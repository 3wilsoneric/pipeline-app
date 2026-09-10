import type { ReferralStage } from "@/lib/pipeline/referral-workflow";
import type {
  AdmissionDecision,
  AdmissionRequirement,
  AssessmentRecommendation,
  EhrHandoffStatus,
  Referral,
  RequirementGate,
  RequirementStatus,
} from "@/lib/pipeline/referral-types";
import { getBlockingRequirementsForGates, isRequirementComplete } from "@/lib/pipeline/workflow-records";

export type WorkflowResponse = {
  referral: Referral;
  context: {
    assessmentId?: string | null;
    assessmentSigned?: boolean;
  };
  work_items: AdmissionRequirement[];
  decision: AdmissionDecision | null;
  recommendation: AssessmentRecommendation | null;
  transitions: Array<{
    target: ReferralStage;
    blockers: Array<{ code: string; label: string }>;
  }>;
  capabilities: {
    can_update: boolean;
    can_recommend: boolean;
    can_decide: boolean;
    can_authorize_manual_intake: boolean;
    can_reconcile_identity: boolean;
    can_review_identity: boolean;
  };
};

export type PendingWorkflowDetail =
  | { kind: "requirement"; item: AdmissionRequirement; status: RequirementStatus }
  | { kind: "ehr_failure" };

export type DecisionOutcomeDraft = AdmissionDecision["outcome"] | "";

export type RequirementGroupPresentation = {
  label: string;
  detail: string;
  items: AdmissionRequirement[];
};

export const requirementStatuses: RequirementStatus[] = [
  "needed",
  "requested",
  "received",
  "reviewed",
  "waived",
  "expired",
  "unavailable",
  "not_applicable",
];

const handoffDescriptions: Record<EhrHandoffStatus, string> = {
  sent: "Sent and recorded",
  queued: "Queued for transfer",
  failed: "Failed; reason recorded",
  ready: "Ready to queue",
  not_ready: "Available after acceptance",
};

export function deriveWorkflowPanelView(workflow: WorkflowResponse) {
  const incompleteDecision = getBlockingRequirementsForGates(workflow.work_items, ["admission_decision"]);
  const incompleteMoveIn = getBlockingRequirementsForGates(workflow.work_items, ["move_in"]);
  const incompleteEhr = getBlockingRequirementsForGates(workflow.work_items, ["ehr_export"]);
  const handoffStatus = workflow.referral.ehrHandoff?.status ?? "not_ready";
  const decisionDisclosureIsOpen = shouldOpenDecisionDisclosure(workflow);
  return {
    currentReferral: workflow.referral,
    forwardTransition: workflow.transitions.find((transition) => transition.target !== "Declined"),
    incompleteDecision,
    incompleteMoveIn,
    incompleteEhr,
    ehrIsBlocked: incompleteDecision.length + incompleteMoveIn.length + incompleteEhr.length > 0,
    handoffStatus,
    decisionDisclosureIsOpen,
    decisionDisclosureKey: disclosureState(decisionDisclosureIsOpen),
  };
}

export function requirementNeedsDetail(status: RequirementStatus) {
  return status === "requested" || status === "waived" || status === "unavailable" || status === "not_applicable";
}

export function requirementDetailPresentation(item: AdmissionRequirement, status: RequirementStatus) {
  if (status === "requested") {
    return {
      title: `Request ${item.label}`,
      description: "Record who is expected to provide this item. Pipeline will set a seven-day follow-up when none exists.",
      label: "Expected provider",
      initialValue: item.requestedFrom ?? "",
      confirmLabel: "Mark requested",
      minimumLength: 1,
    };
  }
  if (status === "waived") {
    return {
      title: `Waive ${item.label}`,
      description: "The waiver and its reason remain visible in the referral record.",
      label: "Waiver reason",
      initialValue: item.waiverReason ?? "",
      confirmLabel: "Record waiver",
      minimumLength: 3,
    };
  }
  return {
    title: status === "unavailable" ? `Mark ${item.label} unavailable` : `Mark ${item.label} not applicable`,
    description: "Record why this requirement cannot or does not need to be completed.",
    label: "Reason",
    initialValue: item.unavailableReason ?? "",
    confirmLabel: status === "unavailable" ? "Mark unavailable" : "Mark not applicable",
    minimumLength: 3,
  };
}

export function requirementGroups(items: AdmissionRequirement[]): RequirementGroupPresentation[] {
  const definitions: Array<{ label: string; detail: string; gates: RequirementGate[] }> = [
    { label: "Decision readiness", detail: "Blocking items must be resolved before an acceptance decision.", gates: ["admission_decision"] },
    { label: "Move-in readiness", detail: "Required move-in items must be resolved before admission is recorded.", gates: ["move_in"] },
    { label: "EHR readiness", detail: "These items must be resolved before the downstream handoff.", gates: ["ehr_export"] },
    { label: "Intake and assessment", detail: "Earlier profile and assessment requirements remain available for review.", gates: ["profile_completion", "pre_assessment"] },
  ];
  return definitions.flatMap((definition) => {
    const groupItems = items.filter((item) => definition.gates.includes(item.requiredFor));
    return groupItems.length > 0 ? [{ ...definition, items: groupItems }] : [];
  });
}

export function resolvedRequirementCount(items: AdmissionRequirement[]) {
  return items.filter((item) => isRequirementComplete(item.status)).length;
}

export function requirementStatusDetail(item: AdmissionRequirement) {
  if (item.status === "requested") {
    const followUp = item.followUpAt ? ` · follow up ${formatRequirementDate(item.followUpAt)}` : "";
    return `Requested from ${item.requestedFrom || "provider"}${followUp}`;
  }
  if (item.status === "waived") return `Waived · ${item.waiverReason || "reason recorded in activity"}`;
  if (item.status === "unavailable") return `Unavailable · ${item.unavailableReason || "reason recorded in activity"}`;
  if (item.status === "not_applicable") return `Not applicable · ${item.unavailableReason || "reason recorded in activity"}`;
  if (item.status === "received") return item.evidenceDocumentName ? `Received · ${item.evidenceDocumentName}` : "Received; review the source evidence.";
  if (item.status === "reviewed") return item.evidenceDocumentName ? `Reviewed · ${item.evidenceDocumentName}` : "Reviewed and resolved.";
  if (item.status === "expired") return "Expired; request current evidence before continuing.";
  return item.nextStep;
}

function formatRequirementDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export function formatRequirementStatus(status: RequirementStatus) {
  const label = status.replace("_", " ");
  return `${label[0].toUpperCase()}${label.slice(1)}`;
}

export function admissionRequirementSummary(items: AdmissionRequirement[]) {
  const openBlockers = getBlockingRequirementsForGates(items, ["admission_decision", "move_in", "ehr_export"]);
  if (openBlockers.length === 0) return "Admission and handoff blockers are resolved";
  return `${openBlockers.length} blocking requirement${openBlockers.length === 1 ? "" : "s"} remaining`;
}

export function admissionReadinessLabel(workflow: WorkflowResponse, blockerCount: number) {
  if (workflow.decision?.outcome === "declined") return "Not required";
  if (workflow.decision?.outcome !== "accepted") return "After acceptance";
  if (blockerCount > 0) return `${blockerCount} blocker${blockerCount === 1 ? "" : "s"} remaining`;
  return workflow.referral.stage === "Accepted / Admitted" ? "Recorded" : "Ready to record";
}

function requirementNextAction(requirements: AdmissionRequirement[], suffix: string) {
  const next = [...requirements].sort((left, right) => left.dueAt.localeCompare(right.dueAt))[0];
  return `${next.label} is still required ${suffix}.`;
}

export function transitionActionLabel(target: ReferralStage) {
  return target === "Accepted / Admitted" ? "Mark admitted" : `Advance to ${target}`;
}

export function terminalStageMessage(referral: Referral) {
  return referral.stage === "Accepted / Admitted"
    ? "Admission is recorded. Complete the EHR handoff below."
    : "This referral is closed as declined.";
}

function shouldOpenDecisionDisclosure(workflow: WorkflowResponse) {
  return Boolean(workflow.recommendation || workflow.decision || (workflow.capabilities.can_decide && workflow.context.assessmentSigned));
}

function disclosureState(open: boolean) {
  return open ? "ready" : "pending";
}

export function decisionHandoffNextAction(
  workflow: WorkflowResponse,
  incompleteDecision: AdmissionRequirement[],
  incompleteMoveIn: AdmissionRequirement[],
  incompleteEhr: AdmissionRequirement[],
  handoffStatus: EhrHandoffStatus,
) {
  if (!workflow.context.assessmentSigned) return "Complete and sign the assessment before the decision can be recorded.";
  if (!workflow.recommendation && !workflow.decision) return "Record the clinical recommendation, or document a supervisor override with the decision.";
  if (!workflow.decision && incompleteDecision.length > 0) return requirementNextAction(incompleteDecision, "before the supervisor can accept the referral");
  if (!workflow.decision) return "The signed assessment and clinical recommendation are ready for supervisor review.";
  if (workflow.decision.outcome === "declined") return "The referral is closed by the supervisor's decline decision; no EHR handoff is required.";
  return acceptedHandoffNextAction(workflow, incompleteDecision, incompleteMoveIn, incompleteEhr, handoffStatus);
}

function acceptedHandoffNextAction(
  workflow: WorkflowResponse,
  incompleteDecision: AdmissionRequirement[],
  incompleteMoveIn: AdmissionRequirement[],
  incompleteEhr: AdmissionRequirement[],
  handoffStatus: EhrHandoffStatus,
) {
  const admissionBlockers = [...incompleteDecision, ...incompleteMoveIn];
  if (admissionBlockers.length > 0) return requirementNextAction(admissionBlockers, "before admission can be recorded");
  if (workflow.referral.stage !== "Accepted / Admitted") return "Admission requirements are complete. Confirm the move-in and mark the person admitted.";
  if (incompleteEhr.length > 0) return requirementNextAction(incompleteEhr, "before the EHR handoff can be queued");
  if (handoffStatus === "queued") return "Confirm the downstream transfer, then record the handoff as sent or failed.";
  if (handoffStatus === "failed") return "Review the recorded failure, correct the downstream issue, and retry the handoff.";
  if (handoffStatus === "sent") return "Pipeline's admission and EHR handoff are complete; roster availability and identity linking remain governed separately.";
  return "The admitted referral is ready to queue for EHR handoff.";
}

export function decisionConfirmationMessage(outcome: AdmissionDecision["outcome"], updating: boolean) {
  const action = updating ? "Update" : "Record";
  const effect = outcome === "declined"
    ? "This closes the referral and writes the decision to its activity history."
    : "This advances the referral into post-assessment admission work and writes the decision to its activity history.";
  return `${action} the ${outcome} admission decision? ${effect}`;
}

export function decisionSubmissionIsBlocked(
  workflow: WorkflowResponse,
  outcome: DecisionOutcomeDraft,
  note: string,
  overrideReason: string,
  incompleteDecision: AdmissionRequirement[],
) {
  return !outcome
    || !workflow.context.assessmentSigned
    || (outcome === "accepted" && incompleteDecision.length > 0)
    || (outcome === "declined" && !note.trim())
    || (!workflow.recommendation && !overrideReason.trim());
}

export function formatOutcome(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

export function handoffDescription(status: EhrHandoffStatus) {
  return handoffDescriptions[status];
}

export function referralFromConflictPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const referral = (payload as { referral?: unknown }).referral;
  return referral && typeof referral === "object" && !Array.isArray(referral) ? referral as Referral : null;
}
