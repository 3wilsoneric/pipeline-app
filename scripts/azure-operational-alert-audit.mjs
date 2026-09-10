#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const resourceGroup = process.env.PIPELINE_AZURE_RESOURCE_GROUP?.trim();
const namePrefix = process.env.PIPELINE_AZURE_NAME_PREFIX?.trim() || "pipeline";
const environment = process.env.PIPELINE_AZURE_ENVIRONMENT?.trim() || "prod";
const strict = process.argv.includes("--strict");
if (!resourceGroup) fail("Configure PIPELINE_AZURE_RESOURCE_GROUP before auditing deployed alerts.");

const bicep = readFileSync("infra/azure/operational-alerts.bicep", "utf8");
const queryKeys = [...bicep.matchAll(/key:\s*'([^']+)'/g)].map((match) => match[1]);
const expectedQueries = queryKeys.map((key) => `${namePrefix}-${environment}-${key}`);
const expectedMetrics = ["postgres-connections", "postgres-storage", "blob-capacity"]
  .map((key) => `${namePrefix}-${environment}-${key}`);

const scheduled = await azJson(["monitor", "scheduled-query", "list", "--resource-group", resourceGroup, "-o", "json"]);
const metrics = await azJson(["monitor", "metrics", "alert", "list", "--resource-group", resourceGroup, "-o", "json"]);
const actionGroups = await azJson(["monitor", "action-group", "list", "--resource-group", resourceGroup, "-o", "json"]);
const queryNames = new Set(scheduled.map((item) => item.name));
const metricNames = new Set(metrics.map((item) => item.name));
const missingQueryAlerts = expectedQueries.filter((name) => !queryNames.has(name));
const missingMetricAlerts = expectedMetrics.filter((name) => !metricNames.has(name));
const receiverCount = actionGroups.reduce((sum, group) => sum + [
  "armRoleReceivers", "automationRunbookReceivers", "azureAppPushReceivers", "azureFunctionReceivers",
  "emailReceivers", "eventHubReceivers", "itsmReceivers", "logicAppReceivers", "smsReceivers",
  "voiceReceivers", "webhookReceivers",
].reduce((groupSum, key) => groupSum + (Array.isArray(group[key]) ? group[key].length : 0), 0), 0);
const enabledQueries = scheduled.filter((item) => item.enabled !== false).length;
const enabledMetrics = metrics.filter((item) => item.enabled !== false).length;
const checks = {
  all_declared_query_alerts_deployed: missingQueryAlerts.length === 0,
  all_declared_metric_alerts_deployed: missingMetricAlerts.length === 0,
  deployed_alerts_enabled: enabledQueries === scheduled.length && enabledMetrics === metrics.length,
  notification_receiver_configured: receiverCount > 0,
};
const ready = Object.values(checks).every(Boolean);

console.log(JSON.stringify({
  ok: strict ? ready : true,
  delivery_ready: ready,
  resource_group: resourceGroup,
  expected: { query_alerts: expectedQueries.length, metric_alerts: expectedMetrics.length },
  deployed: { query_alerts: scheduled.length, enabled_query_alerts: enabledQueries, metric_alerts: metrics.length, enabled_metric_alerts: enabledMetrics, action_groups: actionGroups.length, receivers: receiverCount },
  missing_query_alerts: missingQueryAlerts,
  missing_metric_alerts: missingMetricAlerts,
  checks,
  note: "This read-only audit returns alert names and aggregate delivery configuration only. Default mode reports gaps; strict mode fails until alert coverage and reviewed notification delivery are complete.",
}, null, 2));

if (strict && !ready) process.exit(1);

async function azJson(args) {
  try {
    const { stdout } = await run("az", args, { maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch {
    fail("Azure alert inventory failed. Confirm Azure CLI authentication and resource-group access.");
  }
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_AZURE_RESOURCE_GROUP: Boolean(resourceGroup) } }, null, 2));
  process.exit(1);
}
