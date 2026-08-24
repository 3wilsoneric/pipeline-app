#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const read = (file) => readFileSync(file, "utf8");
const workflow = loadTypeScriptModule(root, "lib/pipeline/workflow-status.ts");
const lifecycle = loadTypeScriptModule(root, "lib/assessment/assessment-lifecycle-validation.ts");
const records = loadTypeScriptModule(root, "lib/pipeline/workflow-records.ts");

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const referral = {
  id: 71,
  name: "Workflow Fixture",
  dob: "1980-01-02",
  community: "San Pablo",
  source: "County referral",
  owner: "Assigned Assessor",
  ownerId: "assessor-1",
  stage: "New",
  documentStatus: "Uploaded",
  documentName: "fixture-packet.pdf",
  packetId: "packet-71",
};
const assessment = {
  assessment_id: "assessment-71",
  referral_id: 71,
  assessor_id: "assessor-1",
  assessor: "Assigned Assessor",
  status: "draft",
  schedule_status: "unscheduled",
  started_at: null,
};

check("unassigned referrals enter the assignment queue", workflow.resolveReferralWorkflowStatus({ ...referral, owner: "Unassigned", ownerId: undefined }) === "intake_unassigned");
check("assigned referrals without initial evidence request documents", workflow.resolveReferralWorkflowStatus({ ...referral, documentStatus: "Missing", documentName: "", packetId: "" }) === "intake_documents_needed");
check("a reserved filename is not proof of an uploaded document", !workflow.hasInitialDocument({ ...referral, documentStatus: "Missing", packetId: "" }));
check("complete intake becomes ready to schedule", workflow.resolveReferralWorkflowStatus(referral) === "ready_to_schedule");
check("explicit schedule drives calendar workflow state", workflow.resolveReferralWorkflowStatus(referral, { assessment: { ...assessment, schedule_status: "scheduled" } }) === "assessment_scheduled");
check("started assessment is in progress", workflow.resolveReferralWorkflowStatus(referral, { assessment: { ...assessment, schedule_status: "scheduled", started_at: "2026-08-23T15:00:00.000Z" } }) === "assessment_in_progress");
check("an unstarted draft with complete fields remains ready to schedule", workflow.resolveReferralWorkflowStatus(referral, { assessment: { ...assessment, resident_number: "71", resident_name: "Workflow Fixture", date_of_birth: "1980-01-02", community: "San Pablo", assessment_date: "2026-08-23", assessor: "Assigned Assessor", primary_diagnosis: "Fixture", adl_needs: "Fixture", behavioral_history: "Fixture", medications_at_intake: ["Fixture"] } }) === "ready_to_schedule");
check("legacy completion is ready to sign, never silently signed", workflow.resolveReferralWorkflowStatus(referral, { assessment: { ...assessment, status: "complete" } }) === "assessment_ready_to_sign");
check("only an explicit signature produces signed status", workflow.resolveReferralWorkflowStatus(referral, { assessment: { ...assessment, status: "complete", signed_at: "2026-08-23T16:00:00.000Z" } }) === "assessment_signed");
check("assessor recommendation creates supervisor decision work", workflow.resolveReferralWorkflowStatus(referral, { recommendation: { recommendationId: "rec-1" } }) === "decision_pending");
check("final decision closes to accepted", workflow.resolveReferralWorkflowStatus(referral, { decision: { outcome: "accepted" } }) === "accepted");

check("schedule requires time, duration, and method", !lifecycle.validateAssessmentScheduleCommand({ if_match: 1, schedule: { status: "scheduled", start_at: null, duration_minutes: null, method: null, location: null } }).ok);
check("schedule accepts a timezone-aware appointment", lifecycle.validateAssessmentScheduleCommand({ if_match: 1, schedule: { status: "scheduled", start_at: "2026-08-25T09:00:00-07:00", duration_minutes: 60, method: "in_person", location: "San Pablo" } }).ok);
check("addenda require an expected version", !lifecycle.validateAssessmentAddendumCommand({ note: "Later information", reason_code: "correction" }).ok);
check("not-applicable requirements satisfy gates only through an explicit reasoned status", records.isRequirementComplete("not_applicable"));

const referralStore = read("lib/pipeline/referral-store.ts");
const assessmentStore = read("lib/assessment/assessment-store.ts");
const assessmentCreateRoute = read("app/api/referrals/[referralId]/assessments/route.ts");
const assessmentImportRoute = read("app/api/referrals/[referralId]/assessments/import/route.ts");
const signRoute = read("app/api/assessments/[assessmentId]/sign/route.ts");
const startRoute = read("app/api/assessments/[assessmentId]/start/route.ts");
const assessmentRoute = read("app/api/assessments/[assessmentId]/route.ts");
const addendumRoute = read("app/api/assessments/[assessmentId]/addenda/route.ts");
const recommendationRoute = read("app/api/referrals/[referralId]/recommendation/route.ts");
const decisionRoute = read("app/api/referrals/[referralId]/decision/route.ts");
const referralRoute = read("app/api/referrals/[referralId]/route.ts");
const manualIntakeRoute = read("app/api/referrals/[referralId]/manual-intake/route.ts");
const workflowStore = read("lib/pipeline/workflow-store.ts");
const workItemRoute = read("app/api/referrals/[referralId]/work-items/[workItemId]/route.ts");
const migration = read("database/migrations/0015_assessor_workflow.sql");
const rollback = read("database/rollbacks/0015_assessor_workflow.sql");

check("referral assignment propagates to open assessments", referralStore.includes("syncLocalOpenAssessmentAssignment") && referralStore.includes("syncPostgresOpenAssessmentAssignment"));
check("recommendations survive the referral store boundary", referralStore.includes('"assessmentRecommendation"'));
check("explicit workflow status updates are persisted in both referral stores", referralStore.match(/safePatch\.workflowStatus/g)?.length >= 2);
check("signed assessments are immutable and use append-only addenda", assessmentStore.includes("This assessment is signed") && assessmentStore.includes("addAssessmentAddendum") && migration.includes("assessment_addenda"));
check("creating or importing an assessment does not start its performance clock", assessmentStore.match(/started_at: null,/g)?.length >= 2 && assessmentStore.includes("started_at: current?.started_at ?? null"));
check("assessment creation and import require an assigned assessor", assessmentCreateRoute.includes("Assign this referral to an assessor before starting") && assessmentImportRoute.includes("Assign this referral to an assessor before importing"));
check("only the assigned assessor can create or import clinical assessment data", assessmentCreateRoute.includes("Only the assigned assessor can create an assessment") && assessmentImportRoute.includes("Only the assigned assessor can import assessment data"));
check("assessment creation and import require initial evidence or audited manual authorization", assessmentCreateRoute.includes("manualIntakeAuthorization") && assessmentImportRoute.includes("manualIntakeAuthorization"));
check("only the assigned assessor can sign", signRoute.includes("Only the assigned assessor can sign"));
check("only the assigned assessor can edit clinical assessment fields", assessmentRoute.includes("Only the assigned assessor can edit this assessment"));
check("assessment start is explicit and cannot rewrite completed history", startRoute.includes("Only the assigned assessor can start") && startRoute.includes("A completed assessment cannot be started again"));
check("new assessments must be begun before signing", signRoute.includes("Begin the assessment before signing it"));
check("signed addenda are limited to the signer or a supervisor", addendumRoute.includes("assessment.signed_by?.id !== auth.user.id") && addendumRoute.includes("Only the signing assessor or a supervisor"));
check("only the assigned assessor can submit a recommendation", recommendationRoute.includes("recordAssessmentRecommendation") && workflowStore.includes("Only the assigned assessor can submit this recommendation"));
check("only supervisors can record final decisions", decisionRoute.includes('["admin", "assessment_coordinator"]'));
check("only supervisors can move a referral to trash", referralRoute.includes('requirePipelineUser(request, ["admin", "assessment_coordinator"])'));
check("only supervisors can authorize intake without an initial packet", manualIntakeRoute.includes('requirePipelineUser(request, ["admin", "assessment_coordinator"])'));
check("final decisions require a recommendation or audited override", workflowStore.includes("recommendation_required") && workflowStore.includes("overrideReason"));
check(
  "accepted decisions preserve admission gates until an explicit transition",
  workflowStore.includes('snapshot.referral.stage === "Assessment"')
    && workflowStore.includes('? "Community Review"')
    && workflowStore.includes('targetStage === "Accepted / Admitted" ? { workflowStatus: "accepted" as const }')
    && !workflowStore.includes("workflowTransitionValidated: true")
    && referralStore.match(/!metadata\?\.workflowTransitionValidated/g)?.length >= 2,
);
check("requirements cannot drift from the referral assignment", workItemRoute.includes("Change the referral assignment to change requirement ownership") && !workItemRoute.includes('"ownerId",'));
check("requested information requires a source and follow-up date", workflowStore.includes("requested_from_required") && workflowStore.includes("follow_up_required"));
check("legacy profile requirements are materialized without invented values", migration.includes("'profile_field'") && migration.includes("when definition.field_key = 'date_of_birth'") && migration.includes("else 'needed'"));
check("legacy backfill never invents a signature", migration.includes("then 'assessment_ready_to_sign'") && !migration.includes("then 'assessment_signed'"));
check("workflow rollback is transaction-neutral", !/^\s*(begin|commit)\s*;/im.test(rollback));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length > 0) process.exit(1);
