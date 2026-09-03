#!/usr/bin/env node

import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const configuredBaseUrl = process.env.PIPELINE_SOAK_BASE_URL?.trim();
if (!configuredBaseUrl) fail("Configure PIPELINE_SOAK_BASE_URL before running the soak check.");
const baseUrl = new URL(configuredBaseUrl);
const localTarget = ["localhost", "127.0.0.1", "::1"].includes(baseUrl.hostname);
if (!localTarget && !process.argv.includes("--allow-remote")) fail("Remote soak checks require --allow-remote.");

const durationSeconds = boundedInteger("PIPELINE_SOAK_SECONDS", 30, 5, 172_800);
const concurrency = boundedInteger("PIPELINE_SOAK_CONCURRENCY", 20, 1, 100);
const thinkMs = boundedInteger("PIPELINE_SOAK_THINK_MS", 250, 0, 5_000);
const timeoutMs = boundedInteger("PIPELINE_SOAK_TIMEOUT_MS", 10_000, 1_000, 60_000);
const p95LimitMs = boundedInteger("PIPELINE_SOAK_P95_LIMIT_MS", 750, 25, 60_000);
const p99LimitMs = boundedInteger("PIPELINE_SOAK_P99_LIMIT_MS", 1_500, 25, 90_000);
const minimumRequestsPerSecond = boundedNumber("PIPELINE_SOAK_MIN_RPS", 10, 0.1, 10_000);
const maximumErrorRate = boundedNumber("PIPELINE_SOAK_MAX_ERROR_RATE", 0, 0, 1);
const includeClinical = process.env.PIPELINE_SOAK_INCLUDE_CLINICAL === "true";
const histogramBounds = [10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1_000, 1_500, 2_000, 3_000, 5_000, 10_000, 30_000, 60_000];
const availableMissions = [
  { name: "health_live", path: "/api/health/live", auth: false },
  { name: "referrals", path: "/api/referrals?limit=100&active=true", auth: true },
  { name: "directory", path: "/api/referrals/directory?limit=100&workspace=all", auth: true },
  { name: "files", path: "/api/files?limit=100", auth: true },
  { name: "operations", path: "/api/operations/overview", auth: true },
  { name: "my_queue", path: "/api/operations/my-queue", auth: true },
  { name: "search", path: "/api/search?scope=local&q=San%20Pablo", auth: true },
  { name: "calendar", path: "/api/calendar/events?start=2026-08-01&end=2026-08-31", auth: true },
  { name: "census", path: "/api/clinical/census", auth: true, clinical: true },
];
const missions = availableMissions.filter((mission) => includeClinical || !mission.clinical);
const overall = accumulator();
const phases = [accumulator(), accumulator(), accumulator()];
const byMission = Object.fromEntries(missions.map((mission) => [mission.name, accumulator()]));
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
const startedAt = performance.now();
const deadline = startedAt + durationSeconds * 1_000;
let maximumRssBytes = process.memoryUsage().rss;
const memoryTimer = setInterval(() => {
  maximumRssBytes = Math.max(maximumRssBytes, process.memoryUsage().rss);
}, 1_000);
eventLoop.enable();

await Promise.all(Array.from({ length: concurrency }, (_, worker) => runWorker(worker)));

clearInterval(memoryTimer);
eventLoop.disable();
const elapsedSeconds = (performance.now() - startedAt) / 1_000;
const summary = summarize(overall);
const phaseSummaries = phases.map((phase, index) => ({ phase: index + 1, ...summarize(phase) }));
const missionSummaries = missions.map((mission) => ({ route: mission.name, ...summarize(byMission[mission.name]) }));
const requestsPerSecond = overall.requests / elapsedSeconds;
const errorRate = overall.requests > 0 ? overall.errors / overall.requests : 1;
const initialP95 = phaseSummaries[0].p95_upper_bound_ms;
const finalP95 = phaseSummaries[2].p95_upper_bound_ms;
const driftLimitMs = Math.min(p95LimitMs, Math.max(initialP95 * 2, initialP95 + 250));
const checks = {
  every_mission_exercised: missionSummaries.every((mission) => mission.requests > 0),
  error_rate: errorRate <= maximumErrorRate,
  p95: summary.p95_upper_bound_ms <= p95LimitMs,
  p99: summary.p99_upper_bound_ms <= p99LimitMs,
  final_phase_drift: finalP95 <= driftLimitMs,
  throughput: requestsPerSecond >= minimumRequestsPerSecond,
};
const result = {
  ok: Object.values(checks).every(Boolean),
  configuration: {
    duration_seconds: durationSeconds,
    concurrency,
    think_ms: thinkMs,
    timeout_ms: timeoutMs,
    p95_limit_ms: p95LimitMs,
    p99_limit_ms: p99LimitMs,
    minimum_requests_per_second: minimumRequestsPerSecond,
    maximum_error_rate: maximumErrorRate,
  },
  elapsed_seconds: rounded(elapsedSeconds),
  requests_per_second: rounded(requestsPerSecond),
  error_rate: rounded(errorRate),
  summary,
  phases: phaseSummaries,
  missions: missionSummaries,
  skipped_missions: availableMissions.filter((mission) => !missions.includes(mission)).map((mission) => mission.name),
  generator_health: {
    event_loop_delay_p99_ms: rounded(eventLoop.percentile(99) / 1_000_000),
    maximum_rss_mb: rounded(maximumRssBytes / 1024 / 1024),
  },
  drift_limit_ms: driftLimitMs,
  checks,
  note: "The soak check keeps bounded histograms and aggregate status classes only. It discards response bodies, identities, query values, and record identifiers.",
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

async function runWorker(worker) {
  let requestIndex = worker;
  while (performance.now() < deadline) {
    const mission = missions[requestIndex % missions.length];
    const requestStartedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let status = 0;
    let bytes = 0;
    try {
      const response = await fetch(new URL(mission.path, baseUrl), {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(mission.auth ? { "x-ms-client-principal": syntheticPrincipal(worker) } : {}),
        },
        signal: controller.signal,
      });
      status = response.status;
      bytes = (await response.arrayBuffer()).byteLength;
    } catch {
      status = 0;
    } finally {
      clearTimeout(timeout);
    }
    const elapsed = performance.now() - requestStartedAt;
    const phaseIndex = Math.min(2, Math.floor(((requestStartedAt - startedAt) / (durationSeconds * 1_000)) * 3));
    record(overall, elapsed, status, bytes);
    record(phases[phaseIndex], elapsed, status, bytes);
    record(byMission[mission.name], elapsed, status, bytes);
    requestIndex += concurrency;
    if (thinkMs > 0 && performance.now() < deadline) await wait(Math.min(thinkMs, Math.max(0, deadline - performance.now())));
  }
}

function accumulator() {
  return {
    requests: 0,
    errors: 0,
    durationTotal: 0,
    maximumDuration: 0,
    maximumBytes: 0,
    statuses: new Map(),
    histogram: Array(histogramBounds.length + 1).fill(0),
  };
}

function record(target, milliseconds, status, bytes) {
  target.requests += 1;
  target.errors += status < 200 || status >= 400 ? 1 : 0;
  target.durationTotal += milliseconds;
  target.maximumDuration = Math.max(target.maximumDuration, milliseconds);
  target.maximumBytes = Math.max(target.maximumBytes, bytes);
  target.statuses.set(status, (target.statuses.get(status) ?? 0) + 1);
  const bucket = histogramBounds.findIndex((bound) => milliseconds <= bound);
  target.histogram[bucket === -1 ? histogramBounds.length : bucket] += 1;
}

function summarize(target) {
  return {
    requests: target.requests,
    errors: target.errors,
    mean_ms: rounded(target.requests > 0 ? target.durationTotal / target.requests : 0),
    p95_upper_bound_ms: histogramPercentile(target, 0.95),
    p99_upper_bound_ms: histogramPercentile(target, 0.99),
    max_ms: rounded(target.maximumDuration),
    max_body_bytes: target.maximumBytes,
    statuses: Object.fromEntries([...target.statuses.entries()].sort(([left], [right]) => left - right).map(([status, count]) => [String(status), count])),
  };
}

function histogramPercentile(target, fraction) {
  if (target.requests === 0) return 0;
  const threshold = Math.ceil(target.requests * fraction);
  let cumulative = 0;
  for (let index = 0; index < target.histogram.length; index += 1) {
    cumulative += target.histogram[index];
    if (cumulative >= threshold) return histogramBounds[index] ?? Number.POSITIVE_INFINITY;
  }
  return Number.POSITIVE_INFINITY;
}

function syntheticPrincipal(index) {
  const padded = String(index + 1).padStart(3, "0");
  return Buffer.from(JSON.stringify({
    userId: `soak-${padded}`,
    userDetails: `soak-${padded}@pipeline.local`,
    claims: [
      { typ: "name", val: `Soak User ${padded}` },
      { typ: "roles", val: index % 10 === 0 ? "Pipeline.Admin" : "Pipeline.Reviewer" },
    ],
  })).toString("base64");
}

function boundedInteger(name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function boundedNumber(name, fallback, minimum, maximum) {
  const parsed = Number.parseFloat(process.env[name] ?? "");
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_SOAK_BASE_URL: Boolean(configuredBaseUrl) } }, null, 2));
  process.exit(1);
}
