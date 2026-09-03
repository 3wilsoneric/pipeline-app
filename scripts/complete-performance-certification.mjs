#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const argumentsSet = new Set(process.argv.slice(2));
const skipBuild = argumentsSet.has("--skip-build");
const strictExternal = argumentsSet.has("--strict-external");
const noArtifact = argumentsSet.has("--no-artifact");
const startedAt = Date.now();
const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const runtimeRoot = path.join(process.cwd(), ".data", "performance-certification", `runtime-${runId}`);
const results = [];
const externalEvidence = [];

if (!skipBuild) await runOpaqueCheck("production_build", "npm", ["run", "build"]);
else results.push({ name: "production_build", ok: existsSync(path.join(process.cwd(), ".next", "standalone", "server.js")), skipped: true, reason: "--skip-build" });

await runJsonCheck("mcmaster_matrix", process.execPath, ["scripts/mcmaster-certification-matrix.mjs"]);
await runJsonCheck("mcmaster_contracts", process.execPath, ["scripts/mcmaster-performance-contracts.mjs"]);
await runJsonCheck("capacity_model", process.execPath, ["scripts/operational-capacity-model.mjs"]);
await runJsonCheck("synthetic_scale", process.execPath, ["scripts/synthetic-scale-benchmark.mjs"]);

const buildReady = existsSync(path.join(process.cwd(), ".next", "standalone", "server.js"));
if (buildReady) {
  await runJsonCheck("browser_performance", process.execPath, ["scripts/mcmaster-certification-runner.mjs"]);
  await runIsolatedHttpChecks();
} else {
  results.push({ name: "browser_performance", ok: false, skipped: true, reason: "standalone_build_missing" });
  results.push({ name: "isolated_http_checks", ok: false, skipped: true, reason: "standalone_build_missing" });
}

if (process.env.PIPELINE_TEST_DATABASE_URL?.trim()) {
  await runJsonCheck("postgres_database_capacity", process.execPath, ["scripts/postgres-capacity-certification.mjs"]);
  externalEvidence.push({ name: "postgres_database_capacity", available: true, exercised: true });
} else {
  recordExternalSkip("postgres_database_capacity", ["PIPELINE_TEST_DATABASE_URL"]);
}

if (process.env.PIPELINE_PERFORMANCE_CLINICAL_BASE_URL?.trim()) {
  const remoteUrl = process.env.PIPELINE_PERFORMANCE_CLINICAL_BASE_URL.trim();
  await runJsonCheck("clinical_backed_http_capacity", process.execPath, [
    "scripts/http-capacity-smoke.mjs",
    ...remoteFlag(remoteUrl),
  ], {
    PIPELINE_CAPACITY_BASE_URL: remoteUrl,
    PIPELINE_CAPACITY_INCLUDE_CLINICAL: "true",
  });
  externalEvidence.push({ name: "clinical_backed_http_capacity", available: true, exercised: true });
} else {
  recordExternalSkip("clinical_backed_http_capacity", ["PIPELINE_PERFORMANCE_CLINICAL_BASE_URL"]);
}

if (process.env.PIPELINE_LIVE_CERTIFICATION === "true" && process.env.PIPELINE_SAMPLE_PACKET_PATH?.trim()) {
  await runJsonCheck("live_sample_packet", process.execPath, ["scripts/sample-packet-extraction-smoke.mjs"]);
  externalEvidence.push({ name: "live_sample_packet", available: true, exercised: true });
} else {
  recordExternalSkip("live_sample_packet", ["PIPELINE_LIVE_CERTIFICATION=true", "PIPELINE_SAMPLE_PACKET_PATH"]);
}

const completedAt = new Date().toISOString();
const failed = results.filter((result) => !result.ok);
const skippedExternal = externalEvidence.filter((item) => !item.exercised);
const payload = {
  ok: failed.length === 0 && (!strictExternal || skippedExternal.length === 0),
  profile: "complete_performance",
  started_at: new Date(startedAt).toISOString(),
  completed_at: completedAt,
  duration_ms: Date.now() - startedAt,
  strict_external: strictExternal,
  results,
  external_evidence: externalEvidence,
  failed,
  note: "The local profile exercises the compiled production artifact with sanitized synthetic data. External PostgreSQL, clinical, and packet evidence is explicitly gated and never inferred from local adapters.",
};
const artifact = noArtifact ? null : writeArtifact(payload);

console.log(JSON.stringify(consoleSummary(payload, artifact), null, 2));
if (!payload.ok) process.exit(1);

async function runIsolatedHttpChecks() {
  mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
  const port = process.env.PIPELINE_COMPLETE_PERF_PORT?.trim()
    ? boundedPort(process.env.PIPELINE_COMPLETE_PERF_PORT)
    : await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["scripts/start-standalone.mjs"], {
    cwd: process.cwd(),
    env: isolatedServerEnvironment(port),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => { serverLog = appendBounded(serverLog, chunk); });
  server.stderr.on("data", (chunk) => { serverLog = appendBounded(serverLog, chunk); });

  try {
    await waitForLiveHealth(baseUrl, server);
    await runJsonCheck("http_load", process.execPath, ["scripts/http-load-smoke.mjs"], {
      PIPELINE_LOAD_BASE_URL: baseUrl,
      PIPELINE_LOAD_USER_EMAIL: "ops-admin@pipeline.local",
      PIPELINE_LOAD_CONCURRENCY: process.env.PIPELINE_LOAD_CONCURRENCY ?? "20",
      PIPELINE_LOAD_REQUESTS: process.env.PIPELINE_LOAD_REQUESTS ?? "500",
      PIPELINE_LOAD_P95_LIMIT_MS: process.env.PIPELINE_LOAD_P95_LIMIT_MS ?? "500",
    });
    await runJsonCheck("http_capacity", process.execPath, ["scripts/http-capacity-smoke.mjs"], {
      PIPELINE_CAPACITY_BASE_URL: baseUrl,
      PIPELINE_CAPACITY_INCLUDE_CLINICAL: "false",
      PIPELINE_CAPACITY_CONCURRENCY: process.env.PIPELINE_CAPACITY_CONCURRENCY ?? "50",
      PIPELINE_CAPACITY_REQUESTS: process.env.PIPELINE_CAPACITY_REQUESTS ?? "2000",
      PIPELINE_CAPACITY_P95_LIMIT_MS: process.env.PIPELINE_CAPACITY_P95_LIMIT_MS ?? "750",
      PIPELINE_CAPACITY_P99_LIMIT_MS: process.env.PIPELINE_CAPACITY_P99_LIMIT_MS ?? "1500",
    });
    await runJsonCheck("collaboration_load", process.execPath, ["scripts/collaboration-load-smoke.mjs"], {
      PIPELINE_COLLABORATION_BASE_URL: baseUrl,
      PIPELINE_COLLABORATION_USERS: process.env.PIPELINE_COLLABORATION_USERS ?? "20",
      PIPELINE_COLLABORATION_P95_LIMIT_MS: process.env.PIPELINE_COLLABORATION_P95_LIMIT_MS ?? "500",
    });
    await runJsonCheck("bounded_soak", process.execPath, ["scripts/http-soak-smoke.mjs"], {
      PIPELINE_SOAK_BASE_URL: baseUrl,
      PIPELINE_SOAK_SECONDS: process.env.PIPELINE_SOAK_SECONDS ?? "30",
      PIPELINE_SOAK_CONCURRENCY: process.env.PIPELINE_SOAK_CONCURRENCY ?? "20",
      PIPELINE_SOAK_INCLUDE_CLINICAL: "false",
    });
  } catch (error) {
    results.push({
      name: "isolated_http_server",
      ok: false,
      skipped: false,
      error: error instanceof Error ? error.message : "isolated_server_failed",
      server_log_tail: serverLog.slice(-2_000),
    });
  } finally {
    await stopServer(server);
    rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

function isolatedServerEnvironment(port) {
  const origins = `http://127.0.0.1:${port},http://localhost:${port}`;
  return {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    PIPELINE_AUTH_MODE: "headers",
    PIPELINE_TRUSTED_GATEWAY: "true",
    PIPELINE_ALLOWED_MUTATION_ORIGINS: origins,
    PIPELINE_EXTRACTION_BACKEND: "mock",
    PIPELINE_ALLOW_PRODUCTION_MOCK_EXTRACTION: "true",
    PIPELINE_DATABASE_MODE: "disconnected",
    PIPELINE_DATABASE_URL: "",
    PIPELINE_ALLOW_LOCAL_REFERRAL_STORE: "true",
    PIPELINE_ALLOW_LOCAL_ASSESSMENT_STORE: "true",
    PIPELINE_ALLOW_LOCAL_RESIDENT_LINK_STORE: "true",
    PIPELINE_REFERRAL_STORE_PATH: path.join(runtimeRoot, "referrals.json"),
    PIPELINE_ASSESSMENT_STORE_PATH: path.join(runtimeRoot, "assessments.json"),
    PIPELINE_RESIDENT_LINK_STORE_PATH: path.join(runtimeRoot, "resident-links.json"),
    PIPELINE_NOTE_LAB_STORE_PATH: path.join(runtimeRoot, "note-lab.json"),
    PIPELINE_LOCAL_DOCUMENT_ROOT: path.join(runtimeRoot, "documents"),
    PIPELINE_ENABLE_SYNTHETIC_PROFILES: "true",
    PIPELINE_CLINICAL_DATA_MODE: "disconnected",
    PIPELINE_CLINICAL_DATA_REQUIRED: "false",
    PIPELINE_DESKTOP_STATE_ENABLED: "false",
    PIPELINE_ALLOW_LOCAL_DESKTOP_STATE_STORE: "false",
    PIPELINE_DESKTOP_STATE_STORE_PATH: path.join(runtimeRoot, "workspace-state.json"),
  };
}

async function runOpaqueCheck(name, command, args, extraEnv = {}) {
  const checkStartedAt = Date.now();
  process.stdout.write(`\n==> ${name}\n`);
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
  const result = { name, ok: exitCode === 0, skipped: false, duration_ms: Date.now() - checkStartedAt, exit_code: exitCode };
  results.push(result);
  process.stdout.write(`${result.ok ? "PASS" : "FAIL"} ${name} (${result.duration_ms}ms)\n`);
  return result;
}

async function runJsonCheck(name, command, args, extraEnv = {}) {
  const checkStartedAt = Date.now();
  process.stdout.write(`\n==> ${name}\n`);
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout = appendBounded(stdout, chunk, 16 * 1024 * 1024); });
  child.stderr.on("data", (chunk) => { stderr = appendBounded(stderr, chunk, 256 * 1024); });
  const exitCode = await new Promise((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
  let evidence = null;
  try {
    evidence = JSON.parse(stdout);
  } catch {
    // The failed result below records only bounded diagnostics, never request bodies.
  }
  const ok = exitCode === 0 && evidence?.ok !== false;
  const result = {
    name,
    ok,
    skipped: false,
    duration_ms: Date.now() - checkStartedAt,
    exit_code: exitCode,
    evidence,
    ...(ok ? {} : { diagnostic_tail: (stderr || stdout).slice(-2_000) }),
  };
  results.push(result);
  process.stdout.write(`${ok ? "PASS" : "FAIL"} ${name} (${result.duration_ms}ms)\n`);
  return result;
}

function recordExternalSkip(name, requiredConfiguration) {
  const item = { name, available: false, exercised: false, required_configuration: requiredConfiguration };
  externalEvidence.push(item);
  results.push({ name, ok: !strictExternal, skipped: true, reason: "external_configuration_missing", required_configuration: requiredConfiguration });
}

async function waitForLiveHealth(baseUrl, server) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`The isolated production server exited with ${server.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/health/live`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await wait(100);
  }
  throw new Error("The isolated production server did not become live within twelve seconds.");
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => server.once("exit", () => resolve(true))),
    wait(2_000).then(() => false),
  ]);
  if (!exited && server.exitCode === null) server.kill("SIGKILL");
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => error || !port ? reject(error ?? new Error("No local port was allocated.")) : resolve(port));
    });
  });
}

function boundedPort(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65_535) throw new Error("PIPELINE_COMPLETE_PERF_PORT must be between 1024 and 65535.");
  return parsed;
}

function remoteFlag(value) {
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname) ? [] : ["--allow-remote"];
  } catch {
    return [];
  }
}

function writeArtifact(payload) {
  const outputDirectory = path.join(process.cwd(), "outputs", "performance-certification");
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const stamp = payload.completed_at.replace(/[:.]/g, "-");
  const target = path.join(outputDirectory, `complete-${stamp}.json`);
  const latest = path.join(outputDirectory, "latest.json");
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(target, content, { encoding: "utf8", mode: 0o600 });
  writeFileSync(latest, content, { encoding: "utf8", mode: 0o600 });
  return { json: target, latest };
}

function consoleSummary(payload, artifact) {
  const browser = payload.results.find((result) => result.name === "browser_performance")?.evidence?.worst_case ?? null;
  const capacity = payload.results.find((result) => result.name === "http_capacity")?.evidence ?? null;
  const collaboration = payload.results.find((result) => result.name === "collaboration_load")?.evidence ?? null;
  const soak = payload.results.find((result) => result.name === "bounded_soak")?.evidence ?? null;
  const capacitySummaries = Array.isArray(capacity?.summaries) ? capacity.summaries : [];
  const collaborationTimings = collaboration?.timings && typeof collaboration.timings === "object"
    ? Object.values(collaboration.timings)
    : [];
  return {
    ok: payload.ok,
    profile: payload.profile,
    duration_ms: payload.duration_ms,
    results: payload.results.map((result) => ({
      name: result.name,
      ok: result.ok,
      skipped: result.skipped,
      duration_ms: result.duration_ms ?? 0,
      reason: result.reason,
    })),
    highlights: {
      browser_worst_case: browser,
      capacity: capacitySummaries.length > 0 ? {
        concurrency: capacity.concurrency,
        requests: capacity.request_count,
        maximum_route_p95_ms: Math.max(...capacitySummaries.map((summary) => summary.p95_ms)),
        errors: capacitySummaries.reduce((sum, summary) => sum + summary.errors, 0),
      } : null,
      collaboration: collaborationTimings.length > 0 ? {
        users: collaboration.users,
        maximum_operation_p95_ms: Math.max(...collaborationTimings.map((timing) => timing.p95_ms)),
        expected_conflicts: collaboration.checks?.expected_save_conflicts,
      } : null,
      soak: soak?.summary ? {
        elapsed_seconds: soak.elapsed_seconds,
        requests: soak.summary.requests,
        requests_per_second: soak.requests_per_second,
        errors: soak.summary.errors,
        p95_upper_bound_ms: soak.summary.p95_upper_bound_ms,
        p99_upper_bound_ms: soak.summary.p99_upper_bound_ms,
      } : null,
    },
    external_evidence: payload.external_evidence,
    failed: payload.failed.map((result) => result.name),
    artifact,
  };
}

function appendBounded(current, chunk, maximum = 16_000) {
  return `${current}${String(chunk)}`.slice(-maximum);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
