import { getPlannedAdmissionDate } from "@/lib/pipeline/admission-lifecycle";
import { getAssessmentCompletionSummary } from "./assessment-completion";
import { assessmentInterviewOptionLabel, assessmentInterviewSections } from "./assessment-interview-schema";
import type { PipelineAssessmentRecord } from "./assessment-records";
import {
  assessmentToolFieldDefinitions,
  type AssessmentToolData,
  type AssessmentToolFieldKey,
} from "./assessment-tool-schema";
import type { AdmissionRequirement, Referral } from "@/lib/pipeline/referral-types";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";

type AssessmentReferralContext = Pick<Referral, "name" | "dob" | "community" | "source" | "currentMedications" | "admissionDate" | "plannedAdmissionDate">
  & Partial<Pick<Referral, "county" | "conserved" | "payer" | "responsiblePerson" | "requirements">>;

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
  admissionDate: string;
  bio: string[];
  medications: string[];
  medicationNotes: AssessmentSummaryItem[];
  supportSnapshot: AssessmentSummaryItem[];
  admissionNotes?: AssessmentSummaryItem[];
  billingNotes?: AssessmentSummaryItem[];
  dietaryNotes?: AssessmentSummaryItem[];
  safetyNotes?: AssessmentSummaryItem[];
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

export function selectSignedAssessment(
  assessments: PipelineAssessmentRecord[],
  assessmentId?: string,
) {
  // Acceptance records the information available then; signing can happen later.
  // Sending records the actual signed version in its own delivery audit.
  const assessment = assessmentId
    ? assessments.find((item) => item.assessment_id === assessmentId)
    : assessments.find((item) => item.signed_at);
  return assessment?.signed_at ? assessment : null;
}

const excludedChartFields = new Set<AssessmentToolFieldKey>([
  "triggers",
  "aggression_risk",
  "unable_to_assess_reasons",
  "source_file",
  "match_confidence",
  "assessment_notes",
  "extraction_date",
  "admit_date",
  "acuity_level",
  "lai_vs_oral",
  "resident_number",
  "responds_to_internal_stimuli",
  "auditory_hallucinations",
  "auditory_hallucination_nature",
  "auditory_hallucination_frequency",
  "auditory_hallucination_triggers",
  "visual_hallucinations",
  "visual_hallucination_details",
  "visual_hallucination_recent",
  "olfactory_hallucinations",
  "olfactory_hallucination_details",
  "olfactory_hallucination_impact",
  "tactile_hallucinations",
  "tactile_hallucination_details",
  "tactile_hallucination_frequency",
  "gustatory_hallucinations",
  "gustatory_hallucination_details",
  "hallucination_coping_strategies",
  "hallucination_distress_impairment",
  "hallucination_functional_impact",
  "hallucination_treatment_history",
]);

export function buildAssessmentSummaryReport(
  assessment: PipelineAssessmentRecord,
  referral: AssessmentReferralContext,
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
  referral: AssessmentReferralContext,
): MeetClientSummary {
  const medications = cleanList(assessment.medications_at_intake).length > 0
    ? cleanList(assessment.medications_at_intake)
    : splitMedicationFallback(referral.currentMedications);
  return {
    name: assessmentClientName(assessment, referral),
    dateOfBirth: assessment.date_of_birth || referral.dob,
    community: assessment.community || referral.community,
    assessmentDate: assessment.assessment_date || "",
    admissionDate: getPlannedAdmissionDate(referral),
    admissionNotes: compactItems([
      buildAdmissionAgreementSummary(referral.requirements),
      item("Referring county", assessment.county || referral.county),
      item("Arriving from", assessment.current_location),
      item("Conserved status", assessment.conservatorship_type || referral.conserved, "conservatorship_type"),
      item("Legal / signing details", assessment.conservatorship_status),
      item("Conservator", assessment.conservator_name),
      item("Referrer contact", assessment.referrer_contact),
    ]),
    billingNotes: [
      { label: "Coverage / payer", value: referral.payer?.trim() || "Not recorded" },
      { label: "SSI / representative payee", value: "Not recorded in the structured chart. Confirm with the referring team." },
    ],
    dietaryNotes: buildDietaryHandoff(assessment),
    bio: compactValues([
      sentence("Current setting", assessment.current_location),
      sentence("Community and routine", assessment.programming_notes),
      sentence("Important supports", firstValue(assessment.family_involvement, assessment.friendships_social_connections)),
      sentence("Goals", assessment.discharge_planning_goals),
      sentence("Placement preferences", firstValue(assessment.placement_preferences_concerns, assessment.preferred_facility_characteristics)),
    ]).slice(0, 4),
    medications,
    medicationNotes: buildMedicationHandoff(assessment),
    safetyNotes: buildSafetyHandoff(assessment),
    supportSnapshot: buildItems(assessment, [
      ["mobility", "Mobility"],
      ["adl_needs", "Daily living support"],
      ["language_barrier_details", "Language support"],
      ["linear_conversation_details", "Communication support"],
      ["special_diet_details", "Diet"],
    ]),
    preparedFromAssessmentId: assessment.assessment_id,
    preparedFromAssessmentVersion: assessment.version,
  };
}

export function buildAdmissionAgreementSummary(requirements?: readonly AdmissionRequirement[]): AssessmentSummaryItem {
  const agreement = requirements?.find((requirement) => requirement.type === "signed_admission_agreement");
  const statuses: Record<AdmissionRequirement["status"], string> = {
    needed: "Still needed; obtain and review the signed copy.",
    requested: "Requested; awaiting the signed copy.",
    received: "Received; signatures still need review.",
    reviewed: "Marked reviewed in the chart.",
    waived: "Requirement waived; this does not confirm a signed copy.",
    expired: "Recorded copy expired; an updated signed copy is needed.",
    unavailable: "Signed copy unavailable; follow up with the referring team.",
    not_applicable: "Marked not applicable; this does not confirm a signed copy.",
  };
  let value = agreement ? statuses[agreement.status] : "Not recorded; confirm whether a signed copy is available.";
  // A signed assessment or an uploaded filename does not establish agreement signatures.
  if (agreement?.status === "reviewed" && !agreement.evidenceDocumentId && !agreement.evidenceDocumentName?.trim()) {
    value += " No supporting document is linked; confirm the signed copy.";
  }
  if (agreement?.evidenceDocumentName?.trim()) value += ` Recorded evidence: ${agreement.evidenceDocumentName.trim()}.`;
  if (agreement?.status === "waived" && agreement.waiverReason?.trim()) value += ` Reason: ${agreement.waiverReason.trim()}`;
  if (agreement?.status === "unavailable" && agreement.unavailableReason?.trim()) value += ` Reason: ${agreement.unavailableReason.trim()}`;
  return { label: "Signed admission agreement", value };
}

function buildDietaryHandoff(assessment: PipelineAssessmentRecord): AssessmentSummaryItem[] {
  return [
    { label: "Allergies", value: "Not recorded in the structured chart. Review source documents and confirm." },
    { label: "Diet", value: assessment.special_diet_details?.trim() || (assessment.special_diet === "no" ? "No special diet reported" : "Confirm dietary requirements") },
  ];
}

function buildMedicationHandoff(assessment: PipelineAssessmentRecord): AssessmentSummaryItem[] {
  const injectionFields = [
    ["im_injections_details", "Injection medication / dose"],
    ["injection_frequency", "Injection frequency"],
    ["last_injection", "Last injection given"],
    ["next_injection_due", "Next injection due"],
  ] as const;
  const includeInjectionDetails = assessment.im_injections !== "no"
    && (assessment.im_injections === "yes" || injectionFields.some(([key]) => assessment[key]?.trim()));
  return [
    ...buildItems(assessment, [["medication_adherence", "Medication support"], ["prn_patterns", "PRN pattern and effect"]]),
    { label: "IM injections", value: formatValue(assessment.im_injections, "im_injections") || "Not recorded; confirm with the referring team." },
    ...(includeInjectionDetails ? injectionFields.map(([key, label]) => ({ label, value: assessment[key]?.trim() || "Not recorded; confirm with the referring team." })) : []),
  ];
}

function buildSafetyHandoff(assessment: PipelineAssessmentRecord): AssessmentSummaryItem[] {
  return compactItems([
    item("Current behavior / recent events", assessment.behavioral_history),
    { label: "Physical altercations reported", value: formatValue(assessment.physical_altercations, "physical_altercations") || "Not recorded; confirm with the referring team." },
    assessment.physical_altercations !== "no" ? item("Altercation context and outcome", assessment.physical_altercation_details) : null,
    { label: "Assault history reported", value: formatValue(assessment.assault_history, "assault_history") || "Not recorded; confirm with the referring team." },
    assessment.assault_history !== "no" ? item("Last reported assault / context", assessment.last_assault_details) : null,
    assessment.assault_history !== "no" ? item("Reported assaults in the last two years", assessment.assaults_last_two_years_count) : null,
    item("Self-harm history reported", assessment.self_harm_history, "self_harm_history"),
    assessment.self_harm_history !== "no" ? item("Last reported self-harm incident", assessment.last_self_harm_incident) : null,
    item("Current self-harm thoughts reported", assessment.current_self_harm_ideation, "current_self_harm_ideation"),
    assessment.current_self_harm_ideation !== "no" ? item("Current self-harm concerns", assessment.current_self_harm_details) : null,
    item("Elopement history reported", assessment.elopement_history, "elopement_history"),
    assessment.elopement_history !== "no" ? item("Elopement context / support needs", assessment.elopement_risk) : null,
    item("Current safety supports", assessment.current_safety_measures),
  ]);
}

function buildIdentity(assessment: PipelineAssessmentRecord, referral: AssessmentReferralContext) {
  return compactItems([
    item("Name", assessmentClientName(assessment, referral)),
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

function assessmentClientName(assessment: PipelineAssessmentRecord, referral: AssessmentReferralContext) {
  return formatClientIdentityTitle({
    name: assessment.resident_name || referral.name,
    community: assessment.community || referral.community,
  });
}

function buildItems(
  data: AssessmentToolData,
  fields: ReadonlyArray<[AssessmentToolFieldKey, string]>,
) {
  return compactItems(fields.map(([key, label]) => item(label, data[key], key)));
}

function item(
  label: string,
  value: AssessmentToolData[AssessmentToolFieldKey] | string | undefined,
  field?: AssessmentToolFieldKey,
) {
  const formatted = formatValue(value, field);
  return formatted ? { label, value: formatted } : null;
}

function formatValue(value: AssessmentToolData[AssessmentToolFieldKey] | string | undefined, field?: AssessmentToolFieldKey) {
  if (Array.isArray(value)) {
    return cleanList(value)
      .map((entry) => field ? assessmentInterviewOptionLabel(field, entry) ?? formatScalar(entry) : formatScalar(entry))
      .join("\n");
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const normalized = value.trim();
    return field ? assessmentInterviewOptionLabel(field, normalized) ?? formatScalar(normalized) : formatScalar(normalized);
  }
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
