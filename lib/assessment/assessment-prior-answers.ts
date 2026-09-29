import type { AssessmentToolData, AssessmentToolFieldKey, AssessmentFieldProvenance } from "@/lib/assessment/assessment-tool-schema";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";

// Last assessment (docs/design/DECISIONS.md, "Interview context"): for a returning client, the
// interview offers answers from their most recent signed assessment. Only history-type answers
// that rarely change are offered; current symptoms, recent incidents, and dates of the latest
// event are always asked fresh. Nothing is filled in until a person chooses "Use", and the server
// re-checks that choice before recording where the answer came from.
export const priorAnswerFields: ReadonlySet<AssessmentToolFieldKey> = new Set<AssessmentToolFieldKey>([
  // Prior history
  "prior_hospitalizations_count", "prior_5150_5250_holds", "hospitalization_history", "hospitalization_timeline", "prior_placements", "prior_awol_failed_placements",
  // Diagnosis
  "primary_diagnosis", "secondary_diagnoses", "diagnosis_categories", "diagnosis_other_detail",
  // Behavioral history (not current risk or recent incidents)
  "behavioral_history", "triggers", "si_hi_history", "self_harm_history", "assault_history", "elopement_history",
  "hallucination_treatment_history",
  // Legal and conservatorship
  "conservatorship_status", "conservatorship_type", "conservator_name", "forensic_involvement", "forensic_involvement_details", "forensic_history", "forensic_timeline",
  "arrest_history", "total_arrests", "pc290_registration", "arson_history",
  // Substance use history
  "substances", "treatment_history", "substance_abuse_history", "longest_sobriety_months", "longest_sobriety_period",
  // Physical health, devices, and diet
  "physical_health_diagnoses", "diabetic", "diabetic_details", "special_diet", "special_diet_details",
  "uses_dentures", "uses_hearing_aids", "uses_glasses", "uses_oxygen", "uses_hospital_bed", "uses_cpap",
  // Social history
  "family_involvement", "housing_history", "prior_living_situation", "benefits_income_status",
]);

// Marks a suggestion chosen from the referral intake rather than an earlier assessment.
export const intakeAnswerSource = "referral-intake";

export type PriorAnswerSource = { assessment_id: string; signed_at: string; referral_id: number };
export type PriorAnswers = { source: PriorAnswerSource; answers: Partial<AssessmentToolData> } | null;
export type PriorAnswerRequest = { field: AssessmentToolFieldKey; assessment_id: string };

export function hasPriorAnswerValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function samePriorAnswerValue(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

// The answers a signed assessment can offer, limited to the history-type fields above.
export function priorAnswersFrom(assessment: PipelineAssessmentRecord): PriorAnswers {
  if (!assessment.signed_at) return null;
  const answers: Partial<AssessmentToolData> = {};
  for (const field of priorAnswerFields) {
    const value = assessment[field as keyof PipelineAssessmentRecord];
    if (hasPriorAnswerValue(value)) (answers as Record<string, unknown>)[field] = value;
  }
  return { source: { assessment_id: assessment.assessment_id, signed_at: assessment.signed_at, referral_id: assessment.referral_id }, answers };
}

// Provenance for an answer taken from an earlier signed assessment; shown as "From last assessment".
export function priorAnswerProvenance(field: AssessmentToolFieldKey, source: PriorAnswerSource): AssessmentFieldProvenance {
  return {
    source_field_key: `prior_assessment.${field}`,
    source_file: `Assessment signed ${source.signed_at.slice(0, 10)}`,
    confidence: 1,
    review_status: "accepted",
    source_page_no: null,
    evidence_url: `assessment://${source.assessment_id}`,
  };
}
