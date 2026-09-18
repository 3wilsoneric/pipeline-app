import { expect, test } from "@playwright/test";
import type { AxeResults } from "axe-core";

for (const width of [1440, 1024, 768, 640]) {
  test(`section bar separates progress and keeps its controls usable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?view=referrals&screen=packet&trainingAssessment=prepare&workspaceStage=assessment&assessmentSection=diagnosis_clinical");
    const bar = page.getByRole("navigation", { name: "Assessment sections", exact: true });
    const section = bar.getByRole("combobox", { name: "Assessment section", exact: true });
    const progress = bar.getByRole("status");
    const search = bar.locator('summary[aria-label="Find assessment question"]');
    await expect(progress).toHaveText("1 to finish");
    await expect(section.locator("option:checked")).toHaveText("How things are now");
    await expect(search).toHaveAttribute("title", "Find a question");
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(62);
    await page.screenshot({ path: info.outputPath(`section-bar-${width}.png`) });

    const answer = page.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
    await answer.fill("Synthetic documented answer");
    await answer.blur();
    await expect(progress).toHaveText("Recorded");
    await section.selectOption("legal_conservatorship");
    const boxes = await Promise.all([section.boundingBox(), progress.boundingBox(), search.boundingBox()]);
    expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x);
    expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x);
    expect(boxes[2]!.width).toBeGreaterThanOrEqual(44);
    expect(boxes[2]!.height).toBeGreaterThanOrEqual(44);
    expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

    await search.focus();
    await search.press("Enter");
    const input = bar.getByRole("searchbox", { name: "Find assessment question", exact: true });
    await expect(input).toBeFocused();
    await input.fill("Prior AWOL");
    const result = bar.getByRole("button", { name: /Prior AWOL \/ failed placements/ });
    await expect(result).toBeVisible();
    await input.press("Escape");
    await expect(search).toBeFocused();
    await expect(input).not.toBeVisible();
    await search.press("Enter");
    await expect(input).toBeFocused();
    await input.fill("Prior AWOL");
    await result.click();
    await expect(page.getByRole("textbox", { name: "Prior AWOL / failed placements", exact: true })).toBeFocused();
    await expect(section).toHaveValue("prior_history");
    await expect(input).not.toBeVisible();

    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
      return (await axe.run('[aria-label="Assessment sections"]', { runOnly: ["color-contrast", "select-name", "button-name"] })).violations;
    });
    expect(violations).toEqual([]);
  });
}
