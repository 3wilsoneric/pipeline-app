#!/usr/bin/env node

import { readFileSync } from "node:fs";

const corpusPath = argument("--corpus") ?? process.env.PIPELINE_EXTRACTION_CORPUS_PATH;
if (!corpusPath) {
  console.log(JSON.stringify({
    ok: false,
    status: "blocked_human_labeling",
    required: { deep_packets: 25, total_packets: 175 },
    next_action: "Set PIPELINE_EXTRACTION_CORPUS_PATH to a governed schema-v2 expected corpus after labeling.",
  }, null, 2));
  process.exit(1);
}

const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
if (corpus?.schema_version !== 2 || !Array.isArray(corpus.documents)) {
  throw new Error("The governed extraction corpus must use schema_version 2.");
}
const deep = corpus.documents.filter((document) => document.metadata?.labeling_tier === "deep");
const wide = corpus.documents.filter((document) => ["deep", "wide"].includes(document.metadata?.labeling_tier));
const invalidDeep = deep.filter((document) => Object.values(document.fields ?? {}).some((field) =>
  !Number.isInteger(field.page) || !validBox(field.evidence_bbox)
    || typeof field.source_text !== "string" || !field.source_text.trim(),
));
const duplicateIds = corpus.documents.length - new Set(corpus.documents.map((document) => document.fixture_id)).size;
const strata = {
  handwritten: wide.filter((document) => document.metadata?.handwriting === true).length,
  low_quality: wide.filter((document) => document.metadata?.scan_quality === "low").length,
  mixed_layout: wide.filter((document) => document.metadata?.document_type === "mixed_packet").length,
};
const checks = [
  { name: "at least 25 packets have page, bounding-box, and source-text labels", ok: deep.length >= 25, actual: deep.length },
  { name: "at least 175 packets have value labels", ok: wide.length >= 175, actual: wide.length },
  { name: "every deep field has complete provenance", ok: invalidDeep.length === 0, actual: invalidDeep.length },
  { name: "fixture identifiers are unique", ok: duplicateIds === 0, actual: duplicateIds },
  { name: "handwriting is represented", ok: strata.handwritten >= 15, actual: strata.handwritten },
  { name: "low-quality scans are represented", ok: strata.low_quality >= 15, actual: strata.low_quality },
  { name: "mixed-layout packets are represented", ok: strata.mixed_layout >= 15, actual: strata.mixed_layout },
];
const ok = checks.every((check) => check.ok);
console.log(JSON.stringify({
  ok,
  status: ok ? "ready_for_accuracy_certification" : "blocked_human_labeling",
  packets: corpus.documents.length,
  deep_packets: deep.length,
  value_labeled_packets: wide.length,
  strata,
  checks,
  note: "The readiness output contains counts only. Keep the corpus itself in governed storage outside Git.",
}, null, 2));
if (!ok) process.exit(1);

function validBox(value) {
  return Array.isArray(value) && value.length === 4
    && value.every((coordinate) => Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1)
    && value[2] > value[0] && value[3] > value[1];
}

function argument(name) {
  const direct = process.argv.find((value) => value.startsWith(`${name}=`));
  return direct ? direct.slice(name.length + 1) : null;
}
