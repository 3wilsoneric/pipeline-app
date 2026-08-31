#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  analyzeClassifiedNotes,
  classifyNoteText,
  splitLabeledNoteSections,
} from "../lib/note-lab/note-lab-taxonomy-core.mjs";
import {
  ASSESSMENT_LANGUAGE_TAXONOMY_VERSION,
  classifyAssessmentNarrativeField,
  splitAssessmentNarrativePassages,
} from "../lib/note-lab/assessment-language-core.mjs";

const manifestPath = await resolveManifestPath();
const outputPath = path.resolve(argumentValue("--output") ?? ".data/private-note-lab-corpus-profile.json");
const parsed = JSON.parse(await readFile(manifestPath, "utf8"));
const sources = candidateSources(parsed);
const analysis = buildClassifiedSamples(sources);
const topicProfile = analyzeClassifiedNotes(analysis.samples);
const fieldGroups = comparisonGroups(analysis.samples);
const profile = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  sourceManifest: path.basename(manifestPath),
  taxonomyVersion: ASSESSMENT_LANGUAGE_TAXONOMY_VERSION,
  sourceCount: new Set(analysis.samples.map((sample) => sample.sourceCanvasId)).size,
  passageCount: analysis.passageCount,
  mappedPassageCount: analysis.mappedPassageCount,
  mappedSampleCount: analysis.samples.length,
  duplicateMappedPassageCount: analysis.mappedPassageCount - analysis.samples.length,
  unassignedPassageCount: analysis.unassignedPassageCount,
  mappingRate: analysis.passageCount === 0 ? 0 : Number((analysis.mappedPassageCount / analysis.passageCount).toFixed(4)),
  pairableSampleCount: fieldGroups.filter((group) => group.pairable)
    .reduce((total, group) => total + group.sampleCount, 0),
  pairableFieldGroupCount: fieldGroups.filter((group) => group.pairable).length,
  distributions: {
    targetField: countBy(analysis.samples, (sample) => sample.targetField),
    confidence: countBy(analysis.samples, (sample) => sample.mappingConfidence),
    sourceSection: topicProfile.distributions.section,
    primaryTopic: topicProfile.distributions.primaryTopic,
    lengthBand: topicProfile.distributions.lengthBand,
  },
  fieldGroups,
};

await writePrivateJson(outputPath, profile);
console.log(JSON.stringify({
  ok: true,
  manifest: manifestPath,
  output: outputPath,
  passageCount: profile.passageCount,
  mappedPassageCount: profile.mappedPassageCount,
  mappedSampleCount: profile.mappedSampleCount,
  duplicateMappedPassageCount: profile.duplicateMappedPassageCount,
  unassignedPassageCount: profile.unassignedPassageCount,
  mappingRate: profile.mappingRate,
  sourceCount: profile.sourceCount,
  pairableSampleCount: profile.pairableSampleCount,
  pairableFieldGroupCount: profile.pairableFieldGroupCount,
  distributions: profile.distributions,
  largestFieldGroups: profile.fieldGroups.slice(0, 20),
}, null, 2));

function buildClassifiedSamples(candidateRows) {
  const seen = new Set();
  const samples = [];
  let passageCount = 0;
  let mappedPassageCount = 0;
  let unassignedPassageCount = 0;
  for (const source of candidateRows) {
    for (const section of splitLabeledNoteSections(source.proposedValue)) {
      for (const text of splitAssessmentNarrativePassages(section.text)) {
        passageCount += 1;
        const mapping = classifyAssessmentNarrativeField(text);
        if (!mapping) {
          unassignedPassageCount += 1;
          continue;
        }
        mappedPassageCount += 1;
        const contentKey = sha256(`${mapping.targetField}\u0000${text}`);
        if (seen.has(contentKey)) continue;
        seen.add(contentKey);
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        samples.push({
          section: section.section,
          targetField: mapping.targetField,
          mappingConfidence: mapping.confidence,
          lengthBand: wordCount <= 45 ? "brief" : wordCount <= 110 ? "standard" : "extended",
          sourceCanvasId: source.sourceCanvasId,
          classification: classifyNoteText(text, section.section),
        });
      }
    }
  }
  return { samples, passageCount, mappedPassageCount, unassignedPassageCount };
}

function comparisonGroups(samples) {
  const groups = new Map();
  for (const sample of samples) {
    const key = `${sample.targetField}:${sample.lengthBand}`;
    const group = groups.get(key) ?? {
      targetField: sample.targetField,
      lengthBand: sample.lengthBand,
      sampleCount: 0,
      sourceIds: new Set(),
    };
    group.sampleCount += 1;
    group.sourceIds.add(sample.sourceCanvasId);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    targetField: group.targetField,
    lengthBand: group.lengthBand,
    sampleCount: group.sampleCount,
    sourceCount: group.sourceIds.size,
    pairable: group.sourceIds.size >= 2,
  })).sort((left, right) => right.sampleCount - left.sampleCount
    || `${left.targetField}:${left.lengthBand}`.localeCompare(`${right.targetField}:${right.lengthBand}`, "en"));
}

function countBy(records, select) {
  const counts = new Map();
  for (const record of records) {
    const key = select(record);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort((left, right) => right[1] - left[1]
    || String(left[0]).localeCompare(String(right[0]), "en")));
}

function candidateSources(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.snapshots)) {
    return value.snapshots.flatMap((snapshot) => {
      if (!snapshot || typeof snapshot !== "object" || typeof snapshot.source_canvas_id !== "string"
        || !Array.isArray(snapshot.candidates)) return [];
      return snapshot.candidates.flatMap((candidate) => candidate?.target_field_key === "assessment_notes"
        && typeof candidate.proposed_value === "string"
        ? [{ sourceCanvasId: snapshot.source_canvas_id, proposedValue: candidate.proposed_value }]
        : []);
    });
  }
  if (Array.isArray(value.clients)) {
    return value.clients.flatMap((client) => Array.isArray(client?.allo_content?.canvases)
      ? client.allo_content.canvases.flatMap((canvas) => Array.isArray(canvas?.note_candidates)
        ? canvas.note_candidates.flatMap((candidate) => candidate?.target_field_key === "assessment_notes"
          && typeof candidate.proposed_value === "string" && typeof canvas.source_canvas_id === "string"
          ? [{ sourceCanvasId: canvas.source_canvas_id, proposedValue: candidate.proposed_value }]
          : [])
        : [])
      : []);
  }
  return [];
}

async function resolveManifestPath() {
  const explicit = argumentValue("--manifest") ?? process.env.PIPELINE_NOTE_LAB_MANIFEST_PATH?.trim();
  if (explicit) return path.resolve(explicit);
  for (const environmentFile of [".env.development.local", ".env.local"]) {
    const source = await readFile(path.resolve(environmentFile), "utf8").catch(() => null);
    const configured = source?.split(/\r?\n/).find((line) => line.startsWith("PIPELINE_NOTE_LAB_MANIFEST_PATH="));
    if (configured) {
      const value = configured.slice(configured.indexOf("=") + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
      if (value) return path.resolve(value);
    }
  }
  throw new Error("Provide --manifest=/absolute/path or configure PIPELINE_NOTE_LAB_MANIFEST_PATH.");
}

function argumentValue(name) {
  const inline = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function writePrivateJson(destination, value) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
  await chmod(destination, 0o600);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
