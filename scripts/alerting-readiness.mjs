#!/usr/bin/env node

import { readFileSync } from "node:fs";

const alerts = readFileSync("infra/azure/operational-alerts.bicep", "utf8");
const main = readFileSync("infra/azure/main.bicep", "utf8");
const metrics = readFileSync("lib/observability/pipeline-metrics.ts", "utf8");
const logging = readFileSync("lib/observability/api-logging.ts", "utf8");
const requiredMetrics = [
  "pipeline.referral.save_conflicts",
  "pipeline.queue.oldest_age",
  "pipeline.extraction.failures",
  "pipeline.api.duration",
  "pipeline.api.overload_rejections",
];
const checks = [
  { name: "Azure alert module uses scheduled query rules", ok: alerts.includes("Microsoft.Insights/scheduledQueryRules@2023-12-01") },
  { name: "main infrastructure deploys the alert module", ok: main.includes("module operationalAlerts 'operational-alerts.bicep'") },
  { name: "initial alert deployment tolerates the not-yet-created Container Apps log table", ok: alerts.includes("skipQueryValidation: true") },
  { name: "alert delivery recipients are explicit inputs", ok: main.includes("param alertActionGroupResourceIds array = []") && alerts.includes("actionGroups: actionGroupResourceIds") },
  { name: "all required operational signals have alert queries", ok: requiredMetrics.every((name) => alerts.includes(name)) },
  { name: "authorization and clinical alerts use only route and status metadata", ok: alerts.includes("toint(payload.status) in (401, 403)") && alerts.includes("startswith '/api/clinical/'") },
  { name: "alert queries do not contain PHI dimensions", ok: !/(resident|diagnosis|medication|client_name|document_id|referral_id)/i.test(alerts) },
  { name: "metric dimension registry remains bounded", ok: metrics.includes(".slice(0, 8)") },
  { name: "API logs expose status without URLs or bodies", ok: logging.includes("status: response.status") && !logging.includes("request.url") && !logging.includes("request.body") },
];
console.log(JSON.stringify({ ok: checks.every((item) => item.ok), alert_rule_count: (alerts.match(/key:\s*'/g) ?? []).length, checks }, null, 2));
if (checks.some((item) => !item.ok)) process.exit(1);
