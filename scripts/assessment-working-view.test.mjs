import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = resolve(import.meta.dirname, "..");
const view = loadTypeScriptModule(root, "components/pipeline/assessment-working-view.ts");
const schema = loadTypeScriptModule(root, "lib/assessment/assessment-interview-schema.ts");
const tool = loadTypeScriptModule(root, "lib/assessment/assessment-tool-schema.ts");
const preparation = loadTypeScriptModule(root, "lib/assessment/assessment-preparation.ts");
const question = (field) => schema.assessmentInterviewQuestions.find((question) => question.field === field);

test("preparation contains every canonical question exactly once, including interview observations", () => {
  const fields = preparation.assessmentPreparationGroups.flatMap((group) => group.fields);
  assert.equal(new Set(fields).size, fields.length);
  assert.deepEqual([...fields].sort(), [...schema.assessmentInterviewQuestions.map((question) => question.field)].sort());
  for (const section of tool.assessmentToolSections) assert.ok(preparation.preparationGroupForSection(section).sections.includes(section));
});

test("full preparation preserves all conditional visibility rules and never mutates answers", () => {
  const cases = [tool.createEmptyAssessmentToolData(), ...schema.assessmentInterviewQuestions.filter((question) => question.showWhen).map((question) => {
    const rule = question.showWhen;
    const value = rule.operator === "not_equals" ? "lps" : Array.isArray(rule.value) ? rule.value[0] : rule.value;
    return { ...tool.createEmptyAssessmentToolData(), [rule.field]: rule.operator === "includes" ? [value] : value };
  })];
  for (const data of cases) {
    const before = JSON.stringify(data);
    const fields = view.assessmentWorkingSections(data, [], true).flatMap((section) => section.questions.map((question) => question.field));
    const expected = schema.assessmentInterviewQuestions.filter((question) => schema.isAssessmentQuestionVisible(question, data)).map((question) => question.field);
    assert.deepEqual([...fields].sort(), [...expected].sort());
    assert.equal(JSON.stringify(data), before);
  }
});

test("interview focuses on conversation while record-review fields stay accessible in reference and preparation", () => {
  const data = { ...tool.createEmptyAssessmentToolData(), im_injections: "yes", current_symptoms: "Prepared information", referrer_contact: "Synthetic contact" };
  const sections = view.assessmentGapSections(data, ["current_symptoms"], true);
  const fields = sections.flatMap((section) => section.questions.map((question) => question.field));
  for (const field of ["current_symptoms", "cognition_orientation", "current_self_harm_ideation", "active_substance_use", "overall_hygiene_rating", "placement_preferences_concerns"]) assert.ok(fields.includes(field), field);
  for (const field of ["referrer_contact", "referral_received_date", "assessment_date", "secondary_diagnoses", "next_injection_due"]) {
    assert.ok(!fields.includes(field), field);
    assert.ok(sections.some((section) => section.referenceQuestions.some((question) => question.field === field)), field);
  }
  assert.ok(sections.find((section) => section.key === "diagnosis_clinical").remaining.some((question) => question.field === "current_symptoms"));
  assert.ok(sections.every((section) => section.questions.length > 0));
  const review = view.assessmentGapSections(data, ["secondary_diagnoses"]);
  assert.ok(review.some((section) => section.remaining.some((question) => question.field === "secondary_diagnoses")));
  assert.deepEqual([...review.flatMap((section) => section.questions.map((question) => question.field))].sort(),
    [...schema.assessmentInterviewQuestions.filter((question) => question.field !== "assessment_date" && schema.isAssessmentQuestionVisible(question, data)).map((question) => question.field)].sort());
});

test("blank, no, unable-to-assess, and pending evidence remain distinct", () => {
  const data = tool.createEmptyAssessmentToolData();
  const q = question("im_injections");
  assert.equal(view.assessmentQuestionStatus(q, data, []), "unanswered");
  data.im_injections = "no";
  assert.equal(view.assessmentQuestionStatus(q, data, []), "captured");
  assert.equal(view.capturedAssessmentAnswer(q, data), "No");
  assert.equal(view.assessmentQuestionStatus(q, data, [q.field]), "verify");
  data.im_injections = "unable_to_assess";
  assert.equal(view.assessmentQuestionStatus(q, data, []), "reason");
  data.unable_to_assess_reasons.im_injections = "Current facility has not supplied this record.";
  assert.equal(view.assessmentQuestionStatus(q, data, []), "captured");
});

test("verified captured count excludes pending evidence and missing reasons", () => {
  const data = { ...tool.createEmptyAssessmentToolData(), medication_adherence: "yes", im_injections: "unable_to_assess" };
  const questions = [question("medication_adherence"), question("im_injections"), question("medications_at_intake")];
  const counts = view.assessmentWorkingCounts(questions, data, ["medication_adherence"]);
  assert.deepEqual(JSON.parse(JSON.stringify(counts)), { unanswered: 1, verify: 1, reasons: 1, captured: 0 });
  assert.equal(view.assessmentWorkingCountLabel(counts), "1 unanswered · 1 to verify · 1 needs a reason");
});

test("conditional answers are shown only with their parent, without deleting stored data", () => {
  const data = { ...tool.createEmptyAssessmentToolData(), im_injections: "yes", im_injections_details: "Synthetic injection details" };
  assert.ok(schema.getAssessmentInterviewQuestions("medication", data).some((q) => q.field === "im_injections_details"));
  data.im_injections = "no";
  assert.ok(!schema.getAssessmentInterviewQuestions("medication", data).some((q) => q.field === "im_injections_details"));
  assert.equal(data.im_injections_details, "Synthetic injection details");
});

test("captured answers use the schema's labels without truncating notes", () => {
  const data = { ...tool.createEmptyAssessmentToolData(), diagnosis_categories: ["schizoaffective", "other"], current_symptoms: "Synthetic source-backed note. ".repeat(40), prior_hospitalizations_count: 0 };
  assert.equal(view.capturedAssessmentAnswer(question("diagnosis_categories"), data), "Schizoaffective disorder; Other");
  assert.equal(view.capturedAssessmentAnswer(question("current_symptoms"), data), data.current_symptoms);
  assert.equal(view.capturedAssessmentAnswer(question("prior_hospitalizations_count"), data), "0");
});
