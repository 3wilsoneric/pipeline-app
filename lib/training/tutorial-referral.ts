import { buildTrainingAssessment } from "./mock-assessment";
import { buildPipelineDemoReferral, pipelineDemoScenarios } from "@/lib/demo/demo-scenarios";
import { calendarToday } from "@/lib/pipeline/calendar-date";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { WorkflowResponse } from "@/components/pipeline/referral-workflow-panel-model";
import type { ReferralWorklistItem } from "@/lib/pipeline/operations-types";
import { getWorkspaceState } from "@/lib/pipeline/workspace-state";
import { resolveReferralWorkflowStatus } from "@/lib/pipeline/workflow-status";
import { getReferralBoardState, referralFlowStateForWorkspaceFocus } from "@/lib/pipeline/referral-flow";
import { getReferralProgress } from "@/lib/pipeline/referral-progress";

export const tutorialReferralSteps = [
  { title: "Home board", instruction: "Open Taylor's card. The next action on each card takes you to the right place.", target: "home-board-card" },
  { title: "Referral details", instruction: "Check the sample details and documents. Create referral continues to scheduling.", target: "intake-identity" },
  { title: "Schedule", instruction: "Choose the appointment time and method, then save. This appointment stays in the tutorial.", target: "assessment-schedule-fields" },
  { title: "Assessment", instruction: "Jump between sections. Edit recorded answers or fill unanswered fields; changes save in this sample.", target: "assessment-section-nav" },
  { title: "Review & sign", instruction: "Review the chart and unanswered items, then sign the sample assessment.", target: "assessment-sign" },
  { title: "Decision", instruction: "Record Accept, Deny, or Under review. Acceptance opens the admission date and packet.", target: "tutorial-decision" },
  { title: "Email & packet", instruction: "Check the recipients, client summary and files. Try a simulated send; nobody receives an email.", target: "tutorial-packet" },
  { title: "Client handoff", instruction: "Review the recorded handoff. Sending the packet does not confirm that the client has arrived.", target: "tutorial-admission" },
  { title: "Back on the board", instruction: "The referral remains available on the board. Close returns to your own work; Restart resets this sample.", target: "tutorial-board" },
] as const;

const entrySteps: Readonly<Record<string, number>> = {
  "assessor-shift": 0, "supervisor-shift": 0, "find-workspace": 0, clients: 0,
  "create-referral": 1, "practice-intake": 1, "workspace-files": 1,
  "start-assessment": 2, calendar: 2,
  "complete-assessment": 3, "practice-assessment": 3, "workspace-history": 3,
  "review-chart": 4, "record-decision": 5, "prepare-packet": 6,
};

export function tutorialReferralEntry(id: string) { return entrySteps[id]; }

export type TutorialReferral = {
  referral: Referral;
  assessment: PipelineAssessmentRecord;
  sentAt: string | null;
  underReview: boolean;
};

// Browser-local only. ID 0 must never be passed to a live referral loader.
export function createTutorialReferral(): TutorialReferral {
  const assessment = buildTrainingAssessment("schedule");
  const referral: Referral = {
    ...buildPipelineDemoReferral(pipelineDemoScenarios[2], "Practice assessor"),
    id: 0, name: "Taylor Rivera", ownerId: "tutorial-assessor", owner: "Practice assessor",
    community: "Turlock", dob: assessment.date_of_birth ?? "", email: "taylor@example.invalid",
    source: "Fictional referral facility", phone: "(555) 010-0200",
    documentStatus: "Uploaded", documentName: "Sample face sheet.pdf", packetStatus: "reviewed",
    note: "Fictional referral for residential placement. Taylor is leaving a stabilization center and has asked for a predictable daily routine.",
    currentMedications: assessment.medications_at_intake.join("\n"),
  };
  return { referral, assessment: { ...assessment, assessor: "Practice assessor", community: referral.community }, sentAt: null, underReview: false };
}

export function tutorialDecision(state: TutorialReferral, outcome: "accepted" | "declined", reasonNote = "") {
  return { decisionId: "tutorial-decision", outcome, reasonCode: "", reasonNote,
    decidedBy: "tutorial-assessor", decidedByName: "Practice assessor", decidedAt: new Date().toISOString(),
    version: 1, assessmentId: state.assessment.assessment_id, assessmentVersion: state.assessment.version };
}

// Jumping ahead supplies only missing prerequisites, never replaces edited answers.
export function prepareTutorialStep(state: TutorialReferral, index: number): TutorialReferral {
  const next = { ...state, referral: { ...state.referral }, assessment: prepareSampleAssessment(state.assessment, index) };
  if (index >= 6 && !next.referral.admissionDecision && !next.underReview) next.referral.admissionDecision = tutorialDecision(next, "accepted");
  if (index >= 6 && next.referral.admissionDecision?.outcome === "accepted") {
    next.referral.plannedAdmissionDate ||= calendarToday();
  }
  return next;
}

function prepareSampleAssessment(assessment: PipelineAssessmentRecord, index: number): PipelineAssessmentRecord {
  const next = { ...assessment };
  if (index < 3) return next;
  if (!next.scheduled_start_at) Object.assign(next, {
    scheduled_start_at: new Date().toISOString(), scheduled_duration_minutes: 60,
    scheduled_method: "phone", scheduled_location: "(555) 010-0200", schedule_status: "scheduled",
  });
  next.started_at ||= new Date().toISOString();
  if (index >= 5 && !next.signed_at) Object.assign(next, {
    signed_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    signed_by: next.updated_by, status: "complete",
  });
  return next;
}

export function tutorialWorkflow(state: TutorialReferral): WorkflowResponse {
  return { referral: state.referral, decision: state.referral.admissionDecision ?? null,
    recommendation: state.underReview ? { recommendationId: "tutorial-review", assessmentId: state.assessment.assessment_id,
      outcome: "needs_more_information", reasonCode: "", reasonNote: "Follow-up needed", recommendedBy: "tutorial-assessor",
      recommendedByName: "Practice assessor", recommendedAt: new Date().toISOString(), version: 1 } : null,
    review: null, reviews: [], work_items: [], transitions: [],
    context: { assessmentExists: true, assessmentId: state.assessment.assessment_id,
      assessmentSigned: Boolean(state.assessment.signed_at), assessmentComplete: Boolean(state.assessment.signed_at),
      assessmentStarted: Boolean(state.assessment.started_at), assessmentData: state.assessment,
      assessmentScheduleStatus: state.assessment.schedule_status, packetSentAt: state.sentAt },
    capabilities: { can_update: true, can_recommend: true, can_decide: true, can_email: false,
      can_request_changes: false, can_authorize_manual_intake: false, can_reconcile_identity: false, can_review_identity: false } };
}

export function tutorialBoardItem(state: TutorialReferral): ReferralWorklistItem {
  const { referral, assessment } = state;
  const context = tutorialWorkflow(state).context;
  const workspace = getWorkspaceState(referral, context);
  const progress = getReferralProgress(referral, context);
  const status = resolveReferralWorkflowStatus(referral, { assessment });
  return { referral_id: 0, client_name: referral.name, community: referral.community, stage: referral.stage,
    workflow_status: status, board: getReferralBoardState(referral, context, workspace), packet_sent_at: state.sentAt, planned_admission_date: referral.plannedAdmissionDate,
    actual_admission_date: referral.actualAdmissionDate, flow_state: referralFlowStateForWorkspaceFocus(workspace.focus),
    assignment_state: workspace.assignment, assessment_state: workspace.assessment,
    outcome_state: workspace.outcome, document_state: workspace.documents, profile_state: workspace.profile, assessment_is_reassessment: false,
    owner: referral.owner, priority: "standard", categories: ["assessment_due"], primary_category: "assessment_due",
    next_action: progress.next_action ?? "Open workspace",
    blockers: [], missing_data: [], urgency: "normal", due_at: assessment.scheduled_start_at ?? null,
    last_activity_at: referral.createdAt, age_hours: 0, completion_pct: 40, missing_document_count: 0,
    location: { view: "assessment" } };
}
