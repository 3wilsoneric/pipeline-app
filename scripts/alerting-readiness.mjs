#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const alerts = readFileSync("infra/azure/operational-alerts.bicep", "utf8");
const main = readFileSync("infra/azure/main.bicep", "utf8");
const runtime = readFileSync("infra/azure/runtime.bicep", "utf8");
const deployment = readFileSync(".github/workflows/deploy-azure.yml", "utf8");
const metricContract = loadTypeScriptModule(process.cwd(), "lib/observability/metric-contract.ts");
const logging = readFileSync("lib/observability/api-logging.ts", "utf8");
const boundedMetric = metricContract.buildPipelineMetricEvent(
  "pipeline.api.duration",
  10,
  "milliseconds",
  {
    route: "/api/referrals",
    method: "GET",
    status_class: "2xx",
    operation: "list",
    result: "success",
    job_type: "request",
    backend: "postgres",
    client_name: "must-be-removed",
    referral_id: "must-be-removed",
  },
  new Date("2026-08-22T12:00:00.000Z"),
);
const requiredMetrics = [
  "pipeline.referral.save_conflicts",
  "pipeline.queue.oldest_age",
  "pipeline.extraction.failures",
  "pipeline.extraction.queue_depth",
  "pipeline.extraction.oldest_age",
  "pipeline.presence.stale_leases",
  "pipeline.storage.failures",
  "pipeline.retention.documents",
  "pipeline.clinical.freshness_age",
  "pipeline.api.duration",
  "pipeline.api.overload_rejections",
];
const checks = [
  { name: "Azure alert module uses scheduled query rules", ok: alerts.includes("Microsoft.Insights/scheduledQueryRules@2023-12-01") },
  { name: "main infrastructure deploys the alert module", ok: main.includes("module operationalAlerts 'operational-alerts.bicep'") },
  { name: "initial alert deployment tolerates the not-yet-created Container Apps log table", ok: alerts.includes("skipQueryValidation: true") },
  { name: "alert delivery recipients are explicit inputs", ok: main.includes("param alertActionGroupResourceIds array = []") && alerts.includes("actionGroups: actionGroupResourceIds") },
  { name: "all required operational signals have alert queries", ok: requiredMetrics.every((name) => alerts.includes(name)) },
  { name: "PostgreSQL connections and capacity use native Azure metrics", ok: alerts.includes("active_connections") && alerts.includes("storage_percent") && alerts.includes("Microsoft.DBforPostgreSQL/flexibleServers") },
  { name: "Blob capacity uses the native UsedCapacity metric", ok: alerts.includes("UsedCapacity") && alerts.includes("Microsoft.Storage/storageAccounts") },
  { name: "Container Apps restarts and resiliency timeouts use native metrics", ok: runtime.includes("RestartCount") && runtime.includes("ResiliencyRequestTimeouts") && runtime.includes("Microsoft.App/containerApps") },
  { name: "runtime alert delivery preserves foundation action groups", ok: main.includes("output alertActionGroupResourceIds") && deployment.includes("alert_action_group_ids") && runtime.includes("param alertActionGroupResourceIds") },
  { name: "authorization and clinical alerts use only route and status metadata", ok: alerts.includes("toint(payload.status) in (401, 403)") && alerts.includes("startswith '/api/clinical/'") },
  { name: "alert queries do not contain PHI dimensions", ok: !/(resident|diagnosis|medication|client_name|document_id|referral_id)/i.test(alerts) },
  {
    name: "metric dimension registry remains bounded",
    ok: Boolean(
      boundedMetric
      && Object.keys(boundedMetric.dimensions).length <= 8
      && boundedMetric.dimensions.route === "/api/referrals"
      && !("client_name" in boundedMetric.dimensions)
      && !("referral_id" in boundedMetric.dimensions)
    ),
  },
  { name: "API logs expose status without URLs or bodies", ok: logging.includes("status: response.status") && !logging.includes("request.url") && !logging.includes("request.body") },
];
console.log(JSON.stringify({ ok: checks.every((item) => item.ok), alert_rule_count: (alerts.match(/key:\s*'/g) ?? []).length, checks }, null, 2));
if (checks.some((item) => !item.ok)) process.exit(1);
