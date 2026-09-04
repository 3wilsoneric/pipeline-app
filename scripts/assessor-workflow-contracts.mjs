#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const read = (file) => readFileSync(file, "utf8");
const workflow = loadTypeScriptModule(root, "lib/pipeline/workflow-status.ts");
const referralFlow = loadTypeScriptModule(root, "lib/pipeline/referral-flow.ts");
const lifecycle = loadTypeScriptModule(root, "lib/assessment/assessment-lifecycle-validation.ts");
const records = loadTypeScriptModule(root, "lib/pipeline/workflow-records.ts");
const assessmentSeed = loadTypeScriptModule(root, "lib/assessment/assessment-seed.ts");
const narrativeGuide = loadTypeScriptModule(root, "lib/assessment/assessment-narrative-guide.ts");
const fieldWritingSpec = loadTypeScriptModule(root, "lib/assessment/assessment-field-writing-spec.ts");
const assessmentSummary = loadTypeScriptModule(root, "lib/assessment/assessment-summary.ts");
const meetClientTemplate = loadTypeScriptModule(root, "lib/notifications/meet-client-email-template.ts");
const attachmentPolicy = loadTypeScriptModule(root, "lib/notifications/meet-client-attachment-policy.ts");

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
check("manual intake authorization satisfies the initial evidence gate", workflow.resolveReferralWorkflowStatus({
  ...referral,
  documentStatus: "Missing",
  documentName: "",
  packetId: "",
  manualIntakeAuthorization: {
    mode: "manual_chart",
    reason: "Source documents are temporarily unavailable.",
    authorizedBy: "supervisor-1",
    authorizedByName: "Supervisor",
    authorizedAt: "2026-08-23T12:00:00.000Z",
  },
}) === "ready_to_schedule");
check("complete intake becomes ready to schedule", workflow.resolveReferralWorkflowStatus(referral) === "ready_to_schedule");
check("intake edits recalculate a stale intake status", workflow.resolveReferralWorkflowStatusAfterReferralChange(
  { ...referral, workflowStatus: "profile_incomplete" },
  { ...referral, workflowStatus: "profile_incomplete" },
) === "ready_to_schedule");
check("referral edits cannot regress an assessment lifecycle status", workflow.resolveReferralWorkflowStatusAfterReferralChange(
  { ...referral, workflowStatus: "assessment_in_progress" },
  { ...referral, workflowStatus: "assessment_in_progress", dob: "" },
) === "assessment_in_progress");
check("referral edits cannot reopen a terminal referral", workflow.resolveReferralWorkflowStatusAfterReferralChange(
  { ...referral, workflowStatus: "accepted", stage: "Accepted / Admitted" },
  { ...referral, workflowStatus: "accepted", stage: "Accepted / Admitted", owner: "Unassigned", ownerId: undefined },
) === "accepted");
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
check("active referral statuses map to one operational flow state", [
  ["intake_unassigned", "ready_to_schedule"],
  ["intake_documents_needed", "ready_to_schedule"],
  ["profile_incomplete", "ready_to_schedule"],
  ["ready_to_schedule", "ready_to_schedule"],
  ["assessment_scheduled", "scheduled"],
  ["assessment_in_progress", "assessment"],
  ["waiting_for_information", "assessment"],
  ["assessment_ready_to_sign", "complete_chart"],
  ["assessment_signed", "complete_chart"],
  ["recommendation_submitted", "complete_chart"],
  ["decision_pending", "complete_chart"],
].every(([status, state]) => referralFlow.referralFlowStateForStatus(status) === state));
check("terminal referral statuses stay out of current work", ["accepted", "declined", "closed"]
  .every((status) => referralFlow.referralFlowStateForStatus(status) === "complete"));

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
const riskAnswerGuide = narrativeGuide.getAssessmentNarrativeGuide("behavioral_history");
const guideCoverage = narrativeGuide.getAssessmentNarrativeGuideCoverage();
check("narrative fields have purpose-specific answer guidance", riskAnswerGuide?.domain === "behavioral_risk" && riskAnswerGuide.purposeTrack === "behavior_pattern" && riskAnswerGuide.thingsToCover.length >= 4 && riskAnswerGuide.strongPattern.includes("[source]"));
check("every assessment textarea has an explicit answer-purpose track", guideCoverage.coachableFields.length >= 60 && guideCoverage.coveredFields.length === guideCoverage.coachableFields.length && guideCoverage.missingFields.length === 0);
check("structured fields do not receive narrative guidance", !narrativeGuide.isCoachableAssessmentField("current_self_harm_ideation") && narrativeGuide.getAssessmentNarrativeGuide("current_self_harm_ideation") === null);
check("answer guidance is deterministic for the same field", JSON.stringify(narrativeGuide.getAssessmentNarrativeGuide("behavioral_history")) === JSON.stringify(riskAnswerGuide));
const writingSpecCoverage = fieldWritingSpec.getAssessmentFieldWritingSpecCoverage();
const medicationWritingSpec = fieldWritingSpec.getAssessmentFieldWritingSpec("medications_at_intake");
const safetyWritingSpec = fieldWritingSpec.getAssessmentFieldWritingSpec("current_self_harm_details");
check("every narrative field has an explicit writing specification", writingSpecCoverage.coachableFields.length >= 60
  && writingSpecCoverage.coveredFields.length === writingSpecCoverage.coachableFields.length
  && writingSpecCoverage.missingFields.length === 0);
check("medication fields use a structured line format", medicationWritingSpec?.preferredFormat === "structured_lines"
  && medicationWritingSpec.formatTemplate.includes("Dose") && medicationWritingSpec.requiredElements.includes("Route"));
check("safety fields use a current risk sequence", safetyWritingSpec?.preferredFormat === "risk_sequence"
  && safetyWritingSpec.requiredElements.includes("Intent") && safetyWritingSpec.requiredElements.includes("Protective factors"));
check("field writing examples are deterministic and synthetic", JSON.stringify(fieldWritingSpec.getAssessmentFieldWritingSpec("medications_at_intake")) === JSON.stringify(medicationWritingSpec)
  && medicationWritingSpec.strongExample.includes("[date]"));

const signedAssessmentReport = assessmentSummary.buildAssessmentSummaryReport({
  ...seededAssessment.data,
  assessment_id: "assessment-summary-fixture",
  referral_id: referral.id,
  version: 7,
  status: "complete",
  assessment_date: "2026-08-25",
  assessor: "Assigned Assessor",
  signed_at: "2026-08-25T18:00:00.000Z",
  signed_by: { id: "assessor-1", name: "Assigned Assessor" },
  updated_by: { id: "assessor-1", name: "Assigned Assessor" },
  medications_at_intake: ["Olanzapine 10 mg nightly", "Metformin 500 mg twice daily"],
  current_location: "County treatment center",
  prior_setting_bucket: "residential_program",
  conservatorship_type: "temporary",
  lai_vs_oral: "oral_and_lai",
  programming_notes: "Prefers a predictable morning routine.",
  family_involvement: "Sister participates in care planning.",
}, referral);
check("assessment report carries its exact signed source version", signedAssessmentReport.signed && signedAssessmentReport.assessmentId === "assessment-summary-fixture" && signedAssessmentReport.assessmentVersion === 7);
check("assessment reports render governed option labels instead of storage tokens",
  signedAssessmentReport.sections.some((section) => section.items.some((item) => item.label === "Prior setting type" && item.value === "Residential program"))
  && signedAssessmentReport.sections.some((section) => section.items.some((item) => item.label === "Conserved status" && item.value === "TCon"))
  && signedAssessmentReport.sections.some((section) => section.items.some((item) => item.label === "LAI vs oral" && item.value === "Oral and LAI")));
check("Meet the Client is generated from structured identity, medication, and bio fields", signedAssessmentReport.meetClient.name === referral.name && signedAssessmentReport.meetClient.medications.length === 2 && signedAssessmentReport.meetClient.bio.length >= 2);
const renderedMeetClient = meetClientTemplate.renderMeetClientEmail({
  ...signedAssessmentReport.meetClient,
  name: "<Test Client>",
}, "Supervisor & Reviewer", "delivery-fixture", ["LIC 602 <signed>.pdf", "Medication list.pdf"]);
check("Meet the Client subject excludes the client name", !renderedMeetClient.subject.includes("Test Client"));
check("Meet the Client HTML escapes clinical and identity content", renderedMeetClient.html.includes("&lt;Test Client&gt;") && renderedMeetClient.html.includes("Supervisor &amp; Reviewer") && !renderedMeetClient.html.includes("<Test Client>"));
check("Meet the Client identifies and escapes every attached admission file", renderedMeetClient.html.includes("LIC 602 &lt;signed&gt;.pdf") && renderedMeetClient.html.includes("Medication list.pdf") && !renderedMeetClient.html.includes("LIC 602 <signed>.pdf"));
check("small packets use direct Graph delivery", attachmentPolicy.meetClientAttachmentDeliveryMode([{ byteSize: 500_000 }, { byteSize: 500_000 }]) === "direct");
check("larger packet payloads use a draft upload", attachmentPolicy.meetClientAttachmentDeliveryMode([{ byteSize: 1_500_000 }, { byteSize: 1_500_000 }]) === "draft_upload");
const uploadRanges = attachmentPolicy.graphUploadRanges(10_000_001);
check("Graph attachment ranges are contiguous, bounded, and cover every byte", uploadRanges.length > 1
  && uploadRanges[0].start === 0
  && uploadRanges.at(-1).end === 10_000_000
  && uploadRanges.every((range, index) => range.end >= range.start
    && range.end - range.start + 1 <= attachmentPolicy.graphUploadChunkBytes
    && (index === 0 || range.start === uploadRanges[index - 1].end + 1)));

check("schedule requires time, duration, and method", !lifecycle.validateAssessmentScheduleCommand({ if_match: 1, schedule: { status: "scheduled", start_at: null, duration_minutes: null, method: null, location: null } }).ok);
check("schedule accepts a timezone-aware appointment", lifecycle.validateAssessmentScheduleCommand({ if_match: 1, schedule: { status: "scheduled", start_at: "2026-08-25T09:00:00-07:00", duration_minutes: 60, method: "in_person", location: "San Pablo" } }).ok);
check("addenda require an expected version", !lifecycle.validateAssessmentAddendumCommand({ note: "Later information", reason_code: "correction" }).ok);
check("not-applicable requirements satisfy gates only through an explicit reasoned status", records.isRequirementComplete("not_applicable"));

const referralStore = read("lib/pipeline/referral-store.ts");
const referralChangesRoute = read("app/api/referrals/changes/route.ts");
const referralHome = read("components/pipeline/ReferralHome.tsx");
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
const assessmentInterviewSchema = read("lib/assessment/assessment-interview-schema.ts");
const assessmentSeedSource = read("lib/assessment/assessment-seed.ts");
const referralCanvasPersistence = read("lib/pipeline/referral-canvas-persistence.ts");
const migration = read("database/migrations/0015_assessor_workflow.sql");
const rollback = read("database/rollbacks/0015_assessor_workflow.sql");
const admissionSummaryRoute = read("app/api/referrals/[referralId]/admission-summary/route.ts");
const meetClientEmailRoute = read("app/api/referrals/[referralId]/meet-client-email/route.ts");
const graphMail = read("lib/notifications/microsoft-graph-mail.ts");
const meetClientAttachments = read("lib/notifications/meet-client-attachments.ts");
const meetClientTemplateSource = read("lib/notifications/meet-client-email-template.ts");
const deliveryAudit = read("lib/pipeline/meet-client-delivery-audit.ts");
const assessmentChartWorkspace = read("components/pipeline/AssessmentChartWorkspace.tsx");
const referralPacketCanvas = read("components/pipeline/ReferralPacketCanvas.tsx");

check("referral assignment propagates to open assessments", referralStore.includes("syncLocalOpenAssessmentAssignment") && referralStore.includes("syncPostgresOpenAssessmentAssignment"));
check("recommendations survive the referral store boundary", referralStore.includes('"assessmentRecommendation"'));
check("explicit workflow status updates are persisted in both referral stores", referralStore.match(/safePatch\.workflowStatus/g)?.length >= 2);
check(
  "the workspace directory refreshes from a lightweight referral revision",
  referralChangesRoute.includes("getReferralStoreRevision")
    && referralChangesRoute.includes("requirePipelineUser")
    && referralHome.includes("/api/referrals/changes?after=")
    && referralHome.includes("window.setInterval(checkForChanges, 10_000)"),
);
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
check("field writing format stays embedded beside the canonical assessment field", assessmentWorkspace.includes("AssessmentFieldWritingGuidePanel")
  && assessmentWorkspace.includes("Use this order") && assessmentWorkspace.includes("Example format"));
check("the interview has no redundant generic assessment-notes question", !assessmentInterviewSchema.includes('q("assessment_notes"'));
check("embedded guidance has no provider or review request path", !/Claude|Anthropic|AI review|note-coach/.test(assessmentWorkspace)
  && !/fetch|provider|model/i.test(read("lib/assessment/assessment-narrative-guide.ts"))
  && !/fetch|provider|model/i.test(read("lib/assessment/assessment-field-writing-spec.ts")));
check("assigned assessors and supervisors can sign", signRoute.includes("canWorkAssessment") && signRoute.includes("assigned assessor or a supervisor"));
check("assigned assessors and supervisors can edit clinical assessment fields", assessmentRoute.includes("canWorkAssessment") && assessmentRoute.includes("assigned assessor or a supervisor"));
check("assessment start is explicit, supervisor-capable, and cannot rewrite completed history", startRoute.includes("canWorkAssessment") && startRoute.includes("assigned assessor or a supervisor") && startRoute.includes("A completed assessment cannot be started again"));
check("assessment start requires an explicit schedule", startRoute.includes("Schedule the assessment before beginning the interview."));
check("new assessments must be begun before signing", signRoute.includes("Begin the assessment before signing it"));
check("signed addenda are limited to the signer or a supervisor", addendumRoute.includes("assessment.signed_by?.id !== auth.user.id") && addendumRoute.includes("Only the signing assessor or a supervisor"));
check("assigned assessors and supervisors can submit a recommendation", recommendationRoute.includes("allowSupervisorOverride") && workflowStore.includes("allowSupervisorOverride") && workflowStore.includes("assigned assessor or a supervisor"));
check("only supervisors can record final decisions", decisionRoute.includes('["admin", "assessment_coordinator"]'));
check("authorized referral users can open signed assessment charts", admissionSummaryRoute.includes("requirePipelineUser(request)") && admissionSummaryRoute.includes("requireReferralAccess") && !admissionSummaryRoute.includes('requirePipelineUser(request, ["admin", "assessment_coordinator"])'));
check("only supervisors can send Meet the Client", meetClientEmailRoute.includes('["admin", "assessment_coordinator"]'));
check("Meet the Client requires explicit recipient confirmation and same-origin protection", meetClientEmailRoute.includes("body.value.confirmed !== true") && meetClientEmailRoute.includes("requireSameOriginMutation"));
check("Meet the Client requires an accepted decision and signed assessment", meetClientEmailRoute.includes('snapshot.decision?.outcome !== "accepted"') && meetClientEmailRoute.includes("selectSignedAssessment") && meetClientEmailRoute.includes("recommended?.signed_at"));
check("summary and email prefer the recommendation's exact assessment", admissionSummaryRoute.includes("snapshot.recommendation?.assessmentId") && meetClientEmailRoute.includes("snapshot.recommendation?.assessmentId"));
check("email recipients are constrained to approved organization domains", graphMail.includes("PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS") && graphMail.includes("allowedRecipientDomains.includes(emailDomain(value))"));
check("email subject excludes the client name", meetClientTemplateSource.includes('Meet the Client | ${summary.community') && !meetClientTemplateSource.match(/subject\s*=.*summary\.name/));
check("admission packet selection is server-owned and referral-scoped", meetClientEmailRoute.includes("getMeetClientAttachmentInventory")
  && meetClientAttachments.includes("referralId: referral.id")
  && meetClientAttachments.includes('excludedCategories = new Set<ReferralFile["category"]>(["Assessment"])')
  && !meetClientEmailRoute.includes("document_ids"));
check("admission packet delivery is blocked unless every file is safety-scanned", meetClientAttachments.includes('status !== "clean"')
  && meetClientAttachments.includes("files.some((file) => !file.ready)")
  && meetClientAttachments.includes("sourceSystem === \"pipeline\""));
check("packet delivery supports direct and resumable Graph attachment paths", graphMail.includes("sendDirectMessage")
  && graphMail.includes("createUploadSession")
  && graphMail.includes('Range: `bytes=${start}-${end}`')
  && graphMail.includes("deleteDraft"));
check("packet email has an explicit serverless delivery window", meetClientEmailRoute.includes("export const maxDuration = 300")
  && assessmentChartWorkspace.includes("timeoutMs: 300_000"));
check("email delivery is idempotent and audited without recipient addresses or filenames", deliveryAudit.includes("pipeline.idempotency_keys")
  && deliveryAudit.includes("recipient_domains")
  && deliveryAudit.includes("attachment_count")
  && !deliveryAudit.includes("recipient_addresses")
  && !deliveryAudit.includes("attachment_names"));
check("attachment inventory failures do not take down the signed chart", admissionSummaryRoute.includes("loadAdmissionPacketInventory")
  && admissionSummaryRoute.includes("Admission packet files are temporarily unavailable"));
check("the referral workspace exposes the assessment Chart without adding it to historical records", referralPacketCanvas.includes('{ page: 3, label: "Chart" }') && referralPacketCanvas.includes("normalizeWorkspaceView") && referralPacketCanvas.includes('workspaceStatus !== "historical"'));
check("the Chart workspace contains only the complete chart and Meet the Client outputs", assessmentChartWorkspace.includes('label="Complete chart"') && assessmentChartWorkspace.includes('label="Meet the Client"') && assessmentChartWorkspace.includes("<CompleteAssessmentChart") && assessmentChartWorkspace.includes("<MeetClientChart") && !assessmentChartWorkspace.includes("DecisionPanel") && !assessmentChartWorkspace.includes("overrideReason"));
check("the supervisor sees the exact packet before confirming delivery", assessmentChartWorkspace.includes("<AdmissionPacketSummary")
  && assessmentChartWorkspace.includes("listed admission files")
  && assessmentChartWorkspace.includes("Email summary + packet"));
check("the complete chart is generated only from a signed assessment", admissionSummaryRoute.includes("selectSignedAssessment") && admissionSummaryRoute.includes("recommended?.signed_at") && admissionSummaryRoute.includes("find((item) => item.signed_at)"));
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
