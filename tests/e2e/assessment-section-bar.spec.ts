import { openAssessmentFixture } from "./support/assessment-fixture";
import { closeTestBrowser } from "./support/browser-lifecycle";
import { chromium, expect, test, webkit } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { editPreparedAnswer } from "./support/assessment-navigation";

for (const [browserName, browserType] of [["chromium", chromium], ["webkit", webkit]] as const) {
test.describe(browserName, () => {

for (const width of [1440, 1024, 768, 640]) {
  test(`section navigation is legible, ordered and paired with current information at ${width}px`, async ({ baseURL }, info) => {
    const browser = await browserType.launch();
    try {
    const page = await browser.newPage({ baseURL });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fixture = await openAssessmentFixture(page, { mode: "interview", section: "diagnosis_clinical" });
    const bar = page.getByRole("navigation", { name: "Assessment sections", exact: true });
    const section = bar.getByRole("combobox", { name: "Assessment section", exact: true });
    const reference = page.getByRole("complementary", { name: "Current information", exact: true });
    const finish = page.locator('footer[aria-label="Assessment actions"]').getByRole("button", { name: "Continue to decision", exact: true });
    await expect(section.locator("option:checked")).toHaveText("How things are now");
    await expect(reference.locator('[data-split-topic="diagnosis_clinical"]')).toBeVisible();
    await expect(bar.locator('input, summary')).toHaveCount(0);
    await expect(reference.getByRole("combobox")).toHaveCount(0);
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(width >= 760 && width < 960 ? 104 : 82);
    await page.screenshot({ path: info.outputPath(`section-bar-${width}.png`) });

    const order = await section.locator("option").evaluateAll(items => items.map(item => (item as HTMLOptionElement).value));
    expect(order).toEqual(["all-questions", "identity", "diagnosis_clinical", "functional_adl", "physical_health", "medication", "prior_placement", "prior_history", "substance_use", "behavioral_risk", "legal_conservatorship", "social_support", "provenance_qc"]);
    await editPreparedAnswer(page, "Current symptoms");
    const answer = page.getByRole("textbox", { name: "Current symptoms", exact: true });
    await answer.fill("Synthetic documented answer");
    await answer.blur();
    await expect.poll(async () => (await fixture.read()).current_symptoms).toBe("Synthetic documented answer");
    expect(await section.locator("option").evaluateAll(items => items.map(item => (item as HTMLOptionElement).value))).toEqual(order);

    // The continuous interview uses its section picker in both directions.
    // Phone Previous/Next paging is verified separately below.
    await section.selectOption("identity");
    await expect(reference.locator('[data-split-topic="identity"]')).toBeVisible();
    await section.selectOption("diagnosis_clinical");
    const recorded = reference.getByRole("button", { name: "Edit Current symptoms", exact: true });
    await expect(recorded).toContainText("Synthetic documented answer");
    await recorded.click();
    await expect(answer).toBeFocused();
    await section.selectOption("functional_adl");
    await expect(reference.locator('[data-split-topic="functional_adl"]')).toBeVisible();
    await expect(reference).not.toContainText("Synthetic documented answer");
    await section.selectOption("diagnosis_clinical");
    await expect(answer).toHaveValue("Synthetic documented answer");
    await section.selectOption("legal_conservatorship");
    expect(await bar.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const control of [section, finish]) {
      await expect(control).toBeInViewport();
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await section.selectOption("provenance_qc");
    await expect(reference.locator('[data-split-topic="provenance_qc"]')).toBeVisible();
    await expect(finish).toBeVisible();
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
      return (await axe.run('[aria-label="Assessment sections"], footer[aria-label="Assessment actions"]', { runOnly: ["color-contrast", "select-name", "button-name"] })).violations;
    });
    expect(violations).toEqual([]);
    } finally { await closeTestBrowser(browser); }
  });
}

for (const width of [390, 320]) {
  test(`phone section position and current information stay together at ${width}px`, async ({ baseURL }, info) => {
    const browser = await browserType.launch();
    try {
    const page = await browser.newPage({ baseURL, hasTouch: true, isMobile: true });
    await page.setViewportSize({ width, height: 800 });
    await openAssessmentFixture(page, { mode: "interview", section: "diagnosis_clinical" });
    const interview = page.locator("[data-phone-interview]");
    await expect(interview.getByRole("button", { name: "Choose questionnaire section" })).toHaveAttribute("title", /^Section 2 of 12:/);
    await editPreparedAnswer(page, "Current symptoms");
    await expect(interview).toContainText("Question 1 of 1");
    await interview.getByRole("textbox", { name: "Current symptoms", exact: true }).fill("Synthetic mobile section note");
    await interview.getByRole("button", { name: "Next section", exact: true }).click();
    await expect(interview.getByRole("button", { name: "Choose questionnaire section" })).toHaveAttribute("title", /^Section 3 of 12:/);
    await interview.getByRole("button", { name: "Client info", exact: true }).click();
    const reference = page.getByRole("dialog", { name: "Client information", exact: true });
    // The reference filter is remembered; explicitly choose this section after
    // editing through the all-sections reference helper.
    await reference.getByRole("combobox", { name: "Reference information", exact: true }).selectOption("section");
    await expect(reference).not.toContainText("Synthetic mobile section note");
    await expect(reference.getByRole("combobox", { name: "Reference information", exact: true })).toHaveValue("section");
    await page.keyboard.press("Escape");
    await expect(interview.getByRole("button", { name: "Client info", exact: true })).toBeFocused();
    await interview.getByRole("button", { name: "Previous question", exact: true }).click();
    await expect(interview.getByRole("button", { name: "Choose questionnaire section" })).toHaveAttribute("title", /^Section 2 of 12:/);
    await interview.getByRole("button", { name: "Client info", exact: true }).click();
    await expect(reference).toContainText("Synthetic mobile section note");
    await reference.getByRole("button", { name: "Review Current symptoms", exact: true }).click();
    await expect(interview.getByRole("textbox", { name: "Current symptoms", exact: true })).toHaveValue("Synthetic mobile section note");
    await interview.getByRole("button", { name: "Choose questionnaire section" }).click();
    const sections = page.getByRole("dialog", { name: "Questionnaire sections", exact: true });
    await expect(sections.getByRole("searchbox", { name: "Find a question", exact: true })).toBeVisible();
    await expect(sections.locator('[aria-current="step"]')).toContainText("2. How things are now");
    await sections.getByRole("button", { name: /^7\. Recent care and history/ }).click();
    await expect(interview.getByRole("button", { name: "Choose questionnaire section" })).toHaveAttribute("title", /^Section 7 of 12:/);
    await expect(interview.getByRole("textbox", { name: "Prior AWOL / failed placements", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`phone-navigation-${width}.png`) });
    } finally { await closeTestBrowser(browser); }
  });
}
});
}
