#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const runCount = boundedInteger(process.env.PIPELINE_MCM_RUNS, 3, 2, 10);
const firstPort = boundedInteger(process.env.PIPELINE_MCM_PORT, 3210, 1024, 65000 - runCount);
const buildEntry = path.join(process.cwd(), ".next", "standalone", "server.js");
if (!existsSync(buildEntry)) fail("The standalone production build is missing. Run npm run build first.");

const root = path.join(process.cwd(), ".data", "mcmaster-certification");
rmSync(root, { recursive: true, force: true });
const runs = [];

for (let index = 0; index < runCount; index += 1) {
  const port = firstPort + index;
  const runRoot = path.join(root, `run-${index + 1}`);
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["scripts/start-standalone.mjs"], {
    cwd: process.cwd(),
    env: certificationEnvironment(port, runRoot),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => { serverLog = appendBounded(serverLog, chunk); });
  server.stderr.on("data", (chunk) => { serverLog = appendBounded(serverLog, chunk); });

  try {
    await waitForHealth(baseUrl, server);
    const scorecard = await runScorecard(baseUrl);
    runs.push({ run: index + 1, ...scorecard });
  } catch (error) {
    await stopServer(server);
    fail(`${error instanceof Error ? error.message : "McMaster run failed."}\n${serverLog}`);
  }
  await stopServer(server);
}

const metric = (name) => runs.map((run) => Number(run.cold?.[name] ?? 0));
const result = {
  ok: runs.every((run) => run.ok),
  run_count: runs.length,
  all_checks_passed: runs.every((run) => Object.values(run.checks ?? {}).every(Boolean)),
  worst_case: {
    ttfb_ms: round(Math.max(...metric("ttfb_ms"))),
    fcp_ms: round(Math.max(...metric("fcp_ms"))),
    lcp_ms: round(Math.max(...metric("lcp_ms"))),
    inp_ms: round(Math.max(...metric("inp_ms"))),
    useful_content_ms: round(Math.max(...metric("useful_content_ms"))),
    cls: round(Math.max(...metric("cls"))),
    transferred_bytes: Math.max(...metric("transferred_bytes")),
    warm_navigation_ms: round(Math.max(...runs.flatMap((run) => run.warm_journeys.filter((journey) => journey.kind === "navigation").map((journey) => journey.duration_ms)))),
    client_directory_ms: journeyWorst(runs, "referrals_to_clients"),
    client_profile_open_ms: journeyWorst(runs, "open_client_profile"),
    client_profile_return_ms: journeyWorst(runs, "profile_to_clients"),
    localized_interaction_ms: round(Math.max(...runs.flatMap((run) => run.warm_journeys.filter((journey) => journey.kind !== "navigation").map((journey) => journey.duration_ms)))),
    ordinary_api_p95_ms: round(Math.max(...runs.map((run) => run.api.ordinary.p95_ms))),
    heavy_api_p95_ms: round(Math.max(...runs.map((run) => run.api.heavy.p95_ms))),
  },
  checks: runs.map((run) => ({ run: run.run, checks: run.checks })),
  samples: runs.map((run) => ({
    run: run.run,
    cold: run.cold,
    warm_navigation_max_ms: round(Math.max(...run.warm_journeys
      .filter((journey) => journey.kind === "navigation")
      .map((journey) => journey.duration_ms))),
    localized_interaction_max_ms: round(Math.max(...run.warm_journeys
      .filter((journey) => journey.kind !== "navigation")
      .map((journey) => journey.duration_ms))),
    client_journeys: Object.fromEntries(run.warm_journeys
      .filter((journey) => ["referrals_to_clients", "open_client_profile", "profile_to_clients"].includes(journey.name))
      .map((journey) => [journey.name, journey.duration_ms])),
    ordinary_api_p95_ms: run.api.ordinary.p95_ms,
    heavy_api_p95_ms: run.api.heavy.p95_ms,
    api_errors: run.api.errors,
    certification_limits: run.certification_limits,
  })),
  fixture_mode: "sanitized_test_only",
  note: "Each run starts the compiled production standalone artifact in an isolated test runtime with a loopback-only mock identity, isolated stores, browser context, and sanitized test-only clinical fixture.",
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok || !result.all_checks_passed) process.exit(1);

function certificationEnvironment(port, runRoot) {
  const localOrigins = `http://localhost:${port},http://127.0.0.1:${port}`;
  return {
    ...process.env,
    // Exercise the compiled standalone production artifact while allowing the
    // deliberately test-only mock identity on loopback. Production runtime
    // correctly refuses to report healthy with mock authentication enabled.
    NODE_ENV: "test",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    PIPELINE_AUTH_MODE: "mock",
    PIPELINE_ALLOW_PRODUCTION_MOCK_AUTH: "true",
    PIPELINE_LOCAL_CERTIFICATION: "true",
    PIPELINE_MOCK_USER_EMAIL: "mcmaster-certification@pipeline.local",
    PIPELINE_MOCK_USER_NAME: "McMaster Certification",
    PIPELINE_ADMIN_EMAILS: "mcmaster-certification@pipeline.local",
    PIPELINE_ALLOWED_EMAILS: "mcmaster-certification@pipeline.local",
    PIPELINE_ALLOWED_MUTATION_ORIGINS: localOrigins,
    PIPELINE_EXTRACTION_BACKEND: "mock",
    PIPELINE_ALLOW_PRODUCTION_MOCK_EXTRACTION: "true",
    PIPELINE_ALLOW_LOCAL_REFERRAL_STORE: "true",
    PIPELINE_REFERRAL_STORE_PATH: path.join(runRoot, "referrals.json"),
    PIPELINE_ASSESSMENT_STORE_PATH: path.join(runRoot, "assessments.json"),
    PIPELINE_RESIDENT_LINK_STORE_PATH: path.join(runRoot, "resident-links.json"),
    PIPELINE_LOCAL_DOCUMENT_ROOT: path.join(runRoot, "documents"),
    PIPELINE_CLINICAL_DATA_MODE: "disconnected",
    PIPELINE_CLINICAL_DATA_REQUIRED: "false",
  };
}

async function waitForHealth(baseUrl, server) {
  let lastHealth = "No health response was received.";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Pipeline exited before becoming ready (${server.exitCode}).`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
      const payload = await response.json().catch(() => null);
      lastHealth = summarizeHealth(payload, response.status);
    } catch {
      // Startup is still in progress.
    }
    await wait(100);
  }
  throw new Error(`Pipeline did not become healthy within eight seconds. ${lastHealth}`);
}

function summarizeHealth(payload, status) {
  const failedChecks = Object.entries(payload?.checks ?? {})
    .filter(([, check]) => check?.ready === false || (check?.required === true && check?.connection_verified === false))
    .map(([name, check]) => ({
      name,
      mode: check?.mode,
      missing_env: check?.missing_env,
      message: check?.message,
    }));
  return JSON.stringify({ status, failed_checks: failedChecks });
}

async function runScorecard(baseUrl) {
  const child = spawn(process.execPath, ["scripts/pipeline-performance-scorecard.mjs", "--enforce"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PIPELINE_PERF_BASE_URL: baseUrl,
      PIPELINE_PERF_FIXTURES: "true",
      PIPELINE_PERF_SEED: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`The performance scorecard did not return valid JSON. ${stderr}`);
  }
  if (exitCode !== 0 && parsed.ok) {
    throw new Error(`The performance scorecard exited with ${exitCode} despite reporting success. ${stderr}`);
  }
  return parsed;
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

function appendBounded(current, chunk) {
  return `${current}${String(chunk)}`.slice(-8_000);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function journeyWorst(runs, name) {
  return round(Math.max(...runs.flatMap((run) => run.warm_journeys
    .filter((journey) => journey.name === name)
    .map((journey) => journey.duration_ms))));
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}
