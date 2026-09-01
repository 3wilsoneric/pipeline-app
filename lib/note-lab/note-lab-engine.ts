import { createHash } from "node:crypto";

import { getAssessmentFieldWritingSpec } from "@/lib/assessment/assessment-field-writing-spec";
import {
  getAssessmentNarrativeGuide,
  getAssessmentNarrativeGuideCoverage,
} from "@/lib/assessment/assessment-narrative-guide";
import {
  noteLabDocumentationCriteria,
  noteLabRevisionReasons,
  recommendedCriteriaForPurpose,
  type NoteLabCriterionId,
  type NoteLabRevisionReasonId,
} from "./assessment-language-standards";
import {
  NOTE_LAB_CALIBRATION_TARGET,
  NOTE_LAB_CALIBRATION_VERSION,
  type NoteLabCalibration,
  type NoteLabProgress,
  type NoteLabReviewInput,
  type NoteLabSample,
  type NoteLabSampleDisposition,
  type NoteLabScenario,
  type NoteLabSection,
} from "./note-lab-contracts";
import {
  ASSESSMENT_LANGUAGE_TAXONOMY_VERSION,
  classifyAssessmentNarrativeField,
  splitAssessmentNarrativePassages,
} from "./assessment-language-core.mjs";
import {
  analyzeClassifiedNotes,
  classifyNoteText,
  splitLabeledNoteSections,
} from "./note-lab-taxonomy-core.mjs";

export type InternalNoteLabSample = NoteLabSample & {
  sourceCanvasId: string;
};

export const NOTE_LAB_SAMPLE_SCHEMA_VERSION = "note_lab_samples_v3";

export type NoteCandidateSource = {
  candidateId: string;
  sourceCanvasId: string;
  sourceCanvasName: string | null;
  proposedValue: string;
};

export function buildNoteLabSamples(sources: readonly NoteCandidateSource[]) {
  const byContent = new Map<string, InternalNoteLabSample>();
  for (const source of sources) {
    for (const section of splitCandidateSections(source.proposedValue)) {
      for (const passage of splitAssessmentNarrativePassages(section.text)) {
        const mapping = classifyAssessmentNarrativeField(passage);
        if (!mapping) continue;
        const guide = getAssessmentNarrativeGuide(mapping.targetField);
        if (!guide) continue;
        const text = redactReviewText(passage, source.sourceCanvasName);
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        if (!noteTextIsUsable(text, wordCount)) continue;
        const contentHash = digest(`${mapping.targetField}\u0000${text}`);
        if (byContent.has(contentHash)) continue;
        byContent.set(contentHash, {
          id: `answer_${digest(`${source.candidateId}\u0000${mapping.targetField}\u0000${text}`).slice(0, 24)}`,
          sourceCanvasId: source.sourceCanvasId,
          sourceSection: section.section,
          targetField: mapping.targetField,
          targetFieldLabel: guide.label,
          fieldPurpose: guide.purpose,
          purposeTrack: guide.purposeTrack,
          text: text.slice(0, 4_000),
          wordCount,
          lengthBand: noteLengthBand(wordCount),
          mappingConfidence: mapping.confidence,
          classification: classifyNoteText(text, section.section),
        });
      }
    }
  }
  const samples = [...byContent.values()].sort((left, right) => left.id.localeCompare(right.id, "en"));
  return {
    samples,
    sampleSetVersion: `answers_${digest(`${NOTE_LAB_SAMPLE_SCHEMA_VERSION}\n${ASSESSMENT_LANGUAGE_TAXONOMY_VERSION}\n${samples.map((sample) => sample.id).join("\n")}`).slice(0, 20)}`,
  };
}

function noteTextIsUsable(text: string, wordCount: number) {
  return text.length >= 20 && wordCount >= 4;
}

function noteLengthBand(wordCount: number): InternalNoteLabSample["lengthBand"] {
  if (wordCount <= 45) return "brief";
  if (wordCount <= 110) return "standard";
  return "extended";
}

export function buildNoteLabCorpusProfile(samples: readonly InternalNoteLabSample[]) {
  return analyzeClassifiedNotes(samples.map((sample) => ({ ...sample, section: sample.sourceSection })));
}

export function buildNoteLabScenarioCatalog(): NoteLabScenario[] {
  return getAssessmentNarrativeGuideCoverage().coveredFields.flatMap((field) => {
    const guide = getAssessmentNarrativeGuide(field);
    const specification = getAssessmentFieldWritingSpec(field);
    if (!guide || !specification) return [];
    return [{
      id: `field_${digest(`${NOTE_LAB_CALIBRATION_VERSION}\u0000${field}`).slice(0, 24)}`,
      targetField: field,
      targetFieldLabel: guide.label,
      fieldPurpose: guide.purpose,
      purposeTrack: guide.purposeTrack,
      reviewQuestion: guide.reviewQuestion,
      guardrail: guide.guardrail,
      recommendedCriterionIds: recommendedCriteriaForPurpose(guide.purposeTrack),
      formatStandard: {
        label: specification.formatLabel,
        lengthGuidance: specification.lengthGuidance,
        template: specification.formatTemplate,
        requiredElements: [...specification.requiredElements],
        referenceAnswer: specification.strongExample,
      },
      reviewSample: null,
      sampleSetVersion: "unavailable",
    }];
  });
}

export function attachReviewSample(
  scenario: NoteLabScenario,
  samples: readonly InternalNoteLabSample[],
  sampleSetVersion: string,
  reviewerId: string,
): NoteLabScenario {
  const candidates = samples.filter((sample) => sample.targetField === scenario.targetField
    && sample.wordCount >= 8
    && sample.wordCount <= 180
    && sample.text.length <= 2_000);
  const selected = candidates.sort((left, right) => sampleRank(reviewerId, scenario.id, left.id)
    .localeCompare(sampleRank(reviewerId, scenario.id, right.id), "en"))[0];
  if (!selected) return { ...scenario, reviewSample: null, sampleSetVersion };
  return {
    ...scenario,
    sampleSetVersion,
    reviewSample: {
      id: selected.id,
      sourceSection: selected.sourceSection,
      text: selected.text,
      wordCount: selected.wordCount,
      lengthBand: selected.lengthBand,
      mappingConfidence: selected.mappingConfidence,
    },
  };
}

export function selectNextScenario(
  catalog: readonly NoteLabScenario[],
  progress: NoteLabProgress,
) {
  const completed = new Set(progress.reviews.map((review) => review.scenarioId));
  return catalog.find((scenario) => !completed.has(scenario.id)) ?? null;
}

export function buildNoteLabCalibration(
  catalog: readonly NoteLabScenario[],
  progress: NoteLabProgress,
): NoteLabCalibration {
  const reviews = progress.reviews.slice(0, NOTE_LAB_CALIBRATION_TARGET);
  const scenarioById = new Map(catalog.map((scenario) => [scenario.id, scenario]));
  const criterionCounts = new Map<NoteLabCriterionId, number>();
  const reasonCounts = new Map<NoteLabRevisionReasonId, number>();
  const purposeTracks = new Set<string>();
  const fieldStandards: NoteLabCalibration["profile"]["fieldStandards"] = [];
  const sampleOutcomes: Record<NoteLabSampleDisposition, number> = { teach: 0, revise: 0, do_not_teach: 0 };

  const trail = reviews.flatMap((review, index) => {
    const scenario = scenarioById.get(review.scenarioId);
    if (!scenario) return [];
    purposeTracks.add(scenario.purposeTrack);
    for (const criterion of review.selectedCriterionIds) {
      criterionCounts.set(criterion, (criterionCounts.get(criterion) ?? 0) + 1);
    }
    for (const reason of review.revisionReasonIds) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
    if (review.sampleDisposition) sampleOutcomes[review.sampleDisposition] += 1;
    fieldStandards.push({
      field: scenario.targetField,
      label: scenario.targetFieldLabel,
      selectedCriterionIds: review.selectedCriterionIds,
      sampleDisposition: review.sampleDisposition,
      revisionReasonIds: review.revisionReasonIds,
    });
    return [{
      step: index + 1,
      targetFieldLabel: scenario.targetFieldLabel,
      purposeTrack: scenario.purposeTrack,
      selectedCriterionIds: review.selectedCriterionIds,
      sampleDisposition: review.sampleDisposition,
    }];
  });

  const decisionsCompleted = reviews.length;
  const complete = decisionsCompleted >= NOTE_LAB_CALIBRATION_TARGET;
  const fieldSteps = catalog.slice(0, NOTE_LAB_CALIBRATION_TARGET).map((scenario) => ({
    field: scenario.targetField,
    label: scenario.targetFieldLabel,
  }));
  const criteria = noteLabDocumentationCriteria.map((criterion) => {
    const selectedCount = criterionCounts.get(criterion.id) ?? 0;
    return {
      id: criterion.id,
      label: criterion.label,
      selectedCount,
      selectionRate: decisionsCompleted === 0 ? 0 : Math.round((selectedCount / decisionsCompleted) * 100),
    };
  }).sort((left, right) => right.selectedCount - left.selectedCount || left.label.localeCompare(right.label, "en"));
  const revisionReasons = noteLabRevisionReasons.map((reason) => ({
    id: reason.id,
    label: reason.label,
    selectedCount: reasonCounts.get(reason.id) ?? 0,
  })).filter((reason) => reason.selectedCount > 0)
    .sort((left, right) => right.selectedCount - left.selectedCount || left.label.localeCompare(right.label, "en"));

  return {
    targetDecisions: NOTE_LAB_CALIBRATION_TARGET,
    decisionsCompleted,
    currentStep: Math.min(decisionsCompleted + 1, NOTE_LAB_CALIBRATION_TARGET),
    remaining: Math.max(0, NOTE_LAB_CALIBRATION_TARGET - decisionsCompleted),
    progressPercent: Math.round((decisionsCompleted / NOTE_LAB_CALIBRATION_TARGET) * 100),
    complete,
    estimatedMinutesRemaining: Math.max(0, Math.ceil((NOTE_LAB_CALIBRATION_TARGET - decisionsCompleted) * 1.5)),
    fieldSteps,
    trail,
    profile: {
      schemaVersion: 3,
      calibrationVersion: progress.calibrationVersion,
      status: complete ? "ready" : "collecting",
      targetDecisions: NOTE_LAB_CALIBRATION_TARGET,
      decisionsCompleted,
      fieldsReviewed: fieldStandards.length,
      purposeTracksReviewed: purposeTracks.size,
      criteria,
      sampleOutcomes,
      revisionReasons,
      fieldStandards,
      inferredRules: inferDocumentationRules(criteria, sampleOutcomes, revisionReasons),
    },
  };
}

export function validateReviewAgainstScenario(
  input: NoteLabReviewInput,
  scenario: NoteLabScenario | null,
) {
  if (!scenario || scenario.id !== input.scenarioId) {
    return { ok: false as const, error: "This assessment field is no longer the active review." };
  }
  if (scenario.targetField !== input.targetField) {
    return { ok: false as const, error: "The assessment field does not match this review." };
  }
  const validCriteria = new Set(noteLabDocumentationCriteria.map((criterion) => criterion.id));
  if (input.selectedCriterionIds.some((criterion) => !validCriteria.has(criterion))) {
    return { ok: false as const, error: "One or more documentation requirements are unavailable." };
  }
  if ((scenario.reviewSample?.id ?? null) !== input.sampleId) {
    return { ok: false as const, error: "The historical answer changed. Reload before saving this review." };
  }
  return { ok: true as const };
}

export function splitCandidateSections(value: string) {
  return splitLabeledNoteSections(value) as Array<{ section: NoteLabSection; text: string }>;
}

export function redactReviewText(value: string, sourceCanvasName: string | null) {
  let text = String(value ?? "").normalize("NFKC");
  for (const alias of identityAliases(sourceCanvasName)) {
    text = text.replace(new RegExp(`\\b${escapeRegExp(alias)}\\b`, "gi"), "[client]");
  }
  return text
    .replace(/\b(?:client|patient)\s+name\s*:\s*[^\n,;]+/gi, "Client name: [client]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, "[phone]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[identifier]")
    .replace(/\b(?:0?[1-9]|1[0-2])[/\.\-](?:0?[1-9]|[12]\d|3[01])[/\.\-](?:19|20)?\d{2}\b/g, "[date]")
    .replace(/\b(?:0?[1-9]|1[0-2])[/.-](?:0?[1-9]|[12]\d|3[01])[/.-]\d{2}\b/g, "[date]")
    .replace(/\b(?:mrn|medical record|client id|case id)\s*[:#-]?\s*[a-z0-9-]{4,}\b/gi, "[identifier]")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function identityAliases(sourceCanvasName: string | null) {
  if (!sourceCanvasName?.trim()) return [];
  const full = sourceCanvasName.normalize("NFKC").trim();
  const nameStem = full
    .split(/\s+\(|\s+-\s+|\s+\d{1,2}[/-]\d{1,2}|,\s*(?:male|female)\b/i)[0]
    .replace(/[^\p{L}' -]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const stopWords = new Set(["client", "male", "female", "admission", "admissions", "referral"]);
  const tokens = nameStem.split(/\s+/).filter((token) => token.length >= 3
    && !stopWords.has(token.toLocaleLowerCase("en-US")));
  return [...new Set([full, nameStem, ...tokens].filter((alias) => alias.length >= 3))]
    .sort((left, right) => right.length - left.length);
}

function inferDocumentationRules(
  criteria: NoteLabCalibration["profile"]["criteria"],
  outcomes: NoteLabCalibration["profile"]["sampleOutcomes"],
  reasons: NoteLabCalibration["profile"]["revisionReasons"],
) {
  const rules = criteria.filter((criterion) => criterion.selectionRate >= 70)
    .slice(0, 5)
    .map((criterion) => `${criterion.label} was required in ${criterion.selectionRate}% of reviewed fields.`);
  const reviewedSamples = outcomes.teach + outcomes.revise + outcomes.do_not_teach;
  if (reviewedSamples > 0) {
    rules.push(`${outcomes.teach} of ${reviewedSamples} historical answers were accepted as teaching examples without revision.`);
  }
  if (reasons[0]) rules.push(`The most common revision need was: ${reasons[0].label.toLocaleLowerCase("en-US")}.`);
  return rules;
}

function sampleRank(reviewerId: string, scenarioId: string, sampleId: string) {
  return digest(`${reviewerId}\u0000${scenarioId}\u0000${sampleId}`);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
