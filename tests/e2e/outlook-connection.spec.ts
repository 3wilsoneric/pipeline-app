import { expect, test, type Page } from "@playwright/test";
import type { AxeResults } from "axe-core";

const clientId = "00000000-0000-4000-8000-000000000001";
const setup = { outlook_client_id: clientId, account_id: "fixture-assessor", account_email: "assessor@example.invalid", demo: false, can_connect: true };

async function unconnectedOutlook(page: Page) {
  // Silent restoration finds no Microsoft session; never contact the real provider.
  await page.route("https://login.microsoftonline.com/**", route => {
    const request = new URL(route.request().url());
    if (!request.pathname.endsWith("/authorize")) return route.abort();
    const callback = new URL(request.searchParams.get("redirect_uri")!);
    expect(callback.origin).toBe(new URL(page.url()).origin);
    callback.hash = new URLSearchParams({ error: "login_required", error_description: "No fixture Microsoft session", state: request.searchParams.get("state")! }).toString();
    return route.fulfill({ status: 302, headers: { location: callback.href } });
  });
  await page.route("**/api/me/outlook", route => route.fulfill({ json: setup }));
}

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
