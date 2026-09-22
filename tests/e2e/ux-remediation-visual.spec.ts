import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral, createOperationalAssessment } from "./support/operational-api";

for (const width of [1440, 834, 390]) for (const state of ["empty", "partial", "populated"]) {
  test(`UX comparison ${state} at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 834 ? 1112 : 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
      name: `Synthetic ${state} comparison`, community: "San Pablo", owner: "", tags: [],
      phone: state === "empty" ? "" : "555-0101", email: state === "empty" ? "" : "care@example.invalid",
      currentMedications: state === "populated" ? "Synthetic documented medication history for visual verification." : "",
    });
    const assessment = await createOperationalAssessment(page.request, referral.id);
    if (state !== "empty") {
      const response = await page.request.patch(`/api/assessments/${assessment.assessment_id}`, { data: {
        if_match: assessment.version, client_mutation_id: randomUUID(), patch: { data: {
          current_symptoms: "Synthetic recorded interview observations.",
          secondary_diagnoses: ["Synthetic recorded diagnosis"],
          ...(state === "populated" ? { family_involvement: "Synthetic family and support history. ".repeat(15), prior_placements: "Synthetic placement record.", prior_hospitalizations_count: 0 } : {}),
        } },
      } });
      expect(response.ok(), await response.text()).toBe(true);
    }
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=chart`);
    await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toBeVisible();
    await expect(page.getByText("Restoring saved work...", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Loading decision...", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`chart-${state}-${width}.png`), animations: "disabled" });
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=prepare&assessmentSection=diagnosis_clinical`);
    const answer = page.locator("#assessment-secondary_diagnoses");
    await expect(answer).toBeVisible();
    await answer.focus();
    await page.screenshot({ path: info.outputPath(`assessment-${state}-${width}.png`), animations: "disabled" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
      return (await axe.run('[data-testid="packet-workspace"]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations;
    });
    await info.attach("accessibility", { body: JSON.stringify(violations, null, 2), contentType: "application/json" });
    if (process.env.PIPELINE_UX_BASELINE !== "true") expect(violations).toEqual([]);
  });
}
