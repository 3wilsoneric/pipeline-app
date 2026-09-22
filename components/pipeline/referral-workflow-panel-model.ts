import { getStageLabel, referralStageDefinitions, type ReferralStage } from "@/lib/pipeline/referral-workflow";
import type {
  AdmissionDecision,
  AdmissionRequirement,
  AssessmentRecommendation,
  AssessmentReview,
  EhrHandoffStatus,
  Referral,
  RequirementGate,
  RequirementStatus,
} from "@/lib/pipeline/referral-types";
import { getBlockingRequirementsForGates, isRequirementComplete, type WorkflowContext } from "@/lib/pipeline/workflow-records";
import { getWorkspaceState } from "@/lib/pipeline/workspace-state";
import { hasManualIntakeAuthorization } from "@/lib/pipeline/workflow-status";

export type WorkflowResponse = {
  referral: Referral;
  context: WorkflowContext;
  work_items: AdmissionRequirement[];
  decision: AdmissionDecision | null;
  recommendation: AssessmentRecommendation | null;
  review: AssessmentReview | null;
  reviews: AssessmentReview[];
  transitions: Array<{
    target: ReferralStage;
    blockers: Array<{ code: string; label: string }>;
    alerts?: Array<{ code: string; label: string }>;
  }>;
  capabilities: {
    can_update: boolean;
    can_recommend: boolean;
    can_decide: boolean;
    can_email: boolean;
    can_request_changes: boolean;
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
  const assessmentState = currentAssessmentState(workflow);
  return {
    currentReferral: workflow.referral,
    forwardTransition: workflow.transitions.find((transition) => transition.target === referralStageDefinitions[referralStageDefinitions.findIndex((stage) => stage.stage === workflow.referral.stage) + 1]?.stage && transition.target !== "Declined"),
    assessmentState,
    showManualIntake: !assessmentState
      && workflow.capabilities.can_authorize_manual_intake
      && !hasManualIntakeAuthorization(workflow.referral)
      && ["New", "Packet Needed"].includes(workflow.referral.stage),
    incompleteDecision,
    incompleteMoveIn,
    incompleteEhr,
    ehrIsBlocked: workflow.decision?.outcome !== "accepted",
    handoffStatus,
    decisionDisclosureIsOpen,
    decisionDisclosureKey: disclosureState(decisionDisclosureIsOpen),
  };
}

function currentAssessmentState(workflow: WorkflowResponse) {
  const state = getWorkspaceState(workflow.referral, workflow.context);
  if (!workflow.context.assessmentId || state.lifecycle !== "active") return null;
  if (state.assessment === "signed" && (workflow.decision || workflow.review?.status === "submitted")) return null;
  const labels: Partial<Record<typeof state.assessment, string>> = {
    scheduled: "Scheduled",
    in_progress: "In progress",
    waiting_for_information: "Waiting for information",
    ready_to_sign: "Ready to sign",
    signed: "Signed",
  };
  return labels[state.assessment] ?? null;
}

export function requirementNeedsDetail(status: RequirementStatus) {
  return status === "requested" || status === "waived" || status === "unavailable" || status === "not_applicable";
}

export function requirementDetailPresentation(item: AdmissionRequirement, status: RequirementStatus) {
  if (status === "requested") {
    return {
      title: `Request ${item.label}`,
      description: "Add the expected provider if known. Missing details can be added later.",
      label: "Expected provider (optional)",
      initialValue: item.requestedFrom ?? "",
      confirmLabel: "Mark requested",
      minimumLength: 0,
    };
  }
  if (status === "waived") {
    return {
      title: `Waive ${item.label}`,
      description: "The waiver is recorded. You can add a reason or continue without one.",
      label: "Waiver reason (optional)",
      initialValue: item.waiverReason ?? "",
      confirmLabel: "Record waiver",
      minimumLength: 0,
    };
  }
  return {
    title: status === "unavailable" ? `Mark ${item.label} unavailable` : `Mark ${item.label} not applicable`,
    description: "Add any context, or continue without a reason.",
    label: "Reason (optional)",
    initialValue: item.unavailableReason ?? "",
    confirmLabel: status === "unavailable" ? "Mark unavailable" : "Mark not applicable",
    minimumLength: 0,
  };
}

export function requirementGroups(items: AdmissionRequirement[]): RequirementGroupPresentation[] {
  const definitions: Array<{ label: string; detail: string; gates: RequirementGate[] }> = [
    { label: "Decision readiness", detail: "Missing items stay visible while the decision proceeds.", gates: ["admission_decision"] },
    { label: "Move-in readiness", detail: "Missing move-in items can be completed after admission is recorded.", gates: ["move_in"] },
    { label: "EHR readiness", detail: "Track remaining paperwork alongside the downstream handoff.", gates: ["ehr_export"] },
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
    const followUp = item.followUpAt ? ` · follow up ${formatRequirementDate(item.followUpAt)}` : " · follow-up date not provided";
    return `Requested from ${item.requestedFrom || "provider not specified"}${followUp}`;
  }
  if (item.status === "waived") return `Waived · ${item.waiverReason || "reason not provided"}`;
  if (item.status === "unavailable") return `Unavailable · ${item.unavailableReason || "reason not provided"}`;
  if (item.status === "not_applicable") return `Not applicable · ${item.unavailableReason || "reason not provided"}`;
  if (item.status === "received") return item.evidenceDocumentName ? `Received · ${item.evidenceDocumentName}` : "Received; review the source evidence.";
  if (item.status === "reviewed") return item.evidenceDocumentName ? `Reviewed · ${item.evidenceDocumentName}` : "Reviewed and resolved.";
  if (item.status === "expired") return "Expired; request current evidence when available.";
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
  if (openBlockers.length === 0) return "Admission and handoff items are complete";
  return `${openBlockers.length} open item${openBlockers.length === 1 ? "" : "s"}`;
}

export function admissionReadinessLabel(workflow: WorkflowResponse, blockerCount: number) {
  if (workflow.decision?.outcome === "declined") return "Not required";
  if (workflow.decision?.outcome !== "accepted") return "After acceptance";
  if (blockerCount > 0) return `${blockerCount} open item${blockerCount === 1 ? "" : "s"}`;
  return workflow.referral.stage === "Accepted / Admitted" ? "Recorded" : "Ready to record";
}

function requirementNextAction(requirements: AdmissionRequirement[], suffix: string) {
  const next = [...requirements].sort((left, right) => left.dueAt.localeCompare(right.dueAt))[0];
  return `${next.label} can be completed ${suffix}.`;
}

// A forward transition only changes the referral's stage; the label must not imply a decision, signature, or send.
export function transitionActionLabel(target: ReferralStage) {
  return target === "Accepted / Admitted" ? "Mark admitted" : `Change stage to ${getStageLabel(target)}`;
}

export function transitionSuccessMessage(target: ReferralStage) {
  return target === "Accepted / Admitted" ? "Admission recorded" : `Stage changed to ${getStageLabel(target)}`;
}

export function terminalStageMessage(referral: Referral) {
  return referral.stage === "Accepted / Admitted"
    ? "Admission is recorded. Complete the EHR handoff below."
    : "This referral is closed as declined.";
}

function shouldOpenDecisionDisclosure(workflow: WorkflowResponse) {
  return Boolean(workflow.review || workflow.recommendation || workflow.decision || workflow.capabilities.can_decide);
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
  if (!workflow.decision) return "Acceptance can be recorded now. Assessment answers, signing, and packet sending are separate steps.";
  if (!workflow.context.assessmentSigned && workflow.decision.outcome === "accepted") return "Accepted. Continue the questionnaire and sign when ready. No packet has been sent by this decision.";
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
  if (admissionBlockers.length > 0) return "Admission can be recorded with open items. Complete the remaining paperwork when available.";
  if (workflow.referral.stage !== "Accepted / Admitted") return "Admission requirements are complete. Confirm the move-in and mark the person admitted.";
  if (incompleteEhr.length > 0) return requirementNextAction(incompleteEhr, "alongside the EHR handoff");
  if (handoffStatus === "queued") return "Confirm the downstream transfer, then record the handoff as sent or failed.";
  if (handoffStatus === "failed") return "Review the recorded failure, correct the downstream issue, and retry the handoff.";
  if (handoffStatus === "sent") return "Pipeline's admission and EHR handoff are complete; roster availability and identity linking remain governed separately.";
  return "The admitted referral is ready to queue for EHR handoff.";
}

export function decisionConfirmationMessage(outcome: AdmissionDecision["outcome"], updating: boolean) {
  const action = updating ? "Replace" : "Record";
  const effect = outcome === "declined"
    ? "This closes the referral and writes the decision to its activity history."
    : "This records acceptance. Assessment answers stay editable until you sign. Signing and packet sending are separate actions.";
  return `${action} the ${outcome} admission decision? ${effect}`;
}

export type DecisionActionState = {
  disabled: boolean;
  hint: string;
};

/**
 * Explains the one decision action next to the button, so an unavailable action
 * never appears as an unexplained dim control. It mirrors the existing
 * permission and selection rules rather than adding new gates.
 */
export function decisionActionState(
  workflow: WorkflowResponse,
  draft: { outcome: DecisionOutcomeDraft | AssessmentRecommendation["outcome"] },
  busy: boolean,
): DecisionActionState {
  const underReview = draft.outcome === "needs_more_information";
  if (!workflow.capabilities.can_decide) return { disabled: true, hint: "You can view this decision, but your account cannot record it." };
  if (!draft.outcome) return { disabled: true, hint: "Choose Accept, Deny, or Under review to continue." };
  if (underReview && hasLegacyDecisionSubmission(workflow)) return { disabled: true, hint: "This earlier submission is preserved. Choose Accept or Deny when ready." };
  if (underReview && !workflow.context.assessmentId) return { disabled: true, hint: "Open the assessment before saving Under review." };
  if (underReview && !workflow.capabilities.can_recommend) return { disabled: true, hint: "Your account cannot save Under review. Choose Accept or Deny." };
  if (busy) return { disabled: true, hint: "Saving..." };
  if (underReview) return { disabled: false, hint: "Saves Under review. The referral stays open and nothing is sent." };
  if (draft.outcome === "decline") return { disabled: false, hint: "You will confirm before the denial is recorded. It closes the referral; nothing is sent." };
  return { disabled: false, hint: "You will confirm before acceptance is recorded. Nothing is signed or sent." };
}

export function hasLegacyDecisionSubmission(workflow: WorkflowResponse) {
  return Boolean(workflow.review && workflow.review.assessmentId === workflow.context.assessmentId);
}

const recommendationOutcomeLabels: Record<AssessmentRecommendation["outcome"], string> = {
  accept: "Accept",
  decline: "Deny",
  needs_more_information: "Under review",
};

export function formatRecordedAt(value: string | null | undefined) {
  if (!value) return "date not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export type RecommendationPresentation = {
  outcome: AssessmentRecommendation["outcome"];
  outcomeLabel: string;
  attribution: string;
  note: string;
  earlierAssessment: boolean;
  review: string | null;
};

/** The recommendation on file, attributed and dated, for display beside the final decision. */
export function recommendationPresentation(workflow: WorkflowResponse): RecommendationPresentation | null {
  const recommendation = workflow.recommendation;
  if (!recommendation) return null;
  const review = workflow.review;
  return {
    outcome: recommendation.outcome,
    outcomeLabel: recommendationOutcomeLabels[recommendation.outcome],
    attribution: `${recommendation.recommendedByName || "Name not recorded"} · ${formatRecordedAt(recommendation.recommendedAt)}`,
    note: recommendation.reasonNote,
    earlierAssessment: Boolean(workflow.context.assessmentId && recommendation.assessmentId && recommendation.assessmentId !== workflow.context.assessmentId),
    review: review ? `${reviewStatusLabel(review)} · submitted by ${review.submittedByName || "name not recorded"} · ${formatRecordedAt(review.submittedAt)}` : null,
  };
}

export type DecisionProgressStep = {
  key: "answers" | "interview" | "signed" | "decision" | "packet";
  label: string;
  state: "done" | "open" | "not_needed";
  detail: string;
};

/**
 * Separate, factual milestones so saved answers, a complete interview, a
 * signature, a recorded decision, and a sent packet are never conflated.
 */
export function decisionProgressSteps(workflow: WorkflowResponse): DecisionProgressStep[] {
  const { context, decision } = workflow;
  // Reuse the canonical workspace projection so these milestones cannot drift
  // from the assessment's own lifecycle.
  const assessment = getWorkspaceState(workflow.referral, context).assessment;
  const signed = assessment === "signed";
  const answersComplete = signed || assessment === "ready_to_sign" || Boolean(context.assessmentComplete);
  const appointmentHeld = context.assessmentScheduleStatus === "completed";
  const interviewComplete = answersComplete || appointmentHeld;
  const started = answersComplete || ["in_progress", "waiting_for_information"].includes(assessment) || Boolean(context.assessmentStarted);
  return [
    started
      ? { key: "answers", label: "Answers saved", state: "done", detail: signed ? "Locked by the signature." : "Saved answers stay editable until signing." }
      : { key: "answers", label: "Answers not started", state: "open", detail: context.assessmentId ? "The assessment is prepared but has no answers yet." : "No assessment has been opened yet." },
    interviewComplete
      ? { key: "interview", label: "Interview complete", state: "done", detail: signed ? "Completed and signed." : answersComplete ? "Answers are complete. Not signed yet." : "The appointment is marked completed. Answers may still be open." }
      : { key: "interview", label: "Interview not complete", state: "open", detail: "Unanswered items can stay open. They do not block the decision." },
    signed
      ? { key: "signed", label: "Assessment signed", state: "done", detail: "Signed in the assessment." }
      : { key: "signed", label: "Assessment not signed", state: "open", detail: "Signing happens in the assessment. Recording a decision does not sign it." },
    decision
      ? { key: "decision", label: `Decision recorded: ${decision.outcome === "accepted" ? "Accepted" : "Denied"}`, state: "done", detail: `${decision.decidedByName || "Name not recorded"} · ${formatRecordedAt(decision.decidedAt)}` }
      : { key: "decision", label: "Decision not recorded", state: "open", detail: workflow.recommendation ? "A recommendation is on file. It is not the final decision." : "No recommendation or decision yet." },
    packetProgressStep(workflow),
  ];
}

function packetProgressStep(workflow: WorkflowResponse): DecisionProgressStep {
  const { context, decision } = workflow;
  if (context.packetSentAt) return { key: "packet", label: "Meet the Client packet sent", state: "done", detail: `Sent ${formatRecordedAt(context.packetSentAt)}` };
  if (decision?.outcome === "declined") return { key: "packet", label: "Meet the Client packet not needed", state: "not_needed", detail: "The referral was denied." };
  if (decision?.outcome !== "accepted") return { key: "packet", label: "Meet the Client packet not sent", state: "open", detail: "Available after acceptance." };
  return {
    key: "packet",
    label: "Meet the Client packet not sent",
    state: "open",
    detail: context.assessmentSigned ? "Review the email and packet below, then send the draft from Outlook." : "You can preview it now. Sign the assessment before sending.",
  };
}

export function reviewStatusLabel(review: AssessmentReview | null) {
  if (!review) return "Not submitted";
  return {
    submitted: "Awaiting supervisor review",
    changes_requested: "Changes requested",
    approved_for_placement: "Approved for placement",
    not_accepted: "Not accepted",
  }[review.status];
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
