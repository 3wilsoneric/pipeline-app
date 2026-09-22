import { expect, test, type Page } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { microsoftCallback, microsoftMetadata, mockOutlookSignInError } from "./support/outlook-auth";

// Provider and API fault injection must reach this page, including on WebKit.
test.use({ serviceWorkers: "block" });

const clientId = "00000000-0000-4000-8000-000000000001";
const setup = { outlook_client_id: clientId, account_id: "fixture-assessor", account_email: "assessor@example.invalid", demo: false, can_connect: true };

async function unconnectedOutlook(page: Page, error = "login_required") {
  await mockOutlookSignInError(page, error);
  await page.route("**/api/me/outlook", route => route.fulfill({ json: setup }));
}

async function connectedOutlook(page: Page) {
  let nonce = "", tokenRequests = 0;
  await page.route("https://login.microsoftonline.com/**", route => {
    const request = new URL(route.request().url());
    if (request.pathname.includes(".well-known")) return route.fulfill({ json: microsoftMetadata() });
    if (request.pathname.endsWith("/authorize")) {
      nonce = request.searchParams.get("nonce")!;
      const callback = new URL(request.searchParams.get("redirect_uri")!);
      callback.hash = new URLSearchParams({ code: "synthetic-code", state: request.searchParams.get("state")! }).toString();
      return microsoftCallback(route, callback);
    }
    if (request.pathname.endsWith("/token")) {
      tokenRequests++;
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const claims = { aud: clientId, iss: "https://login.microsoftonline.com/fixture/v2.0", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 86_400, nonce, sub: "fixture-user", oid: "fixture-user", tid: "fixture-tenant", preferred_username: setup.account_email };
      return route.fulfill({ json: { token_type: "Bearer", scope: "https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/User.Read", expires_in: 3600, access_token: `synthetic-token-${tokenRequests}`, refresh_token: "synthetic-refresh", id_token: `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}.synthetic`, client_info: encode({ uid: "fixture-user", utid: "fixture-tenant" }) } });
    }
    return route.abort();
  });
  return () => tokenRequests;
}

test("a temporary provider failure never opens the Outlook connection prompt", async ({ page }, info) => {
  await unconnectedOutlook(page, "temporarily_unavailable");
  let popups = 0;
  page.on("popup", () => { popups++; });
  await page.goto("/settings");
  const settings = page.getByRole("region", { name: "Outlook connection", exact: true });
  await expect(settings.getByRole("button", { name: "Retry connection check", exact: true })).toBeVisible();
  await expect(settings).toContainText("Check unavailable");
  await expect(settings.getByRole("button", { name: "Connect Outlook", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("outlook-check-retry.png"), animations: "disabled" });
  await page.goto("/?view=referrals");
  await expect(page.getByRole("heading", { name: "Referral workspaces", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Connect your Outlook", exact: true })).toHaveCount(0);
  expect(popups).toBe(0);
});

test("saved Outlook connection survives a failed verification and renews an expired token without prompting", async ({ page }) => {
  await page.clock.install();
  const tokenRequests = await connectedOutlook(page);
  let status = 200, checks = 0, popups = 0;
  await page.route("**/api/me/outlook", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: setup });
    checks++;
    return route.fulfill({ status, json: status === 200 ? { mailbox: setup.account_email } : { error: "Synthetic Outlook check unavailable" } });
  });
  page.on("popup", () => { popups++; });
  await page.goto("/settings");
  const settings = page.getByRole("region", { name: "Outlook connection", exact: true });
  await expect(settings).toContainText("Outlook is connected");
  const firstTokens = tokenRequests();
  status = 503;
  await page.reload();
  await expect(settings.getByRole("button", { name: "Retry connection check", exact: true })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Connect Outlook", exact: true })).toHaveCount(0);
  const before = checks;
  await page.goto("/?view=referrals");
  await expect.poll(() => checks).toBeGreaterThan(before);
  await expect(page.getByRole("dialog", { name: "Connect your Outlook", exact: true })).toHaveCount(0);
  status = 200;
  await page.clock.setFixedTime(new Date(Date.now() + 70 * 60 * 1000));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(tokenRequests).toBeGreaterThan(firstTokens);
  await page.goto("/settings");
  await expect(settings).toContainText("Outlook is connected");
  expect(popups).toBe(0);
});

test("the static Outlook callback supports same-origin restoration while app pages reject framing", async ({ request }) => {
  const callback = await request.get("/outlook-auth.html");
  expect(callback.ok()).toBe(true);
  expect(callback.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  expect(callback.headers()["content-security-policy"]).toBe("default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self';");
  expect(callback.headers()["cache-control"]).toContain("no-store");
  const app = await request.get("/?view=referrals");
  expect(app.headers()["x-frame-options"]).toBe("DENY");
  expect(app.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});

for (const width of [1440, 834, 390, 320]) test(`Outlook is offered before a handoff with a dismissible prompt at ${width}px`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 850 });
  await unconnectedOutlook(page);
  let popups = 0;
  page.on("popup", () => { popups++; });
  await page.goto("/?view=referrals");
  const dialog = page.getByRole("dialog", { name: "Connect your Outlook", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Connect Outlook", exact: true })).toBeEnabled();
  await expect(dialog).toContainText(setup.account_email);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    return (await axe.run('dialog[aria-label="Connect your Outlook"]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations;
  });
  expect(violations).toEqual([]);
  await page.screenshot({ path: info.outputPath(`outlook-prompt-${width}.png`), animations: "disabled" });
  await dialog.getByRole("button", { name: "Connect later", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload(); await expect(page.getByRole("heading", { name: "Referral workspaces", exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(popups).toBe(0);
  const nextVisit = await context.newPage();
  await unconnectedOutlook(nextVisit);
  await nextVisit.goto("/?view=referrals");
  await expect(nextVisit.getByRole("dialog", { name: "Connect your Outlook", exact: true })).toBeVisible();
  await nextVisit.close();
  await page.goto("/settings");
  const settings = page.getByRole("region", { name: "Outlook connection", exact: true });
  await expect(settings.getByRole("button", { name: "Connect Outlook", exact: true })).toBeEnabled();
  await expect(dialog).toHaveCount(0);
});

test("demo and delegated accounts do not receive a live connection prompt", async ({ page }) => {
  await page.goto("/settings");
  const settings = page.getByRole("region", { name: "Outlook connection", exact: true });
  await expect(settings).toContainText("Not production yet");
  await expect(settings.getByRole("button", { name: "Connect Outlook", exact: true })).toBeDisabled();
  await expect(page.getByRole("dialog", { name: "Connect your Outlook", exact: true })).toHaveCount(0);
  const denied = await page.request.post("/api/me/outlook");
  expect(denied.status()).toBe(403); expect(await denied.text()).toContain("Not production yet");
  await page.route("**/api/me/outlook", route => route.fulfill({ json: { ...setup, can_connect: false } }));
  await page.reload(); await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect(settings).toHaveCount(0);
});
