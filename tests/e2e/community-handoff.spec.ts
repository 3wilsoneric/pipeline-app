import { openRecipients } from "./support/handoff-review";
import { readFile } from "node:fs/promises";
import { readPdfText } from "./support/pdf";
import { expect, test, type Page } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral, readOperationalReferral, recordOperationalAcceptance, signOperationalAssessment } from "./support/operational-api";

test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Recipient drafts require the isolated desktop workspace-state store.");

const contact = (name: string, email: string) => ({ name, email: `${email}@example.invalid` });
const lists = [
  { community: "San Pablo", to: [contact("Care team", "care"), contact("Medication team", "meds")], cc: [contact("Admissions", "admissions")] },
  { community: "Turlock", to: [contact("Turlock team", "turlock")], cc: [contact("Coordination", "coordination")] },
].map((list) => ({ ...list, version: 1, sourceDates: ["2026-09-15"], updatedAt: null }));

async function openHandoff(page: Page, referralId: number) {
  const assessment = await createOperationalAssessment(page.request, referralId);
  await signOperationalAssessment(page.request, assessment);
  await recordOperationalAcceptance(page.request, await readOperationalReferral(page.request, referralId));
  await page.route("**/api/community-recipient-lists", (route) => route.fulfill({ json: { lists } }));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referralId}&workspaceView=email`);
  await openRecipients(page);
  await expect(page.getByRole("combobox", { name: /^To/ })).toBeEnabled();
}

test("community defaults, To/Cc edits, reload and community replacement use the actual draft API", async ({ page }, info) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Handoff", owner: "", community: "San Pablo" });
  let sends = 0;
  page.on("request", (request) => { if (request.url().endsWith("/meet-client-email")) sends++; });
  await openHandoff(page, referral.id);
  const to = page.getByRole("list", { name: "To recipients", exact: true });
  const cc = page.getByRole("list", { name: "Cc recipients", exact: true });
  await expect(to).toContainText("Care team");
  await expect(cc).toContainText("Admissions");
  await page.getByRole("button", { name: "Remove Medication team from To", exact: true }).click();
  const input = page.getByRole("combobox", { name: /^Cc/ });
  await input.fill("Transport <transport@example.invalid>");
  await input.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Handoff draft saved" })).toBeVisible();
  const endpoint = `/api/referrals/${referral.id}/handoff-recipients`;
  const saved = await (await page.request.get(endpoint)).json();
  expect(saved.version).toBe(2);
  expect(saved.draft.to.map((item: { email: string }) => item.email)).toEqual(["care@example.invalid"]);
  expect(saved.draft.cc.map((item: { email: string }) => item.email)).toEqual(["admissions@example.invalid", "transport@example.invalid"]);
  await page.reload();
  await openRecipients(page);
  await expect(to).not.toContainText("Medication team");
  await expect(cc).toContainText("Transport");
  await page.getByRole("dialog", { name: "Check recipients", exact: true }).getByRole("button", { name: "Back", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Open Client data sheet.pdf", exact: true }).click();
  const sheet = await download;
  expect(sheet.suggestedFilename()).toBe("Client data sheet.pdf");
  const pdf = await readFile((await sheet.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(await readPdfText(pdf)).toContain("Synthetic Handoff");
  await page.getByRole("button", { name: "Confirm packet", exact: true }).click();
  for (const width of [1440, 834, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(to).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByTestId("packet-workspace").evaluate((element) => element.scrollTo({ top: 0 }));
    await page.screenshot({ path: info.outputPath(`contacts-${width}.png`), fullPage: true });
  }
  const current = await readOperationalReferral(page.request, referral.id);
  const changed = await page.request.patch(`/api/referrals/${referral.id}`, { data: { if_match: current.version, patch: { community: "Turlock" } } });
  expect(changed.status(), await changed.text()).toBe(200);
  await page.reload();
  await openRecipients(page);
  await expect(to).toContainText("Turlock team");
  await expect(page.getByRole("region", { name: "Email and referral packet", exact: true })).toContainText("Synthetic Handoff · Turlock");
  await expect(to).not.toContainText("Care team");
  await expect(cc).not.toContainText("Transport");
  await input.fill("New member <new@example.invalid>");
  await input.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Handoff draft saved" })).toBeVisible();
  expect((await (await page.request.get(endpoint)).json()).draft.community).toBe("Turlock");
  expect(sends).toBe(0);
});

test("recipient keyboard suggestions, dismissal, add and chip focus preserve the selected audience", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "", community: "San Pablo" });
  await openHandoff(page, referral.id);
  await page.getByRole("button", { name: "Remove Medication team from To", exact: true }).click();
  const input = page.getByRole("combobox", { name: /^To/ });
  await input.fill("meds");
  await input.press("ArrowDown");
  await expect(page.getByRole("option", { name: /Medication team/ })).toHaveAttribute("aria-selected", "true");
  await input.press("Escape");
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await input.fill("med");
  await input.press("ArrowUp");
  await input.press("Enter");
  const remove = page.getByRole("button", { name: "Remove Medication team from To", exact: true });
  await expect(remove).toBeVisible();
  await expect(input).toHaveValue("");
  await input.press("Backspace");
  await expect(remove).toBeFocused();
  await input.fill("Keyboard <keyboard@example.invalid>");
  await input.press(";");
  await expect(page.getByRole("status").filter({ hasText: "Handoff draft saved" })).toBeVisible();
  const saved = await (await page.request.get(`/api/referrals/${referral.id}/handoff-recipients`)).json();
  expect(saved.draft.to.map((item: { email: string }) => item.email)).toEqual(["care@example.invalid", "meds@example.invalid", "keyboard@example.invalid"]);
  expect(saved.draft.cc.map((item: { email: string }) => item.email)).toEqual(["admissions@example.invalid"]);
});

test("conflicts preserve the saved audience and cross-origin or wrong-community changes are rejected", async ({ page, baseURL }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "", community: "San Pablo" });
  const endpoint = `/api/referrals/${referral.id}/handoff-recipients`;
  const draft = { ...lists[0], community: "San Pablo" };
  const put = (if_match: number, community = "San Pablo") => page.request.put(endpoint, { data: { if_match, draft: { ...draft, community } } });
  expect((await put(0)).status()).toBe(200);
  expect((await put(0)).status()).toBe(409);
  expect((await put(1, "Turlock")).status()).toBe(409);
  expect((await page.request.put(endpoint, { headers: { Origin: "https://untrusted.example.invalid" }, data: { if_match: 1, draft } })).status()).toBe(403);
  const invalid = await page.request.put(endpoint, { headers: { Origin: baseURL! }, data: { if_match: 1, draft: { ...draft, cc: draft.to } } });
  expect(invalid.status()).toBe(400);
  const saved = await page.request.get(endpoint);
  expect(saved.headers()["cache-control"]).toContain("no-store");
  expect((await saved.json()).version).toBe(1);
});

test("failed autosave keeps visible edits and prevents silently abandoning them", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "", community: "San Pablo" });
  await openHandoff(page, referral.id);
  await page.route(`**/api/referrals/${referral.id}/handoff-recipients`, async (route) => {
    if (route.request().method() === "PUT") await route.fulfill({ status: 503, json: { error: "Synthetic storage unavailable" } });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Remove Care team from To", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Synthetic storage unavailable" })).toBeVisible();
  await expect(page.getByRole("list", { name: "To recipients", exact: true })).not.toContainText("Care team");
  await expect(page.getByRole("combobox", { name: /^To/ })).toBeDisabled();
  const stored = await (await page.request.get(`/api/referrals/${referral.id}/handoff-recipients`)).json();
  expect(stored.version).toBe(0);
  expect(stored.draft).toBeNull();
});
