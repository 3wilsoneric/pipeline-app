import type {
  AdmissionDecision,
  AdmissionRequirement,
  AssessmentRecommendation,
  RequirementGate,
  RequirementStatus,
  RequirementType,
} from "./referral-types";
import type { AssessmentScheduleStatus, AssessmentWorkflowStatus } from "@/lib/assessment/assessment-records";
import type { AssessmentToolData } from "@/lib/assessment/assessment-tool-schema";

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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
