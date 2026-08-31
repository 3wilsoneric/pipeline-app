import {
  assessmentToolFieldDefinitions,
  type AssessmentToolFieldKey,
  type AssessmentToolSection,
} from "@/lib/assessment/assessment-tool-schema";
import { getAssessmentNarrativeGuide } from "@/lib/assessment/assessment-narrative-guide";
import {
  classifyAssessmentNarrativeField,
  splitAssessmentNarrativePassages,
} from "@/lib/note-lab/assessment-language-core.mjs";
import type {
  HistoricalProfileCandidateSource,
  HistoricalProfileEvidence,
  HistoricalProfileResponse,
  HistoricalProfileSection,
  HistoricalProfileSource,
  HistoricalProfileUnmappedEvidence,
} from "@/lib/pipeline/historical-profile-contracts";

const MAX_MAPPED_EVIDENCE = 160;
const MAX_UNMAPPED_EVIDENCE = 80;

const sectionOrder: AssessmentToolSection[] = [
  "identity",
  "diagnosis_clinical",
  "functional_adl",
  "medication",
  "substance_use",
  "behavioral_risk",
  "physical_health",
  "legal_conservatorship",
  "social_support",
  "prior_placement",
  "prior_history",
  "provenance_qc",
];

const sectionLabels: Record<AssessmentToolSection, string> = {
  identity: "Identity and interview context",
  prior_placement: "Placement history",
  prior_history: "Prior service and crisis history",
  diagnosis_clinical: "Clinical presentation",
  functional_adl: "Daily functioning and communication",
  legal_conservatorship: "Legal and conservatorship",
  medication: "Medication",
  substance_use: "Substance use",
  behavioral_risk: "Behavior and safety",
  physical_health: "Physical health",
  social_support: "Supports and transition planning",
  provenance_qc: "Source quality",
};

const definitionsByField = new Map(
  assessmentToolFieldDefinitions.map((definition) => [definition.key, definition]),
);

export function buildHistoricalProfile(
  referralId: number,
  candidates: HistoricalProfileCandidateSource[],
): HistoricalProfileResponse {
  const mapped: HistoricalProfileEvidence[] = [];
  const unmapped: HistoricalProfileUnmappedEvidence[] = [];
  let passageCount = 0;

  for (const candidate of candidates) {
    const source = profileSource(candidate);
    const passages = splitAssessmentNarrativePassages(candidate.proposedValue);
    for (let index = 0; index < passages.length; index += 1) {
      const text = passages[index];
      const evidenceId = `${candidate.candidateId}:${index + 1}`;
      passageCount += 1;
      const mapping = classifyAssessmentNarrativeField(text);
      if (!mapping) {
        unmapped.push({ evidenceId, text, reason: "no_confident_field_match", source });
        continue;
      }

      const field = mapping.targetField as AssessmentToolFieldKey;
      const definition = definitionsByField.get(field);
      const guide = getAssessmentNarrativeGuide(field);
      if (!definition || !guide) {
        unmapped.push({ evidenceId, text, reason: "no_confident_field_match", source });
        continue;
      }

      mapped.push({
        evidenceId,
        targetField: field,
        fieldLabel: definition.label,
        section: definition.section,
        purpose: guide.purpose,
        text,
        confidence: mapping.confidence,
        source,
      });
    }
  }

  const displayedMapped = deduplicateMapped(mapped).slice(0, MAX_MAPPED_EVIDENCE);
  const displayedUnmapped = deduplicateUnmapped(unmapped).slice(0, MAX_UNMAPPED_EVIDENCE);
  return {
    mode: "historical_profile",
    referralId,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    assessmentCreated: false,
    sources: uniqueSources(candidates.map(profileSource)),
    sections: groupSections(displayedMapped),
    unmappedEvidence: displayedUnmapped,
    coverage: {
      sourceCount: uniqueSources(candidates.map(profileSource)).length,
      candidateCount: candidates.length,
      passageCount,
      mappedPassageCount: mapped.length,
      unmappedPassageCount: unmapped.length,
      displayedMappedCount: displayedMapped.length,
      displayedUnmappedCount: displayedUnmapped.length,
    },
    message: candidates.length
      ? null
      : "No captured assessment-note content is linked to this historical workspace.",
  };
}

function groupSections(evidence: HistoricalProfileEvidence[]): HistoricalProfileSection[] {
  const grouped = new Map<AssessmentToolSection, Map<AssessmentToolFieldKey, HistoricalProfileEvidence[]>>();
  for (const item of evidence) {
    const section = grouped.get(item.section) ?? new Map();
    const field = section.get(item.targetField) ?? [];
    field.push(item);
    section.set(item.targetField, field);
    grouped.set(item.section, section);
  }

  return sectionOrder.flatMap((section) => {
    const fields = grouped.get(section);
    if (!fields) return [];
    const rows = [...fields.entries()].map(([targetField, items]) => ({
      targetField,
      label: items[0].fieldLabel,
      purpose: items[0].purpose,
      evidence: items,
    })).sort((left, right) => left.label.localeCompare(right.label, "en"));
    return [{
      section,
      label: sectionLabels[section],
      evidenceCount: rows.reduce((count, field) => count + field.evidence.length, 0),
      fields: rows,
    }];
  });
}

function profileSource(candidate: HistoricalProfileCandidateSource): HistoricalProfileSource {
  return {
    sourceCanvasId: candidate.sourceCanvasId,
    sourceCanvasName: candidate.sourceCanvasName,
    sourceProjectName: candidate.sourceProjectName,
    sourceLocator: candidate.sourceLocator,
    capturedAt: candidate.capturedAt,
  };
}

function uniqueSources(sources: HistoricalProfileSource[]) {
  const byCanvas = new Map<string, HistoricalProfileSource>();
  for (const source of sources) {
    const current = byCanvas.get(source.sourceCanvasId);
    if (!current || String(source.capturedAt) > String(current.capturedAt)) {
      byCanvas.set(source.sourceCanvasId, source);
    }
  }
  return [...byCanvas.values()].sort((left, right) =>
    String(right.capturedAt).localeCompare(String(left.capturedAt), "en")
      || left.sourceCanvasName.localeCompare(right.sourceCanvasName, "en"));
}

function deduplicateMapped(items: HistoricalProfileEvidence[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.targetField}\u0000${normalizeForDedupe(item.text)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicateUnmapped(items: HistoricalProfileUnmappedEvidence[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeForDedupe(item.text);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeForDedupe(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}
