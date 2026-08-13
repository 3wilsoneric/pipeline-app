#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "pipeline-client-history-"));
const outputPath = path.join(temporaryDirectory, "history.json");
const archiveRoot = path.join(temporaryDirectory, "archive");
const auditPath = path.join(temporaryDirectory, "audit.jsonl");
const results = [];

try {
  execFileSync(process.execPath, [
    "scripts/import-master-client-history.mjs",
    "--input",
    "scripts/fixtures/master-client-history.sanitized.csv",
    "--output",
    outputPath,
    "--clinical-snapshot",
    path.join(temporaryDirectory, "missing-clinical.json"),
    "--archive-root",
    archiveRoot,
    "--audit",
    auditPath,
    "--confirm",
    "IMPORT-USER-SUPPLIED-REAL-CLIENT-HISTORY",
  ], { cwd: root, stdio: "pipe" });

  await run("importer preserves structured longitudinal episodes privately", () => {
    const snapshot = JSON.parse(readFileSync(outputPath, "utf8"));
    assert(snapshot.data_class === "user_supplied_real", "Expected explicit real-data classification");
    assert(snapshot.data_as_of === "2026-07-29", "Expected one derived history date");
    assert(snapshot.qa.episode_count === 3, "Expected three sanitized episodes");
    assert(snapshot.qa.unique_resident_count === 2, "Expected two unique residents");
    assert(snapshot.qa.current_episode_count === 2, "Expected two current episodes");
    assert(Array.isArray(snapshot.episodes[0].secondary_diagnoses), "Expected a structured diagnosis list");
    assert(Array.isArray(snapshot.episodes[0].substance_use), "Expected a structured substance list");
    if (process.platform !== "win32") {
      assert((statSync(outputPath).mode & 0o777) === 0o600, "History snapshot must be owner-only");
      assert((statSync(auditPath).mode & 0o777) === 0o600, "History audit must be owner-only");
    }
  });

  const adapter = loadHistoryAdapter(outputPath);
  await run("exact resident-number history strips private source identity fields", async () => {
    const history = await adapter.getClientHistoryForResident("SYN-HIST-100", "1985-04-12");
    assert(history.status === "available" && history.episode_count === 2, "Expected exact history lookup");
    assert(history.discharged_episode_count === 1, "Expected trajectory counts");
    const serialized = JSON.stringify(history);
    assert(!serialized.includes("resident_name"), "Profile history must not repeat source identity fields");
    assert(!serialized.includes("source_file"), "Profile history must not expose private source filenames");
  });

  await run("DOB conflict withholds history instead of silently joining", async () => {
    const history = await adapter.getClientHistoryForResident("SYN-HIST-100", "1999-01-01");
    assert(history.status === "identity_conflict", "Expected identity conflict");
    assert(history.episodes.length === 0, "Conflicting history must be withheld");
  });

  await run("missing history remains distinct from unavailable history", async () => {
    const missing = await adapter.getClientHistoryForResident("SYN-HIST-999", "1980-01-01");
    assert(missing.status === "not_found", "Expected explicit not-found state");
    const production = loadHistoryAdapter(outputPath, { NODE_ENV: "production" });
    const unavailable = await production.getClientHistoryForResident("SYN-HIST-100", "1985-04-12");
    assert(unavailable.status === "unavailable", "Production must reject local client history");
  });
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks: results }, null, 2));
if (failed.length > 0) process.exit(1);

function loadHistoryAdapter(snapshotPath, environment = {}) {
  return loadTypeScriptModule(root, "lib/pipeline/client-history-store.ts", {
    process: {
      cwd: () => root,
      env: {
        NODE_ENV: "development",
        PIPELINE_CLIENT_HISTORY_MODE: "local_snapshot",
        PIPELINE_CLIENT_HISTORY_SNAPSHOT_PATH: snapshotPath,
        ...environment,
      },
    },
    Intl,
  });
}

async function run(name, operation) {
  try {
    await operation();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
