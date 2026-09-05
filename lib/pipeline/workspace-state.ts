import { isDocumentRequirementType } from "./document-requirements";
import { isUnassignedOwner } from "./referral-ownership";
import type { AdmissionRequirement, Referral, RequirementStatus } from "./referral-types";
import type { WorkflowContext } from "./workflow-records";
import { hasInitialDocument, hasManualIntakeAuthorization } from "./workflow-status";

export type WorkspaceAssignmentState = "unassigned" | "assigned";
export type WorkspaceAssessmentState =
  | "not_started"
  | "unscheduled"
  | "scheduled"
  | "in_progress"
  | "waiting_for_information"
  | "ready_to_sign"
  | "signed";
export type WorkspaceOutcomeState = "pending" | "accepted" | "declined";
export type WorkspaceDocumentState = "none" | "partial" | "attention" | "complete";
export type WorkspaceProfileState = "incomplete" | "complete";
export type WorkspaceLifecycleState = "active" | "read_only" | "archived";
export type WorkspaceFocus =
  | "ready_to_schedule"
  | "scheduled"
  | "assessment"
  | "follow_up"
  | "complete";

export type WorkspaceStateProjection = {
  assignment: WorkspaceAssignmentState;
  assessment: WorkspaceAssessmentState;
  outcome: WorkspaceOutcomeState;
  documents: WorkspaceDocumentState;
  profile: WorkspaceProfileState;
  lifecycle: WorkspaceLifecycleState;
  focus: WorkspaceFocus;
  assessment_is_reassessment: boolean;
  profile_complete: number;
  profile_total: number;
  missing_profile_fields: string[];
  active_requirement_ids: string[];
  open_requirement_ids: string[];
  open_document_count: number;
};

type RequirementActivationContext = {
  assessmentComplete: boolean;
  outcome: WorkspaceOutcomeState;
};

/**
 * A requirement becomes operational only when its gate is relevant. This keeps
 * future admission paperwork out of early queues while allowing late evidence
 * to remain actionable after acceptance.
 */
export function isRequirementGateActive(
  requirement: Pick<AdmissionRequirement, "requiredFor">,
  context: RequirementActivationContext,
) {
  if (context.outcome === "declined") return false;

  if (requirement.requiredFor === "profile_completion") return true;
  if (requirement.requiredFor === "pre_assessment") {
    return context.outcome === "pending" && !context.assessmentComplete;
  }
  if (requirement.requiredFor === "admission_decision") {
    return context.outcome === "accepted"
      || (context.outcome === "pending" && context.assessmentComplete);
  }
  return context.outcome === "accepted";
}

export function isRequirementResolved(requirement: AdmissionRequirement) {
  return isRequirementStatusResolved(requirement.status);
}

export function isRequirementStatusResolved(status: RequirementStatus) {
  return ["received", "reviewed", "waived", "not_applicable"].includes(status);
}

export function getWorkspaceState(
  referral: Referral,
  context: WorkflowContext = {},
): WorkspaceStateProjection {
  const outcome = resolveOutcome(referral, context);
  const assessmentComplete = context.assessmentComplete ?? Boolean(referral.assessment?.completedAt);
  const requirements = context.requirements ?? referral.requirements ?? [];
  const activeRequirements = requirements.filter((requirement) =>
    isRequirementGateActive(requirement, { assessmentComplete, outcome }),
  );
  const openRequirements = activeRequirements.filter((requirement) => !isRequirementResolved(requirement));
  const profileCompletion = getProfileCompletion(referral);
  const assessment = resolveAssessment(referral, context, activeRequirements, assessmentComplete);
  const lifecycle = resolveLifecycle(referral);
  const documents = resolveDocuments(referral, activeRequirements, outcome);
  const profile = profileCompletion.missing.length === 0 ? "complete" : "incomplete";
  const assessmentIsReassessment = isAssessmentAfterOutcome(context);

  return {
    assignment: isUnassignedOwner(referral.owner) || !referral.ownerId?.trim()
      ? "unassigned"
      : "assigned",
    assessment,
    outcome,
    documents,
    profile,
    lifecycle,
    assessment_is_reassessment: assessmentIsReassessment,
    focus: resolveFocus({
      assessment,
      assessmentIsReassessment,
      documents,
      lifecycle,
      openRequirementCount: openRequirements.length,
      outcome,
      profile,
    }),
    profile_complete: profileCompletion.total - profileCompletion.missing.length,
    profile_total: profileCompletion.total,
    missing_profile_fields: profileCompletion.missing,
    active_requirement_ids: activeRequirements.map((requirement) => requirement.id),
    open_requirement_ids: openRequirements.map((requirement) => requirement.id),
    open_document_count: openRequirements.filter((requirement) =>
      isDocumentRequirementType(requirement.type),
    ).length,
  };
}

function resolveOutcome(referral: Referral, context: WorkflowContext): WorkspaceOutcomeState {
  const outcome = (context.decision ?? referral.admissionDecision)?.outcome;
  if (outcome === "accepted" || referral.stage === "Accepted / Admitted") return "accepted";
  if (outcome === "declined" || referral.stage === "Declined") return "declined";
  return "pending";
}

function resolveAssessment(
  referral: Referral,
  context: WorkflowContext,
  activeRequirements: AdmissionRequirement[],
  assessmentComplete: boolean,
): WorkspaceAssessmentState {
  if (context.assessmentSigned) return "signed";
  if (assessmentComplete || context.assessmentStatus === "complete") return "ready_to_sign";

  const scheduleStatus = context.assessmentScheduleStatus;
  const started = context.assessmentStarted ?? Boolean(referral.assessment?.startedAt);
  const waiting = activeRequirements.some((requirement) =>
    requirement.blocker && requirement.status === "requested",
  );
  if (started && waiting) return "waiting_for_information";
  if (started) return "in_progress";
  if (scheduleStatus === "completed") return "ready_to_sign";
  if (scheduleStatus === "scheduled" || scheduleStatus === "rescheduled") return "scheduled";

  const exists = context.assessmentExists ?? Boolean(referral.assessment);
  return exists ? "unscheduled" : "not_started";
}

function resolveDocuments(
  referral: Referral,
  activeRequirements: AdmissionRequirement[],
  outcome: WorkspaceOutcomeState,
): WorkspaceDocumentState {
  const documentRequirements = activeRequirements.filter((requirement) =>
    isDocumentRequirementType(requirement.type),
  );
  const initialEvidenceReady = hasInitialDocument(referral) || hasManualIntakeAuthorization(referral);
  const unresolved = documentRequirements.filter((requirement) => !isRequirementResolved(requirement));

  // Initial intake evidence is a pre-assessment gate. Once an outcome is
  // authoritative, only explicit active requirements can create document work.
  if (outcome !== "pending" && documentRequirements.length === 0) return "complete";
  if (!initialEvidenceReady && documentRequirements.every((requirement) => !isRequirementResolved(requirement))) {
    return "none";
  }
  if (unresolved.some((requirement) => ["expired", "unavailable"].includes(requirement.status))) {
    return "attention";
  }
  if (initialEvidenceReady && unresolved.length === 0) return "complete";
  return "partial";
}

function resolveLifecycle(referral: Referral): WorkspaceLifecycleState {
  if (referral.workspaceStatus === "archived" || referral.deletedAt) return "archived";
  if (referral.workspaceStatus === "historical") return "read_only";
  return "active";
}

function resolveFocus({
  assessment,
  assessmentIsReassessment,
  documents,
  lifecycle,
  openRequirementCount,
  outcome,
  profile,
}: {
  assessment: WorkspaceAssessmentState;
  assessmentIsReassessment: boolean;
  documents: WorkspaceDocumentState;
  lifecycle: WorkspaceLifecycleState;
  openRequirementCount: number;
  outcome: WorkspaceOutcomeState;
  profile: WorkspaceProfileState;
}): WorkspaceFocus {
  if (lifecycle !== "active") return "complete";

  // A deliberately scheduled or started reassessment is current work even
  // when a previous admission outcome remains authoritative.
  if (assessment === "scheduled") return "scheduled";
  if (assessment === "in_progress" || assessment === "waiting_for_information") return "assessment";
  if (assessmentIsReassessment) {
    if (assessment === "not_started" || assessment === "unscheduled") return "ready_to_schedule";
    if (assessment === "ready_to_sign" || assessment === "signed") return "follow_up";
  }

  if (outcome === "declined") return "complete";
  if (outcome === "accepted") {
    return openRequirementCount > 0 || documents !== "complete" || profile === "incomplete"
      ? "follow_up"
      : "complete";
  }
  if (assessment === "ready_to_sign" || assessment === "signed") return "follow_up";
  return "ready_to_schedule";
}

function isAssessmentAfterOutcome(context: WorkflowContext) {
  const assessmentCreatedAt = timestamp(context.assessmentCreatedAt);
  const decidedAt = timestamp(context.decision?.decidedAt);
  return assessmentCreatedAt !== null && decidedAt !== null && assessmentCreatedAt > decidedAt;
}

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function getProfileCompletion(referral: Referral) {
  const fields = [
    ["Client name", referral.name],
    ["Date of birth", referral.dob],
    ["Community", referral.community],
    ["Referral source", referral.source],
    ["Referral received date", referral.date],
  ] as const;
  const missing = fields
    .filter(([, value]) => !hasWorkspaceValue(value))
    .map(([label]) => label);
  return { missing, total: fields.length };
}

function hasWorkspaceValue(value: unknown) {
  if (typeof value !== "string") return value !== undefined && value !== null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && !PLACEHOLDER_VALUES.has(normalized);
}

const PLACEHOLDER_VALUES = new Set([
  "n/a",
  "not reported",
  "not scheduled",
  "pending",
  "referral packet",
  "tbd",
  "unassigned",
  "unknown",
]);
