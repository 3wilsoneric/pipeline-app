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
  { title: "Home board", instruction: "Open the sample card to continue its assessment. To practice an intake or appointment, choose Referral details or Schedule.", target: "home-board-card" },
  { title: "Referral details", instruction: "Check the sample details and documents. Create referral continues to scheduling.", target: "intake-identity" },
  { title: "Schedule", instruction: "Choose a time and meeting method, then select Schedule interview. The assessment opens next.", target: "assessment-schedule-fields" },
  { title: "Assessment", instruction: "Choose a section. Try editing an answer or filling a blank; watch for the saved confirmation. Continue to Review & sign when ready.", target: "assessment-section-nav" },
  { title: "Review & sign", instruction: "Review the chart and unanswered items, then sign the sample assessment.", target: "assessment-sign" },
  { title: "Decision", instruction: "Record Accept, Deny, or Under review. An accepted referral can preview the handoff before an admission date is known.", target: "tutorial-decision" },
  { title: "Email & packet", instruction: "Review Meet the Client, the chart and files. Check the recipients, then try Simulate send. No email leaves this tutorial.", target: "tutorial-packet" },
  { title: "Client handoff", instruction: "The packet has not been sent. Use Review email & packet to finish the sample handoff.", target: "tutorial-admission" },
  { title: "Back on the board", instruction: "Open the card to return to this sample. Return to work closes the tutorial without changing your real referrals.", target: "home-board-card" },
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
  packetRecipient: string;
};

const noPacketInstruction = "No packet is needed for this decision. Return to Decision to try acceptance, or go back to the board.";
const outcomeInstructions: Partial<Record<number, Partial<Record<"pending" | "review" | "accepted" | "declined" | "sent", string>>>> = {
  5: {
    sent: "The sample handoff is complete. Its decision stays recorded; return to the board to see where it appears.",
    review: "Saved under review. No admission packet is needed yet. Return to the board, or choose another decision here.",
    declined: "Denied. No admission packet is needed. Return to the board, or use Change sample decision to try acceptance.",
    accepted: "Accepted. Review the email and packet now; add the planned admission date before sending. Acceptance alone does not send anything.",
  },
  6: { review: noPacketInstruction, declined: noPacketInstruction, sent: "Simulated send complete. Nobody received an email. Continue to Client handoff to check the recorded status." },
  7: { review: noPacketInstruction, declined: noPacketInstruction, sent: "The sample packet is marked sent; the client is still awaiting admission. Continue to the board to see that status." },
  8: {
    review: "The sample remains under review in Decision. Reopen it when more information arrives. Return to work leaves this tutorial.",
    declined: "The denied sample stays in Decision. Its assessment and files remain available. Return to work leaves this tutorial.",
    sent: "Find the sample in Decision, awaiting admission. Sending a packet does not mark someone admitted. Return to work leaves this tutorial.",
  },
};

export function tutorialStepInstruction(state: TutorialReferral, step: number): string {
  const outcome = state.sentAt ? "sent" : state.underReview ? "review" : state.referral.admissionDecision?.outcome ?? "pending";
  if (step === 6 && outcome === "accepted" && !state.referral.plannedAdmissionDate) return "Preview Meet the Client, the chart, and files now. To simulate sending, return to Decision and add the planned admission date.";
  return outcomeInstructions[step]?.[outcome] ?? tutorialReferralSteps[step].instruction;
}

const stepHelp = [
  [
    { problem: "Can't find the card?", action: "Look in In progress. On a phone, choose In progress from Referral stage. If you changed the sample, use Restart tutorial to put it back." },
    { problem: "Want to start somewhere else?", action: "Use the Step menu to open Referral details or Schedule. Skipped steps get sample information." },
  ],
  [
    { problem: "No documents to upload?", action: "Open Referral documents. The sample face sheet and medication list are already there; you can also try dropping your own file locally." },
    { problem: "Wrong age or referral contact?", action: "Change Date of birth once; age updates from it. Check the Referral details fields for the source, phone, and email." },
  ],
  [
    { problem: "Schedule interview won't continue?", action: "Choose a date and time, a method, and the phone number, address, or link required for that method. Times are Pacific." },
    { problem: "Closed the scheduling window?", action: "Select Schedule interview in the assessment header to reopen the appointment form." },
  ],
  [
    { problem: "Already answered something?", action: "Open Current information to change that answer, or Client info on a phone. Use Assessment section to jump elsewhere without working in order." },
    { problem: "Not sure your answer saved?", action: "Check the save status before leaving. If it shows an error, keep this assessment open and use the error to retry; do not refresh to get past it." },
  ],
  [
    { problem: "Need to change an answer?", action: "Return to Assessment using the Step menu. Edit the same sample assessment, then return to Review & sign." },
    { problem: "Sign is unavailable?", action: "Wait for saving to finish and check the save status. Unanswered items remain visible in the review; they do not require a second assessment." },
  ],
  [
    { problem: "Where is the admission date?", action: "Select Accept and Record decision first. Planned admission date appears only for an accepted referral." },
    { problem: "Need to change the decision?", action: "Use Change sample decision before the packet is sent. Under review and Deny do not need an admission date or packet." },
  ],
  [
    { problem: "Simulate send is disabled?", action: "Add the planned admission date in Decision, check that To has an address, then select Recipients checked. This tutorial never sends an email." },
    { problem: "Where does the real email go?", action: "In a real workspace, review the recipients, email, chart, and files. The handoff can be sent from Alamo Admissions or prepared for your own inbox or Outlook, depending on the available option. Reopen a sent handoff in workspace Email history. Check the exact status before trying again; an uncertain result must not create a duplicate." },
  ],
  [
    { problem: "Why isn't this client admitted?", action: "Accepting and sending a packet do not mark someone admitted. The actual admission is recorded later, after it happens." },
    { problem: "Need to finish the packet?", action: "Choose Email & packet from the Step menu. Review its tabs, recipients, and simulated send there." },
  ],
  [
    { problem: "Which folder has the sample?", action: "Look in Decision. Open the card to return to its current work; a sent packet can still be awaiting admission." },
    { problem: "Want your real work back?", action: "Select Return to work or Close tutorial. This fictional sample never changes a real referral." },
  ],
] as const;

export function tutorialStepHelp(state: TutorialReferral, step: number) {
  if (step === 5 && state.sentAt) return [
    { problem: "Why can't I change the decision?", action: "The sample packet is marked sent, so the earlier decision is locked. Open the board to see its current status." },
    { problem: "Is the client admitted?", action: "No. Sending Meet the Client does not record an actual arrival or admission." },
  ];
  if (step === 6 && (state.underReview || state.referral.admissionDecision?.outcome === "declined")) return [
    { problem: "Why is there no packet?", action: "Under review and Deny have no admission packet. Return to Decision to change the sample before anything is sent." },
  ];
  if (step === 6 && state.sentAt) return [
    { problem: "Need to check what was sent?", action: "Open the Meet the Client, Assessment chart, and Files tabs. The simulated send did not contact anyone." },
    { problem: "Need to change something now?", action: "The sample is locked after simulated send. In real work, check delivery status and use the documented follow-up process rather than sending a duplicate." },
  ];
  return stepHelp[step] ?? [];
}

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
  return { referral, assessment: { ...assessment, assessor: "Practice assessor", community: referral.community }, sentAt: null, underReview: false, packetRecipient: "community@example.invalid" };
}

export function tutorialDecision(state: TutorialReferral, outcome: "accepted" | "declined", reasonNote = "") {
  return { decisionId: "tutorial-decision", outcome, reasonCode: "", reasonNote,
    decidedBy: "tutorial-assessor", decidedByName: "Practice assessor", decidedAt: new Date().toISOString(),
    version: 1, assessmentId: state.assessment.assessment_id, assessmentVersion: state.assessment.version };
}

// Jumping ahead supplies only missing prerequisites, never replaces edited answers.
export function prepareTutorialStep(state: TutorialReferral, index: number): TutorialReferral {
  const next = { ...state, referral: { ...state.referral }, assessment: prepareSampleAssessment(state.assessment, index) };
  const suppliedDecision = index >= 6 && !next.referral.admissionDecision && !next.underReview;
  if (suppliedDecision) next.referral.admissionDecision = tutorialDecision(next, "accepted");
  if (suppliedDecision) {
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
