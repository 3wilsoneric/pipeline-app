import type { Referral, ReferralWorkflowStatus } from "./referral-types";
import { resolveReferralWorkflowStatus } from "./workflow-status";

export const activeReferralFlowStates = [
  { key: "ready_to_schedule", label: "Ready to schedule", emptyLabel: "No referrals are ready to schedule" },
  { key: "scheduled", label: "Scheduled", emptyLabel: "No assessments are scheduled" },
  { key: "assessment", label: "Assessment", emptyLabel: "No assessments are in progress" },
  { key: "complete_chart", label: "Complete chart", emptyLabel: "No charts need completion" },
] as const;

export type ActiveReferralFlowState = (typeof activeReferralFlowStates)[number]["key"];
export type ReferralFlowState = ActiveReferralFlowState | "complete";

export function getReferralWorkflowStatus(referral: Referral): ReferralWorkflowStatus {
  return referral.workflowStatus ?? resolveReferralWorkflowStatus(referral);
}

export function getReferralFlowState(referral: Referral): ReferralFlowState {
  return referralFlowStateForStatus(getReferralWorkflowStatus(referral));
}

export function referralFlowStateForStatus(status: ReferralWorkflowStatus): ReferralFlowState {
  if (
    status === "intake_unassigned"
    || status === "intake_documents_needed"
    || status === "profile_incomplete"
    || status === "ready_to_schedule"
  ) return "ready_to_schedule";
  if (status === "assessment_scheduled") return "scheduled";
  if (status === "assessment_in_progress" || status === "waiting_for_information") return "assessment";
  if (
    status === "assessment_ready_to_sign"
    || status === "assessment_signed"
    || status === "recommendation_submitted"
    || status === "decision_pending"
  ) return "complete_chart";
  return "complete";
}
