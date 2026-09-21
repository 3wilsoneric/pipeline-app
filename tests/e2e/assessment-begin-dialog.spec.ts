import { expect, test, webkit } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { createOperationalAssessment, createOperationalReferral, scheduleOperationalAssessment } from "./support/operational-api";

for (const scenario of [
  { width: 1440, height: 900, browser: "chromium" },
  { width: 320, height: 568, browser: "chromium" },
  { width: 390, height: 844, browser: "webkit" },
  { width: 834, height: 1194, browser: "webkit" },
  { width: 1194, height: 834, browser: "webkit" },
]) {
  test(`begin assessment is styled, centered and cancellable at ${scenario.width}px in ${scenario.browser}`, async ({ page: defaultPage, baseURL }, info) => {
    const browser = scenario.browser === "webkit" ? await webkit.launch() : null;
    const context = browser ? await browser.newContext({ baseURL, viewport: scenario, hasTouch: true, isMobile: true }) : null;
    const page = context ? await context.newPage() : defaultPage;
    try {
      await page.setViewportSize(scenario);
      const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Example Begin Dialog", owner: "", tags: [] });
      const assessment = await createOperationalAssessment(page.request, referral.id);
      if (scenario.width === 834) await scheduleOperationalAssessment(page.request, assessment);
      let starts = 0;
      page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith(`/assessments/${assessment.assessment_id}/start`)) starts++; });
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
      const trigger = page.getByRole("button", { name: "Begin assessment", exact: true });
      // Click waits for the workspace to finish restoring and enable the opener.
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Begin assessment", exact: true });
      await expect(dialog).toBeVisible();
      const cancel = dialog.getByRole("button", { name: "Keep preparing", exact: true });
      const begin = dialog.getByRole("button", { name: "Begin assessment", exact: true });
      await expect(cancel).toBeFocused();
      const box = (await dialog.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(480);
      expect(box.x).toBeGreaterThanOrEqual(15);
      expect(box.y).toBeGreaterThanOrEqual(15);
      expect(Math.abs(box.x + box.width / 2 - scenario.width / 2)).toBeLessThan(2);
      expect(Math.abs(box.y + box.height / 2 - scenario.height / 2)).toBeLessThan(2);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect(dialog).toHaveCSS("padding-top", "24px");
      await expect(begin).toHaveCSS("background-color", "rgb(8, 125, 102)");
      await expect(begin).toHaveCSS("color", "rgb(255, 255, 255)");
      for (const button of [cancel, begin]) {
        await expect(button).toBeInViewport();
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
      }
      const cancelBox = (await cancel.boundingBox())!;
      const beginBox = (await begin.boundingBox())!;
      expect(beginBox.x - (cancelBox.x + cancelBox.width)).toBeGreaterThanOrEqual(9);
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
        return (await axe.run('dialog[open]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations;
      });
      expect(violations).toEqual([]);
      await page.screenshot({ path: info.outputPath(`begin-assessment-${scenario.width}.png`), animations: "disabled" });
      await page.keyboard.press("Tab");
      await expect(begin).toBeFocused();
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
      await cancel.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await cancel.click();
      await expect(dialog).toHaveCount(0);
      expect(starts).toBe(0);
      const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
      expect(saved.started_at).toBeFalsy();
      expect(saved.current_location).toBe("Synthetic referral source");
    } finally {
      await context?.close();
      await browser?.close();
    }
  });
}

test("begin confirmation blocks dismissal while starting and preserves retry after failure", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Example Begin Retry", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  const endpoint = `/api/assessments/${assessment.assessment_id}/start`;
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let starts = 0;
  await page.route(`**${endpoint}`, async (route) => {
    starts++;
    await pending;
    await route.fulfill({ status: 503, json: { error: "Synthetic start interruption" } });
  });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
  await page.getByRole("button", { name: "Begin assessment", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Begin assessment", exact: true });
  await dialog.getByRole("button", { name: "Begin assessment", exact: true }).click();
  await expect.poll(() => starts).toBe(1);
  await expect(dialog.getByRole("button", { name: "Starting...", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Keep preparing", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  release();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Start time not saved. You can keep answering.", { exact: true })).toBeVisible();
  const beforeRetry = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(beforeRetry.started_at).toBeFalsy();
  expect(beforeRetry.current_location).toBe("Synthetic referral source");
  await page.unroute(`**${endpoint}`);
  await page.getByRole("button", { name: "Retry start time", exact: true }).click();
  await dialog.getByRole("button", { name: "Begin assessment", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  expect(saved.started_at).toBeTruthy();
  expect(saved.current_location).toBe("Synthetic referral source");
});
