import type { ReferralWorkflowStatus } from "@/lib/reliability/referral-operating-model";
import { isUnassignedOwner } from "./referral-ownership";
import type { Referral } from "./referral-types";
import { getBlockingRequirementsForGates, type WorkflowContext } from "./workflow-records";
import { hasInitialDocument, hasManualIntakeAuthorization } from "./workflow-status";

export type ReferralStage =
  | "New"
  | "Packet Needed"
  | "Packet Review"
  | "Assessment"
  | "Community Review"
  | "Accepted / Admitted"
  | "Declined";

export type ReferralStageDefinition = {
  stage: ReferralStage;
  status: ReferralWorkflowStatus;
  label: string;
  tone: string;
  description: string;
  terminal?: boolean;
};

export const referralStageDefinitions: readonly ReferralStageDefinition[] = [
  {
    stage: "New",
    status: "new",
    label: "Email Received",
    tone: "bg-[#f0f0ea]",
    description: "Inbound county or facility email is routed to the referral team.",
  },
  {
    stage: "Packet Needed",
    status: "packet_needed",
    label: "Referral Created",
    tone: "bg-[#fff1e3]",
    description: "Pipeline creates the referral shell and attaches ownership.",
  },
  {
    stage: "Packet Review",
    status: "packet_review",
    label: "Pre-Admission Packet",
    tone: "bg-[#f1f5ff]",
    description: "Packet upload, extraction, and required field confirmation happen here.",
  },
  {
    stage: "Assessment",
    status: "assessment",
    label: "Assessment",
    tone: "bg-[#fff6d5]",
    description: "Packet is reviewed and assessment decision is being completed.",
  },
  {
    stage: "Community Review",
    status: "community_review",
    label: "Post-Assessment",
    tone: "bg-[#f2ecff]",
    description: "Assessment decision, yes/no rationale, and community fit are reviewed.",
  },
  {
    stage: "Accepted / Admitted",
    status: "accepted",
    label: "Decision: Accepted",
    tone: "bg-[#e5faed]",
    description: "Referral is accepted and ready for EHR/export handoff.",
    terminal: true,
  },
  {
    stage: "Declined",
    status: "declined",
    label: "Decision: Declined",
    tone: "bg-[#f7e4e4]",
    description: "Referral is closed as declined and should not keep aging in active work.",
    terminal: true,
  },
] as const;

export const boardStages = referralStageDefinitions.map(({ stage }) => stage);

export function isReferralStage(value: unknown): value is ReferralStage {
  return typeof value === "string" && boardStages.includes(value as ReferralStage);
}

export const stageTone = referralStageDefinitions.reduce(
  (tones, definition) => ({
    ...tones,
    [definition.stage]: definition.tone,
  }),
  {} as Record<ReferralStage, string>,
);

export const stageToWorkflowStatus = referralStageDefinitions.reduce(
  (statuses, definition) => ({
    ...statuses,
    [definition.stage]: definition.status,
  }),
  {} as Record<ReferralStage, ReferralWorkflowStatus>,
);

export const workflowStatusToStage: Record<ReferralWorkflowStatus, ReferralStage> = {
  ...referralStageDefinitions.reduce(
    (stages, definition) => ({
      ...stages,
      [definition.status]: definition.stage,
    }),
    {} as Record<ReferralWorkflowStatus, ReferralStage>,
  ),
  admitted: "Accepted / Admitted",
};

const searchSynonyms: Record<string, readonly string[]> = {
  accepted: ["admitted", "ehr", "handoff"],
  admission: ["accepted", "admitted", "ehr"],
  assessment: ["eval", "evaluation", "clinical", "review"],
  docs: ["documents", "packet", "paperwork", "upload"],
  document: ["packet", "paperwork", "upload"],
  packet: ["docs", "documents", "paperwork", "upload"],
  review: ["assessment", "packet", "clinical"],
  stale: ["old", "aging", "untouched"],
  urgent: ["high", "priority", "stat"],
  unassigned: ["owner", "no owner", "needs owner"],
};

export function isClosedReferralStage(stage: ReferralStage) {
  return Boolean(
    referralStageDefinitions.find((definition) => definition.stage === stage)
      ?.terminal,
  );
}

export function getStageProgressPercent(stage: ReferralStage) {
  if (isClosedReferralStage(stage)) return 100;

  const activeStages = boardStages.filter((item) => !isClosedReferralStage(item));
  const index = activeStages.indexOf(stage);

  if (index < 0) return 0;

  return Math.max(18, Math.round(((index + 1) / activeStages.length) * 82));
}

export function getStageDescription(stage: ReferralStage) {
  return (
    referralStageDefinitions.find((definition) => definition.stage === stage)
      ?.description ?? "Unknown workflow stage."
  );
}

export function getStageLabel(stage: ReferralStage) {
  return (
    referralStageDefinitions.find((definition) => definition.stage === stage)
      ?.label ?? stage
  );
}

export type ReferralTransitionBlocker = {
  code: string;
  label: string;
};

export function getAllowedReferralTargets(stage: ReferralStage) {
  return boardStages.filter((target) => target !== stage);
}

export function getReferralTransitionBlockers(
  referral: Referral,
  targetStage: ReferralStage,
  context: WorkflowContext = {},
): ReferralTransitionBlocker[] {
  return getReferralTransitionAlerts(referral, targetStage, context).filter((issue) =>
    ["admission_decision_required", "decline_decision_required"].includes(issue.code),
  );
}

export function getReferralTransitionAlerts(
  referral: Referral,
  targetStage: ReferralStage,
  context: WorkflowContext = {},
): ReferralTransitionBlocker[] {
  if (targetStage === referral.stage) return [];


  if (targetStage === "Accepted / Admitted") {
    return getAdmissionTransitionAlerts(referral, context);
  }

  if (targetStage === "Declined") {
    return getDeclineTransitionAlerts(referral, context);
  }

  return getInitialTransitionAlerts(referral, targetStage, context);
}

function getInitialTransitionAlerts(
  referral: Referral,
  targetStage: ReferralStage,
  context: WorkflowContext,
): ReferralTransitionBlocker[] {
  switch (targetStage) {
    case "Packet Needed":
      return isUnassignedOwner(referral.owner)
        ? [{ code: "owner_required", label: "An owner can be assigned when ready." }] : [];
    case "Packet Review":
      return !hasInitialPacket(referral)
        ? [{ code: "initial_packet_required", label: "Add the referral packet when available." }] : [];
    case "Assessment":
      return !isPacketReviewed(referral)
        ? [{ code: "packet_review_required", label: "Packet review can be completed as information arrives." }] : [];
    case "Community Review":
      return !isAssessmentComplete(referral, context)
        ? [{ code: "assessment_required", label: "The assessment can be completed alongside community review." }] : [];
    default:
      return [];
  }
}

function getAdmissionTransitionAlerts(referral: Referral, context: WorkflowContext): ReferralTransitionBlocker[] {
  const alerts: ReferralTransitionBlocker[] = [];
  if (getDecisionOutcome(referral, context) !== "accepted") {
    alerts.push({ code: "admission_decision_required", label: "Record an admission decision of yes before acceptance." });
  }
  if (!referral.admissionDate?.trim()) {
    alerts.push({ code: "admission_date_required", label: "The admission date can be added when known." });
  }
  for (const requirement of getBlockingRequirementsForGates(
    context.requirements ?? referral.requirements ?? [],
    ["admission_decision", "move_in"],
  )) {
    alerts.push({ code: `requirement:${requirement.type}`, label: `${requirement.label} can be completed when available.` });
  }
  return alerts;
}

function getDeclineTransitionAlerts(referral: Referral, context: WorkflowContext): ReferralTransitionBlocker[] {
  if (getDecisionOutcome(referral, context) !== "declined") {
    return [{ code: "decline_decision_required", label: "Record an admission decision of no before declining." }];
  }
  if (!hasValue(context.decision?.reasonNote ?? referral.admissionDecision?.reasonNote ?? referral.assessment?.postAssessment.reason)) {
    return [{ code: "decline_reason_required", label: "Record why there will be no admission." }];
  }
  return [];
}

function hasInitialPacket(referral: Referral) {
  return hasManualIntakeAuthorization(referral)
    || hasInitialDocument(referral);
}

function isPacketReviewed(referral: Referral) {
  return hasManualIntakeAuthorization(referral)
    || referral.packetStatus === "reviewed"
    || referral.packetReadiness?.ready === true;
}

function isAssessmentComplete(referral: Referral, context: WorkflowContext) {
  if (context.assessmentComplete !== undefined) return context.assessmentComplete;
  return Boolean(
    referral.assessment?.completedAt &&
      referral.assessment.postAssessment.decision &&
      referral.assessment.postAssessment.decision !== "pending",
  );
}

function getDecisionOutcome(referral: Referral, context: WorkflowContext) {
  const decision = context.decision ?? referral.admissionDecision;
  if (decision?.outcome) return decision.outcome;
  if (referral.assessment?.postAssessment.decision === "accepted") return "accepted";
  if (referral.assessment?.postAssessment.decision === "not-accepted") return "declined";
  return null;
}

function hasValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

export function matchesSearchText(
  values: ReadonlyArray<string | number | null | undefined>,
  rawTerm: string,
) {
  const termGroups = expandSearchTermGroups(rawTerm);
  if (termGroups.length === 0) return true;

  const haystack = normalizeSearchValue(values.filter(Boolean).join(" "));

  return termGroups.every((group) => group.some((term) => haystack.includes(term)));
}

function expandSearchTermGroups(rawTerm: string) {
  return normalizeSearchValue(rawTerm)
    .split(" ")
    .filter(Boolean)
    .map((term) =>
      [term, ...(searchSynonyms[term] ?? [])]
        .map(normalizeSearchValue)
        .filter(Boolean),
    );
}

function normalizeSearchValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}
