import { expect, test, webkit } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { createOperationalAssessment, createOperationalReferral } from "./support/operational-api";

for (const scenario of [
  { width: 1440, height: 900, browser: "chromium" },
  { width: 390, height: 844, browser: "chromium" },
  { width: 320, height: 568, browser: "chromium" },
  { width: 390, height: 844, browser: "webkit" },
]) {
  test(`confirmation is centered, accessible and cancellable at ${scenario.width}px in ${scenario.browser}`, async ({ page: defaultPage, baseURL }, info) => {
    const browser = scenario.browser === "webkit" ? await webkit.launch() : null;
    const context = browser ? await browser.newContext({ baseURL, viewport: scenario }) : null;
    const page = context ? await context.newPage() : defaultPage;
    try {
      await page.setViewportSize(scenario);
      const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Example Jordan Rivera", community: "San Pablo", owner: "", tags: [] });
      const assessment = await createOperationalAssessment(page.request, referral.id);
      const assessmentUrl = `/api/assessments/${assessment.assessment_id}`;
      const read = async () => (await (await page.request.get(assessmentUrl)).json()).assessment;
      let signatures = 0;
      let nativePrompts = 0;
      page.on("dialog", async (dialog) => { nativePrompts++; await dialog.dismiss(); });
      page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith(`${assessmentUrl}/sign`)) signatures++; });
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=review&assessmentSection=provenance_qc`);
      const trigger = page.getByRole("button", { name: "Sign & continue to decision", exact: true });
      await trigger.click();
      const dialog = page.getByRole("alertdialog", { name: "Sign this assessment?", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAccessibleDescription("You can still edit it until Meet the Client is sent. Changes are logged.");
      const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
      const sign = dialog.getByRole("button", { name: "Sign assessment", exact: true });
      await expect(cancel).toBeFocused();
      const box = (await dialog.boundingBox())!;
      expect(Math.abs(box.x + box.width / 2 - scenario.width / 2)).toBeLessThan(2);
      expect(Math.abs(box.y + box.height / 2 - scenario.height / 2)).toBeLessThan(2);
      expect(box.x).toBeGreaterThanOrEqual(15);
      expect(box.y).toBeGreaterThanOrEqual(15);
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
        return (await axe.run('[role="alertdialog"]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations;
      });
      expect(violations).toEqual([]);
      await page.screenshot({ path: info.outputPath("centered-confirmation.png"), animations: "disabled" });
      await page.keyboard.press("Tab");
      await expect(sign).toBeFocused();
      await page.keyboard.press("Tab");
      // Browser chrome may participate in sequential focus; the underlying page must stay inert.
      expect(await dialog.evaluate((element) => element.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
      await cancel.focus();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(signatures).toBe(0);
      expect((await read()).signed_at).toBeNull();

      await trigger.click();
      await cancel.click();
      await expect(trigger).toBeFocused();
      expect(signatures).toBe(0);

      await trigger.click();
      await sign.click();
      await expect(page.getByRole("region", { name: "Admission decision", exact: true })).toBeVisible();
      expect(signatures).toBe(1);
      const saved = await read();
      expect(saved.signed_at).toBeTruthy();
      expect(saved.current_location).toBe("Synthetic referral source");
      expect(saved.meet_client_sent_at).toBeFalsy();
      expect(nativePrompts).toBe(0);
    } finally {
      await context?.close();
      await browser?.close();
    }
  });
}
