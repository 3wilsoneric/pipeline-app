import { pipelineCommunities, type PipelineCommunity } from "@/lib/pipeline/community-config";
import type { ExtractedField } from "@/lib/extraction/contracts";
import type { ReferralCanvasFieldKey } from "@/lib/pipeline/referral-types";

export type ReferralCanvasPacketField = {
  label: string;
  value: string;
  placeholder?: string;
  sourceFile?: string;
};

export type ReferralCanvasDirtyKey = ReferralCanvasFieldKey | "conserved" | "tags" | "documents" | "initialPacket";

type ExtractedCanvasValue = {
  value: string;
  field: ExtractedField;
};

type CanvasFieldUpdate = {
  value: string;
  field?: ExtractedField;
  confirmed?: boolean;
};

const canvasFieldMappings: Record<string, ReferralCanvasFieldKey[]> = {
  "referral.first_name": ["name"],
  "demographics.first_name": ["name"],
  "referral.last_name": ["name"],
  "demographics.last_name": ["name"],
  "referral.full_name": ["name"],
  "demographics.full_name": ["name"],
  "referral.date_of_birth": ["dob"],
  "demographics.date_of_birth": ["dob"],
  "referral.age": ["age"],
  "demographics.age": ["age"],
  "referral.gender": ["gender"],
  "demographics.gender": ["gender"],
  "referral.preferred_admission_date": ["admissionDate"],
  "referral.source": ["referent"],
  "referral.referring_provider": ["referent"],
  "referral.referring_facility": ["referent"],
  "referral.emergency_contact": ["responsiblePerson"],
  "assessment.guardian_contact": ["responsiblePerson"],
  "referral.packet_summary": ["summary"],
  "assessment.presenting_needs": ["interview"],
  "referral.notes": ["interview"],
  "assessment.community_preference": ["county"],
};

export function extractedCanvasFieldKeys(fieldKey: string): ReferralCanvasFieldKey[] {
  return canvasFieldMappings[fieldKey] ?? [];
}

export function populateFormFromExtraction(
  current: Record<ReferralCanvasFieldKey, ReferralCanvasPacketField>,
  extractedFields: ExtractedField[],
  sourceFile: string,
  dirty: ReadonlySet<ReferralCanvasDirtyKey> = new Set(),
  manualOverrideKeys: ReadonlySet<ReferralCanvasFieldKey> = new Set(),
) {
  const extractedByKey = new Map(
    extractedFields
      .filter((field) => field.review_status !== "rejected")
      .map((field) => [field.field_key, field] as const),
  );
  const updates = buildCanvasFieldUpdates(extractedByKey);
  return applyCanvasFieldUpdates(current, updates, sourceFile, dirty, manualOverrideKeys);
}

function buildCanvasFieldUpdates(extractedByKey: Map<string, ExtractedField>) {
  const firstName = extractedValue(extractedByKey, ["referral.first_name", "demographics.first_name"]);
  const lastName = extractedValue(extractedByKey, ["referral.last_name", "demographics.last_name"]);
  const directName = extractedValue(extractedByKey, ["referral.full_name", "demographics.full_name"]);
  const compositeName = firstName?.value && lastName?.value ? `${firstName.value} ${lastName.value}` : "";
  const fullName = directName?.value || compositeName;
  const nameSource = directName?.field ?? firstName?.field ?? lastName?.field;
  const updates: Partial<Record<ReferralCanvasFieldKey, CanvasFieldUpdate>> = {
    ...(fullName ? { name: buildNameUpdate(fullName, nameSource, directName, firstName, lastName) } : {}),
    dob: extractedValue(extractedByKey, ["referral.date_of_birth", "demographics.date_of_birth"]),
    age: extractedValue(extractedByKey, ["referral.age", "demographics.age"]),
    gender: extractedValue(extractedByKey, ["referral.gender", "demographics.gender"]),
    admissionDate: extractedValue(extractedByKey, ["referral.preferred_admission_date"]),
    referent: extractedValue(extractedByKey, [
      "referral.source",
      "referral.referring_provider",
      "referral.referring_facility",
    ]),
    responsiblePerson: extractedValue(extractedByKey, [
      "referral.emergency_contact",
      "assessment.guardian_contact",
    ]),
    summary: extractedValue(extractedByKey, ["referral.packet_summary"]),
    interview: extractedValue(extractedByKey, ["assessment.presenting_needs", "referral.notes"]),
  };
  const community = extractedValue(extractedByKey, ["assessment.community_preference"]);
  if (community && pipelineCommunities.includes(community.value as PipelineCommunity)) updates.county = community;
  return updates;
}

function buildNameUpdate(
  fullName: string,
  nameSource: ExtractedField | undefined,
  directName: ExtractedCanvasValue | undefined,
  firstName: ExtractedCanvasValue | undefined,
  lastName: ExtractedCanvasValue | undefined,
): CanvasFieldUpdate {
  const compositeConfirmed = Boolean(
    firstName?.field
    && lastName?.field
    && [firstName.field.review_status, lastName.field.review_status]
      .every((status) => status === "accepted" || status === "edited"),
  );
  return {
    value: fullName,
    ...(nameSource ? { field: nameSource } : {}),
    ...(directName ? {} : { confirmed: compositeConfirmed }),
  };
}

function applyCanvasFieldUpdates(
  current: Record<ReferralCanvasFieldKey, ReferralCanvasPacketField>,
  updates: Partial<Record<ReferralCanvasFieldKey, CanvasFieldUpdate>>,
  sourceFile: string,
  dirty: ReadonlySet<ReferralCanvasDirtyKey>,
  manualOverrideKeys: ReadonlySet<ReferralCanvasFieldKey>,
) {
  let changed = false;
  const next = { ...current };
  for (const [key, update] of Object.entries(updates) as Array<[ReferralCanvasFieldKey, CanvasFieldUpdate | undefined]>) {
    if (!shouldApplyUpdate(current[key], key, update, sourceFile, dirty, manualOverrideKeys)) continue;
    next[key] = { ...current[key], value: update!.value, sourceFile };
    changed = true;
  }
  return changed ? next : current;
}

function shouldApplyUpdate(
  current: ReferralCanvasPacketField,
  key: ReferralCanvasFieldKey,
  update: CanvasFieldUpdate | undefined,
  sourceFile: string,
  dirty: ReadonlySet<ReferralCanvasDirtyKey>,
  manualOverrideKeys: ReadonlySet<ReferralCanvasFieldKey>,
) {
  if (!update?.value || dirty.has(key)) return false;
  const humanConfirmed = update.confirmed
    ?? (update.field?.review_status === "accepted" || update.field?.review_status === "edited");
  const differsFromManualValue = Boolean(current.value.trim() && !current.sourceFile && current.value !== update.value);
  if (differsFromManualValue && !manualOverrideKeys.has(key)) return false;
  if (!humanConfirmed && current.value.trim()) return false;
  return current.value !== update.value || current.sourceFile !== sourceFile;
}

function extractedValue(
  fields: Map<string, ExtractedField>,
  fieldKeys: string[],
): ExtractedCanvasValue | undefined {
  for (const fieldKey of fieldKeys) {
    const field = fields.get(fieldKey);
    const value = (field?.final_value ?? field?.proposed_value ?? "").trim();
    if (field && value) return { value, field };
  }
  return undefined;
}
