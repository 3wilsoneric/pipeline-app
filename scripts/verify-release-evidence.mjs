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
  { name: "release manifest uses the supported schema", ok: manifest.schema_version === 1 },
  { name: "release manifest identifies a source revision", ok: /^[a-f0-9]{40}$/.test(manifest.source_revision) },
  { name: "release manifest binds the lockfile and migrations", ok: /^[a-f0-9]{64}$/.test(manifest.package_lock_sha256) && /^[a-f0-9]{64}$/.test(manifest.migration_manifest_sha256) },
  { name: "release manifest binds security, authorization, and alert contracts", ok: [manifest.security_workflow_sha256, manifest.route_policy_sha256, manifest.operational_alerts_sha256].every((value) => /^[a-f0-9]{64}$/.test(value)) },
  { name: "SBOM is CycloneDX 1.5", ok: sbom.bomFormat === "CycloneDX" && sbom.specVersion === "1.5" },
  { name: "SBOM omits nondeterministic timestamp and serial metadata", ok: !sbom.serialNumber && !sbom.metadata?.timestamp },
  { name: "evidence timestamps derive from reproducible source metadata", ok: evidence.created_at === manifest.created_at && !Number.isNaN(Date.parse(evidence.created_at)) },
  { name: "clean releases can be enforced", ok: process.env.PIPELINE_REQUIRE_CLEAN_RELEASE !== "true" || manifest.source_dirty === false },
];
console.log(JSON.stringify({ ok: checks.every((item) => item.ok), checks, source_dirty: manifest.source_dirty }, null, 2));
if (checks.some((item) => !item.ok)) process.exit(1);

function parseArgs(args) {
  const index = args.indexOf("--dir");
  const value = index >= 0 ? args[index + 1] : null;
  if (!value || args.length !== 2) throw new Error("Usage: verify-release-evidence.mjs --dir <directory>");
  return value;
}
