import type { AssessmentToolFieldKey } from "./assessment-tool-schema";

export type AssessmentFieldOwner =
  | "referral_context"
  | "assessment_answer"
  | "system_provenance";

const referralContextFields = new Set<AssessmentToolFieldKey>([
  "resident_name",
  "date_of_birth",
  "community",
  "referral_received_date",
  "referrer_name",
  "county",
]);

const systemProvenanceFields = new Set<AssessmentToolFieldKey>([
  "assessment_date",
  "assessor",
  "source_file",
  "match_confidence",
  "extraction_date",
  "unable_to_assess_reasons",
]);

export function assessmentFieldOwner(field: AssessmentToolFieldKey): AssessmentFieldOwner {
  if (referralContextFields.has(field)) return "referral_context";
  if (systemProvenanceFields.has(field)) return "system_provenance";
  return "assessment_answer";
}

export function isPacketAssessmentEvidenceField(field: AssessmentToolFieldKey) {
  return assessmentFieldOwner(field) === "assessment_answer";
}

