import { expect, test, webkit } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";

const note = "Synthetic residential placement, January to August 2026. The referral describes support with appointments and a preference for a quiet setting.\n\nThe discharge note records the reason for transition. Confirm the remaining history with the client; do not treat missing information as a negative finding.";

for (const width of [1440, 1024, 834, 640, 390, 320]) {
  test(`reading page preserves readable notes and direct editing at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 650 : 950 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Reading Page", owner: "", tags: [] });
    const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: {
      client_mutation_id: randomUUID(), data: { prior_placements: note, prior_hospitalizations_count: 0, prior_5150_5250_holds: "No holds documented in the supplied synthetic record." },
    } });
    expect(created.status()).toBe(201);
    const { assessment } = await created.json();
    const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=interview&assessmentSection=prior_history`;
    await page.goto(url);
    const phone = width < 640;
    const reference = phone ? page.getByRole("dialog", { name: "Client information", exact: true }) : page.getByRole("complementary", { name: "Current information", exact: true });
    const openReference = async () => {
      if (phone) await page.getByRole("button", { name: "Client info", exact: true }).click();
      else if (width < 960) await reference.getByRole("button", { name: "Current information", exact: true }).click();
    };
    await openReference();
    const recorded = reference.getByRole("button", { name: `${phone ? "Review" : "Edit"} Prior placements`, exact: true });
    const text = recorded.getByText(note, { exact: true });
    await expect(text).toBeVisible();
    await expect(text).toHaveCSS("font-size", "19px");
    await expect(text).toHaveCSS("font-family", await page.locator("body").evaluate((el) => getComputedStyle(el).fontFamily));
    await expect(text).toHaveCSS("white-space", "pre-wrap");
    await expect(reference.getByRole("button", { name: `${phone ? "Review" : "Edit"} Prior hospitalizations`, exact: true })).toContainText("0");
    expect(await reference.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (!phone) await expect(reference.locator("[data-assessment-reference-page]")).toHaveCSS("animation-name", "none");
    await page.screenshot({ path: info.outputPath(`reading-page-${width}.png`), animations: "disabled" });

    await recorded.click();
    const editor = page.getByRole("textbox", { name: "Prior placements", exact: true });
    if (phone) {
      // Phone navigation focuses the question heading without opening the keyboard.
      await expect(page.locator('[data-phone-question-scroll] [tabindex="-1"]')).toBeFocused();
      await expect(editor).toBeVisible();
    } else await expect(editor).toBeFocused();
    await expect(editor).toHaveValue(note);
    const updated = note + "\nSynthetic interview clarification retained.";
    await editor.fill(updated);
    await editor.blur();
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.prior_placements).toBe(updated);
    await page.reload();
    await openReference();
    await expect(recorded).toContainText("Synthetic interview clarification retained.");
    expect(await reference.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
}

test("iPad reading page supports touch editing and leaves section navigation intact", async ({ baseURL }, info) => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 834, height: 1194 }, hasTouch: true, isMobile: true });
    await page.goto("/?view=referrals&screen=packet&trainingAssessment=interview&demo=1&workspaceStage=assessment&assessmentSection=prior_history");
    const reference = page.getByRole("complementary", { name: "Current information", exact: true });
    // The tablet shows a compact reference summary; open it before reading answers.
    await reference.getByRole("button", { name: /^Current information/ }).tap();
    const recorded = reference.getByRole("button", { name: "Edit Prior placements", exact: true });
    await expect(recorded).toBeVisible();
    await page.screenshot({ path: info.outputPath("reading-page-ipad.png"), animations: "disabled" });
    await recorded.tap();
    await expect(page.getByRole("textbox", { name: "Prior placements", exact: true })).toBeFocused();
    await page.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("medication");
    await expect(reference).not.toContainText("facility discharge note");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole("button", { name: "Next section", exact: true })).toBeVisible();
  } finally { await browser.close(); }
});
