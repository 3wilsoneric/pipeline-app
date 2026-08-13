import type {
  AdmissionDecision,
  AdmissionRequirement,
  RequirementGate,
  RequirementStatus,
  RequirementType,
} from "./referral-types";

export type WorkflowContext = {
  assessmentExists?: boolean;
  assessmentComplete?: boolean;
  assessmentDate?: string | null;
  decision?: AdmissionDecision | null;
  requirements?: AdmissionRequirement[];
};

export type AdmissionDecisionInput = {
  outcome: AdmissionDecision["outcome"];
  reasonCode?: string;
  reasonNote?: string;
};

export type WorkItemPatch = {
  status?: RequirementStatus;
  owner?: string;
  dueAt?: string;
  nextStep?: string;
  blocker?: boolean;
  evidenceDocumentName?: string;
  waiverReason?: string;
};

type DefaultRequirement = {
  type: RequirementType;
  label: string;
  requiredFor: RequirementGate;
  nextStep: string;
  blocker: boolean;
};

export const defaultAdmissionRequirements: readonly DefaultRequirement[] = [
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
) {
  const dueAt = new Date(new Date(now).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return defaultAdmissionRequirements.map((definition) => {
    const current = existing.find((item) => item.type === definition.type);
    const evidenceDocumentName = evidenceByType[definition.type]?.trim() || current?.evidenceDocumentName;
    if (current && !evidenceDocumentName) return current;
    const evidenceChanged = Boolean(current && evidenceDocumentName !== current.evidenceDocumentName);

    return {
      id: current?.id && isUuid(current.id) ? current.id : globalThis.crypto.randomUUID(),
      version: evidenceChanged ? (current?.version ?? 1) + 1 : current?.version ?? 1,
      ...definition,
      status: evidenceDocumentName ? "received" : current?.status ?? "needed",
      owner: (current?.owner ?? owner.trim()) || "Unassigned",
      dueAt: current?.dueAt ?? dueAt,
      evidenceDocumentName,
      waiverReason: current?.waiverReason,
      updatedAt: evidenceChanged
        ? now
        : current?.updatedAt ?? now,
    } satisfies AdmissionRequirement;
  });
}

export function isRequirementComplete(status: RequirementStatus) {
  return status === "received" || status === "reviewed" || status === "waived";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
