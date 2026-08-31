export const NOTE_LAB_TAXONOMY_VERSION: "note_taxonomy_v1";

export type NoteLabTaxonomySection =
  | "referral"
  | "summary"
  | "interview"
  | "medication"
  | "pre_assessment"
  | "assessment"
  | "post_assessment";

export type NoteLabTopic =
  | "referral_context"
  | "mental_status"
  | "psychiatric_symptoms"
  | "medication"
  | "functional_status"
  | "medical_health"
  | "substance_use"
  | "risk_legal"
  | "behavior_interpersonal"
  | "social_placement"
  | "assessment_decision";

export type NoteLabComparisonType = NoteLabTopic | "multi_domain";
export type NoteLabNoteFormat = "narrative" | "bulleted" | "structured" | "mixed";
export type NoteLabWritingSignal =
  | "source_attribution"
  | "uncertainty_preserved"
  | "direct_observation"
  | "chronology"
  | "action_plan"
  | "structured_domains"
  | "quoted_language"
  | "numeric_detail"
  | "possible_problematic_wording";

export type NoteLabClassification = {
  taxonomyVersion: typeof NOTE_LAB_TAXONOMY_VERSION;
  primaryTopic: NoteLabTopic;
  topicTags: NoteLabTopic[];
  scope: "focused" | "multi_domain";
  comparisonType: NoteLabComparisonType;
  format: NoteLabNoteFormat;
  signals: NoteLabWritingSignal[];
};

export const noteLabTopicDefinitions: ReadonlyArray<{ id: NoteLabTopic; label: string }>;
export const noteLabWritingSignalDefinitions: ReadonlyArray<{ id: NoteLabWritingSignal; label: string }>;

export function normalizeNoteSection(value: unknown): NoteLabTaxonomySection | null;
export function splitLabeledNoteSections(value: unknown): Array<{ section: NoteLabTaxonomySection; text: string }>;
export function classifyNoteText(value: unknown, section?: NoteLabTaxonomySection | null): NoteLabClassification;

export type ClassifiedNoteForAnalysis = {
  section: NoteLabTaxonomySection;
  lengthBand: "brief" | "standard" | "extended";
  sourceCanvasId?: string | null;
  classification: NoteLabClassification;
};

export type NoteLabCorpusProfile = {
  schemaVersion: 1;
  taxonomyVersion: typeof NOTE_LAB_TAXONOMY_VERSION;
  sampleCount: number;
  sourceCount: number;
  pairableSampleCount: number;
  pairableGroupCount: number;
  distributions: {
    section: Record<string, number>;
    primaryTopic: Record<string, number>;
    comparisonType: Record<string, number>;
    scope: Record<string, number>;
    format: Record<string, number>;
    lengthBand: Record<string, number>;
    signal: Record<string, number>;
    topicTag: Record<string, number>;
  };
  comparisonGroups: Array<{
    section: string;
    comparisonType: string;
    lengthBand: string;
    sampleCount: number;
    sourceCount: number;
    pairable: boolean;
  }>;
};

export function analyzeClassifiedNotes(notes: readonly ClassifiedNoteForAnalysis[]): NoteLabCorpusProfile;
