import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const types = loadTypeScriptModule(process.cwd(), "lib/pipeline/user-workspace-state-types.ts");
const schema = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-tool-schema.ts");
const draft = {
  schema: 1, assessmentId: "synthetic-phone-assessment", referralId: 1,
  savedAt: new Date().toISOString(), baseVersion: 1, sectionVersions: {},
  dirtySections: [], activeSection: "identity", activeQuestion: "assessment_date",
  data: schema.createEmptyAssessmentToolData(), baseData: schema.createEmptyAssessmentToolData(),
};
test("phone reading position survives a fully saved assessment draft", () => {
  const parsed = types.parsePipelineAssessmentDraft(draft);
  assert.ok(parsed);
  assert.equal(parsed.activeQuestion, "assessment_date");
  assert.equal(parsed.dirtySections.length, 0);
});
test("old drafts still load; invalid or cross-section question keys are rejected", () => {
  assert.ok(types.parsePipelineAssessmentDraft({ ...draft, activeQuestion: undefined }));
  assert.equal(types.parsePipelineAssessmentDraft({ ...draft, activeQuestion: "not-a-field" }), null);
  assert.equal(types.parsePipelineAssessmentDraft({ ...draft, activeSection: "medication" }), null);
});
