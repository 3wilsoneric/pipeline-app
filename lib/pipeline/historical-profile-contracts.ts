import type {
  AssessmentToolFieldKey,
  AssessmentToolSection,
} from "@/lib/assessment/assessment-tool-schema";

export type HistoricalProfileMappingConfidence = "high" | "medium";

export type HistoricalProfileSource = {
  sourceCanvasId: string;
  sourceCanvasName: string;
  sourceProjectName: string | null;
  sourceLocator: string | null;
  capturedAt: string | null;
};

export type HistoricalProfileEvidence = {
  evidenceId: string;
  targetField: AssessmentToolFieldKey;
  fieldLabel: string;
  section: AssessmentToolSection;
  purpose: string;
  text: string;
  confidence: HistoricalProfileMappingConfidence;
  source: HistoricalProfileSource;
};

export type HistoricalProfileUnmappedEvidence = {
  evidenceId: string;
  text: string;
  reason: "no_confident_field_match";
  source: HistoricalProfileSource;
};

export type HistoricalProfileSection = {
  section: AssessmentToolSection;
  label: string;
  evidenceCount: number;
  fields: Array<{
    targetField: AssessmentToolFieldKey;
    label: string;
    purpose: string;
    evidence: HistoricalProfileEvidence[];
  }>;
};

export type HistoricalProfileResponse = {
  mode: "historical_profile";
  referralId: number;
  generatedAt: string;
  readOnly: true;
  assessmentCreated: false;
  sources: HistoricalProfileSource[];
  sections: HistoricalProfileSection[];
  unmappedEvidence: HistoricalProfileUnmappedEvidence[];
  coverage: {
    sourceCount: number;
    candidateCount: number;
    passageCount: number;
    mappedPassageCount: number;
    unmappedPassageCount: number;
    displayedMappedCount: number;
    displayedUnmappedCount: number;
  };
  message: string | null;
};

export type HistoricalProfileCandidateSource = HistoricalProfileSource & {
  candidateId: string;
  proposedValue: string;
};
