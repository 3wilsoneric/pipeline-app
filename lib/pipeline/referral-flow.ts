import type { Referral, ReferralWorkflowStatus } from "./referral-types";
import { resolveReferralWorkflowStatus } from "./workflow-status";

export const activeReferralFlowStates = [
  { key: "assignment", label: "Assign", emptyLabel: "No referrals need assignment" },
  { key: "intake", label: "Intake", emptyLabel: "No referrals are in intake" },
  { key: "ready_to_schedule", label: "Ready to schedule", emptyLabel: "No referrals are ready to schedule" },
  { key: "scheduled", label: "Scheduled", emptyLabel: "No assessments are scheduled" },
  { key: "assessment", label: "Assessment", emptyLabel: "No assessments are in progress" },
  { key: "review", label: "Review", emptyLabel: "No assessments are ready for review" },
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
  if (status === "intake_unassigned") return "assignment";
  if (status === "intake_documents_needed" || status === "profile_incomplete") return "intake";
  if (status === "ready_to_schedule") return "ready_to_schedule";
  if (status === "assessment_scheduled") return "scheduled";
  if (status === "assessment_in_progress" || status === "waiting_for_information") return "assessment";
  if (
    status === "assessment_ready_to_sign"
    || status === "assessment_signed"
    || status === "recommendation_submitted"
    || status === "decision_pending"
  ) return "review";
  return "complete";
}
