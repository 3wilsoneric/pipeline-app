import type {
  AdmissionDecision,
  AdmissionRequirement,
  AssessmentRecommendation,
  Referral,
  RequirementGate,
  RequirementStatus,
  RequirementType,
} from "./referral-types";
import type { AssessmentScheduleStatus, AssessmentWorkflowStatus } from "@/lib/assessment/assessment-records";
import type { AssessmentToolData } from "@/lib/assessment/assessment-tool-schema";
import { normalizeOwnerName } from "./referral-owner-identity";

export type WorkflowContext = {
  assessmentExists?: boolean;
  assessmentId?: string | null;
  assessmentCreatedAt?: string | null;
  assessmentComplete?: boolean;
  assessmentSigned?: boolean;
  assessmentStarted?: boolean;
  assessmentScheduleStatus?: AssessmentScheduleStatus | null;
  assessmentDate?: string | null;
  assessmentStatus?: AssessmentWorkflowStatus | null;
  assessmentData?: AssessmentToolData | null;
  decision?: AdmissionDecision | null;
  recommendation?: AssessmentRecommendation | null;
  requirements?: AdmissionRequirement[];
};

export type AdmissionDecisionInput = {
  outcome: AdmissionDecision["outcome"];
  reasonCode?: string;
  reasonNote?: string;
  overrideReason?: string;
  decidedByRole?: string;
};

export type AssessmentRecommendationInput = {
  assessmentId: string;
  outcome: AssessmentRecommendation["outcome"];
  reasonCode?: string;
  reasonNote?: string;
};

export type WorkItemPatch = {
  status?: RequirementStatus;
  dueAt?: string;
  nextStep?: string;
  blocker?: boolean;
  evidenceDocumentId?: string;
  evidenceDocumentName?: string;
  waiverReason?: string;
  fieldKey?: string;
  requestedFrom?: string;
  requestedAt?: string;
  followUpAt?: string;
  unavailableReason?: string;
};

export type WorkflowRecordSnapshot = {
  referral: Referral;
  context: WorkflowContext;
  work_items: AdmissionRequirement[];
  decision: AdmissionDecision | null;
  recommendation: AssessmentRecommendation | null;
};

type DefaultRequirement = {
  type: RequirementType;
  label: string;
  requiredFor: RequirementGate;
  nextStep: string;
  blocker: boolean;
  fieldKey?: keyof ProfileCompletionFields;
};

export type ProfileCompletionFields = {
  date_of_birth?: string;
  community?: string;
  referral_source?: string;
};

export const defaultAdmissionRequirements: readonly DefaultRequirement[] = [
  {
    type: "profile_field",
    fieldKey: "date_of_birth",
    label: "Date of birth",
    requiredFor: "profile_completion",
    nextStep: "Confirm the client's date of birth from a source document or referral contact.",
    blocker: true,
  },
  {
    type: "profile_field",
    fieldKey: "community",
    label: "Community",
    requiredFor: "profile_completion",
    nextStep: "Select the community responsible for this referral.",
    blocker: true,
  },
  {
    type: "profile_field",
    fieldKey: "referral_source",
    label: "Referral source",
    requiredFor: "profile_completion",
    nextStep: "Record the referring facility, county, or other referral source.",
    blocker: true,
  },
  {
    type: "medication_list",
    label: "Signed medication list",
    requiredFor: "admission_decision",
    nextStep: "Request and review the current signed medication list.",
    blocker: true,
  },
  {
    type: "conservatorship_document",
    label: "Letters of conservatorship",
    requiredFor: "move_in",
    nextStep: "Confirm whether conservatorship applies and attach evidence when required.",
    blocker: false,
  },
  {
    type: "signed_admission_agreement",
    label: "Signed admission agreement + LIC forms",
    requiredFor: "move_in",
    nextStep: "Send the agreement for signature and review the returned copy.",
    blocker: true,
  },
  {
    type: "lic_602",
    label: "LIC 602",
    requiredFor: "move_in",
    nextStep: "Request and review the completed LIC 602.",
    blocker: true,
  },
  {
    type: "tb_test",
    label: "TB test result",
    requiredFor: "move_in",
    nextStep: "Request a current TB result and verify its date.",
    blocker: true,
  },
  {
    type: "lic_601_603",
    label: "LIC 601 & LIC 603",
    requiredFor: "move_in",
    nextStep: "Request and review the completed LIC forms.",
    blocker: true,
  },
  {
    type: "provider_form",
    label: "Provider form",
    requiredFor: "pre_assessment",
    nextStep: "Attach the provider form when it is available.",
    blocker: false,
  },
  {
    type: "face_sheet",
    label: "Face sheet",
    requiredFor: "pre_assessment",
    nextStep: "Attach and review the face sheet.",
    blocker: true,
  },
] as const;

export function createDefaultAdmissionRequirements(
  existing: AdmissionRequirement[] = [],
  evidenceByType: Partial<Record<RequirementType, string>> = {},
  now = new Date().toISOString(),
  owner = "Unassigned",
  ownerId?: string,
  profile: ProfileCompletionFields = {},
) {
  const dueAt = new Date(new Date(now).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return defaultAdmissionRequirements.map((definition) => {
    const current = definition.fieldKey
      ? existing.find((item) => item.type === definition.type && item.fieldKey === definition.fieldKey)
      : existing.find((item) => item.type === definition.type);
    const evidenceDocumentName = evidenceByType[definition.type]?.trim() || current?.evidenceDocumentName;
    const profileComplete = definition.fieldKey ? hasProfileValue(profile[definition.fieldKey]) : false;
    const status = definition.fieldKey
      ? profileComplete
        ? "reviewed"
        : current && !["received", "reviewed"].includes(current.status)
          ? current.status
          : "needed"
      : evidenceDocumentName
        ? current && ["reviewed", "waived", "not_applicable"].includes(current.status)
          ? current.status
          : "received"
        : current?.status ?? "needed";
    const changed = Boolean(current && (
      evidenceDocumentName !== current.evidenceDocumentName
      || status !== current.status
      || current.ownerId !== ownerId
      || current.owner !== (owner.trim() || "Unassigned")
    ));

    return {
      id: current?.id && isUuid(current.id) ? current.id : globalThis.crypto.randomUUID(),
      ...definition,
      version: changed ? (current?.version ?? 1) + 1 : current?.version ?? 1,
      status,
      ownerId,
      owner: owner.trim() || "Unassigned",
      dueAt: current?.dueAt ?? dueAt,
      evidenceDocumentId: current?.evidenceDocumentId,
      evidenceDocumentName,
      waiverReason: current?.waiverReason,
      requestedFrom: current?.requestedFrom,
      requestedAt: current?.requestedAt,
      followUpAt: current?.followUpAt,
      unavailableReason: current?.unavailableReason,
      updatedAt: changed
        ? now
        : current?.updatedAt ?? now,
    } satisfies AdmissionRequirement;
  });
}

function hasProfileValue(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized && ![
    "unassigned",
    "unknown",
    "pending",
    "not reported",
    "n/a",
    "referral packet",
  ].includes(normalized));
}

export function isRequirementComplete(status: RequirementStatus) {
  return status === "received"
    || status === "reviewed"
    || status === "waived"
    || status === "not_applicable";
}

export function getBlockingRequirementsForGates(
  requirements: readonly AdmissionRequirement[],
  gates: readonly RequirementGate[],
) {
  return requirements.filter((requirement) =>
    gates.includes(requirement.requiredFor)
      && requirement.blocker
      && !isRequirementComplete(requirement.status),
  );
}

export function normalizeWorkItem(item: AdmissionRequirement): AdmissionRequirement {
  return {
    ...item,
    ownerId: item.ownerId?.trim() || undefined,
    owner: normalizeOwnerName(item.owner),
    dueAt: item.dueAt,
    nextStep: item.nextStep.trim(),
    evidenceDocumentId: item.evidenceDocumentId?.trim() || undefined,
    evidenceDocumentName: item.evidenceDocumentName?.trim() || undefined,
    waiverReason: item.waiverReason?.trim() || undefined,
    fieldKey: item.fieldKey?.trim() || undefined,
    requestedFrom: item.requestedFrom?.trim() || undefined,
    requestedAt: item.requestedAt?.trim() || undefined,
    followUpAt: item.followUpAt?.trim() || undefined,
    unavailableReason: item.unavailableReason?.trim() || undefined,
  };
}

export function validateWorkItem(item: AdmissionRequirement) {
  const validators = [
    validateWaiverReason,
    validateRequestedFrom,
    validateFollowUp,
    validateAvailabilityReason,
    validateNextStep,
    validateDueDate,
  ];
  for (const validate of validators) {
    const issue = validate(item);
    if (issue) return issue;
  }
  return null;
}

export function getEhrHandoffBlockers(
  snapshot: WorkflowRecordSnapshot,
  action: "queue" | "mark_sent" | "mark_failed" | "retry",
  failureReason: string,
) {
  const current = snapshot.referral.ehrHandoff;
  const transitionBlocker = getEhrTransitionBlocker(current?.status, action, failureReason);
  if (transitionBlocker) return [transitionBlocker];
  return isEhrQueueAction(action) ? getEhrQueueReadinessBlockers(snapshot) : [];
}

export function getAdmissionDecisionBlockers(
  snapshot: WorkflowRecordSnapshot,
  input: AdmissionDecisionInput,
) {
  if (!snapshot.context.assessmentSigned) {
    return [{ code: "assessment_required", label: "Sign the assessment before recording the admission decision." }];
  }
  if (!snapshot.recommendation && !input.overrideReason?.trim()) {
    return [{ code: "recommendation_required", label: "An assessor recommendation is required, or the supervisor must record an override reason." }];
  }
  if (input.outcome === "accepted") {
    const incomplete = getBlockingRequirementsForGates(snapshot.work_items, ["admission_decision"]);
    if (incomplete.length > 0) {
      return incomplete.map((requirement) => ({
        code: `requirement:${requirement.type}`,
        label: `${requirement.label} is still required before acceptance.`,
      }));
    }
  }
  if (input.outcome === "declined" && !input.reasonNote?.trim()) {
    return [{ code: "decline_reason_required", label: "Record why there will be no admission." }];
  }
  return [];
}

export function workflowStatusAfterWorkItem(
  snapshot: WorkflowRecordSnapshot,
  requirements: AdmissionRequirement[],
): Referral["workflowStatus"] {
  const current = snapshot.referral.workflowStatus;
  if (current && ["accepted", "declined", "closed"].includes(current)) return current;
  if (snapshot.recommendation) return "decision_pending";
  if (snapshot.context.assessmentSigned) return "assessment_signed";
  if (snapshot.context.assessmentComplete) return "assessment_ready_to_sign";
  return snapshot.context.assessmentExists
    ? activeAssessmentWorkflowStatus(snapshot.context, requirements)
    : current;
}

export function workItemChangedFields(current: AdmissionRequirement, next: AdmissionRequirement) {
  const fields: Array<keyof AdmissionRequirement> = [
    "status",
    "owner",
    "dueAt",
    "nextStep",
    "blocker",
    "evidenceDocumentId",
    "evidenceDocumentName",
    "waiverReason",
    "fieldKey",
    "requestedFrom",
    "requestedAt",
    "followUpAt",
    "unavailableReason",
  ];
  return fields.filter((field) => current[field] !== next[field]);
}

export function getWorkItemAuditAction(
  current: AdmissionRequirement,
  next: AdmissionRequirement,
  changedFields: Array<keyof AdmissionRequirement>,
) {
  const statusAction = workItemStatusAuditActions[next.status];
  if (statusAction && current.status !== next.status) return statusAction;
  if (changedFields.includes("evidenceDocumentId") || changedFields.includes("evidenceDocumentName")) return "work_item_evidence_recorded";
  if (changedFields.includes("owner")) return "work_item_reassigned";
  if (changedFields.includes("dueAt") || changedFields.includes("nextStep")) return "work_item_circle_back_updated";
  return "work_item_updated";
}

type WorkItemValidationIssue = { code: string; label: string };
type WorkItemValidator = (item: AdmissionRequirement) => WorkItemValidationIssue | null;

const validateWaiverReason: WorkItemValidator = (item) => item.status === "waived" && !item.waiverReason
  ? { code: "waiver_reason_required", label: "Record why this requirement is being waived." }
  : null;

const validateRequestedFrom: WorkItemValidator = (item) => item.status === "requested" && !item.requestedFrom
  ? { code: "requested_from_required", label: "Record who is expected to provide the missing information." }
  : null;

const validateFollowUp: WorkItemValidator = (item) => item.status === "requested" && !item.followUpAt
  ? { code: "follow_up_required", label: "Set a follow-up date for requested information." }
  : null;

const validateAvailabilityReason: WorkItemValidator = (item) => {
  if (!(["unavailable", "not_applicable"] as RequirementStatus[]).includes(item.status) || item.unavailableReason) return null;
  return {
    code: "availability_reason_required",
    label: item.status === "unavailable"
      ? "Record why this information is unavailable."
      : "Record why this requirement does not apply.",
  };
};

const validateNextStep: WorkItemValidator = (item) => item.nextStep
  ? null
  : { code: "next_action_required", label: "Every open requirement needs a next action." };

const validateDueDate: WorkItemValidator = (item) => item.dueAt
  ? null
  : { code: "due_date_required", label: "Every open requirement needs a due date." };

function getEhrTransitionBlocker(
  currentStatus: NonNullable<Referral["ehrHandoff"]>["status"] | undefined,
  action: "queue" | "mark_sent" | "mark_failed" | "retry",
  failureReason: string,
): WorkItemValidationIssue | null {
  if (action === "mark_failed" && !failureReason.trim()) {
    return { code: "ehr_failure_reason_required", label: "Record why the EHR handoff failed." };
  }
  if (["mark_sent", "mark_failed"].includes(action) && currentStatus !== "queued") {
    return { code: "ehr_handoff_not_queued", label: "Queue the EHR handoff before recording its result." };
  }
  return action === "retry" && currentStatus !== "failed"
    ? { code: "ehr_handoff_not_failed", label: "Only a failed EHR handoff can be retried." }
    : null;
}

function isEhrQueueAction(action: "queue" | "mark_sent" | "mark_failed" | "retry") {
  return action === "queue" || action === "retry";
}

function getEhrQueueReadinessBlockers(snapshot: WorkflowRecordSnapshot): WorkItemValidationIssue[] {
  if (snapshot.referral.stage !== "Accepted / Admitted" || snapshot.decision?.outcome !== "accepted") {
    return [{ code: "accepted_referral_required", label: "Accept the referral before queueing the EHR handoff." }];
  }
  const incomplete = getBlockingRequirementsForGates(
    snapshot.work_items,
    ["admission_decision", "move_in", "ehr_export"],
  );
  if (incomplete.length > 0) {
    return incomplete.map((item) => ({ code: `requirement:${item.type}`, label: `${item.label} is still required for EHR handoff.` }));
  }
  return snapshot.referral.ehrHandoff?.status === "sent"
    ? [{ code: "ehr_handoff_already_sent", label: "This EHR handoff has already been recorded as sent." }]
    : [];
}

function activeAssessmentWorkflowStatus(
  context: WorkflowContext,
  requirements: AdmissionRequirement[],
): Referral["workflowStatus"] {
  const waiting = requirements.some((requirement) =>
    requirement.blocker
      && requirement.status === "requested"
      && ["profile_completion", "pre_assessment", "admission_decision"].includes(requirement.requiredFor),
  );
  if (waiting) return "waiting_for_information";
  if (context.assessmentStarted) return "assessment_in_progress";
  return ["scheduled", "rescheduled"].includes(context.assessmentScheduleStatus ?? "")
    ? "assessment_scheduled"
    : "ready_to_schedule";
}

const workItemStatusAuditActions: Partial<Record<RequirementStatus, string>> = {
  waived: "work_item_waived",
  requested: "work_item_requested",
  unavailable: "work_item_unavailable",
  not_applicable: "work_item_not_applicable",
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
