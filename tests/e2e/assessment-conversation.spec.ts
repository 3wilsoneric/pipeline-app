import { expect, test } from "@playwright/test";
import { assessmentAnswerOrigin, assessmentQuestionStatus, assessmentWorkingSections } from "../../components/pipeline/assessment-working-view";
import { buildTrainingAssessment } from "../../lib/training/mock-assessment";
import type { AxeResults } from "axe-core";
import { randomUUID } from "node:crypto";
import { createOperationalReferral } from "./support/operational-api";

const practice = "/?view=referrals&screen=packet&trainingAssessment=prepare&demo=1&workspaceStage=assessment&assessmentSection=diagnosis_clinical";

test("preparation uses the same conditional answers without treating source acceptance as client confirmation", () => {
  const data = buildTrainingAssessment("prepare");
  const prepared = assessmentWorkingSections(data, [], true);
  expect(prepared).toHaveLength(5);
  expect(assessmentWorkingSections(data, [])).toHaveLength(12);
  const fields = prepared.flatMap((group) => group.questions.map((question) => question.field));
  expect(fields).not.toContain("current_symptoms");
  expect(fields).not.toContain("current_self_harm_ideation");
  expect(fields).toContain("secondary_diagnoses");
  data.im_injections = "yes";
  expect(assessmentWorkingSections(data, [], true).flatMap((group) => group.questions.map((q) => q.field))).toContain("im_injections_details");
  data.im_injections = "no";
  expect(assessmentWorkingSections(data, [], true).flatMap((group) => group.questions.map((q) => q.field))).not.toContain("im_injections_details");
  data.secondary_diagnoses = ["Synthetic record detail"];
  data.field_provenance.secondary_diagnoses = [{ source_field_key: "secondary_diagnoses", source_file: "Referral.pdf", source_page_no: 2, confidence: 0.9, review_status: "pending", evidence_url: null }];
  const question = prepared.flatMap((group) => group.questions).find((q) => q.field === "secondary_diagnoses")!;
  expect(assessmentQuestionStatus(question, data, ["secondary_diagnoses"])).toBe("verify");
  expect(assessmentAnswerOrigin(data, data, "secondary_diagnoses")).toBe("Source: Referral.pdf · page 2");
  data.field_provenance.secondary_diagnoses[0].review_status = "accepted";
  expect(assessmentAnswerOrigin(data, data, "secondary_diagnoses")).not.toMatch(/confirmed|verified/i);
  expect(assessmentAnswerOrigin(data, { ...data, secondary_diagnoses: ["Changed during interview"] }, "secondary_diagnoses")).toBe("Updated in this session");
});

for (const width of [1440, 820]) {
  test(`records and interview share a stable reference at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(practice);
    const folder = page.getByTestId("assessment-client-folder");
    const modes = folder.getByRole("group", { name: "Assessment working mode" });
    const reference = folder.getByRole("complementary", { name: "Current information" });
    const editor = folder.locator("[data-assessment-question-editor]");
    await modes.getByRole("button", { name: "Prepare from records", exact: true }).click();
    await expect(modes.getByRole("button", { name: "Prepare from records", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(folder).toContainText("Complete what the referral supports");
    await expect(folder.getByLabel("Assessment section", { exact: true })).toHaveValue("prior_history");
    await expect(reference.getByRole("button", { name: "Edit Current symptoms", exact: true })).toHaveCount(0);
    const field = editor.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
    const answer = "Synthetic history prepared before meeting the client.";
    await field.fill(answer);
    await expect(field).toBeFocused();
    await expect(reference).not.toContainText(answer);
    await field.press("Tab");
    await expect(reference).toContainText(answer);
    await expect(field).toBeVisible();
    await page.screenshot({ path: info.outputPath(`prepare-${width}.png`) });
    await modes.getByRole("button", { name: "Interview", exact: true }).click();
    await expect(folder.getByLabel("Assessment section", { exact: true })).toHaveValue("diagnosis_clinical");
    await expect(reference).toContainText(answer);
    await expect(field).toHaveCount(0);
    const current = reference.getByRole("button", { name: "Edit Current symptoms", exact: true });
    await current.click();
    const interview = editor.getByRole("textbox", { name: "Current symptoms", exact: false });
    await interview.fill("Synthetic change described by the client today.");
    await expect(current).not.toContainText("Synthetic change described");
    await interview.press("Tab");
    await expect(current).toContainText("Synthetic change described by the client today.");
    await expect(interview).toBeVisible();
    // A mode change must retain the latest field even without waiting for autosave.
    await interview.fill("Synthetic final sentence before switching.");
    await modes.getByRole("button", { name: "Prepare from records", exact: true }).click();
    await modes.getByRole("button", { name: "Interview", exact: true }).click();
    await expect(current).toContainText("Synthetic final sentence before switching.");
    await expect(folder.getByText("Practice changes saved locally", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
      return (await axe.run('[aria-label="Assessment working mode"], [data-assessment-working-section]', { runOnly: ["color-contrast", "button-name", "label"] })).violations.map(({ id }) => id);
    });
    expect(violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`interview-${width}.png`), animations: "disabled" });
  });
}

test("record preparation can remain incomplete and lead directly into interview", async ({ page }) => {
  await page.goto(practice);
  const folder = page.getByTestId("assessment-client-folder");
  await folder.getByRole("button", { name: "Prepare from records", exact: true }).click();
  await folder.getByLabel("Assessment section", { exact: true }).selectOption("legal_conservatorship");
  await folder.getByRole("button", { name: "Continue to interview", exact: true }).click();
  await expect(folder.getByRole("button", { name: "Interview", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(folder.getByLabel("Assessment section", { exact: true }).locator("option")).toHaveCount(12);
  await expect(folder.getByLabel("Assessment section", { exact: true })).toHaveValue("diagnosis_clinical");
  await expect(page.getByRole("dialog", { name: "Begin assessment", exact: true })).toHaveCount(0);
  await expect(folder.getByRole("button", { name: "Sign assessment", exact: true })).toHaveCount(0);
});

test("preparation persists in the same assessment without starting or signing an encounter", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Conversation ${randomUUID().slice(0, 8)}`, owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  const created = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: { client_mutation_id: randomUUID(), data: { secondary_diagnoses: ["Synthetic referral history"] } } });
  expect(created.status()).toBe(201);
  const { assessment } = await created.json();
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=diagnosis_clinical`);
  const folder = page.getByTestId("assessment-client-folder");
  await folder.getByRole("button", { name: "Prepare from records", exact: true }).click();
  await folder.getByRole("button", { name: "Edit Secondary diagnosis", exact: true }).click();
  await folder.getByRole("textbox", { name: "Secondary diagnosis", exact: true }).fill("Synthetic amended history from records");
  await folder.getByRole("button", { name: "Interview", exact: true }).click();
  const read = async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
  await expect.poll(async () => (await read()).secondary_diagnoses).toEqual(["Synthetic amended history from records"]);
  await page.reload();
  await expect(folder.getByRole("complementary", { name: "Current information" })).toContainText("Synthetic amended history from records");
  const stored = await read();
  expect(stored.started_at).toBeNull();
  expect(stored.signed_at).toBeNull();
  expect(stored.current_symptoms).toBeNull();
  const list = await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json();
  expect(list.assessments).toHaveLength(1);
});

for (const width of [390, 320]) {
  test(`phone preparation and reference return to the same interview at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 740 : 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(practice);
    const folder = page.getByTestId("assessment-client-folder");
    await folder.getByRole("button", { name: "Prepare from records", exact: true }).click();
    await folder.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
    const sections = page.getByRole("dialog", { name: "Questionnaire sections", exact: true });
    await sections.getByRole("searchbox", { name: "Find a question", exact: true }).fill("Secondary diagnosis");
    await sections.getByRole("button", { name: /^Secondary diagnosis/ }).click();
    const field = folder.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
    await field.fill("Synthetic diagnosis from referral notes.");
    await folder.getByRole("button", { name: "Client info", exact: true }).click();
    const reference = page.getByRole("dialog", { name: "Client information", exact: true });
    await expect(reference).toContainText("Synthetic diagnosis from referral notes.");
    await expect(reference).not.toContainText("During the practice interview");
    await reference.getByRole("button", { name: "Close information panel" }).click();
    await expect(field).toHaveValue("Synthetic diagnosis from referral notes.");
    await folder.getByRole("button", { name: "Interview", exact: true }).click();
    await folder.getByRole("button", { name: "Client info", exact: true }).click();
    await expect(reference).toContainText("Synthetic diagnosis from referral notes.");
    await expect(reference).toContainText("During the practice interview");
    await reference.getByRole("button", { name: "Close information panel" }).click();
    await expect(folder.getByRole("navigation", { name: "Question steps" }).getByRole("button").last()).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`phone-interview-${width}.png`), animations: "disabled" });
  });
}
