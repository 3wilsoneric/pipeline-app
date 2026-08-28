#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const options = parseArgs(process.argv.slice(2));
const expected = await loadCorpus(options.expected);
const actual = await loadCorpus(options.actual);
const actualById = new Map(actual.documents.map((document) => [document.fixture_id, document]));
const totals = emptyTotals();
const strata = new Map();

for (const expectedDocument of expected.documents) {
  const actualDocument = actualById.get(expectedDocument.fixture_id);
  const expectedFieldKeys = new Set(Object.keys(expectedDocument.fields));
  const stratumKeys = documentStrata(expectedDocument);
  for (const actualFieldKey of Object.keys(actualDocument?.fields ?? {})) {
    totals.actual_fields += 1;
    if (expectedFieldKeys.has(actualFieldKey)) totals.known_actual_fields += 1;
  }

  for (const [fieldKey, expectedField] of Object.entries(expectedDocument.fields)) {
    addExpected(totals, expectedField);
    for (const key of stratumKeys) addExpected(stratum(strata, key), expectedField);
    const actualField = actualDocument?.fields?.[fieldKey];
    if (!actualField) continue;
    const exact = equivalent(expectedField.value, actualField.value);
    const pageMatch = Number.isInteger(expectedField.page) && expectedField.page === actualField.page;
    const bboxExpected = validBox(expectedField.evidence_bbox);
    const bboxMatch = bboxExpected && validBox(actualField.evidence_bbox)
      && intersectionOverUnion(expectedField.evidence_bbox, actualField.evidence_bbox) >= options.minimumBboxIou;
    addActual(totals, expectedField, actualField, { exact, pageMatch, bboxMatch }, options);
    for (const key of stratumKeys) {
      addActual(stratum(strata, key), expectedField, actualField, { exact, pageMatch, bboxMatch }, options);
    }
  }
  totals.correction_events += Array.isArray(actualDocument?.correction_history)
    ? actualDocument.correction_history.length
    : 0;
}

const metrics = metricsFor(totals);
const confidenceIntervals = {
  exact_match_rate: wilson(totals.exact_matches, totals.expected_fields),
  required_field_recall: wilson(totals.required_present, totals.required_fields),
  field_value_precision: wilson(totals.exact_matches, totals.extracted_fields),
  evidence_page_accuracy: wilson(totals.evidence_page_matches, totals.evidence_expected),
  evidence_bbox_accuracy: wilson(totals.evidence_bbox_matches, totals.evidence_bbox_expected),
};
const qualityScore = round(
  metrics.required_field_recall * 0.3
  + metrics.exact_match_rate * 0.3
  + metrics.field_value_precision * 0.15
  + metrics.evidence_page_accuracy * 0.15
  + metrics.evidence_bbox_accuracy * 0.1,
);
const confidenceGatePassed = options.minimumConfidenceLower === null
  || confidenceIntervals.exact_match_rate.lower >= options.minimumConfidenceLower;
const passed = qualityScore >= options.minimum
  && metrics.required_field_recall === 1
  && metrics.evidence_page_accuracy >= options.minimumEvidence
  && metrics.evidence_bbox_accuracy >= options.minimumBbox
  && confidenceGatePassed;

console.log(JSON.stringify({
  ok: passed,
  quality_score: qualityScore,
  thresholds: {
    minimum_quality_score: options.minimum,
    minimum_evidence_page_accuracy: options.minimumEvidence,
    minimum_evidence_bbox_accuracy: options.minimumBbox,
    minimum_bbox_iou: options.minimumBboxIou,
    minimum_exact_match_confidence_lower: options.minimumConfidenceLower,
    low_confidence_below: options.lowConfidence,
  },
  metrics,
  confidence_intervals_95: confidenceIntervals,
  strata: Object.fromEntries([...strata.entries()].map(([key, value]) => [key, {
    metrics: metricsFor(value),
    exact_match_confidence_95: wilson(value.exact_matches, value.expected_fields),
  }])),
  totals,
  fixtures: expected.documents.length,
  corpus_schema_version: expected.schema_version,
  note: "Only aggregate quality measures and synthetic fixture identifiers are emitted; field values are never logged.",
}, null, 2));
if (!passed) process.exit(1);

function emptyTotals() {
  return {
    expected_fields: 0,
    actual_fields: 0,
    known_actual_fields: 0,
    extracted_fields: 0,
    exact_matches: 0,
    required_fields: 0,
    required_present: 0,
    evidence_expected: 0,
    evidence_page_matches: 0,
    evidence_bbox_expected: 0,
    evidence_bbox_matches: 0,
    reviewed_fields: 0,
    edited_fields: 0,
    low_confidence_fields: 0,
    correction_events: 0,
  };
}

function addExpected(totals, field) {
  totals.expected_fields += 1;
  if (field.required) totals.required_fields += 1;
  if (Number.isInteger(field.page)) totals.evidence_expected += 1;
  if (validBox(field.evidence_bbox)) totals.evidence_bbox_expected += 1;
}

function addActual(totals, expected, actual, comparison, options) {
  totals.extracted_fields += 1;
  if (expected.required) totals.required_present += 1;
  if (comparison.exact) totals.exact_matches += 1;
  if (comparison.pageMatch) totals.evidence_page_matches += 1;
  if (comparison.bboxMatch) totals.evidence_bbox_matches += 1;
  if (["accepted", "edited"].includes(actual.review_status)) totals.reviewed_fields += 1;
  if (actual.review_status === "edited") totals.edited_fields += 1;
  if (Number(actual.confidence) < options.lowConfidence) totals.low_confidence_fields += 1;
}

function metricsFor(totals) {
  return {
    field_recall: ratio(totals.extracted_fields, totals.expected_fields),
    field_presence_precision: ratio(totals.known_actual_fields || totals.extracted_fields, totals.actual_fields || totals.extracted_fields),
    field_value_precision: ratio(totals.exact_matches, totals.extracted_fields),
    exact_match_rate: ratio(totals.exact_matches, totals.expected_fields),
    required_field_recall: ratio(totals.required_present, totals.required_fields),
    evidence_page_accuracy: ratio(totals.evidence_page_matches, totals.evidence_expected),
    evidence_bbox_accuracy: ratio(totals.evidence_bbox_matches, totals.evidence_bbox_expected),
    human_edit_rate: ratio(totals.edited_fields, totals.reviewed_fields),
    low_confidence_rate: ratio(totals.low_confidence_fields, totals.extracted_fields),
  };
}

function documentStrata(document) {
  const metadata = document.metadata ?? {};
  return [
    `tier:${metadata.labeling_tier ?? "unknown"}`,
    `document_type:${metadata.document_type ?? "unknown"}`,
    `scan_quality:${metadata.scan_quality ?? "unknown"}`,
    `handwriting:${metadata.handwriting === true ? "yes" : metadata.handwriting === false ? "no" : "unknown"}`,
  ];
}

function stratum(collection, key) {
  if (!collection.has(key)) collection.set(key, emptyTotals());
  return collection.get(key);
}

async function loadCorpus(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (![1, 2].includes(value?.schema_version) || !Array.isArray(value.documents)) {
    throw new Error("Extraction quality corpus is invalid.");
  }
  return value;
}

function equivalent(expectedValue, actualValue) {
  if (Array.isArray(expectedValue) || Array.isArray(actualValue)) {
    if (!Array.isArray(expectedValue) || !Array.isArray(actualValue)) return false;
    const left = expectedValue.map(normalize).sort();
    const right = actualValue.map(normalize).sort();
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return normalize(expectedValue) === normalize(actualValue);
}

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function validBox(value) {
  return Array.isArray(value) && value.length === 4
    && value.every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)
    && value[2] > value[0] && value[3] > value[1];
}

function intersectionOverUnion(left, right) {
  const width = Math.max(0, Math.min(left[2], right[2]) - Math.max(left[0], right[0]));
  const height = Math.max(0, Math.min(left[3], right[3]) - Math.max(left[1], right[1]));
  const intersection = width * height;
  const leftArea = (left[2] - left[0]) * (left[3] - left[1]);
  const rightArea = (right[2] - right[0]) * (right[3] - right[1]);
  return intersection / Math.max(Number.EPSILON, leftArea + rightArea - intersection);
}

function wilson(successes, trials, z = 1.96) {
  if (trials === 0) return { estimate: 1, lower: 0, upper: 1, successes, trials };
  const estimate = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (estimate + (z * z) / (2 * trials)) / denominator;
  const margin = (z / denominator) * Math.sqrt((estimate * (1 - estimate) / trials) + (z * z) / (4 * trials * trials));
  return { estimate: round(estimate), lower: round(Math.max(0, center - margin)), upper: round(Math.min(1, center + margin)), successes, trials };
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : round(numerator / denominator);
}

function round(value) {
  return Math.round(value * 10_000) / 10_000;
}

function parseArgs(args) {
  const result = {
    expected: "scripts/fixtures/extraction-quality/expected.json",
    actual: "scripts/fixtures/extraction-quality/actual.json",
    minimum: 0.9,
    minimumEvidence: 0.9,
    minimumBbox: 0.9,
    minimumBboxIou: 0.5,
    minimumConfidenceLower: null,
    lowConfidence: 0.75,
  };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    const next = () => {
      index += 1;
      if (!args[index]) throw new Error(`${value} requires a value.`);
      return args[index];
    };
    if (value === "--expected") result.expected = next();
    else if (value === "--actual") result.actual = next();
    else if (value === "--minimum") result.minimum = Number(next());
    else if (value === "--minimum-evidence") result.minimumEvidence = Number(next());
    else if (value === "--minimum-bbox") result.minimumBbox = Number(next());
    else if (value === "--minimum-bbox-iou") result.minimumBboxIou = Number(next());
    else if (value === "--minimum-confidence-lower") result.minimumConfidenceLower = Number(next());
    else if (value === "--low-confidence") result.lowConfidence = Number(next());
    else throw new Error(`Unknown option: ${value}`);
  }
  for (const threshold of [result.minimum, result.minimumEvidence, result.minimumBbox, result.minimumBboxIou, result.lowConfidence, result.minimumConfidenceLower]) {
    if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) {
      throw new Error("Quality thresholds must be between 0 and 1.");
    }
  }
  return result;
}
