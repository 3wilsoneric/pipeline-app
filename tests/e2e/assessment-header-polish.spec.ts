import { expect, test, webkit, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { AxeResults } from "axe-core";
import { createOperationalReferral } from "./support/operational-api";

async function createHeaderAssessment(page: Page) {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Header", owner: "", tags: [] });
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: {
    client_mutation_id: randomUUID(), data: {
      diagnosis_categories: ["schizoaffective"], current_symptoms: "Synthetic documented symptoms.",
      prior_placements: "Synthetic prior placement.", prior_hospitalizations_count: 3, prior_5150_5250_holds: "Synthetic prior hold.",
    },
  } });
  expect(created.status(), await created.text()).toBe(201);
  return { referral, url: `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=interview&assessmentSection=diagnosis_clinical` };
}

for (const width of [1440, 1024, 834, 768, 640]) {
  test(`assessment header keeps status legible and navigation usable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
    const { url } = await createHeaderAssessment(page);
    await page.goto(url);
    const header = page.getByRole("navigation", { name: "Assessment sections", exact: true });
    const picker = header.getByRole("combobox", { name: "Assessment section", exact: true });
    const status = header.getByRole("status");
    await expect(status).toHaveText("1 / 2 recorded");
    await expect(status).toHaveCSS("font-size", "14px");
    await expect(page.getByText("Unanswered", { exact: true })).toHaveCount(0);
    await expect(header.getByLabel("Section 2 of 12", { exact: true })).toBeVisible();
    // Browser transforms can report a 44px target as 43.99999px.
    expect((await picker.boundingBox())!.height).toBeGreaterThanOrEqual(43.99);
    expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const answer = page.getByRole("textbox", { name: "Cognition / orientation", exact: true });
    await answer.fill("Synthetic header test answer");
    await answer.blur();
    await expect(status).toHaveText("2 / 2 recorded");
    await picker.focus();
    await picker.selectOption("prior_history");
    await expect(picker).toBeFocused();
    await expect(header.getByLabel("Section 7 of 12", { exact: true })).toBeVisible();
    await expect(status).toHaveText("1 / 3 recorded");
    await page.screenshot({ path: info.outputPath(`assessment-header-${width}.png`), animations: "disabled" });
    await picker.selectOption("legal_conservatorship");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width >= 760 && width <= 959) {
      const title = (await picker.boundingBox())!;
      const count = (await status.boundingBox())!;
      expect(title.width).toBeGreaterThan(300);
      expect(title.x + title.width).toBeLessThanOrEqual(count.x);
    }
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
      return (await axe.run('[aria-label="Assessment sections"]', { runOnly: ["color-contrast", "select-name"] })).violations;
    });
    expect(violations).toEqual([]);
  });
}

test("review warnings remain distinct from unanswered questions", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 950 });
  const { referral, url } = await createHeaderAssessment(page);
  await page.route(`**/api/referrals/${referral.id}/assessments`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.assessments[0].field_provenance.current_symptoms = [{ source_field_key: "current_symptoms", source_file: "Synthetic referral.pdf", confidence: 0.8, review_status: "pending", source_page_no: 2, evidence_url: null }];
    await route.fulfill({ response, json: payload });
  });
  await page.goto(url);
  const header = page.getByRole("navigation", { name: "Assessment sections", exact: true });
  await expect(header.getByRole("status")).toHaveText("0 / 2 recorded1 to verify");
  await expect(page.locator('[data-working-field="current_symptoms"]').getByText("Review", { exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Current information", exact: true })).toContainText("Needs verification");
  expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

for (const width of [390, 320]) {
  test(`phone assessment retains its compact header at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/?view=referrals&screen=packet&trainingAssessment=interview&demo=1&workspaceStage=assessment&assessmentSection=prior_history");
    const interview = page.locator("[data-phone-interview]");
    await expect(interview.getByRole("button", { name: "Choose questionnaire section" })).toHaveAttribute("title", /^Section 7 of 12:/);
    await expect(interview.getByText("Unanswered", { exact: true })).toHaveCount(0);
    await interview.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
    await page.getByRole("dialog", { name: "Questionnaire sections", exact: true }).getByRole("button", { name: /^5\. Medication/ }).click();
    await expect(interview.getByRole("button", { name: "Choose questionnaire section" })).toHaveAttribute("title", /^Section 5 of 12:/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("iPad WebKit retains the native section picker and readable status", async ({ baseURL }, info) => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 834, height: 1194 }, isMobile: true, hasTouch: true });
    await page.goto("/?view=referrals&screen=packet&trainingAssessment=interview&demo=1&workspaceStage=assessment&assessmentSection=prior_history");
    const header = page.getByRole("navigation", { name: "Assessment sections", exact: true });
    await expect(header.getByRole("status")).toHaveCSS("font-size", "14px");
    await header.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("legal_conservatorship");
    await expect(header.getByLabel("Section 10 of 12", { exact: true })).toBeVisible();
    expect(await header.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("assessment-header-ipad.png") });
  } finally { await browser.close(); }
});
