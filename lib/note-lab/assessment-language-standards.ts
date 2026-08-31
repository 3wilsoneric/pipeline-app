import type { AssessmentNarrativePurpose } from "@/lib/assessment/assessment-narrative-guide";

export const noteLabDocumentationCriteria = [
  {
    id: "direct_answer",
    label: "Answers the field",
    description: "States the relevant finding first instead of burying it in a broad narrative.",
  },
  {
    id: "source_provenance",
    label: "Names the source",
    description: "Separates client report, collateral, supplied records, and direct observation.",
  },
  {
    id: "timeframe_recency",
    label: "Bounds the timeframe",
    description: "Distinguishes current status from history and gives recency, frequency, or duration when relevant.",
  },
  {
    id: "observable_specificity",
    label: "Uses specific facts",
    description: "Uses reported or observable details instead of labels, conclusions, or character judgments.",
  },
  {
    id: "functional_safety_impact",
    label: "Explains the impact",
    description: "Connects the finding to function, safety, care needs, or placement when the connection matters.",
  },
  {
    id: "response_support_action",
    label: "Records response or action",
    description: "Identifies what helps, what happened after intervention, or who must close an information gap.",
  },
  {
    id: "uncertainty_conflict",
    label: "Preserves uncertainty",
    description: "Makes unknown, unverified, conflicting, alleged, or incomplete information visible.",
  },
  {
    id: "person_centered_language",
    label: "Uses person-centered language",
    description: "Represents the client perspective without defining the person by a diagnosis, behavior, or substance use.",
  },
  {
    id: "concise_nonduplicative",
    label: "Stays concise and current",
    description: "Includes only decision-relevant information and avoids copied, stale, or duplicated narrative.",
  },
] as const;

export type NoteLabCriterionId = typeof noteLabDocumentationCriteria[number]["id"];

export const noteLabRevisionReasons = [
  { id: "does_not_answer_field", label: "Does not answer this field" },
  { id: "missing_or_unclear_source", label: "Source is missing or unclear" },
  { id: "missing_or_unclear_timeframe", label: "Timeframe is missing or unclear" },
  { id: "vague_label_or_judgment", label: "Uses a vague label or judgment" },
  { id: "unsupported_inference", label: "States an inference as fact" },
  { id: "missing_impact", label: "Does not explain relevant impact" },
  { id: "missing_response_or_action", label: "Does not record response, support, or next action" },
  { id: "uncertainty_or_conflict_lost", label: "Hides uncertainty or conflicting information" },
  { id: "stigmatizing_or_identity_first", label: "Language is not person-centered" },
  { id: "duplicated_stale_or_irrelevant", label: "Contains duplicated, stale, or irrelevant text" },
] as const;

export type NoteLabRevisionReasonId = typeof noteLabRevisionReasons[number]["id"];

const alwaysRecommended: NoteLabCriterionId[] = [
  "direct_answer",
  "source_provenance",
  "person_centered_language",
  "concise_nonduplicative",
];

const purposeCriteria: Record<AssessmentNarrativePurpose, readonly NoteLabCriterionId[]> = {
  behavior_pattern: ["timeframe_recency", "observable_specificity", "functional_safety_impact", "response_support_action", "uncertainty_conflict"],
  benefits_status: ["timeframe_recency", "observable_specificity", "response_support_action", "uncertainty_conflict"],
  clinical_presentation: ["timeframe_recency", "observable_specificity", "functional_safety_impact", "uncertainty_conflict"],
  communication_support: ["observable_specificity", "functional_safety_impact", "response_support_action", "uncertainty_conflict"],
  crisis_history: ["timeframe_recency", "observable_specificity", "functional_safety_impact", "response_support_action", "uncertainty_conflict"],
  daily_support: ["timeframe_recency", "observable_specificity", "functional_safety_impact", "response_support_action"],
  diagnostic_record: ["timeframe_recency", "observable_specificity", "uncertainty_conflict"],
  health_support: ["timeframe_recency", "observable_specificity", "functional_safety_impact", "response_support_action", "uncertainty_conflict"],
  legal_status: ["timeframe_recency", "observable_specificity", "response_support_action", "uncertainty_conflict"],
  medication_reconciliation: ["timeframe_recency", "observable_specificity", "functional_safety_impact", "response_support_action", "uncertainty_conflict"],
  perceptual_experience: ["timeframe_recency", "observable_specificity", "functional_safety_impact", "uncertainty_conflict"],
  perceptual_response: ["timeframe_recency", "observable_specificity", "functional_safety_impact", "response_support_action", "uncertainty_conflict"],
  placement_preferences: ["observable_specificity", "functional_safety_impact", "response_support_action", "uncertainty_conflict"],
  placement_trajectory: ["timeframe_recency", "observable_specificity", "functional_safety_impact", "response_support_action", "uncertainty_conflict"],
  safety_history: ["timeframe_recency", "observable_specificity", "functional_safety_impact", "response_support_action", "uncertainty_conflict"],
  social_support: ["timeframe_recency", "observable_specificity", "functional_safety_impact", "response_support_action", "uncertainty_conflict"],
  substance_pattern: ["timeframe_recency", "observable_specificity", "functional_safety_impact", "response_support_action", "uncertainty_conflict"],
  supplemental_context: ["observable_specificity", "functional_safety_impact", "response_support_action", "uncertainty_conflict"],
  treatment_participation: ["timeframe_recency", "observable_specificity", "functional_safety_impact", "response_support_action", "uncertainty_conflict"],
};

export function recommendedCriteriaForPurpose(purpose: AssessmentNarrativePurpose) {
  return [...new Set([...alwaysRecommended, ...purposeCriteria[purpose]])];
}
