#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const read = (file) => readFileSync(file, "utf8");
const workflow = loadTypeScriptModule(root, "lib/pipeline/workflow-status.ts");
const lifecycle = loadTypeScriptModule(root, "lib/assessment/assessment-lifecycle-validation.ts");
const records = loadTypeScriptModule(root, "lib/pipeline/workflow-records.ts");
const assessmentSeed = loadTypeScriptModule(root, "lib/assessment/assessment-seed.ts");
const noteGuide = loadTypeScriptModule(root, "lib/assessment/assessment-note-guide.ts");

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
check("signed assessments remain signed even when historical recommendations exist", workflow.resolveReferralWorkflowStatus(referral, {
  assessment: { ...assessment, status: "complete", signed_at: "2026-08-23T16:00:00.000Z" },
  recommendation: { recommendationId: "rec-1" },
}) === "assessment_signed");
check("final decision closes to accepted", workflow.resolveReferralWorkflowStatus(referral, { decision: { outcome: "accepted" } }) === "accepted");

const seededAssessment = assessmentSeed.buildAssessmentSeedFromReferral({
  ...referral,
  date: "2026-08-23",
  county: "Contra Costa County",
  currentMedications: "Olanzapine 10 mg\nMetformin 500 mg",
  createdAt: "2026-08-23T08:00:00.000Z",
  packetFields: [
    {
      field_key: "assessment_tool.mobility",
      version: 1,
      proposed_value: "Independent",
      confidence: 0.91,
      review_status: "pending",
      source_page_no: 14,
      is_conflict: false,
      candidates: [],
    },
    {
      field_key: "assessment_tool.community",
      version: 1,
      proposed_value: "Wrong community",
      confidence: 0.8,
      review_status: "pending",
      source_page_no: 2,
      is_conflict: false,
      candidates: [],
    },
  ],
}, "Assigned Assessor", new Date("2026-08-25T12:00:00.000Z"));
check("packet clinical evidence seeds the assessment as reviewable", seededAssessment.data.mobility === "Independent" && seededAssessment.status === "needs_review");
check("referral context remains authoritative during assessment seeding", seededAssessment.data.community === "San Pablo" && seededAssessment.data.county === "Contra Costa County");
check("pre-assessment medications seed the assessment medication profile", seededAssessment.data.medications_at_intake.join("|") === "Olanzapine 10 mg|Metformin 500 mg");
check("seeded assessment evidence retains page provenance", seededAssessment.field_provenance.mobility?.at(-1)?.source_page_no === 14);
check("referral-owned packet duplicates do not enter assessment review", !seededAssessment.field_provenance.community?.some((entry) => entry.review_status === "pending"));
const riskNoteGuide = noteGuide.getAssessmentNoteGuide("behavioral_history");
check("narrative fields have domain-specific documentation guidance", riskNoteGuide?.domain === "behavioral_risk" && riskNoteGuide.thingsToCover.length >= 4 && riskNoteGuide.strongPattern.includes("[Source]"));
check("structured fields do not receive narrative guidance", !noteGuide.isCoachableAssessmentField("current_self_harm_ideation") && noteGuide.getAssessmentNoteGuide("current_self_harm_ideation") === null);
check("note guidance is deterministic for the same field", JSON.stringify(noteGuide.getAssessmentNoteGuide("behavioral_history")) === JSON.stringify(riskNoteGuide));

check("schedule requires time, duration, and method", !lifecycle.validateAssessmentScheduleCommand({ if_match: 1, schedule: { status: "scheduled", start_at: null, duration_minutes: null, method: null, location: null } }).ok);
check("schedule accepts a timezone-aware appointment", lifecycle.validateAssessmentScheduleCommand({ if_match: 1, schedule: { status: "scheduled", start_at: "2026-08-25T09:00:00-07:00", duration_minutes: 60, method: "in_person", location: "San Pablo" } }).ok);
check("addenda require an expected version", !lifecycle.validateAssessmentAddendumCommand({ note: "Later information", reason_code: "correction" }).ok);
check("not-applicable requirements satisfy gates only through an explicit reasoned status", records.isRequirementComplete("not_applicable"));

const referralStore = read("lib/pipeline/referral-store.ts");
const assessmentStore = read("lib/assessment/assessment-store.ts");
const assessmentAccess = read("lib/assessment/assessment-access.ts");
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
const assessmentWorkspace = read("components/pipeline/AssessmentWorkspace.tsx");
const assessmentSeedSource = read("lib/assessment/assessment-seed.ts");
const referralCanvasPersistence = read("lib/pipeline/referral-canvas-persistence.ts");
const migration = read("database/migrations/0015_assessor_workflow.sql");
const rollback = read("database/rollbacks/0015_assessor_workflow.sql");

check("referral assignment propagates to open assessments", referralStore.includes("syncLocalOpenAssessmentAssignment") && referralStore.includes("syncPostgresOpenAssessmentAssignment"));
check("recommendations survive the referral store boundary", referralStore.includes('"assessmentRecommendation"'));
check("explicit workflow status updates are persisted in both referral stores", referralStore.match(/safePatch\.workflowStatus/g)?.length >= 2);
check("signed assessments are immutable and use append-only addenda", assessmentStore.includes("This assessment is signed") && assessmentStore.includes("addAssessmentAddendum") && migration.includes("assessment_addenda"));
check("creating or importing an assessment does not start its performance clock", assessmentStore.match(/started_at: null,/g)?.length >= 2 && assessmentStore.includes("started_at: current?.started_at ?? null"));
check("assessment assignment is preserved while supervisors can cover unassigned work", assessmentAccess.includes("assessmentAssigneeForReferral") && assessmentAccess.includes("referral.ownerId") && assessmentAccess.includes("isAssessmentSupervisor(user)"));
check("assessment creation and import use one assigned-assessor-or-supervisor rule", assessmentCreateRoute.includes("canWorkAssessment") && assessmentImportRoute.includes("canWorkAssessment") && assessmentCreateRoute.includes("assigned assessor or a supervisor") && assessmentImportRoute.includes("assigned assessor or a supervisor"));
check(
  "assessment drafts remain open when intake evidence or profile fields are incomplete",
  !assessmentCreateRoute.includes("hasInitialDocument")
    && !assessmentImportRoute.includes("hasInitialDocument")
    && !assessmentCreateRoute.includes("profileIsReady")
    && !assessmentImportRoute.includes("profileIsReady"),
);
check("new assessment creation uses the packet-to-assessment handoff", assessmentCreateRoute.includes("buildAssessmentSeedFromReferral") && assessmentCreateRoute.includes("field_provenance: seed.field_provenance"));
check("packet context and interview answers have explicit ownership", assessmentSeedSource.includes('assessmentFieldOwner(target) === "assessment_answer"'));
check("schedule exposes Zoom instead of a generic video meeting method", lifecycle.validateAssessmentScheduleCommand({ if_match: 1, schedule: { status: "scheduled", start_at: "2026-08-25T09:00:00-07:00", duration_minutes: 60, method: "zoom", location: "https://zoom.us/j/123" } }).ok && assessmentWorkspace.includes('<option value="zoom">Zoom</option>') && !assessmentWorkspace.includes('<option value="video">Video</option>'));
check("new referral saves do not write the legacy interview duplicate", !referralCanvasPersistence.includes('interview: fields.interview'));
check("assessment suggestions support field-level accept and reject", assessmentWorkspace.includes("reviewExtractedField") && assessmentWorkspace.includes('review_extraction: [{ field, action }]'));
check("narrative guidance stays embedded beside the canonical assessment field", assessmentWorkspace.includes("AssessmentNarrativeGuidePanel") && assessmentWorkspace.includes("Things to note") && assessmentWorkspace.includes("Strong note pattern"));
check("embedded guidance has no provider or review request path", !/Claude|Anthropic|AI review|note-coach/.test(assessmentWorkspace) && !/fetch|provider|model/i.test(read("lib/assessment/assessment-note-guide.ts")));
check("assigned assessors and supervisors can sign", signRoute.includes("canWorkAssessment") && signRoute.includes("assigned assessor or a supervisor"));
check("assigned assessors and supervisors can edit clinical assessment fields", assessmentRoute.includes("canWorkAssessment") && assessmentRoute.includes("assigned assessor or a supervisor"));
check("assessment start is explicit, supervisor-capable, and cannot rewrite completed history", startRoute.includes("canWorkAssessment") && startRoute.includes("assigned assessor or a supervisor") && startRoute.includes("A completed assessment cannot be started again"));
check("assessment start requires an explicit schedule", startRoute.includes("Schedule the assessment before beginning the interview."));
check("new assessments must be begun before signing", signRoute.includes("Begin the assessment before signing it"));
check("signed addenda are limited to the signer or a supervisor", addendumRoute.includes("assessment.signed_by?.id !== auth.user.id") && addendumRoute.includes("Only the signing assessor or a supervisor"));
check("assigned assessors and supervisors can submit a recommendation", recommendationRoute.includes("allowSupervisorOverride") && workflowStore.includes("allowSupervisorOverride") && workflowStore.includes("assigned assessor or a supervisor"));
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
check(
  "assessment interview uses one focused schedule-then-begin shell with grouped responsive navigation",
  assessmentWorkspace.includes('createPortal(')
    && assessmentWorkspace.includes('aria-label="Assessment interview"')
    && assessmentWorkspace.includes("assessmentNavigationGroups")
    && assessmentWorkspace.includes('aria-label="Schedule assessment"')
    && assessmentWorkspace.includes('aria-label="Begin assessment"')
    && !assessmentWorkspace.includes("assessmentWorkbookTemplatePath")
    && !assessmentWorkspace.includes('role="tablist" aria-label="Assessment sections"'),
);
check("requested information requires a source and follow-up date", workflowStore.includes("requested_from_required") && workflowStore.includes("follow_up_required"));
check("legacy profile requirements are materialized without invented values", migration.includes("'profile_field'") && migration.includes("when definition.field_key = 'date_of_birth'") && migration.includes("else 'needed'"));
check("legacy backfill never invents a signature", migration.includes("then 'assessment_ready_to_sign'") && !migration.includes("then 'assessment_signed'"));
check("workflow rollback is transaction-neutral", !/^\s*(begin|commit)\s*;/im.test(rollback));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length > 0) process.exit(1);
