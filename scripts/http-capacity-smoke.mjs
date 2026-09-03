#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const baseUrl = process.env.PIPELINE_CAPACITY_BASE_URL?.trim();
const allowRemote = process.argv.includes("--allow-remote");
if (!baseUrl) fail("Configure PIPELINE_CAPACITY_BASE_URL before running the capacity smoke check.");

const parsedBaseUrl = new URL(baseUrl);
if (!allowRemote && !["localhost", "127.0.0.1", "::1"].includes(parsedBaseUrl.hostname)) {
  fail("Remote capacity checks require an explicit --allow-remote flag.");
}

const concurrency = boundedInteger("PIPELINE_CAPACITY_CONCURRENCY", 50, 1, 250);
const requestTarget = boundedInteger("PIPELINE_CAPACITY_REQUESTS", 2_000, concurrency, 25_000);
const timeoutMs = boundedInteger("PIPELINE_CAPACITY_TIMEOUT_MS", 15_000, 1_000, 60_000);
const p95LimitMs = boundedInteger("PIPELINE_CAPACITY_P95_LIMIT_MS", 1_500, 100, 60_000);
const p99LimitMs = boundedInteger("PIPELINE_CAPACITY_P99_LIMIT_MS", 3_000, 100, 90_000);
const maxBodyBytes = boundedInteger("PIPELINE_CAPACITY_MAX_BODY_BYTES", 750_000, 50_000, 5_000_000);
const includeClinical = process.env.PIPELINE_CAPACITY_INCLUDE_CLINICAL !== "false";
const samples = [];

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

await Promise.all(Array.from({ length: concurrency }, (_, worker) => runWorker(worker)));

const summaries = missions.map((mission) => summarize(
  mission.name,
  samples.filter((sample) => sample.name === mission.name),
));
const failed = summaries.some((summary) => (
  summary.errors > 0 ||
  summary.p95_ms > p95LimitMs ||
  summary.p99_ms > p99LimitMs ||
  summary.max_body_bytes > maxBodyBytes
));

console.log(JSON.stringify({
  ok: !failed,
  concurrency,
  request_target: requestTarget,
  request_count: samples.length,
  p95_limit_ms: p95LimitMs,
  p99_limit_ms: p99LimitMs,
  max_body_bytes: maxBodyBytes,
  skipped_missions: availableMissions.filter((mission) => !missions.includes(mission)).map((mission) => mission.name),
  summaries,
  note: "Capacity smoke logs route templates, status classes, timings, and response sizes only. Response bodies and identities are discarded.",
}, null, 2));

if (failed) process.exit(1);

async function runWorker(worker) {
  for (let requestIndex = worker; requestIndex < requestTarget; requestIndex += concurrency) {
    const mission = missions[requestIndex % missions.length];
    const actorIndex = requestIndex % Math.max(1, concurrency);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();
    let status = 0;
    let bytes = 0;

    try {
      const response = await fetch(new URL(mission.path, parsedBaseUrl), {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(mission.auth ? { "x-ms-client-principal": syntheticPrincipal(actorIndex) } : {}),
        },
        signal: controller.signal,
      });
      status = response.status;
      const body = await response.arrayBuffer();
      bytes = body.byteLength;
    } catch {
      status = 0;
    } finally {
      clearTimeout(timeout);
      samples.push({
        name: mission.name,
        ms: performance.now() - startedAt,
        status,
        bytes,
      });
    }
  }
}

function summarize(name, values) {
  const durations = values.map((value) => value.ms).sort((left, right) => left - right);
  const bodySizes = values.map((value) => value.bytes).sort((left, right) => left - right);
  const statuses = Object.fromEntries(
    [...new Set(values.map((value) => value.status))]
      .sort()
      .map((status) => [
        String(status),
        values.filter((value) => value.status === status).length,
      ]),
  );
  return {
    route: name,
    requests: values.length,
    errors: values.filter((value) => value.status < 200 || value.status >= 400).length,
    p50_ms: round(percentile(durations, 0.5)),
    p95_ms: round(percentile(durations, 0.95)),
    p99_ms: round(percentile(durations, 0.99)),
    max_ms: round(durations.at(-1) ?? 0),
    max_body_bytes: bodySizes.at(-1) ?? 0,
    statuses,
  };
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  return values[Math.min(values.length - 1, Math.ceil(values.length * percentileValue) - 1)];
}

function boundedInteger(name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function syntheticPrincipal(index) {
  const padded = String(index + 1).padStart(3, "0");
  const role = index % 20 === 0
    ? "Pipeline.Admin"
    : index % 5 === 0
      ? "Pipeline.AssessmentCoordinator"
      : index % 4 === 0
        ? "Pipeline.Viewer"
        : "Pipeline.Reviewer";
  const emailRole = role.replace("Pipeline.", "").replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();

  return Buffer.from(JSON.stringify({
    userId: `capacity-${padded}`,
    userDetails: `${emailRole}-${padded}@pipeline.local`,
    claims: [
      { typ: "name", val: `Capacity User ${padded}` },
      { typ: "roles", val: role },
    ],
  })).toString("base64");
}

function fail(message) {
  console.error(JSON.stringify({
    ok: false,
    error: message,
    configuration_present: {
      PIPELINE_CAPACITY_BASE_URL: Boolean(baseUrl),
    },
  }, null, 2));
  process.exit(1);
}
