#!/usr/bin/env node

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const metrics = loadTypeScriptModule(process.cwd(), "lib/observability/metric-contract.ts");
const checkedAt = new Date("2026-08-22T12:00:00.000Z");
const events = [];

for (let user = 1; user <= 10; user += 1) {
  for (let request = 0; request < 20; request += 1) {
    events.push(metrics.buildPipelineMetricEvent(
      "pipeline.api.duration",
      45 + ((user * request) % 180),
      "milliseconds",
      {
        route: request % 2 ? "/api/referrals/[referralId]" : "/api/referrals",
        method: request % 3 ? "GET" : "PATCH",
        status_class: request % 17 ? "2xx" : "4xx",
        resident_id: `synthetic-resident-${user}`,
        client_name: `Synthetic Client ${user}`,
      },
      checkedAt,
    ));
  }
}

events.push(metrics.buildPipelineMetricEvent(
  "pipeline.referral.save_conflicts",
  7,
  "count",
  { operation: "patch", result: "conflict", referral_id: "synthetic-referral" },
  checkedAt,
));
events.push(metrics.buildPipelineMetricEvent(
  "pipeline.extraction.failures",
  2,
  "count",
  { operation: "report", result: "dead_letter", error_code: "synthetic_failure" },
  checkedAt,
));

const emitted = events.filter(Boolean);
const serialized = JSON.stringify(emitted);
const durations = emitted
  .filter((event) => event.metric === "pipeline.api.duration")
  .map((event) => event.value)
  .sort((left, right) => left - right);
const p95 = durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] ?? 0;
const checks = [
  { name: "ten-user workload emits every bounded request metric", ok: durations.length === 200 },
  { name: "synthetic latency rollup remains computable", ok: p95 > 0 && p95 < 300 },
  { name: "PHI and record identifiers are removed from dimensions", ok: !serialized.includes("resident_id") && !serialized.includes("client_name") && !serialized.includes("referral_id") },
  { name: "error codes do not become high-cardinality dimensions", ok: !serialized.includes("error_code") && !serialized.includes("synthetic_failure") },
  { name: "invalid metric names fail closed", ok: metrics.buildPipelineMetricEvent("Bad Metric", 1, "count") === null },
  { name: "non-finite metric values fail closed", ok: metrics.buildPipelineMetricEvent("pipeline.api.duration", Number.NaN, "milliseconds") === null },
];

console.log(JSON.stringify({
  ok: checks.every((check) => check.ok),
  emitted_metric_count: emitted.length,
  synthetic_api_p95_ms: p95,
  checks,
  note: "All workload values are synthetic and only aggregate counts are emitted.",
}, null, 2));
if (checks.some((check) => !check.ok)) process.exit(1);
