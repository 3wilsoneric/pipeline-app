import { expect, test } from "@playwright/test";
import { assessmentConversationSections, assessmentGapSections } from "../../components/pipeline/assessment-working-view";
import { assessmentInterviewSections } from "../../lib/assessment/assessment-interview-schema";
import { buildTrainingAssessment } from "../../lib/training/mock-assessment";

test("gap itinerary retains every canonical section, zeros, and source checks", () => {
  const data = buildTrainingAssessment("interview");
  data.secondary_diagnoses = ["Synthetic documented answer"];
  data.prior_hospitalizations_count = 0;
  data.current_symptoms = "unable_to_assess";
  data.unable_to_assess_reasons = {};
  const itinerary = assessmentGapSections(data, ["secondary_diagnoses"]);
  expect(assessmentConversationSections.map((section) => section.key).sort()).toEqual(assessmentInterviewSections.map((section) => section.key).sort());
  expect(itinerary.find((section) => section.key === "identity")!.remaining).toHaveLength(0);
  expect(itinerary.find((section) => section.key === "diagnosis_clinical")!.remaining.map((question) => question.field)).toEqual(["secondary_diagnoses", "current_symptoms"]);
  expect(itinerary.flatMap((section) => section.remaining).map((question) => question.field)).not.toContain("prior_hospitalizations_count");
  data.unable_to_assess_reasons = { current_symptoms: "Client requested a break." };
  expect(assessmentGapSections(data, []).find((section) => section.key === "diagnosis_clinical")!.remaining).toHaveLength(0);
});

for (const width of [1440, 768, 390, 320]) {
  test(`assessment fills chart gaps without re-asking recorded answers at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 650 : 950 });
    await page.goto("/?view=referrals&screen=packet&trainingAssessment=prepare&workspaceStage=assessment&assessmentSection=identity");
    const folder = page.getByTestId("assessment-client-folder");
    const footer = folder.locator('footer[aria-label="Assessment actions"]');
    await expect(folder.locator('summary[aria-label="More assessment actions"]')).toHaveCount(0);
    await expect(footer.getByRole("button", { name: "Review chart", exact: true })).toHaveCount(0);
    await expect(folder).toContainText("This section is recorded");
    const next = width < 640 ? folder.getByRole("navigation", { name: "Question steps" }).getByRole("button", { name: "Next section", exact: true }) : footer.getByRole("button", { name: "Next section", exact: true });
    await next.click();
    await expect(page).toHaveURL(/assessmentSection=diagnosis_clinical/);
    const field = folder.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
    await expect(field).toBeVisible();
    const questions = page.locator(width < 640 ? "[data-phone-interview]" : "[data-assessment-question-editor]");
    await expect(questions.locator('[data-working-field="current_symptoms"]')).toHaveCount(0);
    await expect(questions.locator('[data-working-field="cognition_orientation"]')).toHaveCount(0);
    await field.fill("Synthetic interview gap completed");
    await field.blur();
    await expect(field).toBeVisible();
    await expect(field).toHaveValue("Synthetic interview gap completed");
    await expect(page).toHaveURL(/assessmentSection=diagnosis_clinical/);
    await next.click();
    await expect(page).toHaveURL(/assessmentSection=functional_adl/);
    await expect(questions.locator('[data-working-field="ambulatory"]')).toHaveCount(0);
    if (width < 640) {
      await folder.getByRole("button", { name: "Client info", exact: true }).click();
      const reference = page.getByRole("dialog", { name: "Client information", exact: true });
      await reference.getByLabel("Reference information").selectOption("all");
      await expect(reference).toContainText("Synthetic interview gap completed");
      await reference.getByRole("button", { name: "Review Ambulatory", exact: true }).click();
      await questions.getByRole("group", { name: "Ambulatory", exact: true }).getByRole("button", { name: "No", exact: true }).click();
      await questions.getByRole("button", { name: "Next", exact: true }).click();
      await expect(questions.getByPlaceholder("Type of device", { exact: true })).toBeVisible();
    } else {
      await page.getByLabel("Assessment section", { exact: true }).selectOption("medication");
      await next.click();
      // Placement is already documented, so the conversation moves to gaps in history.
      await expect(page).toHaveURL(/assessmentSection=prior_history/);
      await page.getByLabel("Assessment section", { exact: true }).selectOption("provenance_qc");
      await footer.getByRole("button", { name: "Review chart", exact: true }).click();
      await expect(page.getByRole("region", { name: "Assessment chart review" })).toContainText("Synthetic interview gap completed");
      await expect(footer.getByRole("button", { name: "Sign assessment", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Return to questions", exact: true }).click();
    }
    await page.screenshot({ path: info.outputPath(`gap-flow-${width}.png`) });
  });
}
