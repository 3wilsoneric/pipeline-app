#!/usr/bin/env node

import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadManifest, manifestBytes, sha256 } from "./allo-canvas-content-common.mjs";
import { parseCsv } from "./allo-canvas-record-linking.mjs";

const args = argumentMap();
const manifestPath = absoluteArgument("--manifest");
const historyPath = absoluteArgument("--history");
const crosswalkPath = absoluteArgument("--identity-crosswalk");
const outputPath = absoluteArgument("--output");
const unresolvedPath = absoluteArgument("--unresolved");
const summaryPath = optionalAbsoluteArgument("--summary");

const [manifest, history, crosswalkSource] = await Promise.all([
  loadManifest(manifestPath, { requireBlob: false }),
  readJson(historyPath, "client_history_invalid"),
  readFile(crosswalkPath, "utf8"),
]);
if (!Array.isArray(history?.episodes)) fail("client_history_invalid");
const crosswalkRows = parseCsv(crosswalkSource);

const episodesByResident = groupBy(history.episodes, (episode) => normalizedValue(episode.resident_number));
const identitiesByCanonical = new Map();
const canonicalByResident = new Map();
for (const row of crosswalkRows) {
  const canonicalClientId = normalizedValue(row.canonical_client_id);
  const residentNumber = normalizedValue(row.resident_number);
  if (!canonicalClientId || !residentNumber) continue;
  const existingCanonical = canonicalByResident.get(residentNumber);
  if (existingCanonical && existingCanonical !== canonicalClientId) fail("crosswalk_identity_conflict");
  canonicalByResident.set(residentNumber, canonicalClientId);
  const identities = identitiesByCanonical.get(canonicalClientId) ?? [];
  identities.push({
    resident_number: residentNumber,
    resident_name: normalizedValue(row.resident_name),
    date_of_birth: normalizedValue(row.date_of_birth),
    canonical_resident_name: normalizedValue(row.canonical_resident_name),
    identity_rule: normalizedValue(row.identity_rule),
    identity_review_status: normalizedValue(row.identity_review_status),
  });
  identitiesByCanonical.set(canonicalClientId, identities);
}

const snapshotsByCanonical = new Map();
const unresolved = [];
for (const snapshot of manifest.snapshots) {
  if (snapshot.canonical_link_status === "confirmed" && snapshot.canonical_client_id) {
    const snapshots = snapshotsByCanonical.get(snapshot.canonical_client_id) ?? [];
    snapshots.push(snapshot);
    snapshotsByCanonical.set(snapshot.canonical_client_id, snapshots);
  } else {
    unresolved.push(unresolvedCanvas(snapshot));
  }
}

const canonicalIds = new Set([...identitiesByCanonical.keys(), ...snapshotsByCanonical.keys()]);
const clients = [...canonicalIds].map((canonicalClientId) => {
  const identities = deduplicateIdentities(identitiesByCanonical.get(canonicalClientId) ?? []);
  const residentNumbers = new Set(identities.map((identity) => identity.resident_number));
  const episodes = [...residentNumbers].flatMap((residentNumber) => episodesByResident.get(residentNumber) ?? [])
    .sort(compareEpisodes);
  const canvases = (snapshotsByCanonical.get(canonicalClientId) ?? []).map(combinedCanvas).sort(compareCanvases);
  const primaryIdentity = primaryIdentityFor(identities);
  return {
    canonical_client_id: canonicalClientId,
    resident_name: primaryIdentity?.canonical_resident_name ?? primaryIdentity?.resident_name ?? null,
    date_of_birth: primaryIdentity?.date_of_birth ?? null,
    resident_numbers: [...residentNumbers].sort(),
    identities,
    existing_history: {
      episode_count: episodes.length,
      episodes,
    },
    allo_content: {
      canvas_count: canvases.length,
      note_candidate_count: canvases.reduce((sum, canvas) => sum + canvas.note_candidates.length, 0),
      canvases,
    },
  };
}).sort((left, right) => (left.resident_name ?? "").localeCompare(right.resident_name ?? "", "en")
  || left.canonical_client_id.localeCompare(right.canonical_client_id, "en"));

const clientIds = new Set(clients.map((client) => client.canonical_client_id));
for (const canonicalClientId of snapshotsByCanonical.keys()) {
  if (!clientIds.has(canonicalClientId)) fail("canonical_client_missing_from_output");
}
const matchedCanvasCount = clients.reduce((sum, client) => sum + client.allo_content.canvas_count, 0);
const noteCandidateCount = clients.reduce((sum, client) => sum + client.allo_content.note_candidate_count, 0);
if (matchedCanvasCount + unresolved.length !== manifest.canvas_count) fail("combined_canvas_count_mismatch");

const combined = {
  version: 1,
  data_class: "user_supplied_real",
  purpose: "client_history_with_allo_canvas_content",
  created_at: new Date().toISOString(),
  sources: {
    canvas_manifest: { path: manifestPath, sha256: sha256(await readFile(manifestPath)) },
    client_history: { path: historyPath, sha256: sha256(await readFile(historyPath)) },
    identity_crosswalk: { path: crosswalkPath, sha256: sha256(Buffer.from(crosswalkSource, "utf8")) },
  },
  counts: {
    client_count: clients.length,
    client_with_canvas_count: clients.filter((client) => client.allo_content.canvas_count > 0).length,
    matched_canvas_count: matchedCanvasCount,
    unresolved_canvas_count: unresolved.length,
    note_candidate_count: noteCandidateCount,
    existing_episode_count: history.episodes.length,
  },
  safety: {
    identity_rule: "exact_name_dob_only",
    note_state: "pending_human_review",
    source_snapshots_immutable: true,
    automatic_assessment_mutation: false,
  },
  clients,
};
const unresolvedEnvelope = {
  version: 1,
  data_class: "user_supplied_real",
  purpose: "canvas_identity_review_queue",
  created_at: combined.created_at,
  source_manifest_sha256: combined.sources.canvas_manifest.sha256,
  unresolved_canvas_count: unresolved.length,
  canvases: unresolved.sort((left, right) => left.source_canvas_name.localeCompare(right.source_canvas_name, "en")),
};

await writePrivateJson(outputPath, combined);
await writePrivateJson(unresolvedPath, unresolvedEnvelope);
if (summaryPath) await writePrivateText(summaryPath, summaryCsv(clients));

console.log(JSON.stringify({
  ok: true,
  ...combined.counts,
  output_path: outputPath,
  unresolved_path: unresolvedPath,
  summary_path: summaryPath,
}));

function combinedCanvas(snapshot) {
  return {
    source_canvas_id: snapshot.source_canvas_id,
    source_canvas_name: snapshot.source_canvas_name,
    source_project_id: snapshot.source_project_id,
    source_project_name: snapshot.source_project_name,
    source_locator: snapshot.source_locator,
    captured_at: snapshot.captured_at,
    source_sha256: snapshot.source_sha256,
    record_link_status: snapshot.record_link_status,
    canonical_match_method: snapshot.canonical_match_method,
    note_candidates: snapshot.candidates.map((candidate) => ({
      target_field_key: candidate.target_field_key,
      proposed_value: candidate.proposed_value,
      mapping_confidence: candidate.mapping_confidence,
      review_status: candidate.review_status,
      source_block_ids: candidate.source_block_ids,
    })),
    source_content: {
      block_count: snapshot.block_count,
      blocks: snapshot.blocks,
    },
  };
}

function unresolvedCanvas(snapshot) {
  return {
    source_canvas_id: snapshot.source_canvas_id,
    source_canvas_name: snapshot.source_canvas_name,
    source_project_id: snapshot.source_project_id,
    source_project_name: snapshot.source_project_name,
    source_locator: snapshot.source_locator,
    captured_at: snapshot.captured_at,
    source_sha256: snapshot.source_sha256,
    record_link_status: snapshot.record_link_status ?? "not_evaluated",
    canonical_link_status: snapshot.canonical_link_status ?? "not_evaluated",
    note_candidate_count: snapshot.candidates.length,
    block_count: snapshot.block_count,
  };
}

function deduplicateIdentities(identities) {
  const seen = new Set();
  return identities.filter((identity) => {
    const key = [identity.resident_number, identity.resident_name, identity.date_of_birth].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => left.resident_number.localeCompare(right.resident_number, "en"));
}

function primaryIdentityFor(identities) {
  return identities.find((identity) => identity.identity_review_status?.toLocaleLowerCase("en-US") === "confirmed")
    ?? identities[0]
    ?? null;
}

function compareEpisodes(left, right) {
  return String(left.admit_date ?? "").localeCompare(String(right.admit_date ?? ""), "en")
    || String(left.resident_number ?? "").localeCompare(String(right.resident_number ?? ""), "en");
}

function compareCanvases(left, right) {
  return String(left.captured_at ?? "").localeCompare(String(right.captured_at ?? ""), "en")
    || left.source_canvas_id.localeCompare(right.source_canvas_id, "en");
}

function summaryCsv(clientRows) {
  const headers = [
    "canonical_client_id", "resident_name", "date_of_birth", "resident_numbers", "episode_count",
    "canvas_count", "note_candidate_count", "latest_canvas_at",
  ];
  const rows = clientRows.map((client) => [
    client.canonical_client_id,
    client.resident_name,
    client.date_of_birth,
    client.resident_numbers.join("|"),
    client.existing_history.episode_count,
    client.allo_content.canvas_count,
    client.allo_content.note_candidate_count,
    client.allo_content.canvases.at(-1)?.captured_at ?? null,
  ]);
  return `${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function groupBy(values, keyFor) {
  const grouped = new Map();
  for (const value of values) {
    const key = keyFor(value);
    if (!key) continue;
    const group = grouped.get(key) ?? [];
    group.push(value);
    grouped.set(key, group);
  }
  return grouped;
}

async function readJson(filePath, errorCode) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    fail(errorCode);
  }
}

async function writePrivateJson(filePath, value) {
  await writeFile(filePath, manifestBytes(value), { mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function writePrivateText(filePath, value) {
  await writeFile(filePath, value, { mode: 0o600 });
  await chmod(filePath, 0o600);
}

function normalizedValue(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function argumentMap() {
  return new Map(process.argv.slice(2).map((argument) => {
    const [key, ...rest] = argument.split("=");
    return [key, rest.join("=")];
  }));
}

function absoluteArgument(name) {
  const value = args.get(name);
  if (!value) fail(`${name} is required.`);
  return path.resolve(value);
}

function optionalAbsoluteArgument(name) {
  const value = args.get(name);
  return value ? path.resolve(value) : null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
