import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral, readOperationalReferral, signOperationalAssessment } from "./support/operational-api";

test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Handoff drafts use the isolated workspace-state store.");

async function messageCase(page: Page) {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Message Client", community: "San Pablo", owner: "", plannedAdmissionDate: "2026-10-01" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await signOperationalAssessment(page.request, assessment);
  await page.route("**/api/community-recipient-lists", (route) => route.fulfill({ json: { lists: [] } }));
  return referral;
}

async function openMessage(page: Page, referralId: number) {
  await page.goto(`/?view=referrals&screen=packet&referralId=${referralId}&workspaceView=email`);
  await page.getByRole("button", { name: "Preview email", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Subject", exact: true })).toBeEditable();
}

for (const width of [1440, 390]) test(`message saves, retains recipients and tracks the admission date at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const referral = await messageCase(page);
  let sends = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/meet-client-email")) sends++; });
  await openMessage(page, referral.id);
  await expect(page.getByRole("link", { name: "Open Client data sheet.html", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Subject", exact: true }).fill("Arrival arrangements");
  await page.getByRole("button", { name: "Edit message", exact: true }).click();
  const body = page.getByRole("textbox", { name: "Meet the Client message" });
  await expect(body).toHaveValue(/Hello team/);
  const text = "Hello team,\nPlease call before arrival. <script>text only</script>";
  await body.fill(text);
  const to = page.getByRole("combobox", { name: /^To/ });
  await to.fill("Care team <care@example.invalid>");
  await to.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Handoff draft saved" })).toBeVisible();
  const endpoint = `/api/referrals/${referral.id}/handoff-recipients`;
  const saved = await (await page.request.get(endpoint)).json();
  expect(saved.draft.message).toEqual({ subject: "Arrival arrangements", body: text });
  expect(saved.draft.to[0].email).toBe("care@example.invalid");
  await page.getByRole("button", { name: "Preview message", exact: true }).click();
  const preview = page.frameLocator('iframe[title="Meet the Client email preview"]');
  await expect(preview.locator("body")).toContainText(text, { useInnerText: true });
  await expect(preview.locator("script")).toHaveCount(0);
  await expect(preview.locator("body")).toContainText("2026-10-01");
  await page.getByRole("button", { name: "Edit message", exact: true }).click();
  await page.screenshot({ path: info.outputPath(`message-editor-${width}.png`) });
  await page.addScriptTag({ path: createRequire(process.cwd() + "/package.json").resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string }[] }> } }).axe;
    return (await axe.run({ include: ['dialog[aria-label="Meet the Client email"]'] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations;
  });
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const current = await readOperationalReferral(page.request, referral.id);
  const changed = await page.request.patch(`/api/referrals/${referral.id}`, { data: { if_match: current.version, patch: { plannedAdmissionDate: "2026-10-02" } } });
  expect(changed.status(), await changed.text()).toBe(200);
  await openMessage(page, referral.id);
  await expect(page.getByRole("textbox", { name: "Subject", exact: true })).toHaveValue("Arrival arrangements");
  await expect(preview.locator("body")).toContainText(text, { useInnerText: true });
  await expect(preview.locator("body")).toContainText("2026-10-02");
  await expect(preview.locator("body")).not.toContainText("2026-10-01");
  expect(sends).toBe(0);
});

test("message save failures retain the draft and retry without losing text", async ({ page }) => {
  const referral = await messageCase(page);
  await openMessage(page, referral.id);
  const endpoint = `**/api/referrals/${referral.id}/handoff-recipients`;
  await page.route(endpoint, (route) => route.request().method() === "PUT" ? route.fulfill({ status: 503, json: { error: "Synthetic save interruption" } }) : route.continue());
  await page.getByRole("button", { name: "Edit message", exact: true }).click();
  const body = page.getByRole("textbox", { name: "Meet the Client message" });
  await body.fill("Keep this message through the interruption.");
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic save interruption" })).toBeVisible();
  await expect(body).toHaveValue("Keep this message through the interruption.");
  await page.unroute(endpoint);
  await page.getByRole("button", { name: "Retry saving", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Handoff draft saved" })).toBeVisible();
  await openMessage(page, referral.id);
  await expect(page.frameLocator('iframe[title="Meet the Client email preview"]').locator("body")).toContainText("Keep this message through the interruption.");
});

test("message draft validation and optimistic versions preserve the saved handoff", async ({ page, baseURL }) => {
  const referral = await messageCase(page);
  const endpoint = `/api/referrals/${referral.id}/handoff-recipients`;
  const draft = { community: "San Pablo", to: [], cc: [], message: { subject: "Arrival", body: "Call before arrival." } };
  expect((await page.request.put(endpoint, { data: { if_match: 0, draft } })).status()).toBe(200);
  expect((await page.request.put(endpoint, { data: { if_match: 0, draft: { ...draft, message: { ...draft.message, body: "Stale edit" } } } })).status()).toBe(409);
  for (const message of [{ subject: "Bad\r\nBcc: injected@example.invalid", body: "Okay" }, { subject: "Okay", body: "x".repeat(20_001) }, { subject: "Okay", body: 42 }]) {
    expect((await page.request.put(endpoint, { data: { if_match: 1, draft: { ...draft, message } } })).status()).toBe(400);
  }
  expect((await page.request.put(endpoint, { headers: { Origin: "https://untrusted.example.invalid" }, data: { if_match: 1, draft } })).status()).toBe(403);
  expect((await page.request.put(endpoint, { headers: { Origin: baseURL! }, data: { if_match: 1, draft: { ...draft, community: "Turlock" } } })).status()).toBe(409);
  const saved = await (await page.request.get(endpoint)).json();
  expect(saved.version).toBe(1);
  expect(saved.draft.message).toEqual(draft.message);
  expect((await page.request.post(`/api/referrals/${referral.id}/meet-client-email`, { data: { if_match: referral.version, confirmed: true, recipients: ["care@example.invalid"], message: draft.message, client_mutation_id: randomUUID() } })).status()).toBe(403);
});
