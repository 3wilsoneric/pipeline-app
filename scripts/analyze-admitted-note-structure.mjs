#!/usr/bin/env node

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  NOTE_LAB_TAXONOMY_VERSION,
  classifyNoteText,
  splitLabeledNoteSections,
} from "../lib/note-lab/note-lab-taxonomy-core.mjs";
import {
  ASSESSMENT_LANGUAGE_TAXONOMY_VERSION,
  classifyAssessmentNarrativeField,
  splitAssessmentNarrativePassages,
} from "../lib/note-lab/assessment-language-core.mjs";

function buildProfile(value, sourceManifest) {
  if (!value || typeof value !== "object" || !Array.isArray(value.clients)) {
    throw new Error("The admitted-note analysis requires a combined client history manifest with a clients array.");
  }

  const admittedClients = value.clients.filter(hasExplicitAdmission);
  const admittedEpisodes = admittedClients.flatMap((client) =>
    client.existing_history.episodes.filter(hasAdmissionDate));
  const linkedCanvases = admittedClients.flatMap((client) => client.allo_content?.canvases ?? []);
  const noteRows = [];
  let clientsWithNotes = 0;

  for (const client of admittedClients) {
    const clientRows = (client.allo_content?.canvases ?? []).flatMap((canvas) =>
      (canvas.note_candidates ?? []).flatMap((candidate) =>
        candidate?.target_field_key === "assessment_notes"
          && typeof candidate.proposed_value === "string"
          && candidate.proposed_value.trim()
          ? [{
            clientKey: opaqueClientKey(client),
            canvasKey: opaqueCanvasKey(canvas),
            text: normalizeText(candidate.proposed_value),
          }]
          : []));
    if (clientRows.length > 0) clientsWithNotes += 1;
    noteRows.push(...clientRows);
  }

  const uniqueNotes = deduplicateNotes(noteRows);
  const canvasesWithNotes = new Set(noteRows.map((row) => row.canvasKey)).size;
  const admittedClientsWithCanvases = admittedClients.filter(
    (client) => (client.allo_content?.canvases?.length ?? 0) > 0,
  ).length;
  const documentRecords = uniqueNotes.map(analyzeDocument);
  const passageAnalysis = analyzePassages(uniqueNotes);
  const wordCounts = documentRecords.map((record) => record.wordCount).sort((a, b) => a - b);
  const sentenceCounts = documentRecords.map((record) => record.sentenceCount).sort((a, b) => a - b);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceManifest,
    dataClass: "private_aggregate",
    cohortDefinition: "A client is included only when at least one historical episode has a non-empty admit_date.",
    taxonomyVersions: {
      noteStructure: NOTE_LAB_TAXONOMY_VERSION,
      fieldMapping: ASSESSMENT_LANGUAGE_TAXONOMY_VERSION,
    },
    cohort: {
      sourceClientCount: value.clients.length,
      admittedClientCount: admittedClients.length,
      admittedEpisodeCount: admittedEpisodes.length,
      admittedClientWithLinkedCanvasCount: admittedClientsWithCanvases,
      admittedClientWithAssessmentNotesCount: clientsWithNotes,
      linkedCanvasCount: linkedCanvases.length,
      linkedCanvasWithAssessmentNotesCount: canvasesWithNotes,
      assessmentNoteCandidateCount: noteRows.length,
      uniqueAssessmentNoteCount: uniqueNotes.length,
      duplicateAssessmentNoteCandidateCount: noteRows.length - uniqueNotes.length,
      candidateUniquenessRate: rate(uniqueNotes.length, noteRows.length),
      noteCoverageRate: rate(clientsWithNotes, admittedClients.length),
      linkedClientNoteCoverageRate: rate(clientsWithNotes, admittedClientsWithCanvases),
    },
    noteStructure: {
      wordCount: summarizeNumbers(wordCounts),
      sentenceCount: summarizeNumbers(sentenceCounts),
      lengthBand: distribution(documentRecords, (record) => record.lengthBand),
      format: distribution(documentRecords, (record) => record.format),
      labeledSectionCount: summarizeNumbers(
        documentRecords.map((record) => record.labeledSectionCount).sort((a, b) => a - b),
      ),
      sourceSection: passageAnalysis.sourceSection,
      notesWithBullets: metric(documentRecords, (record) => record.bulletCount > 0),
      notesWithDomainLabels: metric(documentRecords, (record) => record.labeledLineCount > 0),
      notesWithMultipleParagraphs: metric(documentRecords, (record) => record.paragraphCount > 1),
      notesWithSummaryAndInterviewSections: metric(
        documentRecords,
        (record) => record.sections.includes("summary") && record.sections.includes("interview"),
      ),
    },
    documentationSignals: Object.fromEntries(
      Object.keys(signalMatchers).map((signal) => [
        signal,
        metric(documentRecords, (record) => record.signals.includes(signal)),
      ]),
    ),
    documentationGaps: {
      missingSourceAttribution: inverseMetric(documentRecords, "sourceAttribution"),
      missingCurrentOrHistoricalContext: metric(
        documentRecords,
        (record) => !record.signals.includes("currentStatus")
          && !record.signals.includes("historicalContext"),
      ),
      missingRecencyFrequencyOrDuration: inverseMetric(documentRecords, "recencyFrequencyOrDuration"),
      missingUncertaintyHandling: inverseMetric(documentRecords, "uncertaintyHandling"),
      missingActionOrFollowUp: inverseMetric(documentRecords, "actionOrFollowUp"),
      missingFunctionalImpact: inverseMetric(documentRecords, "functionalImpact"),
      missingResponseOrOutcome: inverseMetric(documentRecords, "responseOrOutcome"),
    },
    fieldMapping: passageAnalysis.fieldMapping,
    topicDistribution: passageAnalysis.topicDistribution,
    limitations: [
      "This is a descriptive analysis of historically admitted clients, not a comparison of admitted and non-admitted referrals.",
      "No pattern in this profile may be interpreted as causing admission or as an admission, rejection, diagnosis, or risk rule.",
      "A non-admitted comparator with adjudicated outcomes is required before studying decision-associated differences.",
      "Historical canvas mappings are deterministic candidate mappings pending human review; unmapped text is retained only in the private source corpus.",
      "Only exact linked canvases are represented. Unresolved canvases and admitted clients without linked notes are not included in note-level rates.",
      "Aggregate absence of a writing signal identifies a documentation-review opportunity, not incorrect care or an assessor performance finding.",
    ],
    privacy: {
      containsClientIdentifiers: false,
      containsSourceRecordIdentifiers: false,
      containsNoteText: false,
      outputMode: "0600",
    },
  };
}

function analyzeDocument(note) {
  const text = note.text;
  const sections = splitLabeledNoteSections(text);
  const classification = classifyNoteText(text);
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const wordCount = countWords(text);
  return {
    wordCount,
    sentenceCount: countSentences(text),
    paragraphCount: text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean).length,
    bulletCount: lines.filter((line) => /^(?:[-*•]|\d+[.)])\s+/.test(line)).length,
    labeledLineCount: lines.filter((line) => /^[A-Za-z][A-Za-z /&-]{1,36}:\s*\S/.test(line)).length,
    labeledSectionCount: sections.length,
    sections: sections.map((section) => section.section),
    lengthBand: wordCount <= 45 ? "brief" : wordCount <= 110 ? "standard" : "extended",
    format: classification.format,
    signals: Object.entries(signalMatchers)
      .filter(([, matcher]) => matcher.test(text))
      .map(([signal]) => signal),
  };
}

function analyzePassages(notes) {
  const seenPassages = new Set();
  const passageRecords = [];
  const sectionRecords = [];
  let totalPassageCount = 0;
  let mappedPassageCount = 0;
  let unmappedPassageCount = 0;

  for (const note of notes) {
    for (const section of splitLabeledNoteSections(note.text)) {
      sectionRecords.push(section.section);
      for (const text of splitAssessmentNarrativePassages(section.text)) {
        totalPassageCount += 1;
        const mapping = classifyAssessmentNarrativeField(text);
        if (!mapping) {
          unmappedPassageCount += 1;
          continue;
        }
        mappedPassageCount += 1;
        const passageKey = sha256(`${mapping.targetField}\u0000${text}`);
        if (seenPassages.has(passageKey)) continue;
        seenPassages.add(passageKey);
        const classification = classifyNoteText(text, section.section);
        passageRecords.push({
          targetField: mapping.targetField,
          confidence: mapping.confidence,
          sourceSection: section.section,
          primaryTopic: classification.primaryTopic,
          signals: classification.signals,
        });
      }
    }
  }

  return {
    sourceSection: distribution(sectionRecords, (section) => section),
    fieldMapping: {
      totalPassageCount,
      mappedPassageCount,
      uniqueMappedPassageCount: passageRecords.length,
      duplicateMappedPassageCount: mappedPassageCount - passageRecords.length,
      unmappedPassageCount,
      mappingRate: rate(mappedPassageCount, totalPassageCount),
      targetField: distribution(passageRecords, (record) => record.targetField),
      confidence: distribution(passageRecords, (record) => record.confidence),
    },
    topicDistribution: distribution(passageRecords, (record) => record.primaryTopic),
  };
}

const signalMatchers = {
  sourceAttribution: /\b(?:per|according to|reported by|records? (?:indicate|state|show)|client\s+(?:states?|reports?|denies?|endorses?)|resident\s+(?:states?|reports?|denies?|endorses?)|case manager\s+(?:states?|reports?)|cm\s+(?:states?|reports?))\b/i,
  clientReported: /\b(?:client|resident|individual)\s+(?:states?|reports?|denies?|endorses?|describes?|recalls?)\b/i,
  collateralReported: /\b(?:cm|case manager|social worker|staff|family|collateral|referr(?:er|ing team))\s+(?:states?|reports?|notes?|indicates?|denies?)\b/i,
  recordReported: /\b(?:per|according to)\s+(?:the\s+)?(?:record|chart|packet|hospital|discharge summary|documentation)|\brecords? (?:indicate|state|show)\b/i,
  directObservation: /\b(?:observed|appeared|presented|during (?:the )?interview|on exam|speech (?:was|is)|affect (?:was|is))\b/i,
  currentStatus: /\b(?:current(?:ly)?|today|at present|during (?:the )?interview|now|presented)\b/i,
  historicalContext: /\b(?:history of|historical|previous(?:ly)?|past|prior|formerly|ago|before admission|before hospitalization)\b/i,
  recencyFrequencyOrDuration: /\b(?:daily|weekly|monthly|once|twice|frequen(?:cy|t)|duration|since|last|recent|\d+\s+(?:times?|days?|weeks?|months?|years?))\b/i,
  uncertaintyHandling: /\b(?:unknown|unclear|unverified|not (?:yet )?verified|pending|conflict(?:ing)?|unable to confirm|unable to verify|does not recall|doesn't remember|reportedly|presumably|not provided)\b/i,
  negationOrDenial: /\b(?:denies?|no known|none reported|not reported|without|negative for|does not|did not)\b/i,
  actionOrFollowUp: /\b(?:follow[- ]?up|verify|confirm|obtain|request|coordinate|monitor|review with|pending|recommend|schedule|next step|plan)\w*\b/i,
  functionalImpact: /\b(?:adl|activities of daily living|function|independent|assist(?:ance)?|cueing|prompting|ambulatory|mobility|sleep|housing|roommate|self[- ]care|participat)\w*\b/i,
  responseOrOutcome: /\b(?:response|responded|effective|improved|resolved|outcome|support|de[- ]?escalat|redirect|coping|helped|less frequent)\w*\b/i,
  medicationDoseOrRoute: /\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml)\b|\b(?:po|im|iv|oral|injection)\b/i,
  possibleProblematicWording: /\b(?:crazy|manipulative|attention[- ]seeking|difficult patient|drug[- ]seeking|noncompliant|poor historian|good historian|frequent flyer)\b/i,
};

function hasExplicitAdmission(client) {
  return Array.isArray(client?.existing_history?.episodes)
    && client.existing_history.episodes.some(hasAdmissionDate);
}

function hasAdmissionDate(episode) {
  return typeof episode?.admit_date === "string" && episode.admit_date.trim().length > 0;
}

function opaqueClientKey(client) {
  return sha256(String(client?.canonical_client_id ?? JSON.stringify(client?.identities ?? [])));
}

function opaqueCanvasKey(canvas) {
  return sha256(String(canvas?.source_canvas_id ?? canvas?.source_sha256 ?? "unknown-canvas"));
}

function deduplicateNotes(rows) {
  const notes = new Map();
  for (const row of rows) {
    const key = sha256(row.text);
    const note = notes.get(key) ?? {
      text: row.text,
      occurrenceCount: 0,
      clientKeys: new Set(),
      canvasKeys: new Set(),
    };
    note.occurrenceCount += 1;
    note.clientKeys.add(row.clientKey);
    note.canvasKeys.add(row.canvasKey);
    notes.set(key, note);
  }
  return [...notes.values()];
}

function normalizeText(value) {
  return value.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
}

function countWords(value) {
  return value.split(/\s+/).filter(Boolean).length;
}

function countSentences(value) {
  const normalized = value.replace(/\n+/g, " ").trim();
  if (!normalized) return 0;
  return normalized.split(/(?<=[.!?])\s+(?=[A-Z[])/).filter(Boolean).length;
}

function metric(records, predicate) {
  const count = records.filter(predicate).length;
  return { count, rate: rate(count, records.length) };
}

function inverseMetric(records, signal) {
  return metric(records, (record) => !record.signals.includes(signal));
}

function distribution(records, select) {
  const counts = new Map();
  for (const record of records) {
    const key = select(record);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort((left, right) => right[1] - left[1]
    || String(left[0]).localeCompare(String(right[0]), "en")));
}

function summarizeNumbers(values) {
  if (values.length === 0) return { minimum: 0, p25: 0, median: 0, p75: 0, maximum: 0, mean: 0 };
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    minimum: values[0],
    p25: percentile(values, 0.25),
    median: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    maximum: values.at(-1),
    mean: Number((sum / values.length).toFixed(2)),
  };
}

function percentile(values, fraction) {
  const index = (values.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return values[lower];
  return Number((values[lower] + (values[upper] - values[lower]) * (index - lower)).toFixed(2));
}

function rate(numerator, denominator) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

async function resolveManifestPath() {
  const explicit = argumentValue("--manifest")
    ?? process.env.PIPELINE_NOTE_LAB_ADMITTED_MANIFEST_PATH?.trim()
    ?? process.env.PIPELINE_NOTE_LAB_MANIFEST_PATH?.trim();
  if (explicit) return path.resolve(explicit);
  for (const environmentFile of [".env.development.local", ".env.local"]) {
    const contents = await readFile(path.resolve(environmentFile), "utf8").catch(() => null);
    if (!contents) continue;
    for (const name of ["PIPELINE_NOTE_LAB_ADMITTED_MANIFEST_PATH", "PIPELINE_NOTE_LAB_MANIFEST_PATH"]) {
      const configured = contents.split(/\r?\n/).find((line) => line.startsWith(`${name}=`));
      const candidate = configured?.slice(configured.indexOf("=") + 1).trim()
        .replace(/^(['"])(.*)\1$/, "$2");
      if (candidate) return path.resolve(candidate);
    }
  }
  throw new Error(
    "Provide --manifest=/absolute/path or configure PIPELINE_NOTE_LAB_ADMITTED_MANIFEST_PATH.",
  );
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

const manifestPath = await resolveManifestPath();
const outputPath = path.resolve(
  argumentValue("--output") ?? ".data/private-admitted-note-structure-profile.json",
);
const source = JSON.parse(await readFile(manifestPath, "utf8"));
const profile = buildProfile(source, path.basename(manifestPath));

await writePrivateJson(outputPath, profile);
console.log(JSON.stringify({
  ok: true,
  manifest: manifestPath,
  output: outputPath,
  cohort: profile.cohort,
  noteStructure: profile.noteStructure,
  documentationSignals: profile.documentationSignals,
  fieldMapping: profile.fieldMapping,
}, null, 2));
