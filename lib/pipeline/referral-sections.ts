import {
  referralSectionNames,
  type Referral,
  type ReferralSection,
  type ReferralSectionVersions,
} from "@/lib/pipeline/referral-types";

const sectionByField = {
  name: "identity",
  dob: "identity",
  gender: "identity",
  reportedAge: "identity",
  ssn: "identity",
  phone: "identity",
  email: "identity",
  payer: "identity",
  date: "intake",
  community: "intake",
  source: "intake",
  priority: "intake",
  tags: "intake",
  owner: "intake",
  note: "intake",
  admissionDate: "intake",
  responsiblePerson: "intake",
  interview: "intake",
  conserved: "intake",
  documentName: "documents",
  documentSizeBytes: "documents",
  documentHash: "documents",
  documentStatus: "documents",
  packetId: "documents",
  packetStatus: "documents",
  packetFields: "documents",
  packetReadiness: "documents",
  packetCompleteness: "documents",
  packetMessage: "documents",
  fieldSources: "documents",
  assessment: "assessment",
  assessmentDocumentName: "assessment",
  assessmentDocumentSizeBytes: "assessment",
  assessmentMessage: "assessment",
  stage: "workflow",
  requirements: "workflow",
  admissionDecision: "decision",
  ehrHandoff: "decision",
} satisfies Partial<Record<keyof Referral, ReferralSection>>;

export function defaultReferralSectionVersions(): ReferralSectionVersions {
  return {
    identity: 1,
    intake: 1,
    documents: 1,
    assessment: 1,
    workflow: 1,
    decision: 1,
  };
}

export function normalizeReferralSectionVersions(value: unknown): ReferralSectionVersions {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<Record<ReferralSection, unknown>>
    : {};
  const defaults = defaultReferralSectionVersions();

  return Object.fromEntries(referralSectionNames.map((section) => {
    const version = input[section];
    return [section, Number.isInteger(version) && Number(version) > 0 ? Number(version) : defaults[section]];
  })) as ReferralSectionVersions;
}

export function getReferralPatchSections(patch: Record<string, unknown>): ReferralSection[] {
  return [...new Set(Object.keys(patch).flatMap((key) => {
    const section = sectionByField[key as keyof typeof sectionByField];
    return section ? [section] : [];
  }))];
}

export function incrementReferralSections(
  current: ReferralSectionVersions,
  sections: ReferralSection[],
): ReferralSectionVersions {
  const next = { ...current };
  for (const section of sections) next[section] += 1;
  return next;
}

export function isReferralSection(value: string): value is ReferralSection {
  return (referralSectionNames as readonly string[]).includes(value);
}
