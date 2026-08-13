#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const directory = parseArgs(process.argv.slice(2));
await mkdir(directory, { recursive: true, mode: 0o700 });
const manifestPath = path.join(directory, "release-manifest.json");
const sbomPath = path.join(directory, "pipeline.cdx.json");

execFileSync(process.execPath, ["scripts/create-release-manifest.mjs", "--out", manifestPath], { stdio: "ignore" });
execFileSync(process.execPath, ["scripts/generate-sbom.mjs", "--out", sbomPath], { stdio: "ignore" });

const files = ["release-manifest.json", "pipeline.cdx.json"];
const checksums = Object.fromEntries(await Promise.all(files.map(async (file) => [
  file,
  createHash("sha256").update(await readFile(path.join(directory, file))).digest("hex"),
])));
const evidence = {
  schema_version: 1,
  created_at: releaseTimestamp(),
  files: checksums,
};
await writeFile(path.join(directory, "SHA256SUMS.json"), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ok: true, directory, evidence_file_count: files.length + 1, checksums }, null, 2));

function parseArgs(args) {
  const index = args.indexOf("--out-dir");
  const value = index >= 0 ? args[index + 1] : null;
  if (!value || args.length !== 2) throw new Error("Usage: create-release-evidence.mjs --out-dir <directory>");
  return value;
}

function releaseTimestamp() {
  const sourceDateEpoch = process.env.SOURCE_DATE_EPOCH;
  if (sourceDateEpoch && /^\d+$/.test(sourceDateEpoch)) {
    return new Date(Number(sourceDateEpoch) * 1000).toISOString();
  }
  try {
    const committedAt = execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return new Date(committedAt).toISOString();
  } catch {
    return "1970-01-01T00:00:00.000Z";
  }
}
