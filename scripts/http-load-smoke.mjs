#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const baseUrl = process.env.PIPELINE_LOAD_BASE_URL?.trim();
const allowRemote = process.argv.includes("--allow-remote");
if (!baseUrl) fail("Configure PIPELINE_LOAD_BASE_URL before running the load smoke check.");

const parsedBaseUrl = new URL(baseUrl);
if (!allowRemote && !["localhost", "127.0.0.1", "::1"].includes(parsedBaseUrl.hostname)) {
  fail("Remote load checks require an explicit --allow-remote flag.");
}

const concurrency = boundedInteger("PIPELINE_LOAD_CONCURRENCY", 10, 1, 25);
const fallbackRounds = boundedInteger("PIPELINE_LOAD_ROUNDS", 5, 1, 50);
const requestTarget = process.env.PIPELINE_LOAD_REQUESTS?.trim()
  ? boundedInteger("PIPELINE_LOAD_REQUESTS", 100, concurrency, 1_000)
  : concurrency * fallbackRounds;
const timeoutMs = boundedInteger("PIPELINE_LOAD_TIMEOUT_MS", 10_000, 1_000, 30_000);
const p95LimitMs = boundedInteger("PIPELINE_LOAD_P95_LIMIT_MS", 2_000, 100, 30_000);
const loadUserEmail = process.env.PIPELINE_LOAD_USER_EMAIL?.trim();
const loadUserPrincipal = loadUserEmail ? syntheticEasyAuthPrincipal(loadUserEmail) : null;
const missions = [
  { name: "referrals", path: "/api/referrals?limit=100&active=true" },
  { name: "files", path: "/api/files?limit=100" },
  { name: "operations", path: "/api/operations/overview" },
  { name: "search_local", path: "/api/search?scope=local&q=San%20Pablo" },
];
const samples = [];

await Promise.all(Array.from({ length: concurrency }, (_, worker) => runWorker(worker)));

const summaries = missions.map((mission) => summarize(mission.name, samples.filter((sample) => sample.name === mission.name)));
const failed = summaries.some((summary) => summary.errors > 0 || summary.p95_ms > p95LimitMs);
console.log(JSON.stringify({
  ok: !failed,
  concurrency,
  request_target: requestTarget,
  request_count: samples.length,
  p95_limit_ms: p95LimitMs,
  summaries,
  note: "The load check records route templates, status classes, and timings only. Response bodies are discarded.",
}, null, 2));
if (failed) process.exit(1);

async function runWorker(worker) {
  for (let requestIndex = worker; requestIndex < requestTarget; requestIndex += concurrency) {
    const mission = missions[requestIndex % missions.length];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = performance.now();
    let status = 0;
    try {
      const response = await fetch(new URL(mission.path, parsedBaseUrl), {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(loadUserPrincipal ? { "x-ms-client-principal": loadUserPrincipal } : {}),
        },
        signal: controller.signal,
      });
      status = response.status;
      await response.arrayBuffer();
    } catch {
      status = 0;
    } finally {
      clearTimeout(timeout);
      samples.push({ name: mission.name, ms: performance.now() - startedAt, status });
    }
  }
}

function summarize(name, values) {
  const durations = values.map((value) => value.ms).sort((left, right) => left - right);
  const statuses = Object.fromEntries([...new Set(values.map((value) => value.status))].sort().map((status) => [String(status), values.filter((value) => value.status === status).length]));
  return {
    route: name,
    requests: values.length,
    errors: values.filter((value) => value.status < 200 || value.status >= 400).length,
    p50_ms: round(percentile(durations, 0.5)),
    p95_ms: round(percentile(durations, 0.95)),
    max_ms: round(durations.at(-1) ?? 0),
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

function syntheticEasyAuthPrincipal(email) {
  return Buffer.from(JSON.stringify({
    userId: "pipeline-load-user",
    userDetails: email,
    claims: [
      { typ: "name", val: "Pipeline Load User" },
      { typ: "roles", val: "Pipeline.Admin" },
    ],
  })).toString("base64");
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_LOAD_BASE_URL: Boolean(baseUrl) } }, null, 2));
  process.exit(1);
}
