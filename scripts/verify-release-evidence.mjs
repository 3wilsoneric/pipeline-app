#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const directory = parseArgs(process.argv.slice(2));
const evidence = JSON.parse(await readFile(path.join(directory, "SHA256SUMS.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(directory, "release-manifest.json"), "utf8"));
const sbom = JSON.parse(await readFile(path.join(directory, "pipeline.cdx.json"), "utf8"));
const hashesMatch = (await Promise.all(Object.entries(evidence.files ?? {}).map(async ([file, expected]) => {
  const actual = createHash("sha256").update(await readFile(path.join(directory, file))).digest("hex");
  return actual === expected;
}))).every(Boolean);
const checks = [
  { name: "all release evidence hashes match", ok: hashesMatch },
  { name: "release manifest uses the supported schema", ok: manifest.schema_version === 2 },
  { name: "release manifest identifies a source revision", ok: /^[a-f0-9]{40}$/.test(manifest.source_revision) },
  { name: "release manifest fingerprints the complete candidate source state", ok: validSourceState(manifest) },
  { name: "release dirty state agrees with candidate file counts", ok: manifest.source_dirty === sourceStateIsDirty(manifest.source_state) },
  { name: "release manifest binds the lockfile and migrations", ok: /^[a-f0-9]{64}$/.test(manifest.package_lock_sha256) && /^[a-f0-9]{64}$/.test(manifest.migration_manifest_sha256) },
  { name: "release manifest binds security, authorization, and alert contracts", ok: [manifest.security_workflow_sha256, manifest.route_policy_sha256, manifest.operational_alerts_sha256].every((value) => /^[a-f0-9]{64}$/.test(value)) },
  { name: "SBOM is CycloneDX 1.5", ok: sbom.bomFormat === "CycloneDX" && sbom.specVersion === "1.5" },
  { name: "SBOM omits nondeterministic timestamp and serial metadata", ok: !sbom.serialNumber && !sbom.metadata?.timestamp },
  { name: "evidence timestamps derive from reproducible source metadata", ok: evidence.created_at === manifest.created_at && !Number.isNaN(Date.parse(evidence.created_at)) },
  { name: "clean releases can be enforced", ok: process.env.PIPELINE_REQUIRE_CLEAN_RELEASE !== "true" || manifest.source_dirty === false },
];
console.log(JSON.stringify({ ok: checks.every((item) => item.ok), checks, source_dirty: manifest.source_dirty }, null, 2));
if (checks.some((item) => !item.ok)) process.exit(1);

function validSourceState(manifest) {
  const state = manifest.source_state;
  if (!state || state.algorithm !== "sha256") return false;
  if (state.scope !== "tracked binary diff from HEAD plus non-ignored untracked files") return false;
  if (![state.tracked_diff_sha256, state.untracked_source_sha256, state.candidate_sha256].every((value) => /^[a-f0-9]{64}$/.test(value))) return false;
  if (![state.tracked_file_count, state.untracked_file_count].every((value) => Number.isSafeInteger(value) && value >= 0)) return false;
  return state.candidate_sha256 === candidateDigest(manifest.source_revision, state);
}

function sourceStateIsDirty(state) {
  return Boolean(state && (state.tracked_file_count > 0 || state.untracked_file_count > 0));
}

function candidateDigest(revision, state) {
  return createHash("sha256").update([
    "pipeline-source-state-v1",
    revision,
    state.tracked_diff_sha256,
    state.untracked_source_sha256,
    String(state.tracked_file_count),
    String(state.untracked_file_count),
  ].join("\0")).digest("hex");
}

function parseArgs(args) {
  const index = args.indexOf("--dir");
  const value = index >= 0 ? args[index + 1] : null;
  if (!value || args.length !== 2) throw new Error("Usage: verify-release-evidence.mjs --dir <directory>");
  return value;
}
