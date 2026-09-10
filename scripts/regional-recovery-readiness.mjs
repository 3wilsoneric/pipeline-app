#!/usr/bin/env node

import { readFileSync } from "node:fs";

const infrastructure = readFileSync("infra/azure/main.bicep", "utf8");
const recoveryGuide = readFileSync("docs/DATABASE_RECOVERY.md", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const strict = process.argv.includes("--require-regional-failover");

const checks = {
  production_blob_storage_is_zone_redundant: infrastructure.includes("environment == 'prod' ? 'Standard_ZRS'"),
  database_ha_is_an_explicit_cost_choice: infrastructure.includes("databaseServiceLevel") && infrastructure.includes("production_ha"),
  production_ha_enables_zone_standby: infrastructure.includes("highAvailabilityDatabase ? 'ZoneRedundant'"),
  production_ha_enables_geo_backup: infrastructure.includes("geoRedundantBackup: highAvailabilityDatabase ? 'Enabled'"),
  logical_backup_is_automated: Boolean(packageJson.scripts["database:backup"]),
  destructive_restore_requires_disposable_confirmation: recoveryGuide.includes("PIPELINE_ALLOW_RESTORE_DRILL=true") && recoveryGuide.includes("--confirm-disposable"),
};
const regionalFailoverChecks = {
  secondary_region_declared: /secondary(?:Location|Region)/.test(infrastructure),
  cross_region_runtime_declared: /module\s+\w+\s+'runtime\.bicep'.*module\s+\w+\s+'runtime\.bicep'/s.test(infrastructure),
  automated_traffic_failover_declared: /front\s*door|traffic\s*manager/i.test(infrastructure),
};
const backupRestoreReady = Object.values(checks).every(Boolean);
const regionalFailoverReady = Object.values(regionalFailoverChecks).every(Boolean);
const ok = strict ? regionalFailoverReady : backupRestoreReady;

console.log(JSON.stringify({
  ok,
  recovery_level: regionalFailoverReady ? "cross_region_failover" : "zone_resilience_and_backup_restore",
  backup_restore_ready: backupRestoreReady,
  regional_failover_ready: regionalFailoverReady,
  checks,
  regional_failover_checks: regionalFailoverChecks,
  next_regional_rehearsal: "Provision a secondary regional runtime and database recovery target only after cost and recovery objectives are owner-approved; then execute DNS/traffic failover against synthetic data.",
  note: "The default check certifies the repository recovery controls that can be rehearsed without provisioning billable standby infrastructure. Strict mode requires real cross-region topology.",
}, null, 2));

if (!ok) process.exit(1);
