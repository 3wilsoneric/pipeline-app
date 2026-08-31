import { getAssessmentCompletionSummary } from "./assessment-completion";
import { assessmentInterviewSections } from "./assessment-interview-schema";
import type { PipelineAssessmentRecord } from "./assessment-records";
import {
  assessmentToolFieldDefinitions,
  type AssessmentToolData,
  type AssessmentToolFieldKey,
} from "./assessment-tool-schema";
import type { Referral } from "@/lib/pipeline/referral-types";

export type AssessmentSummaryItem = {
  label: string;
  value: string;
};

export type AssessmentSummarySection = {
  id: string;
  title: string;
  items: AssessmentSummaryItem[];
};

export type MeetClientSummary = {
  name: string;
  dateOfBirth: string;
  community: string;
  assessmentDate: string;
  bio: string[];
  medications: string[];
  medicationNotes: AssessmentSummaryItem[];
  supportSnapshot: AssessmentSummaryItem[];
  preparedFromAssessmentId: string;
  preparedFromAssessmentVersion: number;
};

export type AssessmentSummaryReport = {
  assessmentId: string;
  assessmentVersion: number;
  assessmentDate: string;
  assessor: string;
  status: string;
  signed: boolean;
  signedAt: string | null;
  signedBy: string;
  completion: ReturnType<typeof getAssessmentCompletionSummary>;
  identity: AssessmentSummaryItem[];
  sections: AssessmentSummarySection[];
  meetClient: MeetClientSummary;
};

const chartSectionLabels = new Map(assessmentInterviewSections.map((section) => [section.key, section.label]));
const excludedChartFields = new Set<AssessmentToolFieldKey>([
  "unable_to_assess_reasons",
  "source_file",
  "match_confidence",
  "assessment_notes",
  "extraction_date",
]);

export function buildAssessmentSummaryReport(
  assessment: PipelineAssessmentRecord,
  referral: Referral,
): AssessmentSummaryReport {
  const sections = assessmentInterviewSections
    .filter((section) => section.key !== "identity")
    .map((section) => ({
      id: section.key,
      title: chartSectionLabels.get(section.key) ?? section.label,
      items: buildItems(
        assessment,
        assessmentToolFieldDefinitions
          .filter((definition) => definition.section === section.key && !excludedChartFields.has(definition.key))
          .map((definition) => [definition.key, definition.label] as const),
      ),
    }))
    .filter((sectionValue) => sectionValue.items.length > 0);

  return {
    assessmentId: assessment.assessment_id,
    assessmentVersion: assessment.version,
    assessmentDate: assessment.assessment_date || "",
    assessor: assessment.assessor || assessment.updated_by.name,
    status: assessment.status,
    signed: Boolean(assessment.signed_at),
    signedAt: assessment.signed_at ?? null,
    signedBy: assessment.signed_by?.name ?? "",
    completion: getAssessmentCompletionSummary(assessment),
    identity: buildIdentity(assessment, referral),
    sections,
    meetClient: buildMeetClientSummary(assessment, referral),
  };
}

export function buildMeetClientSummary(
  assessment: PipelineAssessmentRecord,
  referral: Referral,
): MeetClientSummary {
  const medications = cleanList(assessment.medications_at_intake).length > 0
    ? cleanList(assessment.medications_at_intake)
    : splitMedicationFallback(referral.currentMedications);
  return {
    name: assessment.resident_name || referral.name,
    dateOfBirth: assessment.date_of_birth || referral.dob,
    community: assessment.community || referral.community,
    assessmentDate: assessment.assessment_date || "",
    bio: compactValues([
      sentence("Current setting", assessment.current_location),
      sentence("Community and routine", assessment.programming_notes),
      sentence("Important supports", firstValue(assessment.family_involvement, assessment.friendships_social_connections)),
      sentence("Goals", assessment.discharge_planning_goals),
      sentence("Placement preferences", firstValue(assessment.placement_preferences_concerns, assessment.preferred_facility_characteristics)),
    ]).slice(0, 4),
    medications,
    medicationNotes: buildItems(assessment, [
      ["medication_adherence", "Medication support"],
      ["lai_vs_oral", "Administration"],
      ["prn_patterns", "PRN pattern and effect"],
      ["im_injections", "IM injections"],
    ]),
    supportSnapshot: buildItems(assessment, [
      ["mobility", "Mobility"],
      ["adl_needs", "Daily living support"],
      ["language_barrier_details", "Language support"],
      ["linear_conversation_details", "Communication support"],
      ["special_diet_details", "Diet"],
      ["current_safety_measures", "Current safety support"],
      ["triggers", "Known triggers"],
      ["hallucination_coping_strategies", "Helpful coping strategies"],
    ]),
    preparedFromAssessmentId: assessment.assessment_id,
    preparedFromAssessmentVersion: assessment.version,
  };
}

function buildIdentity(assessment: PipelineAssessmentRecord, referral: Referral) {
  return compactItems([
    item("Resident number", assessment.resident_number),
    item("Name", assessment.resident_name || referral.name),
    item("Date of birth", assessment.date_of_birth || referral.dob),
    item("Community", assessment.community || referral.community),
    item("Current location", assessment.current_location),
    item("Time at current location", assessment.time_at_current_location),
    item("Date referral received", assessment.referral_received_date),
    item("Referrer", firstValue(assessment.referrer_name, referral.source)),
    item("Referrer contact", assessment.referrer_contact),
    item("Assessment date", assessment.assessment_date),
    item("Assessor", assessment.assessor),
  ]);
}

function buildItems(
  data: AssessmentToolData,
  fields: ReadonlyArray<[AssessmentToolFieldKey, string]>,
) {
  return compactItems(fields.map(([key, label]) => item(label, data[key])));
}

function item(label: string, value: AssessmentToolData[AssessmentToolFieldKey] | string | undefined) {
  const formatted = formatValue(value);
  return formatted ? { label, value: formatted } : null;
}

function formatValue(value: AssessmentToolData[AssessmentToolFieldKey] | string | undefined) {
  if (Array.isArray(value)) return cleanList(value).map(formatScalar).join("\n");
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return formatScalar(value.trim());
  return "";
}

function formatScalar(value: string) {
  if (!value) return "";
  if (/^[a-z0-9_]+$/.test(value) && (value.includes("_") || value === "yes" || value === "no")) {
    const readable = value.replaceAll("_", " ");
    return `${readable.charAt(0).toUpperCase()}${readable.slice(1)}`;
  }
  return value;
}

function cleanList(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
}

function splitMedicationFallback(value: string | undefined) {
  return (value ?? "").split(/\r?\n|;/).map((entry) => entry.trim()).filter(Boolean);
}

function compactItems(values: Array<AssessmentSummaryItem | null>) {
  return values.filter((value): value is AssessmentSummaryItem => Boolean(value));
}

function compactValues(values: Array<string | null>) {
  return values.filter((value): value is string => Boolean(value));
}

function sentence(label: string, value: string | null) {
  const clean = value?.trim();
  return clean ? `${label}: ${clean}` : null;
}

function firstValue(...values: Array<string | null | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? "";
}
