#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import postgres from "postgres";

const configuredDatabaseUrl = process.env.PIPELINE_TEST_DATABASE_URL?.trim();
if (!configuredDatabaseUrl) fail("Configure PIPELINE_TEST_DATABASE_URL for a disposable PostgreSQL 16+ server.");

const workingTreeChanges = execFileSync("git", ["status", "--porcelain=v1"], { encoding: "utf8" }).trim();
if (workingTreeChanges) fail("Commit or remove working-tree changes before capturing workflow characterization evidence.");

const startedAt = new Date();
const capturedFromCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const testPath = "tests/e2e/operational/workflow-store-characterization.spec.ts";
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pipeline-workflow-characterization-"));
const databaseName = `pipeline_workflow_characterization_${process.pid}_${randomUUID().slice(0, 8).replaceAll("-", "")}`;
const testDatabaseUrl = databaseUrlFor(configuredDatabaseUrl, databaseName);
const adminUrl = databaseUrlFor(configuredDatabaseUrl, "postgres");
const adminSql = postgres(adminUrl, databaseOptions());
const results = [];
let postgresMajor = null;
let databaseCreated = false;
let failureMessage = "";

try {
  const versionRows = await adminSql`select current_setting('server_version_num') as version`;
  postgresMajor = Math.floor(Number(versionRows[0]?.version ?? 0) / 10_000);
  if (postgresMajor < 16) throw new Error(`PostgreSQL 16+ is required; found ${postgresMajor || "unknown"}.`);

  await adminSql.unsafe(`create database "${databaseName}"`);
  databaseCreated = true;

  requirePass(await runCommand("build", "npm", ["run", "build"]));
  requirePass(await runCommand("migrate", process.execPath, ["scripts/apply-database-migrations.mjs"], {
    PIPELINE_DATABASE_URL: testDatabaseUrl,
  }));

  const localPort = await availablePort();
  results.push(await runCharacterization("local_file", localPort, {
    PIPELINE_DATABASE_MODE: "disconnected",
    PIPELINE_DATABASE_URL: "",
    PIPELINE_TEST_DATABASE_URL: "",
    PIPELINE_REFERRAL_STORE_MODE: "local_file",
    PIPELINE_ASSESSMENT_STORE_MODE: "local_file",
    PIPELINE_RESIDENT_LINK_STORE_MODE: "local_file",
    PIPELINE_E2E_REFERRAL_STORE_PATH: path.join(tempRoot, "local", "referrals.json"),
    PIPELINE_E2E_ASSESSMENT_STORE_PATH: path.join(tempRoot, "local", "assessments.json"),
    PIPELINE_E2E_RESIDENT_LINK_STORE_PATH: path.join(tempRoot, "local", "resident-links.json"),
    PIPELINE_E2E_DOCUMENT_STORE_PATH: path.join(tempRoot, "local", "documents"),
    PIPELINE_E2E_DESKTOP_STATE_STORE_PATH: path.join(tempRoot, "local", "desktop-state.json"),
    PIPELINE_E2E_NOTE_LAB_STORE_PATH: path.join(tempRoot, "local", "note-lab.json"),
  }));

  const postgresPort = await availablePort();
  results.push(await runCharacterization("postgres", postgresPort, {
    PIPELINE_DATABASE_MODE: "postgres",
    PIPELINE_DATABASE_URL: testDatabaseUrl,
    PIPELINE_TEST_DATABASE_URL: testDatabaseUrl,
    PIPELINE_ALLOW_TEST_DATABASE_REUSE: "true",
    PIPELINE_REFERRAL_STORE_MODE: "postgres",
    PIPELINE_ASSESSMENT_STORE_MODE: "postgres",
    PIPELINE_RESIDENT_LINK_STORE_MODE: "postgres",
  }));
} catch (error) {
  failureMessage = error instanceof Error ? error.message : "Workflow-store characterization failed.";
} finally {
  if (databaseCreated) {
    await adminSql.unsafe(`drop database if exists "${databaseName}" with (force)`).catch((error) => {
      failureMessage ||= error instanceof Error ? error.message : "Could not drop the disposable characterization database.";
    });
  }
  await adminSql.end({ timeout: 5 });
  rmSync(tempRoot, { recursive: true, force: true });
}

const payload = {
  ok: !failureMessage && results.length === 2 && results.every((result) => result.ok),
  profile: "workflow_store_characterization",
  captured_at: new Date().toISOString(),
  captured_from_commit: capturedFromCommit,
  test_path: testPath,
  test_digest: createHash("sha256").update(readFileSync(testPath)).digest("hex"),
  fixture_classification: "synthetic",
  postgres_major: postgresMajor,
  adapters: results,
  characterized_boundaries: [
    "ordered stage transitions and stale-write rejection",
    "assigned-assessor recommendation authorization and replay",
    "single-winner supervisor decision collisions",
    "full correction, successor resubmission, and decision lineage",
    "single-successor correction collisions without orphan assessments",
    "coherent correction-versus-decision collisions without orphan assessments",
    "work-item validation, conflict detection, and audit-neutral replay",
    "recoverable at-most-once EHR handoff progression",
    "role and resource denial without side effects",
  ],
  normalized_nondeterminism: [
    "Store-generated referral, assessment, recommendation, decision, work-item, and audit identifiers are asserted within an adapter, not compared across adapters.",
    "The winning request in a deliberately concurrent admission-decision pair is nondeterministic; exactly one success and one stale conflict are required.",
    "Correction-versus-correction and correction-versus-decision winners are nondeterministic; each pair must produce one success, one stale conflict, and one coherent persisted direction.",
    "Storage timestamps are checked through resulting state and audit cardinality, not equality across adapters.",
  ],
  failure: failureMessage || null,
  duration_ms: Date.now() - startedAt.getTime(),
};
const artifact = writeArtifact(payload);
process.stdout.write(`${JSON.stringify({ ...payload, artifact }, null, 2)}\n`);
if (!payload.ok) process.exitCode = 1;

async function runCharacterization(adapter, port, extraEnv) {
  const result = await runCommand(adapter, path.join(process.cwd(), "node_modules", ".bin", "playwright"), [
    "test",
    "-c",
    "playwright.operational.config.ts",
    testPath,
    "--reporter=json",
  ], {
    PIPELINE_OPERATIONAL_E2E: "true",
    PIPELINE_OPERATIONAL_PREBUILT: "true",
    PIPELINE_WORKFLOW_CHARACTERIZATION: "true",
    PORT: String(port),
    ...extraEnv,
  }, true);
  return {
    adapter,
    ok: result.ok,
    duration_ms: result.duration_ms,
    tests: result.stats,
    error: result.error,
  };
}

async function runCommand(name, command, args, extraEnv = {}, captureJson = false) {
  const started = Date.now();
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: captureJson ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  const output = captureCommandOutput(child, captureJson);
  const { exitCode, spawnError } = await childResult(child);
  const { stats, parseError } = parsePlaywrightStats(output.stdout, captureJson, spawnError);
  const ok = commandPassed({ exitCode, spawnError, parseError, captureJson, stats });
  reportCapturedFailure({ name, ok, captureJson, spawnError, parseError, output });
  return {
    name,
    ok,
    exit_code: exitCode,
    duration_ms: Date.now() - started,
    stats,
    error: spawnError || parseError || (exitCode === 0 ? null : `${name} exited with ${exitCode}`),
  };
}

function commandPassed({ exitCode, spawnError, parseError, captureJson, stats }) {
  if (exitCode !== 0 || spawnError || parseError) return false;
  return !captureJson || (stats?.expected === 9 && stats.unexpected === 0);
}

function reportCapturedFailure({ name, ok, captureJson, spawnError, parseError, output }) {
  if (ok || !captureJson) return;
  const detail = spawnError || parseError || output.stderr || output.stdout.slice(-8_000);
  process.stderr.write(`${name} characterization failed.\n${detail}\n`);
}

function captureCommandOutput(child, enabled) {
  const output = { stdout: "", stderr: "" };
  if (!enabled) return output;
  child.stdout.on("data", (chunk) => { output.stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { output.stderr = `${output.stderr}${String(chunk)}`.slice(-8_000); });
  return output;
}

function childResult(child) {
  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ exitCode: 1, spawnError: error.message }));
    child.once("exit", (code) => resolve({ exitCode: code ?? 1, spawnError: "" }));
  });
}

function parsePlaywrightStats(stdout, enabled, spawnError) {
  if (!enabled || spawnError) return { stats: null, parseError: "" };
  try {
    const report = JSON.parse(stdout);
    const stats = report.stats ? {
      expected: Number(report.stats.expected ?? 0),
      unexpected: Number(report.stats.unexpected ?? 0),
      flaky: Number(report.stats.flaky ?? 0),
      skipped: Number(report.stats.skipped ?? 0),
    } : null;
    return { stats, parseError: "" };
  } catch {
    return { stats: null, parseError: "Playwright did not return a valid JSON report." };
  }
}

function requirePass(result) {
  if (!result.ok) throw new Error(`${result.name} failed with exit code ${result.exit_code}.`);
}

function databaseUrlFor(value, databaseNameValue) {
  if (!/^[a-z0-9_]+$/.test(databaseNameValue)) throw new Error("Unsafe disposable database name.");
  const url = new URL(value);
  url.pathname = `/${databaseNameValue}`;
  return url.toString();
}

function databaseOptions() {
  const mode = process.env.PIPELINE_DATABASE_SSL_MODE?.trim().toLowerCase();
  return {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false,
    onnotice: () => undefined,
    ...(mode === "require" ? { ssl: "require" } : mode === "disable" ? { ssl: false } : {}),
  };
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Could not allocate an isolated loopback port."));
        else resolve(port);
      });
    });
  });
}

function writeArtifact(value) {
  const directory = path.join(process.cwd(), "outputs", "refactor-characterization");
  mkdirSync(directory, { recursive: true });
  const timestamp = value.captured_at.replaceAll(":", "-");
  const target = path.join(directory, `workflow-store-${timestamp}.json`);
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  writeFileSync(path.join(directory, "workflow-store-latest.json"), `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return target;
}

function fail(message) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exit(1);
}
