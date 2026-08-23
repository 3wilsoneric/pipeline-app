#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), "utf8");
const metrics = read("lib/observability/pipeline-metrics.ts");
const metricContract = read("lib/observability/metric-contract.ts");
const apiLogging = read("lib/observability/api-logging.ts");
const referralRoute = read("app/api/referrals/[referralId]/route.ts");
const workItemRoute = read("app/api/referrals/[referralId]/work-items/[workItemId]/route.ts");
const ehrHandoffRoute = read("app/api/referrals/[referralId]/ehr-handoff/route.ts");
const presence = read("lib/pipeline/editing-presence.ts");
const extraction = read("lib/extraction/processing-worker.ts");
const storage = read("lib/extraction/storage-inventory.ts");
const blob = read("lib/extraction/azure-blob.ts");
const clinicalHealth = read("app/api/clinical/health/route.ts");
const operations = read("lib/pipeline/operations-snapshot.ts");
const governor = read("lib/reliability/request-governor.ts");

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

check("save conflicts are counted", referralRoute.includes('"pipeline.referral.save_conflicts"'));
check("work-item conflicts are counted", workItemRoute.includes('"pipeline.referral.save_conflicts"'));
check("EHR handoff actions and conflicts are counted", ehrHandoffRoute.includes('"pipeline.ehr_handoff.actions"') && ehrHandoffRoute.includes('"pipeline.referral.save_conflicts"'));
check("expired presence leases are counted", presence.includes('"pipeline.presence.stale_leases"'));
check("all extraction failure dispositions are counted", extraction.includes('"pipeline.extraction.failures"') && extraction.indexOf('"pipeline.extraction.failures"') > extraction.indexOf("async function failOrRetry"));
check("extraction queue depth and age are measured", extraction.includes('"pipeline.extraction.queue_depth"') && extraction.includes('"pipeline.extraction.oldest_age"'));
check("storage capacity is measured without record dimensions", storage.includes('"pipeline.storage.source_bytes"') && storage.includes('"pipeline.storage.preview_bytes"') && storage.includes('"pipeline.storage.artifact_bytes"'));
check("storage operation failures are counted", blob.includes('"pipeline.storage.failures"'));
check("clinical snapshot freshness is measured", clinicalHealth.includes('"pipeline.clinical.freshness_age"') && clinicalHealth.includes('"pipeline.clinical.freshness_status"'));
check("oldest active queue age is measured", operations.includes('"pipeline.queue.oldest_age"'));
check("supervisor exception volume is measured", operations.includes('"pipeline.queue.supervisor_exceptions"'));
check("API response latency includes normal responses", apiLogging.match(/"pipeline\.api\.duration"/g)?.length === 2);
check("API response latency includes thrown failures", apiLogging.includes('status_class: "5xx"'));
check("overload rejections are counted", apiLogging.includes('"pipeline.api.overload_rejections"') && governor.includes("createOverloadResponse"));
check("metric names and values are validated", metricContract.includes("Number.isFinite(value)") && metricContract.includes("/^[a-z][a-z0-9_.]{2,80}$/"));

const forbiddenDimensions = [
  "name",
  "client_name",
  "resident_id",
  "resident_key",
  "diagnosis",
  "medication",
  "token",
  "secret",
  "error",
  "error_code",
  "document_id",
  "referral_id",
];
const allowedDimensionBlock = metricContract.slice(
  metricContract.indexOf("const allowedDimensions"),
  metricContract.indexOf("]);", metricContract.indexOf("const allowedDimensions")) + 3,
);
check(
  "metric dimensions exclude PHI and high-cardinality identifiers",
  forbiddenDimensions.every((dimension) => !allowedDimensionBlock.includes(`"${dimension}"`)),
);
check("metric dimensions are capped", metricContract.includes(".slice(0, 8)"));
check("metric emission uses the tested contract", metrics.includes("buildPipelineMetricEvent"));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({
  ok: failed.length === 0,
  checks,
  emitted_values: "counts, milliseconds, bytes, and bounded low-cardinality dimensions only",
}, null, 2));
if (failed.length > 0) process.exit(1);
