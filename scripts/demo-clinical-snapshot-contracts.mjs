#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const root = process.cwd();
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "pipeline-demo-clinical-"));
const outputPath = path.join(temporaryDirectory, "snapshot.json");
const results = [];

try {
  execFileSync(process.execPath, [
    "scripts/import-demo-clinical-roster.mjs",
    "--roster",
    "scripts/fixtures/demo-clinical-roster.sanitized.csv",
    "--reconciliation",
    "scripts/fixtures/demo-clinical-reconciliation.sanitized.csv",
    "--output",
    outputPath,
  ], { cwd: root, stdio: "pipe" });

  await run("importer writes a private reconciled snapshot", () => {
    const snapshot = JSON.parse(readFileSync(outputPath, "utf8"));
    assert(snapshot.qa.reconciled === true, "Expected reconciled QA state");
    assert(snapshot.qa.roster_count === 3, "Expected three sanitized residents");
    assert(snapshot.qa.community_count === 2, "Expected two sanitized communities");
    assert(snapshot.residents.every((resident) => resident.date_of_birth), "Expected DOB preservation");
    if (process.platform !== "win32") {
      assert((statSync(outputPath).mode & 0o777) === 0o600, "Snapshot must be owner-readable and owner-writable only");
    }
  });

  await run("default response bound accepts snapshots larger than 64 KB", () => {
    const snapshot = JSON.parse(readFileSync(outputPath, "utf8"));
    snapshot.contract_test_padding = "x".repeat(70_000);
    writeFileSync(outputPath, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(outputPath, 0o600);
    assert(statSync(outputPath).size > 65_536, "Expected a snapshot larger than the minimum response bound");
  });

  const adapter = loadDemoAdapter(outputPath);
  await run("demo readiness is explicit and connected only in local runtime", () => {
    const readiness = adapter.getClinicalDataReadiness();
    assert(readiness.mode === "demo_snapshot", "Expected explicit demo mode");
    assert(readiness.connected === true && readiness.ready === true, "Expected readable local snapshot");
    assert(readiness.warning.includes("does not refresh automatically"), "Expected one-time snapshot warning");
    const serialized = JSON.stringify(readiness);
    assert(!serialized.includes(outputPath), "Readiness must not expose the private snapshot path");
  });

  await run("demo census reconciles to the governed roster", async () => {
    const census = await adapter.getClinicalCensus();
    assert(census.roster_count === 3, "Expected portfolio roster count");
    assert(census.portfolio_census_total === 3, "Expected portfolio census total");
    assert(census.reconciliation_status === "matched" && census.delta === 0, "Expected matched census");
    assert(census.communities.every((community) => community.reconciliation_status === "matched"), "Expected community reconciliation");
  });

  await run("demo roster search and snapshot-bound pagination are deterministic", async () => {
    const first = await adapter.getClinicalRoster(undefined, { limit: 2 });
    assert(first.total === 3 && first.residents.length === 2, "Expected bounded first page");
    assert(first.next_cursor, "Expected a second-page cursor");
    const second = await adapter.getClinicalRoster(undefined, { limit: 2, cursor: first.next_cursor });
    assert(second.residents.length === 1 && second.next_cursor === null, "Expected final page");
    const search = await adapter.getClinicalRoster(undefined, { query: "sanitized wallace", limit: 50 });
    assert(search.total === 1 && search.residents[0].community_id === "343", "Expected deterministic token search");
    await assertRejects(
      () => adapter.getClinicalRoster(undefined, { query: "changed", limit: 2, cursor: first.next_cursor }),
      (error) => assert(error.status === 400 && error.code === "clinical_cursor_invalid", "Expected query-bound cursor"),
      "Expected changed-query pagination rejection",
    );
  });

  await run("demo resident lookup requires a community-qualified key when ambiguous", async () => {
    const resident = await adapter.getClinicalResident(undefined, "337:R-100");
    assert(resident.resident.date_of_birth === "1985-04-12", "Expected governed DOB");
    await assertRejects(
      () => adapter.getClinicalResident(undefined, "R-100"),
      (error) => {
        assert(error.status === 409 && error.code === "resident_identifier_ambiguous", "Expected ambiguity response");
        assert(error.details.matching_resident_keys.length === 2, "Expected bounded matching keys");
      },
      "Expected ambiguous bare identifier rejection",
    );
  });

  await run("demo health is degraded and medication detail fails closed", async () => {
    const health = await adapter.getClinicalHealth();
    assert(health.status === "degraded" && health.ready === false, "Expected explicit degraded health");
    assert(health.checks.roster_ready === true, "Expected roster readiness");
    assert(health.checks.medication_summary_ready === false, "Expected missing medication summary");
    await assertRejects(
      () => adapter.getClinicalMedicationSummary(),
      (error) => assert(error.status === 503 && error.code === "clinical_medication_summary_unavailable", "Expected fail-closed medication summary"),
      "Expected unavailable medication summary",
    );
  });

  await run("production rejects the local snapshot mode", () => {
    const production = loadDemoAdapter(outputPath, { NODE_ENV: "production" });
    const readiness = production.getClinicalDataReadiness();
    assert(readiness.connected === false && readiness.ready === false, "Production must reject demo mode");
    assert(readiness.missing_env.includes("PIPELINE_CLINICAL_DATA_MODE=alamo_api"), "Expected live API requirement");
  });
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks: results }, null, 2));
if (failed.length > 0) process.exit(1);

function loadDemoAdapter(snapshotPath, environment = {}) {
  return loadTypeScriptModule(root, "lib/clinical/clinical-data.ts", {
    process: {
      cwd: () => root,
      env: {
        NODE_ENV: "development",
        PIPELINE_CLINICAL_DATA_MODE: "demo_snapshot",
        PIPELINE_CLINICAL_DEMO_SNAPSHOT_PATH: snapshotPath,
        ...environment,
      },
    },
    URL,
    URLSearchParams,
    AbortController,
    DOMException,
    TextDecoder,
    TextEncoder,
    setTimeout,
    clearTimeout,
    crypto,
    fetch: async () => {
      throw new Error("Demo snapshot mode must not call the network");
    },
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

async function assertRejects(operation, check, message) {
  try {
    await operation();
  } catch (error) {
    check(error);
    return;
  }
  throw new Error(message);
}
