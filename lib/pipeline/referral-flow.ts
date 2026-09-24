import type { Referral, ReferralWorkflowStatus } from "./referral-types";
import type { WorkflowContext } from "./workflow-records";
import { getWorkspaceState, isRequirementResolved, type WorkspaceFocus, type WorkspaceStateProjection } from "./workspace-state";
import { resolveReferralWorkflowStatus } from "./workflow-status";
import { getAssessmentToolCoverage } from "../assessment/assessment-tool-schema";
import type { PipelineWorkspaceLocation } from "./work-continuity";
import { isDocumentRequirementType } from "./document-requirements";

export const activeReferralFlowStates = [
  { key: "ready_to_schedule", label: "Intake & scheduling", emptyLabel: "No intake or scheduling work" },
  { key: "scheduled", label: "Scheduled", emptyLabel: "No assessments are scheduled" },
  { key: "assessment", label: "Assessment", emptyLabel: "No assessments are in progress" },
  { key: "complete_chart", label: "Decision & completion", emptyLabel: "No decision or completion work" },
] as const;

export const referralBoardStages = [
  { key: "received", label: "Referral received" },
  { key: "in_progress", label: "In progress" },
  { key: "decision", label: "Decision" },
] as const;

export type ReferralBoardStage = (typeof referralBoardStages)[number]["key"];

export type ReferralBoardState = {
  stage: ReferralBoardStage | null;
  detail: string;
  next_action: string;
  location: PipelineWorkspaceLocation;
};

function boardCard(stage: ReferralBoardStage | null, detail: string, next_action: string, view: PipelineWorkspaceLocation["view"]): ReferralBoardState {
  return { stage, detail, next_action, location: { view } };
}

/** The personal board tracks admission work, not extraction or later client reconciliation. */
export function getReferralBoardState(
  referral: Referral,
  context: WorkflowContext = {},
  state: WorkspaceStateProjection = getWorkspaceState(referral, context),
): ReferralBoardState {
  if (state.lifecycle !== "active" || referral.workflowStatus === "closed") {
    return boardCard(null, "Closed", "Open workspace", "chart");
  }
  // A new assessment reopens current work without discarding the earlier admission.
  const reassessmentOpen = state.assessment_is_reassessment
    && !(state.assessment === "signed" && context.packetSentAt);
  if (!reassessmentOpen) {
    const decision = decisionBoardState(referral, context, state);
    if (decision) return decision;
  }
  return assessmentBoardState(referral, context, state);
}

function decisionBoardState(referral: Referral, context: WorkflowContext, state: WorkspaceStateProjection): ReferralBoardState | null {
  if (referral.stage === "Accepted / Admitted" || referral.workflowStatus === "admitted") {
    return context.packetSentAt
      ? boardCard(null, "Completed", "Open workspace", "chart")
      : boardCard("decision", "Email not sent", "Send Meet the Client", "email");
  }
  if (state.outcome === "declined") return boardCard("decision", "Denied", "Review decision", "workflow");
  if (state.outcome === "accepted") return acceptedBoardState(referral, context, state);
  if (["recommendation_submitted", "decision_pending"].includes(referral.workflowStatus ?? "")) {
    return boardCard("decision", "Under review", "Record decision", "workflow");
  }
  return null;
}

function acceptedBoardState(referral: Referral, context: WorkflowContext, state: WorkspaceStateProjection): ReferralBoardState {
  if (state.assessment === "ready_to_sign") return { ...boardCard("decision", "Accept", "Review and sign the assessment", "assessment"), location: { view: "assessment", assessmentMode: "review" } };
  if (state.assessment !== "signed") return boardCard("decision", "Accept", "Complete the assessment", "assessment");
  const outstanding = (context.requirements ?? referral.requirements ?? [])
    .filter((requirement) => ["admission_decision", "move_in"].includes(requirement.requiredFor) && !isRequirementResolved(requirement))
    .sort((left, right) => Number(right.blocker) - Number(left.blocker)
      || (left.dueAt || "9999").localeCompare(right.dueAt || "9999")
      || Number(left.requiredFor !== "admission_decision") - Number(right.requiredFor !== "admission_decision"));
  if (outstanding.length > 0) {
    const nextItems = outstanding.slice(0, 3).map((requirement) => requirement.label.trim()).filter(Boolean).join(", ");
    return boardCard("decision", "Accept", nextItems || "Review admission requirements", isDocumentRequirementType(outstanding[0].type) ? "files" : "workflow");
  }
  return boardCard("decision", "Awaiting admit", "Record admission", "workflow");
}

function assessmentBoardState(referral: Referral, context: WorkflowContext, state: WorkspaceStateProjection): ReferralBoardState {
  if (state.assessment === "signed") return boardCard("decision", "Under review", "Record decision", "workflow");
  if (state.assessment === "ready_to_sign") return { ...boardCard("in_progress", "Ready to sign", "Review and sign the assessment", "assessment"), location: { view: "assessment", assessmentMode: "review" } };
  if (["in_progress", "waiting_for_information"].includes(state.assessment)) return boardCard("in_progress", "Assessment underway", "Continue assessment", "assessment");
  if (state.assessment === "scheduled") return boardCard("in_progress", "Assessment scheduled", "Prepare assessment", "assessment");
  return hasReferralPreparation(referral, context, state)
    ? boardCard("in_progress", "Preparation", "Continue preparation", "assessment")
    : boardCard("received", "Referral received", "Add referral information", "intake");
}

function hasReferralPreparation(referral: Referral, context: WorkflowContext, state: WorkspaceStateProjection) {
  return Boolean(referral.packetId || referral.additionalDocuments?.length
    || ["Uploaded", "Reviewed"].includes(referral.documentStatus)
    || !state.missing_profile_fields.includes("Date of birth")
    || !state.missing_profile_fields.includes("Referral source")
    || [referral.currentMedications, referral.phone, referral.email, referral.conserved].some((value) => value?.trim())
    || context.assessmentData && getAssessmentToolCoverage(context.assessmentData).captured > 0);
}

export type ActiveReferralFlowState = (typeof activeReferralFlowStates)[number]["key"];
export type ReferralFlowState = ActiveReferralFlowState | "complete";

export function getReferralWorkflowStatus(referral: Referral): ReferralWorkflowStatus {
  return referral.workflowStatus ?? resolveReferralWorkflowStatus(referral);
}

export function getReferralFlowState(
  referral: Referral,
  context: WorkflowContext = {},
): ReferralFlowState {
  return referralFlowStateForWorkspaceFocus(getWorkspaceState(referral, context).focus);
}

export function referralFlowStateForWorkspaceFocus(focus: WorkspaceFocus): ReferralFlowState {
  if (focus === "follow_up") return "complete_chart";
  return focus;
}

export function referralFlowStateForStatus(status: ReferralWorkflowStatus): ReferralFlowState {
  if (
    status === "intake_unassigned"
    || status === "intake_documents_needed"
    || status === "profile_incomplete"
    || status === "ready_to_schedule"
  ) return "ready_to_schedule";
  if (status === "assessment_scheduled") return "scheduled";
  if (status === "assessment_in_progress" || status === "waiting_for_information" || status === "changes_requested") return "assessment";
  if (
    status === "assessment_ready_to_sign"
    || status === "assessment_signed"
    || status === "recommendation_submitted"
    || status === "decision_pending"
    || status === "approved_for_placement"
  ) return "complete_chart";
  return "complete";
}
