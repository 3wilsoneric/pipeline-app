#!/usr/bin/env node

import { readFile } from "node:fs/promises";

const options = parseArgs(process.argv.slice(2));
const expected = await loadCorpus(options.expected);
const actual = await loadCorpus(options.actual);
const actualById = new Map(actual.documents.map((document) => [document.fixture_id, document]));
const totals = {
  expected_fields: 0,
  extracted_fields: 0,
  exact_matches: 0,
  required_fields: 0,
  required_present: 0,
  evidence_expected: 0,
  evidence_page_matches: 0,
  reviewed_fields: 0,
  edited_fields: 0,
  low_confidence_fields: 0,
  correction_events: 0,
};

for (const expectedDocument of expected.documents) {
  const actualDocument = actualById.get(expectedDocument.fixture_id);
  for (const [fieldKey, expectedField] of Object.entries(expectedDocument.fields)) {
    totals.expected_fields += 1;
    if (expectedField.required) totals.required_fields += 1;
    if (Number.isInteger(expectedField.page)) totals.evidence_expected += 1;
    const actualField = actualDocument?.fields?.[fieldKey];
    if (!actualField) continue;
    totals.extracted_fields += 1;
    if (expectedField.required) totals.required_present += 1;
    if (equivalent(expectedField.value, actualField.value)) totals.exact_matches += 1;
    if (expectedField.page === actualField.page) totals.evidence_page_matches += 1;
    if (["accepted", "edited"].includes(actualField.review_status)) totals.reviewed_fields += 1;
    if (actualField.review_status === "edited") totals.edited_fields += 1;
    if (Number(actualField.confidence) < options.lowConfidence) totals.low_confidence_fields += 1;
  }
  totals.correction_events += Array.isArray(actualDocument?.correction_history)
    ? actualDocument.correction_history.length
    : 0;
}

const metrics = {
  field_recall: ratio(totals.extracted_fields, totals.expected_fields),
  exact_match_rate: ratio(totals.exact_matches, totals.expected_fields),
  required_field_recall: ratio(totals.required_present, totals.required_fields),
  evidence_page_accuracy: ratio(totals.evidence_page_matches, totals.evidence_expected),
  human_edit_rate: ratio(totals.edited_fields, totals.reviewed_fields),
  low_confidence_rate: ratio(totals.low_confidence_fields, totals.extracted_fields),
};
const qualityScore = round(
  metrics.required_field_recall * 0.35
  + metrics.exact_match_rate * 0.35
  + metrics.evidence_page_accuracy * 0.2
  + metrics.field_recall * 0.1,
);
const passed = qualityScore >= options.minimum
  && metrics.required_field_recall === 1
  && metrics.evidence_page_accuracy >= options.minimumEvidence;

console.log(JSON.stringify({
  ok: passed,
  quality_score: qualityScore,
  thresholds: {
    minimum_quality_score: options.minimum,
    minimum_evidence_page_accuracy: options.minimumEvidence,
    low_confidence_below: options.lowConfidence,
  },
  metrics,
  totals,
  fixtures: expected.documents.length,
  note: "Only aggregate quality measures and fixture identifiers are emitted; field values are never logged.",
}, null, 2));
if (!passed) process.exit(1);

async function loadCorpus(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value?.schema_version !== 1 || !Array.isArray(value.documents)) throw new Error("Extraction quality corpus is invalid.");
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
    else if (value === "--low-confidence") result.lowConfidence = Number(next());
    else throw new Error(`Unknown option: ${value}`);
  }
  for (const threshold of [result.minimum, result.minimumEvidence, result.lowConfidence]) {
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("Quality thresholds must be between 0 and 1.");
  }
  return result;
}
