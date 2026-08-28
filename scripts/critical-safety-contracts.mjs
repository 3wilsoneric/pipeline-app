#!/usr/bin/env node

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const workflow = loadTypeScriptModule(root, "lib/pipeline/referral-workflow.ts");
const extraction = loadTypeScriptModule(root, "lib/extraction/extraction-state.ts");
const worker = loadTypeScriptModule(root, "lib/extraction/worker-report-validation.ts");
const matching = loadTypeScriptModule(root, "lib/pipeline/master-record-matching.ts");
const upload = loadTypeScriptModule(root, "lib/extraction/durable-upload-reconciliation.ts");
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

check("workflow does not allow stage skipping", !workflow.getAllowedReferralTargets("New").includes("Assessment"));
check("accepted referrals are terminal", workflow.getAllowedReferralTargets("Accepted / Admitted").length === 0);
check("an owner is required to begin workflow", hasBlocker(
  workflow.getReferralTransitionBlockers(referral("New"), "Packet Needed"),
  "owner_required",
));
check("an initial packet is required for packet review", hasBlocker(
  workflow.getReferralTransitionBlockers(referral("Packet Needed", { owner: "Operator" }), "Packet Review"),
  "initial_packet_required",
));
check("human packet review is required before assessment", hasBlocker(
  workflow.getReferralTransitionBlockers(referral("Packet Review", { owner: "Operator", packetStatus: "ready_for_review" }), "Assessment"),
  "packet_review_required",
));
check("a completed assessment is required before community review", hasBlocker(
  workflow.getReferralTransitionBlockers(referral("Assessment"), "Community Review", { assessmentComplete: false }),
  "assessment_required",
));
check("acceptance requires an accepted decision", hasBlocker(
  workflow.getReferralTransitionBlockers(referral("Community Review"), "Accepted / Admitted", { requirements: [] }),
  "admission_decision_required",
));
check("move-in requirements block acceptance", hasBlocker(
  workflow.getReferralTransitionBlockers(referral("Community Review"), "Accepted / Admitted", {
    decision: { outcome: "accepted" },
    requirements: [{ id: "requirement", type: "tb_test", label: "TB test", status: "needed", requiredFor: "move_in", blocker: true }],
  }),
  "requirement:tb_test",
));
check("declining requires a declined decision", hasBlocker(
  workflow.getReferralTransitionBlockers(referral("Assessment"), "Declined", {}),
  "decline_decision_required",
));
check("declining requires a reason", hasBlocker(
  workflow.getReferralTransitionBlockers(referral("Assessment"), "Declined", { decision: { outcome: "declined", reasonNote: "" } }),
  "decline_reason_required",
));

check("the final retry dead-letters", extraction.getExtractionFailureDisposition(5, 5, true).status === "dead_letter");
check("non-retryable extraction dead-letters immediately", extraction.getExtractionFailureDisposition(1, 5, false).status === "dead_letter");
check("future queued work cannot be claimed", !extraction.leaseCanBeClaimed("queued", 101, null, 100));
check("an expired running lease can be reclaimed", extraction.leaseCanBeClaimed("running", 0, 99, 100));
check("an unexpired running lease cannot be reclaimed", !extraction.leaseCanBeClaimed("running", 0, 101, 100));
check("successful extraction cannot requeue", !extraction.isAllowedExtractionTransition("succeeded", "queued"));

const validReport = {
  extraction_job_id: "11111111-1111-4111-8111-111111111111",
  attempt_count: 1,
  attempt_token: "22222222-2222-4222-8222-222222222222",
  status: "succeeded",
};
check("duplicate extracted fields are rejected", throwsCode(() => worker.validateWorkerReport({
  ...validReport,
  fields: [
    { field_key: "identity.name", proposed_value: "A", confidence: 0.9 },
    { field_key: "identity.name", proposed_value: "B", confidence: 0.8 },
  ],
})) === "duplicate_field_key");
check("confidence cannot exceed one", throwsCode(() => worker.validateWorkerReport({
  ...validReport,
  fields: [{ field_key: "identity.name", proposed_value: "A", confidence: 1.1 }],
})) === "confidence_invalid");
check("unsafe Blob traversal keys are rejected", throwsCode(() => worker.validateWorkerReport({
  ...validReport,
  artifacts: [{ kind: "other", blob_container: "artifacts", blob_key: "packet/../source.pdf" }],
})) === "blob_key_invalid");

const identityCandidates = [{
  canonical_person_id: "person-1",
  resident_number: "SYN-1",
  date_of_birth: "1980-01-01",
  display_name: "Synthetic Person",
}];
check("name and DOB without resident number never auto-match", matching.decideMasterIdentityMatch({
  source_record_id: "source-1",
  resident_number: null,
  date_of_birth: "1980-01-01",
  display_name: "Synthetic Person",
}, identityCandidates).status === "human_review");
check("resident-number match with a different DOB is blocked", matching.decideMasterIdentityMatch({
  source_record_id: "source-2",
  resident_number: "SYN-1",
  date_of_birth: "1990-01-01",
  display_name: "Synthetic Person",
}, identityCandidates).status === "blocked_conflict");

check("partial upload finalization is retryable", upload.decideDurableUploadRecovery({
  database_state: "reserved",
  blob_state: "present",
  reservation_expired: false,
  work_expected: true,
  active_job_present: false,
}) === "retry_finalize");
check("finalized database metadata with no blob is an incident", upload.decideDurableUploadRecovery({
  database_state: "finalized",
  blob_state: "missing",
  reservation_expired: false,
  work_expected: true,
  active_job_present: true,
}) === "data_loss_incident");

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }));
if (failed.length) process.exit(1);

function referral(stage, patch = {}) {
  return {
    id: 1,
    name: "Synthetic Person",
    date: "2026-08-01",
    stage,
    community: "San Pablo",
    source: "Synthetic",
    priority: "standard",
    documentName: "",
    documentStatus: "Missing",
    owner: "",
    note: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    dob: "1980-01-01",
    phone: "",
    email: "",
    payer: "",
    ...patch,
  };
}

function hasBlocker(blockers, code) {
  return blockers.some((blocker) => blocker.code === code);
}

function throwsCode(operation) {
  try {
    operation();
    return "";
  } catch (error) {
    return error && typeof error === "object" && "code" in error ? String(error.code) : "unknown";
  }
}
