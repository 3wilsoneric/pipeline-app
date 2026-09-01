import type { AssessmentNarrativePurpose } from "@/lib/assessment/assessment-narrative-guide";
import type { AssessmentToolFieldKey } from "@/lib/assessment/assessment-tool-schema";
import {
  noteLabDocumentationCriteria,
  noteLabRevisionReasons,
  type NoteLabCriterionId,
  type NoteLabRevisionReasonId,
} from "./assessment-language-standards";

export const NOTE_LAB_CALIBRATION_TARGET = 15;
export const NOTE_LAB_CALIBRATION_VERSION = "note_lab_field_standard_v3";

export type NoteLabSection =
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
  taxonomyVersion: "note_taxonomy_v1";
  primaryTopic: NoteLabTopic;
  topicTags: NoteLabTopic[];
  scope: "focused" | "multi_domain";
  comparisonType: NoteLabTopic | "multi_domain";
  format: "narrative" | "bulleted" | "structured" | "mixed";
  signals: NoteLabWritingSignal[];
};

export type NoteLabSample = {
  id: string;
  sourceSection: NoteLabSection;
  targetField: AssessmentToolFieldKey;
  targetFieldLabel: string;
  fieldPurpose: string;
  purposeTrack: AssessmentNarrativePurpose;
  text: string;
  wordCount: number;
  lengthBand: "brief" | "standard" | "extended";
  mappingConfidence: "high" | "medium";
  classification: NoteLabClassification;
};

export type NoteLabReviewSample = Pick<
  NoteLabSample,
  "id" | "sourceSection" | "text" | "wordCount" | "lengthBand" | "mappingConfidence"
>;

export type NoteLabScenario = {
  id: string;
  targetField: AssessmentToolFieldKey;
  targetFieldLabel: string;
  fieldPurpose: string;
  purposeTrack: AssessmentNarrativePurpose;
  reviewQuestion: string;
  guardrail: string;
  recommendedCriterionIds: NoteLabCriterionId[];
  formatStandard: {
    label: string;
    lengthGuidance: string;
    template: string;
    requiredElements: string[];
    referenceAnswer: string;
  };
  reviewSample: NoteLabReviewSample | null;
  sampleSetVersion: string;
};

export type NoteLabSampleDisposition = "teach" | "revise" | "do_not_teach";

export type NoteLabFieldReview = {
  scenarioId: string;
  targetField: AssessmentToolFieldKey;
  selectedCriterionIds: NoteLabCriterionId[];
  sampleId: string | null;
  sampleDisposition: NoteLabSampleDisposition | null;
  revisionReasonIds: NoteLabRevisionReasonId[];
  submittedAt: string;
};

export type NoteLabProgress = {
  schemaVersion: 3;
  calibrationVersion: string;
  reviews: NoteLabFieldReview[];
};

export type NoteLabCalibrationTrailItem = {
  step: number;
  targetFieldLabel: string;
  purposeTrack: AssessmentNarrativePurpose;
  selectedCriterionIds: NoteLabCriterionId[];
  sampleDisposition: NoteLabSampleDisposition | null;
};

export type NoteLabFieldStep = {
  field: AssessmentToolFieldKey;
  label: string;
};

export type NoteLabPreferenceProfile = {
  schemaVersion: 3;
  calibrationVersion: string;
  status: "collecting" | "ready";
  targetDecisions: number;
  decisionsCompleted: number;
  fieldsReviewed: number;
  purposeTracksReviewed: number;
  criteria: Array<{
    id: NoteLabCriterionId;
    label: string;
    selectedCount: number;
    selectionRate: number;
  }>;
  sampleOutcomes: Record<NoteLabSampleDisposition, number>;
  revisionReasons: Array<{
    id: NoteLabRevisionReasonId;
    label: string;
    selectedCount: number;
  }>;
  fieldStandards: Array<{
    field: AssessmentToolFieldKey;
    label: string;
    selectedCriterionIds: NoteLabCriterionId[];
    sampleDisposition: NoteLabSampleDisposition | null;
    revisionReasonIds: NoteLabRevisionReasonId[];
  }>;
  inferredRules: string[];
};

export type NoteLabCalibration = {
  targetDecisions: number;
  decisionsCompleted: number;
  currentStep: number;
  remaining: number;
  progressPercent: number;
  complete: boolean;
  estimatedMinutesRemaining: number;
  fieldSteps: NoteLabFieldStep[];
  trail: NoteLabCalibrationTrailItem[];
  profile: NoteLabPreferenceProfile;
};

export type NoteLabSession = {
  enabled: boolean;
  available: boolean;
  message: string | null;
  calibrationVersion: string;
  revision: number;
  persistence: "postgres" | "local_file" | "unavailable";
  scenario: NoteLabScenario | null;
  calibration: NoteLabCalibration;
  stats: {
    decisionsCompleted: number;
    fieldsAvailable: number;
    criteriaAvailable: number;
    corpusSamplesAvailable: number;
  };
};

export type NoteLabReviewInput = {
  expectedRevision: number;
  calibrationVersion: string;
  scenarioId: string;
  targetField: AssessmentToolFieldKey;
  selectedCriterionIds: NoteLabCriterionId[];
  sampleId: string | null;
  sampleDisposition: NoteLabSampleDisposition | null;
  revisionReasonIds: NoteLabRevisionReasonId[];
};

const criterionSet = new Set<string>(noteLabDocumentationCriteria.map((criterion) => criterion.id));
const revisionReasonSet = new Set<string>(noteLabRevisionReasons.map((reason) => reason.id));
const dispositionSet = new Set<string>(["teach", "revise", "do_not_teach"]);

export function validateNoteLabReviewInput(value: unknown):
  | { ok: true; value: NoteLabReviewInput }
  | { ok: false; error: string } {
  if (!isRecord(value)) return invalid("Review payload must be an object.");
  const identity = validateReviewIdentity(value);
  if (!identity.ok) return identity;
  const criteria = validateReviewCriteria(value);
  if (!criteria.ok) return criteria;
  const sample = validateSampleReview(value);
  if (!sample.ok) return sample;
  return {
    ok: true,
    value: {
      ...identity.value,
      selectedCriterionIds: criteria.value,
      ...sample.value,
    },
  };
}

function validateReviewIdentity(value: Record<string, unknown>) {
  if (!Number.isInteger(value.expectedRevision) || Number(value.expectedRevision) < 0) {
    return invalid("Review revision is invalid.");
  }
  if (![value.calibrationVersion, value.scenarioId, value.targetField].every((item) => shortText(item, 128))) {
    return invalid("Review identity is invalid.");
  }
  return {
    ok: true as const,
    value: {
      expectedRevision: Number(value.expectedRevision),
      calibrationVersion: String(value.calibrationVersion),
      scenarioId: String(value.scenarioId),
      targetField: String(value.targetField) as AssessmentToolFieldKey,
    },
  };
}

function validateReviewCriteria(value: Record<string, unknown>) {
  const selected = normalizedIds(value.selectedCriterionIds, criterionSet);
  if (!selected?.length || selected.length > noteLabDocumentationCriteria.length) {
    return invalid("Select at least one valid documentation requirement.");
  }
  return { ok: true as const, value: selected as NoteLabCriterionId[] };
}

function validateSampleReview(value: Record<string, unknown>) {
  const sampleId = normalizeOptionalId(value.sampleId);
  if (sampleId === undefined) return invalid("Historical answer identity is invalid.");
  const sampleDisposition = normalizeDisposition(value.sampleDisposition);
  if (sampleDisposition === undefined) return invalid("Historical answer decision is invalid.");
  const revisionReasonIds = normalizedIds(value.revisionReasonIds, revisionReasonSet);
  if (!revisionReasonIds || revisionReasonIds.length > noteLabRevisionReasons.length) {
    return invalid("Revision reasons are invalid.");
  }
  const relationshipError = sampleRelationshipError(sampleId, sampleDisposition, revisionReasonIds);
  return relationshipError
    ? invalid(relationshipError)
    : {
        ok: true as const,
        value: {
          sampleId,
          sampleDisposition,
          revisionReasonIds: revisionReasonIds as NoteLabRevisionReasonId[],
        },
      };
}

export function emptyNoteLabProgress(calibrationVersion: string): NoteLabProgress {
  return { schemaVersion: 3, calibrationVersion, reviews: [] };
}

export function normalizeNoteLabProgress(value: unknown, calibrationVersion: string): NoteLabProgress {
  if (!isRecord(value) || value.schemaVersion !== 3 || !Array.isArray(value.reviews)) {
    return emptyNoteLabProgress(calibrationVersion);
  }
  const reviews = value.reviews
    .map(normalizeReview)
    .filter((review): review is NoteLabFieldReview => Boolean(review));
  return { schemaVersion: 3, calibrationVersion, reviews: reviews.slice(-10_000) };
}

function normalizeReview(value: unknown): NoteLabFieldReview | null {
  if (!isReviewIdentity(value)) return null;
  const selectedCriterionIds = normalizedIds(value.selectedCriterionIds, criterionSet) as NoteLabCriterionId[] | null;
  const revisionReasonIds = normalizedIds(value.revisionReasonIds, revisionReasonSet) as NoteLabRevisionReasonId[] | null;
  const sampleId = normalizeOptionalId(value.sampleId);
  const sampleDisposition = normalizeDisposition(value.sampleDisposition);
  if (!selectedCriterionIds?.length || !revisionReasonIds || sampleId === undefined || sampleDisposition === undefined) return null;
  if (sampleRelationshipError(sampleId, sampleDisposition, revisionReasonIds)) return null;
  return {
    scenarioId: String(value.scenarioId),
    targetField: String(value.targetField) as AssessmentToolFieldKey,
    selectedCriterionIds,
    sampleId,
    sampleDisposition,
    revisionReasonIds,
    submittedAt: value.submittedAt,
  };
}

function isReviewIdentity(value: unknown): value is Record<string, unknown> & { submittedAt: string } {
  return isRecord(value)
    && shortText(value.scenarioId, 128)
    && shortText(value.targetField, 128)
    && typeof value.submittedAt === "string";
}

function normalizeOptionalId(value: unknown) {
  if (value === null) return null;
  return shortText(value, 128) ? String(value) : undefined;
}

function normalizeDisposition(value: unknown): NoteLabSampleDisposition | null | undefined {
  if (value === null) return null;
  return dispositionSet.has(String(value)) ? String(value) as NoteLabSampleDisposition : undefined;
}

function sampleRelationshipError(
  sampleId: string | null,
  disposition: NoteLabSampleDisposition | null,
  revisionReasonIds: readonly string[],
) {
  if ((sampleId === null) !== (disposition === null)) return "Historical answer and decision must be submitted together.";
  if (disposition === "teach" && revisionReasonIds.length > 0) return "An answer accepted for teaching cannot include revision reasons.";
  if (["revise", "do_not_teach"].includes(disposition ?? "") && revisionReasonIds.length === 0) {
    return "Select at least one reason the historical answer needs work.";
  }
  if (disposition === null && revisionReasonIds.length > 0) return "Revision reasons require a historical answer.";
  return null;
}

function normalizedIds(value: unknown, allowed: Set<string>) {
  if (!Array.isArray(value)) return null;
  const ids = [...new Set(value.map(String))];
  return ids.some((id) => !allowed.has(id)) ? null : ids;
}

function shortText(value: unknown, maximum: number) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalid(error: string) {
  return { ok: false as const, error };
}
