#!/usr/bin/env node

import { readFileSync } from "node:fs";

const migration = readFileSync("database/migrations/0006_user_workspace_state.sql", "utf8");
const store = readFileSync("lib/pipeline/user-workspace-state-store.ts", "utf8");
const retentionRoute = readFileSync("app/api/internal/retention/route.ts", "utf8");
const purge = readFileSync("scripts/purge-user-workspace-state.mjs", "utf8");
const runbook = readFileSync("docs/DATABASE_RECOVERY.md", "utf8");
const referralTrashMigration = readFileSync("database/migrations/0012_referral_trash.sql", "utf8");
const referralRetention = readFileSync("lib/pipeline/referral-retention.ts", "utf8");
const retentionPolicy = readFileSync("docs/RETENTION_POLICY.md", "utf8");
const runtime = readFileSync("infra/azure/runtime.bicep", "utf8");
const deployment = readFileSync(".github/workflows/deploy-azure.yml", "utf8");
const checks = [
  ["workspace state has an indexed explicit expiry", migration.includes("expires_at timestamptz not null") && migration.includes("user_workspace_state_expiry_idx")],
  ["retention deletes workspace state in bounded batches", store.includes("pruneExpiredUserWorkspaceState") && store.includes("limit ${limit}")],
  ["internal retention includes workspace state", retentionRoute.includes("pruneExpiredUserWorkspaceState(100, dryRun)")],
  ["per-user purge defaults to dry run", purge.includes('const execute = process.argv.includes("--execute")')],
  ["per-user purge requires two-part confirmation", purge.includes("PIPELINE_ALLOW_USER_STATE_PURGE") && purge.includes("PURGE_USER_WORKSPACE_STATE")],
  ["per-user purge serializes against competing cleanup", purge.includes("pg_advisory_xact_lock")],
  ["per-user purge never emits the principal", purge.includes("principal_configured: true") && !purge.includes("principal_id: principalId")],
  ["recovery runbook documents account-state cleanup", runbook.includes("User workspace-state cleanup")],
  ["referral trash stores an indexed deletion deadline", referralTrashMigration.includes("delete_after timestamptz") && referralTrashMigration.includes("referrals_trash_retention_idx")],
  ["expired referral purge is bounded and removes private blobs", referralRetention.includes("limit ${Math.min(500") && referralRetention.includes("signer.deleteBlob")],
  ["internal retention includes expired referrals", retentionRoute.includes("purgeExpiredReferrals(100, dryRun)")],
  ["retention only counts a referral removed after a guarded delete", referralRetention.includes("and delete_after <= now()") && referralRetention.includes("if (removed) deleted += 1")],
  ["retention policy documents the 30-day recovery window", retentionPolicy.includes("30 days") && retentionPolicy.includes("permanently")],
  ["Azure retention schedule requires explicit deployment approval", runtime.includes("param enableRetentionJob bool = false")],
  ["deployment keeps retention enabled by default", deployment.includes("enable_retention_job:") && deployment.includes("default: true")],
].map(([name, ok]) => ({ name, ok: Boolean(ok) }));
const failed = checks.filter((check) => !check.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
if (failed.length > 0) process.exit(1);
