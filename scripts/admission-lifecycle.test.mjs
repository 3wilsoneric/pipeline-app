import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";
const load = (path) => loadTypeScriptModule(process.cwd(), path);
const dates = load("lib/pipeline/admission-lifecycle.ts");
const presentation = load("lib/pipeline/workspace-presentation.ts");
const validation = load("lib/pipeline/referral-validation.ts");
const sections = load("lib/pipeline/referral-sections.ts");
const flow = load("lib/pipeline/referral-flow.ts");

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
  assert.equal(flow.isFinishedBoardReferral({ workflow_status: "approved_for_placement", flow_state: "complete_chart" }), false);
  assert.equal(dates.isAwaitingAdmission("Declined", "declined", "2026-01-01T10:00:00Z"), false);
  assert.equal(presentation.getWorkspaceAdmissionOutcome({ ...referral, actualAdmissionDate: "2026-01-02", stage: "Accepted / Admitted" }).status, "admitted");
  assert.equal(flow.isFinishedBoardReferral({ workflow_status: "admitted", flow_state: "complete" }), true);
  assert.equal(flow.isFinishedBoardReferral({ workflow_status: "admitted", flow_state: "assessment", assessment_is_reassessment: true }), false);
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
