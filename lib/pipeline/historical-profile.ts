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
  HistoricalProfileCapturedSource,
  HistoricalProfileDocument,
  HistoricalProfileEvidence,
  HistoricalProfileFact,
  HistoricalProfileResponse,
  HistoricalProfileSection,
  HistoricalProfileSource,
  HistoricalProfileSourceBlock,
  HistoricalProfileSourceSection,
  HistoricalProfileUnmappedEvidence,
} from "@/lib/pipeline/historical-profile-contracts";

const MAX_MAPPED_EVIDENCE = 160;
const MAX_UNMAPPED_EVIDENCE = 80;
const MAX_SOURCE_BLOCKS = 800;

const factDefinitions = [
  { key: "referral_received", label: "Referral received", aliases: ["date referral received m d y", "date referral received"] },
  { key: "assessment_date", label: "Assessment date", aliases: ["assessment date m d y", "assesment date m d y", "assessment date", "assesment date"] },
  { key: "admission_date", label: "Admission date", aliases: ["admission date m d y", "admission date"] },
  { key: "county", label: "County", aliases: ["county"] },
  { key: "referrer", label: "Referrer", aliases: ["referrer", "referrent"] },
  { key: "responsible_person", label: "Responsible person", aliases: ["responsible person"] },
] as const;

const metadataDefinitions = [
  { key: "created_by", label: "Created by", heading: "created by" },
  { key: "modified_by", label: "Modified by", heading: "modified by" },
  { key: "section", label: "Original status", heading: "section" },
  { key: "assignee", label: "Original assignee", heading: "assignee" },
  { key: "due_date", label: "Due date", heading: "due date" },
  { key: "tags", label: "Tags", heading: "tags" },
  { key: "collaborators", label: "Collaborators", heading: "collaborators" },
] as const;

const interfaceText = new Set([
  "activity",
  "add a subtask",
  "add assignee",
  "add collaborators",
  "add due date",
  "back to",
  "canvas",
  "collaborators",
  "connected",
  "created by",
  "drag and drop documents here",
  "due date",
  "google docs",
  "open canvas",
  "related links",
  "section",
  "subtasks",
  "tags",
  "use canvas for whiteboarding brainstorming or documentation",
]);

const templateText = new Set([
  "admission documentation",
  "conserved",
  "fill out or upload documentation in the yellow areas please",
  "letter s of conservatorship if applicable",
  "lic 601 lic 603",
  "lic602",
  "once documents are approved for admission please check upper box",
  "signed admission agreement lic forms",
  "signed medication list",
  "tb test results",
  "yes",
  "no",
]);

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
  capturedSources: HistoricalProfileCapturedSource[] = [],
  documents: HistoricalProfileDocument[] = [],
): HistoricalProfileResponse {
  const projection = projectCandidateEvidence(candidates);
  const displayedMapped = deduplicateMapped(projection.mapped).slice(0, MAX_MAPPED_EVIDENCE);
  const displayedUnmapped = deduplicateUnmapped(projection.unmapped).slice(0, MAX_UNMAPPED_EVIDENCE);
  const extracted = extractFacts(capturedSources);
  const evidenceText = new Set(
    [...displayedMapped, ...displayedUnmapped].map((item) => normalizeForDedupe(item.text)),
  );
  const sourceSections = buildSourceSections(capturedSources, extracted.consumedBlockIds, evidenceText);
  const sources = uniqueSources([
    ...candidates.map(profileSource),
    ...capturedSources.map(capturedSourceProfile),
  ]);
  const sourceBlockCount = capturedSources.reduce((count, source) => count + source.blocks.length, 0);
  const displayedSourceBlockCount = sourceSections.reduce((count, section) => count + section.blocks.length, 0);
  const profileDocuments = deduplicateDocuments(documents);
  const hasContent = hasHistoricalContent({
    factCount: extracted.facts.length,
    documentCount: profileDocuments.length,
    mappedCount: displayedMapped.length,
    unmappedCount: displayedUnmapped.length,
    sourceBlockCount: displayedSourceBlockCount,
  });
  return {
    mode: "historical_profile",
    referralId,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    assessmentCreated: false,
    sources,
    facts: extracted.facts,
    documents: profileDocuments,
    sections: groupSections(displayedMapped),
    unmappedEvidence: displayedUnmapped,
    sourceSections,
    coverage: {
      sourceCount: sources.length,
      sourceBlockCount,
      displayedSourceBlockCount,
      factCount: extracted.facts.length,
      documentCount: profileDocuments.length,
      candidateCount: candidates.length,
      passageCount: projection.passageCount,
      mappedPassageCount: projection.mapped.length,
      unmappedPassageCount: projection.unmapped.length,
      displayedMappedCount: displayedMapped.length,
      displayedUnmappedCount: displayedUnmapped.length,
    },
    message: hasContent
      ? null
      : "No captured source content or linked documents are available for this workspace.",
  };
}

function projectCandidateEvidence(candidates: HistoricalProfileCandidateSource[]) {
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
  return { mapped, unmapped, passageCount };
}

function hasHistoricalContent(counts: Record<string, number>) {
  return Object.values(counts).some((count) => count > 0);
}

function extractFacts(capturedSources: HistoricalProfileCapturedSource[]) {
  const facts: HistoricalProfileFact[] = [];
  const consumedBlockIds = new Set<string>();

  for (const captured of capturedSources) {
    const source = capturedSourceProfile(captured);
    const blocks = [...captured.blocks].sort((left, right) => left.ordinal - right.ordinal);
    extractIdentityFacts(blocks, source, facts, consumedBlockIds);
    extractLabeledFacts(blocks, source, facts, consumedBlockIds);
    extractMetadataFacts(blocks, source, facts, consumedBlockIds);
  }

  const seen = new Set<string>();
  return {
    consumedBlockIds,
    facts: facts.filter((fact) => {
      const key = `${fact.key}\u0000${normalizeForDedupe(fact.value)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

function extractIdentityFacts(
  blocks: HistoricalProfileSourceBlock[],
  source: HistoricalProfileSource,
  facts: HistoricalProfileFact[],
  consumed: Set<string>,
) {
  const identity = [
    { key: "name", label: "Name", marker: "name" },
    { key: "gender", label: "Gender", marker: "gender" },
    { key: "age", label: "Age", marker: "age" },
    { key: "dob", label: "Date of birth", marker: "dob" },
  ] as const;

  for (let index = 0; index <= blocks.length - identity.length; index += 1) {
    const headers = blocks.slice(index, index + identity.length);
    if (!headers.every((block, offset) => normalizeToken(block.text) === identity[offset].marker)) continue;
    const values = blocks.slice(index + identity.length, index + (identity.length * 2));
    if (values.length !== identity.length || values.some((block) => block.blockType === "heading")) continue;
    for (let offset = 0; offset < identity.length; offset += 1) {
      const value = cleanSourceValue(values[offset].text);
      consumed.add(headers[offset].blockId);
      if (!value) continue;
      consumed.add(values[offset].blockId);
      facts.push({
        factId: `${values[offset].blockId}:${identity[offset].key}`,
        key: identity[offset].key,
        label: identity[offset].label,
        value,
        source,
      });
    }
    return;
  }
}

function extractLabeledFacts(
  blocks: HistoricalProfileSourceBlock[],
  source: HistoricalProfileSource,
  facts: HistoricalProfileFact[],
  consumed: Set<string>,
) {
  const labels = new Map<string, (typeof factDefinitions)[number]>();
  for (const definition of factDefinitions) {
    for (const alias of definition.aliases) labels.set(alias, definition);
  }

  for (let index = 0; index < blocks.length; index += 1) {
    const definition = labels.get(normalizeToken(blocks[index].text));
    if (!definition) continue;
    consumed.add(blocks[index].blockId);
    const values = collectLabeledFactValues(
      blocks,
      index + 1,
      labels,
      definition.key === "responsible_person",
    );
    if (!values.length) continue;
    values.forEach((block) => consumed.add(block.blockId));
    facts.push({
      factId: `${blocks[index].blockId}:${definition.key}`,
      key: definition.key,
      label: definition.label,
      value: values.map((block) => cleanSourceValue(block.text)).filter(Boolean).join("; "),
      source,
    });
  }
}

function collectLabeledFactValues(
  blocks: HistoricalProfileSourceBlock[],
  startIndex: number,
  labels: Map<string, (typeof factDefinitions)[number]>,
  allowMultiple: boolean,
) {
  const values: HistoricalProfileSourceBlock[] = [];
  for (let cursor = startIndex; cursor < blocks.length; cursor += 1) {
    const candidate = blocks[cursor];
    if (candidate.blockType === "heading") break;
    if (labels.has(normalizeToken(candidate.text))) break;
    const value = cleanSourceValue(candidate.text);
    if ([!value, isInterfaceText(value)].some(Boolean)) continue;
    values.push(candidate);
    if (!allowMultiple) break;
  }
  return values;
}

function extractMetadataFacts(
  blocks: HistoricalProfileSourceBlock[],
  source: HistoricalProfileSource,
  facts: HistoricalProfileFact[],
  consumed: Set<string>,
) {
  for (const definition of metadataDefinitions) {
    const matching = blocks.filter((block) =>
      normalizeToken(block.headingPath.at(-1) ?? "") === definition.heading);
    if (!matching.length) continue;
    const values = matching.filter((block) => {
      const value = cleanSourceValue(block.text);
      return block.blockType !== "heading" && Boolean(value) && !isInterfaceText(value);
    });
    matching.filter((block) => block.blockType === "heading").forEach((block) => consumed.add(block.blockId));
    if (!values.length) continue;
    values.forEach((block) => consumed.add(block.blockId));
    facts.push({
      factId: `${matching[0].blockId}:${definition.key}`,
      key: definition.key,
      label: definition.label,
      value: values.map((block) => cleanSourceValue(block.text)).filter(Boolean).join(" "),
      source,
    });
  }
}

function buildSourceSections(
  capturedSources: HistoricalProfileCapturedSource[],
  consumed: Set<string>,
  evidenceText: Set<string>,
): HistoricalProfileSourceSection[] {
  const sections: HistoricalProfileSourceSection[] = [];
  let remaining = MAX_SOURCE_BLOCKS;

  for (const captured of capturedSources) {
    const source = capturedSourceProfile(captured);
    const grouped = collectSourceBlocks(captured, consumed, evidenceText, remaining);

    let sourceSectionIndex = 0;
    for (const [label, blocks] of grouped) {
      const unique = deduplicateSourceBlocks(blocks);
      if (!unique.length) continue;
      sourceSectionIndex += 1;
      sections.push({
        sectionId: `${captured.snapshotId}:${sourceSectionIndex}`,
        label,
        source,
        blocks: unique,
      });
      remaining -= unique.length;
    }
  }
  return sections;
}

function collectSourceBlocks(
  captured: HistoricalProfileCapturedSource,
  consumed: Set<string>,
  evidenceText: Set<string>,
  limit: number,
) {
  const grouped = new Map<string, HistoricalProfileSourceBlock[]>();
  const source = capturedSourceProfile(captured);
  const excludedText = new Set([
    normalizeForDedupe(source.sourceCanvasName),
    normalizeForDedupe(source.sourceProjectName ?? ""),
  ]);
  let count = 0;
  for (const block of [...captured.blocks].sort((left, right) => left.ordinal - right.ordinal)) {
    if (count >= limit) break;
    const prepared = prepareSourceBlock(block, consumed, evidenceText, excludedText);
    if (!prepared) continue;
    const current = grouped.get(prepared.heading) ?? [];
    current.push(prepared.block);
    grouped.set(prepared.heading, current);
    count += 1;
  }
  return grouped;
}

function prepareSourceBlock(
  block: HistoricalProfileSourceBlock,
  consumed: Set<string>,
  evidenceText: Set<string>,
  excludedText: Set<string>,
) {
  if (consumed.has(block.blockId)) return null;
  const text = cleanSourceValue(block.text);
  if ([!text, block.blockType === "heading", isInterfaceText(text), isTemplateText(text)].some(Boolean)) return null;
  const normalized = normalizeForDedupe(text);
  if (evidenceText.has(normalized)) return null;
  if (excludedText.has(normalized)) return null;
  const heading = sourceSectionLabel(block.headingPath.at(-1));
  if (!heading) return null;
  return { heading, block: { ...block, text } };
}

function sourceSectionLabel(value: string | undefined) {
  const normalized = normalizeToken(value ?? "");
  if (!normalized || normalized === "activity") return "Other source details";
  if (normalized.includes("instruction")) return null;
  if (normalized === "subtasks") return "Original tasks";
  if (normalized === "admission documentation" || normalized === "signed medication list") return "Document notes";
  return value?.trim() || "Other source details";
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

function capturedSourceProfile(source: HistoricalProfileCapturedSource): HistoricalProfileSource {
  return {
    sourceCanvasId: source.sourceCanvasId,
    sourceCanvasName: source.sourceCanvasName,
    sourceProjectName: source.sourceProjectName,
    sourceLocator: source.sourceLocator,
    capturedAt: source.capturedAt,
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

function deduplicateSourceBlocks(items: HistoricalProfileSourceBlock[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeForDedupe(item.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicateDocuments(items: HistoricalProfileDocument[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.documentId)) return false;
    seen.add(item.documentId);
    return true;
  }).sort((left, right) =>
    String(right.uploadedAt).localeCompare(String(left.uploadedAt), "en")
      || left.name.localeCompare(right.name, "en"));
}

function cleanSourceValue(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizeToken(value: string) {
  return cleanSourceValue(value)
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isInterfaceText(value: string) {
  return interfaceText.has(normalizeToken(value));
}

function isTemplateText(value: string) {
  return templateText.has(normalizeToken(value));
}

function normalizeForDedupe(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}
