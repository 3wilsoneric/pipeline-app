import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral, readOperationalReferral, recordOperationalAcceptance, signOperationalAssessment } from "./support/operational-api";

test.skip(process.env.PIPELINE_DESKTOP_E2E !== "true", "Handoff drafts use the isolated workspace-state store.");

for (const width of [1440, 390, 320]) test.describe(`section editor at ${width}px`, () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width, height: 900 }); });
test("Meet the Client section edit persists, preserves other sections, and survives whole-message preview", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Section Email", owner: "" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await signOperationalAssessment(page.request, assessment);
  await recordOperationalAcceptance(page.request, await readOperationalReferral(page.request, referral.id));
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  const edit = page.getByRole("button", { name: "Edit Meet the client", exact: true });
  let sends = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/meet-client-email")) sends++; });
  await edit.click();
  const text = "Synthetic client prefers a quiet introduction. This is a local editing test.";
  await page.getByRole("textbox", { name: "Edit Meet the client", exact: true }).fill(text);
  await page.getByRole("button", { name: "Done editing Meet the client", exact: true }).click();
  await expect.poll(async () => {
    const data = await (await page.request.get(`/api/referrals/${referral.id}/handoff-recipients?community=San%20Pablo`)).json();
    return data.draft?.message?.sectionEdits?.bio?.text;
  }).toBe(text);
  await page.reload();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Med room", exact: true })).toBeVisible();
  await page.getByText(text, { exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(sends).toBe(0);
  await page.screenshot({ path: test.info().outputPath("section-edit.png"), fullPage: true });
  await page.getByRole("button", { name: "Edit message", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Meet the Client message" })).toHaveValue(new RegExp(text));
  if (width === 1440) {
    await page.getByRole("button", { name: "Back to email preview", exact: true }).click();
    const endpoint = `/api/referrals/${referral.id}/handoff-recipients`;
    const saved = await (await page.request.get(endpoint)).json();
    const source = saved.draft.message.sectionEdits.bio.source;
    saved.draft.message.sectionEdits.bio.source = "Previous synthetic chart content";
    const stale = await page.request.put(endpoint, { data: { if_match: saved.version, draft: saved.draft } });
    expect(stale.status(), await stale.text()).toBe(200);
    await page.reload();
    await expect(page.getByText("Chart updated", { exact: true })).toBeVisible();
    await page.getByText("Compare with the chart", { exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Chart updated" }).getByText(source, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Keep my edit", exact: true }).click();
    await expect.poll(async () => (await (await page.request.get(endpoint)).json()).draft?.message?.sectionEdits?.bio?.source).toBe(source);
    await expect(page.getByText("Chart updated", { exact: true })).toHaveCount(0);
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Use chart text", exact: true }).click();
    await expect.poll(async () => (await (await page.request.get(endpoint)).json()).draft?.message?.sectionEdits?.bio).toBeUndefined();
    await page.reload();
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
    expect(sends).toBe(0);
  }
});

});
