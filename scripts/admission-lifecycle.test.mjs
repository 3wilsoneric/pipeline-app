import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";
const load = (path) => loadTypeScriptModule(process.cwd(), path);
const dates = load("lib/pipeline/admission-lifecycle.ts");
const presentation = load("lib/pipeline/workspace-presentation.ts");
const validation = load("lib/pipeline/referral-validation.ts");
const sections = load("lib/pipeline/referral-sections.ts");
const flow = load("lib/pipeline/referral-flow.ts");

test("normal reopening follows handoff progress without inventing admission or redirecting unsigned work", () => {
  const referral = { workspaceStatus: "active", stage: "Community Review" };
  const signed = { signedAt: "2026-09-21T10:00:00Z" };
  assert.equal(dates.handoffWorkspaceView(referral, {}), null);
  assert.equal(dates.handoffWorkspaceView(referral, signed), "workflow");
  const accepted = { ...referral, admissionDecision: { outcome: "accepted" } };
  assert.equal(dates.handoffWorkspaceView(accepted, signed), "workflow");
  const prepared = { ...accepted, plannedAdmissionDate: "2026-10-01" };
  assert.equal(dates.handoffWorkspaceView(prepared, signed), "email");
  assert.equal(dates.handoffWorkspaceView(prepared, { ...signed, packetSentAt: "2026-09-21T11:00:00Z" }), "workflow");
  assert.equal(dates.handoffWorkspaceView(prepared, {}), null, "new unsigned reassessment does not inherit the old handoff route");
  assert.equal(dates.handoffWorkspaceView({ ...prepared, workspaceStatus: "historical" }, signed), null);
  assert.equal(dates.handoffWorkspaceView({ ...prepared, stage: "Accepted / Admitted" }, signed), null);
  assert.equal(dates.handoffWorkspaceView({ ...prepared, admissionDecision: { outcome: "declined" } }, signed), "workflow");
});

test("planned date is separate, supports legacy previews, and can be cleared deliberately", () => {
  const imported = { workspaceOrigin: "allo", admissionDate: "2024-05-02", plannedAdmissionDate: "2026-10-12" };
  assert.equal(dates.getPlannedAdmissionDate(imported), "2026-10-12");
  assert.equal(presentation.getWorkspaceAdmissionOutcome(imported).status, "admitted");
  assert.equal(imported.admissionDate, "2024-05-02");
  assert.equal(dates.getPlannedAdmissionDate({ admissionDate: "2026-10-12" }), "2026-10-12");
  assert.equal(dates.getPlannedAdmissionDate({ admissionDate: "2026-10-12", plannedAdmissionDate: "" }), "");
});

test("planned arrival and sending never prove actual admission", () => {
  const referral = { workspaceOrigin: "pipeline", stage: "Community Review", admissionDecision: { outcome: "accepted" }, plannedAdmissionDate: "2026-01-01" };
  assert.equal(presentation.getWorkspaceAdmissionOutcome(referral).status, "accepted");
  assert.equal(dates.isAwaitingAdmission(referral.stage, "accepted", "2026-01-01T10:00:00Z"), true);
  assert.notEqual(flow.getReferralBoardState(referral, { assessmentSigned: true, packetSentAt: "2026-01-01T10:00:00Z" }).stage, null);
  assert.equal(dates.isAwaitingAdmission("Declined", "declined", "2026-01-01T10:00:00Z"), false);
  assert.equal(presentation.getWorkspaceAdmissionOutcome({ ...referral, actualAdmissionDate: "2026-01-02", stage: "Accepted / Admitted" }).status, "admitted");
  const admitted = { ...referral, stage: "Accepted / Admitted", workflowStatus: "admitted" };
  assert.notEqual(flow.getReferralBoardState(admitted, { assessmentSigned: true }).stage, null, "admission without email stays on the board");
  assert.equal(flow.getReferralBoardState(admitted, { assessmentSigned: true, packetSentAt: "2026-01-01T10:00:00Z" }).stage, null);
  assert.equal(flow.getReferralBoardState(admitted, { assessmentStarted: true, assessmentCreatedAt: "2026-01-02T10:00:00Z", decision: { outcome: "accepted", decidedAt: "2026-01-01T10:00:00Z" } }).stage, "in_progress");
});

test("date boundaries validate real dates and keep actual admission behind explicit confirmation", () => {
  for (const value of [undefined, null, "", "2026-02-30", "not a date"]) {
    assert.ok(dates.plannedAdmissionDateError(value));
    assert.ok(dates.actualAdmissionDateError(value));
  }
  assert.equal(dates.plannedAdmissionDateError("2099-01-01"), null);
  assert.ok(dates.actualAdmissionDateError("2099-01-01"));
  assert.equal(dates.actualAdmissionDateError("2026-01-01"), null);
  assert.equal(validation.validateReferralPatch({ plannedAdmissionDate: "2026-10-12" }).ok, true);
  assert.equal(validation.validateReferralPatch({ plannedAdmissionDate: "2026-02-30" }).ok, false);
  assert.equal(validation.validateReferralPatch({ actualAdmissionDate: "2026-01-01" }).ok, false);
  assert.deepEqual([...sections.getReferralPatchSections({ plannedAdmissionDate: "2026-10-12" })], ["intake"]);
  assert.deepEqual([...sections.getReferralPatchSections({ actualAdmissionDate: "2026-01-01", stage: "Accepted / Admitted" })], ["workflow"]);
});
