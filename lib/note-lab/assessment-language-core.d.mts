import type { AssessmentToolFieldKey } from "../assessment/assessment-tool-schema";

export const ASSESSMENT_LANGUAGE_TAXONOMY_VERSION: "assessment_language_v4";

export function splitAssessmentNarrativePassages(value: unknown): string[];

export function classifyAssessmentNarrativeField(value: unknown): {
  targetField: AssessmentToolFieldKey;
  confidence: "high" | "medium";
  score: number;
} | null;
