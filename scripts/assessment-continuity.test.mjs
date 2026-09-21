import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const continuity = loadTypeScriptModule(process.cwd(), "lib/pipeline/work-continuity.ts");
const drafts = loadTypeScriptModule(process.cwd(), "lib/pipeline/user-workspace-state-types.ts");
const schedule = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-schedule-draft.ts");
const schema = loadTypeScriptModule(process.cwd(), "lib/assessment/assessment-tool-schema.ts");

test("preparation, interview, question and scheduling intent round trip without appointment data in URLs", () => {
  for (const assessmentMode of ["prepare", "interview", "review"]) {
    const location = { view: "assessment", assessmentSection: "identity", assessmentMode,
      ...(assessmentMode !== "review" ? { assessmentDialog: "schedule", assessmentQuestion: "date_of_birth" } : {}) };
    const params = new URLSearchParams();
    continuity.applyPipelineWorkspaceLocation(params, location);
    assert.deepEqual(JSON.parse(JSON.stringify(continuity.pipelineWorkspaceLocationFromSearchParams(params))), location);
    continuity.applyPipelineWorkspaceLocation(params, { view: "files" });
    assert.equal(params.has("assessmentDialog"), false);
    assert.equal(params.has("assessmentQuestion"), false);
    assert.equal(params.has("assessmentMode"), false);
  }
  for (const invalid of [{ assessmentMode: "start" }, { assessmentMode: { toString: "prepare" } }, { assessmentDialog: "send" }, { assessmentQuestion: "not-a-field" }, { assessmentMode: "review", assessmentDialog: "schedule" }]) {
    assert.equal(continuity.parsePipelineWorkspaceLocation({ view: "assessment", ...invalid }), null);
  }
  assert.equal(continuity.parsePipelineWorkspaceLocation({ view: "chart", assessmentDialog: "schedule" }), null);
});

test("appointment draft is bounded and remains separate from booked dates and answers", () => {
  const assessment = { scheduled_start_at: null, schedule_status: "unscheduled" };
  const scheduleDraft = { ...schedule.assessmentScheduleDraft(assessment), start: "2026-10-12T10:30", method: "phone", location: "555-0100" };
  const draft = { schema: 1, assessmentId: "synthetic", savedAt: new Date().toISOString(), baseVersion: 1, sectionVersions: {}, dirtySections: [], data: schema.createEmptyAssessmentToolData(), baseData: schema.createEmptyAssessmentToolData(), scheduleDraft };
  assert.deepEqual(JSON.parse(JSON.stringify(drafts.parsePipelineAssessmentDraft(draft).scheduleDraft)), scheduleDraft);
  assert.equal(assessment.scheduled_start_at, null);
  assert.ok(drafts.parsePipelineAssessmentDraft({ ...draft, scheduleDraft: undefined }));
  for (const invalid of [{ location: "x".repeat(501) }, { method: "script" }, { duration: "-1" }, { base: "x".repeat(1001) }, { start: 42 }]) {
    assert.equal(drafts.parsePipelineAssessmentDraft({ ...draft, scheduleDraft: { ...scheduleDraft, ...invalid } }), null);
  }
  assert.equal(schedule.assessmentScheduleDraft({ ...assessment, version: 99, referrer_name: "Changed" }).base, scheduleDraft.base);
  assert.notEqual(schedule.assessmentScheduleDraft({ ...assessment, scheduled_start_at: "2026-10-13T18:00:00Z" }).base, scheduleDraft.base);
});

test("unfinished workflow dialogs round trip and deliberate destinations clear them", () => {
  for (const location of [
    { view: "assessment", assessmentMode: "prepare", assessmentDialog: "begin" },
    { view: "chart", workspaceDialog: "created" },
  ]) {
    const params = new URLSearchParams();
    continuity.applyPipelineWorkspaceLocation(params, location);
    assert.deepEqual(JSON.parse(JSON.stringify(continuity.pipelineWorkspaceLocationFromSearchParams(params))), location);
    const state = continuity.parsePipelineWorkContinuityPatch({ lastWorkspace: { referralId: 1, location, visitedAt: "2026-09-21T12:00:00Z" } });
    assert.deepEqual(JSON.parse(JSON.stringify(state.lastWorkspace.location)), location);
    continuity.applyPipelineWorkspaceLocation(params, { view: "assessment", assessmentMode: "prepare" });
    assert.equal(params.has("assessmentDialog"), false);
    assert.equal(params.has("workspaceDialog"), false);
  }
  for (const location of [
    { view: "assessment", assessmentMode: "review", assessmentDialog: "begin" },
    { view: "assessment", workspaceDialog: "created" },
    { view: "intake", workspaceDialog: "created" },
    { view: "chart", workspaceDialog: "send" },
  ]) assert.equal(continuity.parsePipelineWorkspaceLocation(location), null);
});
