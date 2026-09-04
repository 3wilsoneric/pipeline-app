import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { getAssessmentCompletionSummary } from "@/lib/assessment/assessment-completion";
import { isUnassignedOwner } from "@/lib/pipeline/referral-ownership";
import type {
  AdmissionDecision,
  AssessmentRecommendation,
  Referral,
  ReferralWorkflowStatus,
} from "@/lib/pipeline/referral-types";

const referralManagedWorkflowStatuses = new Set<ReferralWorkflowStatus>([
  "intake_unassigned",
  "intake_documents_needed",
  "profile_incomplete",
  "ready_to_schedule",
]);

const terminalWorkflowStatuses = new Set<ReferralWorkflowStatus>([
  "accepted",
  "declined",
  "closed",
]);

export type WorkflowEvidence = {
  assessment?: PipelineAssessmentRecord | null;
  recommendation?: AssessmentRecommendation | null;
  decision?: AdmissionDecision | null;
};

export const workflowStatusLabels: Record<ReferralWorkflowStatus, string> = {
  intake_unassigned: "Needs assignment",
  intake_documents_needed: "Needs initial documents",
  profile_incomplete: "Profile incomplete",
  ready_to_schedule: "Ready to schedule",
  assessment_scheduled: "Assessment scheduled",
  assessment_in_progress: "Assessment in progress",
  waiting_for_information: "Waiting for information",
  assessment_ready_to_sign: "Ready to sign",
  assessment_signed: "Assessment signed",
  recommendation_submitted: "Recommendation submitted",
  decision_pending: "Supervisor decision needed",
  accepted: "Accepted",
  declined: "Declined",
  closed: "Closed",
};

export function resolveReferralWorkflowStatus(
  referral: Referral,
  evidence: WorkflowEvidence = {},
): ReferralWorkflowStatus {
  const decision = evidence.decision ?? referral.admissionDecision;
  if (decision?.outcome === "accepted" || referral.stage === "Accepted / Admitted") return "accepted";
  if (decision?.outcome === "declined" || referral.stage === "Declined") return "declined";
  if (isUnassignedOwner(referral.owner) || !referral.ownerId?.trim()) return "intake_unassigned";

  const assessment = evidence.assessment;
  if (assessment?.signed_at) return "assessment_signed";
  // Legacy "complete" records predate signatures. Preserve their completed
  // content, but require an explicit signer before calling them signed.
  if (assessment?.status === "complete") return "assessment_ready_to_sign";
  if (assessment?.status === "needs_review" || assessment?.status === "draft") {
    if (hasRequestedBlockingInformation(referral)) return "waiting_for_information";
    if (!assessment.started_at) {
      if (assessment.schedule_status === "scheduled" || assessment.schedule_status === "rescheduled") {
        return "assessment_scheduled";
      }
      return "ready_to_schedule";
    }
    const completion = getAssessmentCompletionSummary(assessment);
    if (completion.missing.length === 0) return "assessment_ready_to_sign";
    return "assessment_in_progress";
  }

  if (!hasInitialDocument(referral) && !hasManualIntakeAuthorization(referral)) {
    return "intake_documents_needed";
  }
  if (!profileIsReady(referral)) return "profile_incomplete";
  return "ready_to_schedule";
}

/**
 * Recalculate states that are derived entirely from referral intake data while
 * preserving assessment and terminal states owned by their lifecycle stores.
 */
export function resolveReferralWorkflowStatusAfterReferralChange(
  current: Referral,
  candidate: Referral,
  requestedStatus?: ReferralWorkflowStatus,
): ReferralWorkflowStatus {
  if (requestedStatus) return requestedStatus;

  const currentStatus = current.workflowStatus;
  if (currentStatus && terminalWorkflowStatuses.has(currentStatus)) return currentStatus;
  if (candidate.stage === "Accepted / Admitted" || candidate.stage === "Declined") {
    return resolveReferralWorkflowStatus(candidate);
  }
  if (!currentStatus || referralManagedWorkflowStatuses.has(currentStatus)) {
    return resolveReferralWorkflowStatus(candidate);
  }
  return currentStatus;
}

function hasRequestedBlockingInformation(referral: Referral) {
  return referral.requirements?.some((requirement) =>
    requirement.blocker
      && requirement.status === "requested"
      && ["profile_completion", "pre_assessment", "admission_decision"].includes(requirement.requiredFor),
  ) ?? false;
}

export function hasInitialDocument(referral: Referral) {
  return referral.documentStatus !== "Missing"
    || Boolean(referral.packetId?.trim());
}

export function hasManualIntakeAuthorization(referral: Referral) {
  const authorization = referral.manualIntakeAuthorization;
  return authorization?.mode === "manual_chart"
    && isPresent(authorization.reason)
    && isPresent(authorization.authorizedBy)
    && isPresent(authorization.authorizedAt);
}

export function profileIsReady(referral: Referral) {
  return Boolean(
    isCanonicalProfileValue(referral.name, ["pending packet review"])
      && isCanonicalProfileValue(referral.dob)
      && isCanonicalProfileValue(referral.community)
      && isCanonicalProfileValue(referral.source, ["referral packet"]),
  );
}

function isCanonicalProfileValue(value: string | undefined, extraPlaceholders: string[] = []) {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized && ![
    "unassigned",
    "unknown",
    "pending",
    "not reported",
    "n/a",
    ...extraPlaceholders,
  ].includes(normalized));
}

function isPresent(value: string | undefined) {
  return Boolean(value?.trim());
}
