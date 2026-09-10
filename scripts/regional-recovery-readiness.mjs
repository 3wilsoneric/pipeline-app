#!/usr/bin/env node

import { readFileSync } from "node:fs";

const infrastructure = readFileSync("infra/azure/main.bicep", "utf8");
const runtime = readFileSync("infra/azure/runtime.bicep", "utf8");
const recoveryVault = readFileSync("infra/azure/recovery-vault.bicep", "utf8");
const recoveryGuide = readFileSync("docs/DATABASE_RECOVERY.md", "utf8");
const regionalGuide = readFileSync("docs/REGIONAL_RECOVERY.md", "utf8");
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
const recoveryKitChecks = {
  secondary_recovery_vault_declared: recoveryVault.includes("purpose: 'regional-recovery'")
    && recoveryVault.includes("database-recovery")
    && recoveryVault.includes("object-recovery")
    && recoveryVault.includes("recovery-evidence"),
  recovery_vault_is_private_and_keyless: recoveryVault.includes("allowBlobPublicAccess: false")
    && recoveryVault.includes("allowSharedKeyAccess: false")
    && recoveryVault.includes("defaultToOAuthAuthentication: true"),
  runtime_can_target_recovery_vault: runtime.includes("param backupStorageAccountName string = storageAccountName")
    && runtime.includes("PIPELINE_BACKUP_STORAGE_ACCOUNT', value: backupStorageAccountName"),
  full_stack_rebuild_template_retained: infrastructure.includes("resource postgres")
    && infrastructure.includes("module operationalAlerts"),
  database_and_object_reconciliation_required: regionalGuide.includes("database-only recovery is not sufficient")
    && regionalGuide.includes("reconcile object count, byte count, and digest inventory"),
  traffic_change_is_gated: regionalGuide.includes("Change traffic only after the incident owner signs the reconciliation record"),
  current_geo_backup_limit_is_explicit: regionalGuide.includes("cannot use paired-region geo-restore"),
};
const backupRestoreReady = Object.values(checks).every(Boolean);
const regionalFailoverReady = Object.values(regionalFailoverChecks).every(Boolean);
const recoveryKitReady = Object.values(recoveryKitChecks).every(Boolean);
const ok = strict ? regionalFailoverReady : backupRestoreReady && recoveryKitReady;

console.log(JSON.stringify({
  ok,
  recovery_level: regionalFailoverReady ? "cross_region_failover" : recoveryKitReady ? "cross_region_cold_recovery_kit" : "zone_resilience_and_backup_restore",
  backup_restore_ready: backupRestoreReady,
  recovery_kit_ready: recoveryKitReady,
  regional_failover_ready: regionalFailoverReady,
  checks,
  regional_failover_checks: regionalFailoverChecks,
  recovery_kit_checks: recoveryKitChecks,
  next_regional_rehearsal: "Approve a secondary region and Azure what-if, deploy the recovery vault, activate database and object copies, then execute a timed synthetic cold-rebuild drill.",
  note: "The default check certifies the repository recovery controls that can be rehearsed without provisioning billable standby infrastructure. Strict mode requires real cross-region topology.",
}, null, 2));

if (!ok) process.exit(1);
