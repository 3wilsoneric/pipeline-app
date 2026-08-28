import { assessmentFieldOwner } from "./assessment-field-ownership";
import {
  assessmentToolFieldForExtractionKey,
  createEmptyAssessmentToolData,
  mapExtractedAssessmentFields,
  pickAssessmentToolData,
  type AssessmentFieldProvenance,
  type AssessmentToolFieldKey,
} from "./assessment-tool-schema";
import type { AssessmentCreateInput } from "./assessment-records";
import type { Referral } from "../pipeline/referral-types";

type AssessmentSeed = Pick<
  AssessmentCreateInput,
  "data" | "field_provenance" | "unmapped_fields" | "status"
>;

const canonicalReferralFields: ReadonlyArray<{
  target: AssessmentToolFieldKey;
  source: string;
  value: (referral: Referral, assessorName: string, today: string) => string | string[] | null;
  canvasSource?: keyof NonNullable<Referral["fieldSources"]>;
}> = [
  { target: "resident_name", source: "referral.name", value: (referral) => referral.name.trim() || null, canvasSource: "name" },
  { target: "date_of_birth", source: "referral.dob", value: (referral) => isoDateOrNull(referral.dob), canvasSource: "dob" },
  { target: "community", source: "referral.community", value: (referral) => referral.community || null, canvasSource: "community" },
  { target: "assessment_date", source: "system.assessment_date", value: (_referral, _assessor, today) => today },
  { target: "assessor", source: "assignment.assessor", value: (_referral, assessor) => assessor || null },
  { target: "referral_received_date", source: "referral.received_date", value: (referral) => isoDateOrNull(referral.date), canvasSource: "referralReceived" },
  { target: "referrer_name", source: "referral.source", value: (referral) => meaningfulSource(referral.source), canvasSource: "referent" },
  { target: "county", source: "referral.county", value: (referral) => referral.county?.trim() || null, canvasSource: "county" },
  { target: "medications_at_intake", source: "referral.current_medications", value: (referral) => medicationList(referral.currentMedications), canvasSource: "currentMedications" },
];

export function buildAssessmentSeedFromReferral(
  referral: Referral,
  assessorName: string,
  now = new Date(),
): AssessmentSeed {
  const packetEvidence = (referral.packetFields ?? []).filter((field) => {
    const target = assessmentToolFieldForExtractionKey(field.field_key);
    return target ? assessmentFieldOwner(target) === "assessment_answer" : false;
  });
  const mapped = mapExtractedAssessmentFields(packetEvidence, {
    source_file: referral.documentName || undefined,
    extraction_date: referral.updatedAt ?? referral.createdAt,
  });
  const data = pickAssessmentToolData({
    ...createEmptyAssessmentToolData(),
    ...mapped.data,
  });
  const provenance = cloneProvenance(mapped.field_provenance);
  const today = now.toISOString().slice(0, 10);

  for (const definition of canonicalReferralFields) {
    const value = definition.value(referral, assessorName, today);
    if (!value) continue;
    (data as Record<AssessmentToolFieldKey, unknown>)[definition.target] = value;
    appendProvenance(provenance, definition.target, {
      source_field_key: definition.source,
      source_file: definition.canvasSource
        ? referral.fieldSources?.[definition.canvasSource] ?? null
        : null,
      confidence: 1,
      review_status: "accepted",
      source_page_no: null,
      evidence_url: null,
    });
  }

  return {
    data,
    field_provenance: provenance,
    unmapped_fields: mapped.unmapped_fields,
    status: hasPendingEvidence(provenance) ? "needs_review" : "draft",
  };
}

function meaningfulSource(value: string) {
  const source = value.trim();
  return !source || /^(referral packet|face sheet upload|unknown)$/i.test(source)
    ? null
    : source;
}

function isoDateOrNull(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    ? value
    : null;
}

function medicationList(value: string | undefined) {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const entries = parsed
          .map((entry) => typeof entry === "string" ? entry.trim() : "")
          .filter(Boolean)
          .slice(0, 100);
        return entries.length > 0 ? entries : null;
      }
    } catch {
      // Fall through to text parsing so a malformed machine value can still be reviewed.
    }
  }
  const entries = raw
    .split(/\r?\n|;/)
    .map((entry) => entry.replace(/^[\s*-]+/, "").trim())
    .filter(Boolean)
    .slice(0, 100);
  return entries.length > 0 ? entries : null;
}

function cloneProvenance(
  value: Partial<Record<AssessmentToolFieldKey, AssessmentFieldProvenance[]>>,
) {
  return Object.fromEntries(
    Object.entries(value).map(([field, entries]) => [field, entries?.map((entry) => ({ ...entry })) ?? []]),
  ) as Partial<Record<AssessmentToolFieldKey, AssessmentFieldProvenance[]>>;
}

function appendProvenance(
  provenance: Partial<Record<AssessmentToolFieldKey, AssessmentFieldProvenance[]>>,
  field: AssessmentToolFieldKey,
  entry: AssessmentFieldProvenance,
) {
  provenance[field] = [...(provenance[field] ?? []), entry];
}

function hasPendingEvidence(
  provenance: Partial<Record<AssessmentToolFieldKey, AssessmentFieldProvenance[]>>,
) {
  return Object.values(provenance).some((entries) => entries?.at(-1)?.review_status === "pending");
}
