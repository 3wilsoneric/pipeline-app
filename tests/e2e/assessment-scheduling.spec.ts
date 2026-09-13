import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const scheduleUrl = "/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=schedule";
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 740, height: 360 },
]) {
  test(`scheduling fits the full screen at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(scheduleUrl);
    const dialog = page.getByRole("dialog", { name: "Schedule assessment", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("data-assessment-scheduling", "fullscreen");
    expect(await dialog.boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
    const date = dialog.getByLabel("Assessment date and time");
    await expect(date).toBeFocused();
    expect(await date.evaluate((input) => ({
      height: input.getBoundingClientRect().height,
      fontSize: getComputedStyle(input).fontSize,
    }))).toEqual({ height: 56, fontSize: "16px" });
    await expect(dialog.getByRole("button", { name: "Schedule assessment", exact: true })).toBeDisabled();
    await date.fill("2027-09-14T09:30");
    await dialog.getByLabel("Assessment method").selectOption("zoom");
    await dialog.getByLabel("Zoom meeting link").fill("https://example.invalid/synthetic-appointment");

    for (const name of ["Close schedule", "Back to workspace", "Schedule assessment"]) {
      const bounds = await dialog.getByRole("button", { name, exact: true }).boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    }
    const overflowing = await dialog.evaluate((element) => [...element.querySelectorAll("input, select, button, label")].filter((control) => {
      const bounds = control.getBoundingClientRect();
      // Long URLs scroll inside native text inputs; labels and commands must fit.
      return bounds.x < 0 || bounds.right > window.innerWidth + 1 || (control.tagName !== "INPUT" && control.scrollWidth > control.clientWidth + 1);
    }).map((control) => control.getAttribute("aria-label") || control.textContent));
    expect(overflowing).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`appointment-${viewport.width}x${viewport.height}.png`) });

    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (context: Element, options: object) => Promise<{ violations: { id: string; impact: string }[] }> } }).axe;
      const result = await axe.run(document.querySelector('[data-assessment-scheduling="fullscreen"]')!, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
      return result.violations.filter((violation) => ["serious", "critical"].includes(violation.impact)).map((violation) => violation.id);
    });
    expect(violations).toEqual([]);
  });
}

test("keeps scheduling methods, keyboard focus, and unsaved appointment edits usable", async ({ page }) => {
  await page.goto(scheduleUrl);
  const dialog = page.getByRole("dialog", { name: "Schedule assessment", exact: true });
  const date = dialog.getByLabel("Assessment date and time");
  await date.fill("2027-09-14T09:30");
  await dialog.getByLabel("Assessment duration").selectOption("90");
  const method = dialog.getByLabel("Assessment method");
  await expect(dialog.getByLabel("Assessment address")).toBeVisible();
  await method.selectOption("phone");
  await expect(dialog.getByLabel("Phone number to call")).toHaveAttribute("type", "tel");
  await method.selectOption("record_review");
  await expect(dialog.locator("input")).toHaveCount(1);
  await method.selectOption("zoom");
  await dialog.getByLabel("Zoom meeting link").fill("https://example.invalid/synthetic-appointment");
  const save = dialog.getByRole("button", { name: "Schedule assessment", exact: true });
  const close = dialog.getByRole("button", { name: "Close schedule", exact: true });
  await save.focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(save).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Schedule assessment", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(date).toHaveValue("2027-09-14T09:30");
  await expect(dialog.getByLabel("Assessment duration")).toHaveValue("90");
  await expect(method).toHaveValue("zoom");
  await expect(dialog.getByLabel("Zoom meeting link")).toHaveValue("https://example.invalid/synthetic-appointment");
  await close.click();
  await expect(dialog).toHaveCount(0);
});
