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

export type HistoricalProfileSourceBlock = {
  blockId: string;
  ordinal: number;
  pageNumber: number | null;
  pageTitle: string | null;
  blockType: string;
  semanticRole: string | null;
  headingPath: string[];
  text: string;
};

export type HistoricalProfileCapturedSource = HistoricalProfileSource & {
  snapshotId: string;
  blocks: HistoricalProfileSourceBlock[];
};

export type HistoricalProfileFact = {
  factId: string;
  key:
    | "name"
    | "gender"
    | "age"
    | "dob"
    | "referral_received"
    | "assessment_date"
    | "admission_date"
    | "county"
    | "referrer"
    | "responsible_person"
    | "created_by"
    | "modified_by"
    | "section"
    | "assignee"
    | "due_date"
    | "tags"
    | "collaborators";
  label: string;
  value: string;
  source: HistoricalProfileSource;
};

export type HistoricalProfileSourceSection = {
  sectionId: string;
  label: string;
  source: HistoricalProfileSource;
  blocks: HistoricalProfileSourceBlock[];
};

export type HistoricalProfileDocument = {
  documentId: string;
  name: string;
  category: string;
  contentType: string | null;
  sizeBytes: number | null;
  pageCount: number | null;
  uploadedAt: string;
  status: string;
  previewStatus: string;
  sourceSystem: string | null;
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
  facts: HistoricalProfileFact[];
  documents: HistoricalProfileDocument[];
  sections: HistoricalProfileSection[];
  unmappedEvidence: HistoricalProfileUnmappedEvidence[];
  sourceSections: HistoricalProfileSourceSection[];
  coverage: {
    sourceCount: number;
    sourceBlockCount: number;
    displayedSourceBlockCount: number;
    factCount: number;
    documentCount: number;
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
