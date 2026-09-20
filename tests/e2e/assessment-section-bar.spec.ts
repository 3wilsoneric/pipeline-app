import { chromium, expect, test, webkit } from "@playwright/test";
import type { AxeResults } from "axe-core";

for (const [browserName, browserType] of [["chromium", chromium], ["webkit", webkit]] as const) {
test.describe(browserName, () => {

for (const width of [1440, 1024, 768, 640]) {
  test(`section navigation is legible, ordered and paired with current information at ${width}px`, async ({ baseURL }, info) => {
    const browser = await browserType.launch();
    try {
    const page = await browser.newPage({ baseURL });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?view=referrals&screen=packet&trainingAssessment=prepare&workspaceStage=assessment&assessmentSection=diagnosis_clinical");
    const bar = page.getByRole("navigation", { name: "Assessment sections", exact: true });
    const section = bar.getByRole("combobox", { name: "Assessment section", exact: true });
    const progress = bar.getByRole("status");
    const paging = page.getByRole("navigation", { name: "Assessment section steps" });
    const previous = paging.getByRole("button", { name: "Previous section", exact: true });
    const next = paging.getByRole("button", { name: "Next section", exact: true });
    const reference = page.getByRole("complementary", { name: "Current information", exact: true });
    await expect(progress).toHaveText("1 unanswered");
    await expect(bar).toContainText("Section 2 of 12");
    await expect(section.locator("option:checked")).toHaveText("How things are now");
    await expect(bar.locator('input, summary')).toHaveCount(0);
    await expect(reference.getByRole("combobox")).toHaveCount(0);
    // The narrow-tablet layout deliberately stacks the progress row below the select.
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(width >= 760 && width < 960 ? 104 : 82);
    await page.screenshot({ path: info.outputPath(`section-bar-${width}.png`) });

    const order = await section.locator("option").evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value));
    const answer = page.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
    await answer.fill("Synthetic documented answer");
    await answer.blur();
    await expect(progress).toHaveText("Complete");
    expect(await section.locator("option").evaluateAll((items) => items.map((item) => (item as HTMLOptionElement).value))).toEqual(order);

    // Completed sections stay in place. Back and Next are exact inverses.
    await previous.click();
    await expect(section).toHaveValue("identity");
    await expect(previous).toBeDisabled();
    await next.click();
    await expect(section).toHaveValue("diagnosis_clinical");
    await expect(progress).toHaveText("Complete");
    if (width < 760) await reference.getByRole("button", { name: "Current information", exact: true }).click();
    const recorded = reference.getByRole("button", { name: "Edit Secondary diagnosis", exact: true });
    await expect(recorded).toContainText("Synthetic documented answer");
    await recorded.click();
    await expect(answer).toBeFocused();

    await next.click();
    await expect(section).toHaveValue("functional_adl");
    await expect(reference).not.toContainText("Synthetic documented answer");
    await expect(bar).toContainText("Section 3 of 12");
    await previous.click();
    await expect(section).toHaveValue("diagnosis_clinical");
    await section.selectOption("legal_conservatorship");
    expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const control of [previous, next, section]) {
      await expect(control).toBeInViewport();
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await section.selectOption("provenance_qc");
    await expect(bar).toContainText("Section 12 of 12");
    await expect(paging.getByRole("button", { name: "Review assessment", exact: true })).toBeVisible();
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
      return (await axe.run('[aria-label="Assessment sections"], [aria-label="Assessment section steps"]', { runOnly: ["color-contrast", "select-name", "button-name"] })).violations;
    });
    expect(violations).toEqual([]);
    } finally { await browser.close(); }
  });
}

for (const width of [390, 320]) {
  test(`phone section position and current information stay together at ${width}px`, async ({ baseURL }, info) => {
    const browser = await browserType.launch();
    try {
    const page = await browser.newPage({ baseURL, hasTouch: true, isMobile: true });
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?view=referrals&screen=packet&trainingAssessment=prepare&workspaceStage=assessment&assessmentSection=diagnosis_clinical");
    const interview = page.locator("[data-phone-interview]");
    await expect(interview).toContainText("Section 2 of 12");
    await expect(interview).toContainText("Question 1 of 1");
    await interview.getByRole("textbox", { name: "Secondary diagnosis", exact: true }).fill("Synthetic mobile section note");
    await interview.getByRole("button", { name: "Next section", exact: true }).click();
    await expect(interview).toContainText("Section 3 of 12");
    await interview.getByRole("button", { name: "Client info", exact: true }).click();
    const reference = page.getByRole("dialog", { name: "Client information", exact: true });
    await expect(reference).not.toContainText("Synthetic mobile section note");
    await expect(reference.getByRole("combobox", { name: "Reference information", exact: true })).toHaveValue("section");
    await page.keyboard.press("Escape");
    await expect(interview.getByRole("button", { name: "Client info", exact: true })).toBeFocused();
    await interview.getByRole("button", { name: "Previous question", exact: true }).click();
    await expect(interview).toContainText("Section 2 of 12");
    await interview.getByRole("button", { name: "Client info", exact: true }).click();
    await expect(reference).toContainText("Synthetic mobile section note");
    await reference.getByRole("button", { name: "Review Secondary diagnosis", exact: true }).click();
    await expect(interview.getByRole("textbox", { name: "Secondary diagnosis", exact: true })).toHaveValue("Synthetic mobile section note");
    await interview.getByRole("button", { name: "Choose questionnaire section" }).click();
    const sections = page.getByRole("dialog", { name: "Questionnaire sections", exact: true });
    await expect(sections.getByRole("searchbox", { name: "Find a question", exact: true })).toBeVisible();
    await expect(sections.locator('[aria-current="step"]')).toContainText("2. How things are now");
    await sections.getByRole("button", { name: /^7\. Recent care and history/ }).click();
    await expect(interview).toContainText("Section 7 of 12");
    await expect(interview.getByRole("textbox", { name: "Prior AWOL / failed placements", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`phone-navigation-${width}.png`) });
    } finally { await browser.close(); }
  });
}
});
}
