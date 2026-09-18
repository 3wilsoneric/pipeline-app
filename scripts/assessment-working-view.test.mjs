import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = resolve(import.meta.dirname, "..");
const view = loadTypeScriptModule(root, "components/pipeline/assessment-working-view.ts");
const schema = loadTypeScriptModule(root, "lib/assessment/assessment-interview-schema.ts");
const tool = loadTypeScriptModule(root, "lib/assessment/assessment-tool-schema.ts");
const question = (field) => schema.assessmentInterviewQuestions.find((question) => question.field === field);

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
  assert.equal(view.assessmentWorkingCountLabel(counts), "1 unanswered · 1 to verify · 1 need a reason");
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
  assert.equal(view.matchesAssessmentQuestion(question("current_symptoms"), " CURRENT SYMPTOMS "), true);
});
