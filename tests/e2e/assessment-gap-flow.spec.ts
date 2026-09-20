import { expect, test } from "@playwright/test";
import { returnToAssessmentQuestions } from "./support/assessment-navigation";
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
  test(`assessment starts with the actual information, not repeated headings, at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?view=referrals&screen=packet&trainingAssessment=prepare&workspaceStage=assessment&assessmentSection=prior_history");
    const folder = page.getByTestId("assessment-client-folder");
    for (const text of ["Fill the gaps", "Placement trajectory", "Hospital and crisis history", "Fill in recent stays and what led to this referral.", "Fill what is missing. Recorded answers are in Client info."]) {
      await expect(folder.getByText(text, { exact: true })).toHaveCount(0);
    }
    const question = folder.getByRole("textbox", { name: "Prior AWOL / failed placements", exact: true });
    await expect(question).toBeInViewport();
    if (width >= 640) {
      const editor = folder.locator("[data-assessment-question-page]");
      const field = editor.locator("[data-working-field]").first();
      expect((await field.boundingBox())!.y - (await editor.boundingBox())!.y).toBeLessThan(40);
      await expect(editor.getByRole("heading")).toHaveCount(0);
      const reference = folder.getByRole("complementary", { name: "Current information" });
      const recorded = reference.getByRole("button", { name: "Edit Prior placements", exact: true });
      await expect(recorded).toBeInViewport();
      const reading = reference.locator("[data-assessment-reference-page]");
      expect((await recorded.boundingBox())!.y - (await reading.boundingBox())!.y).toBeLessThan(40);
      await recorded.click();
      await expect(folder.getByRole("textbox", { name: "Prior placements", exact: true })).toBeFocused();
    } else {
      await expect(folder.getByText("Question 1 of 3", { exact: true })).toBeVisible();
      await expect(folder.getByText(/gaps this visit|3 in the chart|to finish here/)).toHaveCount(0);
      await expect(folder.getByRole("button", { name: "Next", exact: true })).toBeInViewport();
    }
    await page.screenshot({ path: info.outputPath(`direct-assessment-${width}.png`) });
  });
}

for (const width of [1440, 768, 390, 320]) {
  test(`assessment fills chart gaps without re-asking recorded answers at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 650 : 950 });
    await page.goto("/?view=referrals&screen=packet&trainingAssessment=prepare&workspaceStage=assessment&assessmentSection=identity");
    const folder = page.getByTestId("assessment-client-folder");
    const footer = folder.locator('footer[aria-label="Assessment actions"]');
    await expect(folder.locator('summary[aria-label="More assessment actions"]')).toHaveCount(0);
    await expect(footer.getByRole("button", { name: "Review chart", exact: true })).toHaveCount(0);
    await expect(folder).toContainText(width < 640 ? "Section complete" : "This section is complete");
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
      await expect(reference.getByRole("combobox", { name: "Reference information", exact: true })).toHaveValue("section");
      await expect(reference).not.toContainText("Synthetic interview gap completed");
      await reference.getByRole("button", { name: "Review Ambulatory", exact: true }).click();
      await questions.getByRole("group", { name: "Ambulatory", exact: true }).getByRole("button", { name: "No", exact: true }).click();
      await questions.getByRole("button", { name: "Next", exact: true }).click();
      await expect(questions.getByPlaceholder("Type of device", { exact: true })).toBeVisible();
    } else {
      await page.getByLabel("Assessment section", { exact: true }).selectOption("medication");
      await next.click();
      // Completed sections keep their place in the itinerary.
      await expect(page).toHaveURL(/assessmentSection=prior_placement/);
      await next.click();
      await expect(page).toHaveURL(/assessmentSection=prior_history/);
      await page.getByLabel("Assessment section", { exact: true }).selectOption("provenance_qc");
      await footer.getByRole("button", { name: "Review assessment", exact: true }).click();
      await expect(page.getByRole("region", { name: "Assessment chart review" })).toContainText("Synthetic interview gap completed");
      await expect(footer.getByRole("button", { name: "Sign assessment", exact: true })).toBeVisible();
      await returnToAssessmentQuestions(page);
    }
    await page.screenshot({ path: info.outputPath(`gap-flow-${width}.png`) });
  });
}
