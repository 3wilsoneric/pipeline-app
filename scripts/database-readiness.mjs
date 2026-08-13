#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), "utf8");
const migration = read("database/migrations/0001_pipeline_core.sql");
const workflowMigration = read("database/migrations/0002_workflow_engine.sql");
const hardeningMigration = read("database/migrations/0003_operational_hardening.sql");
const documentMigration = read("database/migrations/0004_document_processing.sql");
const collaborationMigration = read("database/migrations/0005_collaboration.sql");
const workspaceStateMigration = read("database/migrations/0006_user_workspace_state.sql");
const migrationRunner = read("scripts/apply-database-migrations.mjs");
const productionBootstrap = read("scripts/bootstrap-production-database.mjs");
const databaseAdapter = read("lib/database/pipeline-database.ts");
const referralStore = read("lib/pipeline/referral-store.ts");
const assessmentStore = read("lib/assessment/assessment-store.ts");
const linkStore = read("lib/pipeline/resident-link-store.ts");
const workflowStore = read("lib/pipeline/workflow-store.ts");
const presenceStore = read("lib/pipeline/editing-presence.ts");
const unifiedProfile = read("lib/pipeline/unified-profile.ts");
const integrationFixture = read("database/fixtures/integration.sql");
const integrationFixtureRunner = read("scripts/postgres-integration-fixtures.mjs");
const collaborationRollback = read("database/rollbacks/0005_collaboration.sql");
const workspaceStateRollback = read("database/rollbacks/0006_user_workspace_state.sql");
const rollbackDrill = read("scripts/database-rollback-drill.mjs");
const productionSeed = read("scripts/seed-production-reference-data.mjs");
const pilotReset = read("scripts/pilot-reset.mjs");
const liveSmoke = read("scripts/postgres-live-smoke.mjs");
const restoreVerify = read("scripts/database-restore-verify.mjs");
const workspacePurge = read("scripts/purge-user-workspace-state.mjs");
const ci = read(".github/workflows/ci.yml");
const envExample = read(".env.example");

const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

for (const table of [
  "people",
  "store_revisions",
  "referrals",
  "referral_fields",
  "documents",
  "extraction_jobs",
  "assessments",
  "assessment_field_provenance",
  "assessment_unmapped_fields",
  "work_items",
  "admission_decisions",
  "resident_links",
  "audit_events",
  "idempotency_keys",
]) {
  check(`migration creates pipeline.${table}`, migration.includes(`pipeline.${table}`));
}
for (const table of [
  "packet_uploads",
  "packet_upload_files",
  "extraction_candidates",
  "field_review_events",
  "document_preview_pages",
  "document_artifacts",
  "retention_events",
]) {
  check(`document migration creates pipeline.${table}`, documentMigration.includes(`pipeline.${table}`));
}

check(
  "confirmed Alamo residents are unique",
  migration.includes("resident_links_confirmed_resident_unique_idx") &&
    migration.includes("on pipeline.resident_links(resident_key)"),
);
check(
  "confirmed Pipeline people are unique",
  migration.includes("resident_links_confirmed_person_unique_idx") &&
    migration.includes("on pipeline.resident_links(person_id)"),
);
check(
  "active duplicate resident-link candidates are unique",
  migration.includes("resident_links_active_pair_unique_idx") &&
    migration.includes("on pipeline.resident_links(person_id, resident_key)"),
);
check("database adapter is server-only", databaseAdapter.includes('import "server-only"'));
check("referral adapter is server-only", referralStore.includes('import "server-only"'));
check("assessment adapter is server-only", assessmentStore.includes('import "server-only"'));
check("resident-link adapter is server-only", linkStore.includes('import "server-only"'));
check("workflow adapter is server-only", workflowStore.includes('import "server-only"'));
check("presence adapter is server-only", presenceStore.includes('import "server-only"'));
check("referral writes are transactional", referralStore.includes("sql.begin(async (tx)"));
check("assessment writes are transactional", assessmentStore.includes("sql.begin(async (tx)"));
check("resident-link writes are transactional", linkStore.includes("sql.begin(async (tx)"));
check("workflow writes are transactional", workflowStore.includes("sql.begin(async (tx)"));
check("referral edits use optimistic versions", referralStore.includes("r.version = ${currentVersion}"));
check("assessment edits use optimistic versions", assessmentStore.includes("version = ${expectedVersion}"));
check("resident-link review uses optimistic versions", linkStore.includes("version = ${expectedVersion}"));
check("workflow item edits use optimistic versions", workflowStore.includes("version = ${expectedVersion}"));
check("referral retries use idempotency locks", referralStore.includes("referral_create:${mutationId}"));
check("assessment retries use idempotency locks", assessmentStore.includes("lockIdempotencyMutation"));
check("referral writes create audit events", referralStore.includes("writeReferralAudit"));
check("assessment writes create audit events", assessmentStore.includes("writeAssessmentAudit"));
check("workflow writes create audit events", workflowStore.includes("writeWorkflowAudit"));
check("assessment provenance is persisted", assessmentStore.includes("insertAssessmentProvenance"));
check("unmapped assessment values are retained", assessmentStore.includes("insertAssessmentUnmapped"));
check(
  "packet hashes cannot duplicate within the referral store",
  migration.includes("referrals_document_sha256_unique_idx"),
);
check("resident-link confirmation detects collisions", linkStore.includes("resident_already_linked"));
check("resident-link confirmation serializes competing reviews", linkStore.includes("pg_advisory_xact_lock"));
check("unified profile requires a confirmed link", unifiedProfile.includes('link.status === "confirmed"'));
check("unified profile forbids implicit name matching", unifiedProfile.includes("will not be matched by name"));
check("database URL remains server-only", !/NEXT_PUBLIC_PIPELINE_DATABASE_URL/.test(envExample));
check("workflow migration versions work-item evidence", workflowMigration.includes("evidence_document_name"));
check("workflow migration records decision actor names", workflowMigration.includes("decided_by_name"));
check("workflow migration adds a workflow revision", workflowMigration.includes("values ('workflow')"));
check("migration history records checksums", hardeningMigration.includes("checksum_sha256"));
check("durable documents track preview state", hardeningMigration.includes("preview_status"));
check("durable documents track malware state", hardeningMigration.includes("malware_scan_status"));
check("document deletion is recoverable", hardeningMigration.includes("deleted_at"));
check("extraction jobs use worker leases", hardeningMigration.includes("lease_expires_at"));
check("extraction jobs have an explicit dead letter", documentMigration.includes("dead_letter"));
check("upload reservations are durable", documentMigration.includes("packet_upload_files"));
check("field candidates preserve extraction alternatives", documentMigration.includes("extraction_candidates"));
check("worker derivatives have a retention manifest", documentMigration.includes("document_artifacts"));
check("review actions have a durable audit trail", documentMigration.includes("field_review_events"));
check("referrals have independently versioned collaboration sections", collaborationMigration.includes("section_versions"));
check("editing presence uses expiring leases", collaborationMigration.includes("editing_presence") && collaborationMigration.includes("expires_at"));
check("per-user workspace state has composite ownership", workspaceStateMigration.includes("primary key (principal_id, state_kind, state_key)"));
check("per-user workspace state expires", workspaceStateMigration.includes("expires_at") && workspaceStateMigration.includes("user_workspace_state_expiry_idx"));
check("per-user workspace state is typed", workspaceStateMigration.includes("recent_destination") && workspaceStateMigration.includes("referral_draft"));
check("high-volume lists have keyset indexes", documentMigration.includes("referrals_updated_keyset_idx") && documentMigration.includes("documents_uploaded_keyset_idx"));
check("migration runner serializes deployments", migrationRunner.includes("pg_advisory_lock"));
check("migration runner rejects changed migration history", migrationRunner.includes("migration_checksum_mismatch"));
check("migration runner backfills historical checksums atomically", migrationRunner.includes("checksum_sha256 is null"));
check("production role passwords use PostgreSQL identifier and literal quoting", productionBootstrap.includes("'alter role %I password %L'") && productionBootstrap.includes("${role}::text") && productionBootstrap.includes("${password}::text") && !productionBootstrap.includes("alter role pipeline_migrator password ${"));
check("bootstrap migrator elevation is temporary and fail-safe", productionBootstrap.includes("grant create on database pipeline to pipeline_migrator") && (productionBootstrap.match(/revoke create on database pipeline from pipeline_migrator/g) ?? []).length === 2 && !productionBootstrap.includes("grant create on database pipeline to pipeline_runtime"));
check("integration fixture is explicitly synthetic", integrationFixture.includes("pipeline-integration-fixture") && integrationFixture.includes("Synthetic integration fixture"));
check("integration fixtures are transactionally rolled back", integrationFixtureRunner.includes("sql.begin(async (tx)") && integrationFixtureRunner.includes("fixture_rollback"));
check("integration fixtures require a separate test database", integrationFixtureRunner.includes("PIPELINE_TEST_DATABASE_URL") && integrationFixtureRunner.includes("PIPELINE_ALLOW_TEST_DATABASE_REUSE"));
check("collaboration rollback removes only migration 0005 objects", collaborationRollback.includes("editing_presence") && collaborationRollback.includes("0005_collaboration") && !collaborationRollback.includes("drop schema"));
check("workspace-state rollback removes only migration 0006 objects", workspaceStateRollback.includes("user_workspace_state") && workspaceStateRollback.includes("0006_user_workspace_state") && !workspaceStateRollback.includes("drop schema"));
check("rollback drill is transactional and opt-in", rollbackDrill.includes("PIPELINE_ALLOW_MIGRATION_ROLLBACK_DRILL") && rollbackDrill.includes("rollback") && rollbackDrill.includes("pg_advisory_lock"));
check("production seed creates reference rows only", productionSeed.includes("synthetic_client_rows: 0") && !productionSeed.includes("insert into pipeline.people") && !productionSeed.includes("insert into pipeline.referrals"));
check("production seed requires the latest workspace-state migration", productionSeed.includes("0006_user_workspace_state") && productionSeed.includes("migrations.length !== 6"));
check("live database smoke requires and writes through migration 0006", liveSmoke.includes("0006_user_workspace_state") && liveSmoke.includes("pipeline.user_workspace_state"));
check("restore verification includes workspace state", restoreVerify.includes("pipeline.user_workspace_state"));
check("account-state purge is dry-run-first and identity-redacted", workspacePurge.includes('mode: execute ? "execute" : "dry_run"') && workspacePurge.includes("principal_configured: true"));
check("CI exercises PostgreSQL migrations, rollback, fixtures, and contention", ["postgres:16", "database:migrate", "database:fixtures", "database:rollback:drill", "check:collaboration-load"].every((term) => ci.includes(term)));
check("pilot reset defaults to dry run", pilotReset.includes('mode: "dry_run"') && pilotReset.includes("const execute = process.argv.includes(\"--execute\")"));
check("pilot reset requires two-part confirmation", pilotReset.includes("PIPELINE_PILOT_RESET_ENABLED") && pilotReset.includes("--confirm=RESET_PIPELINE_PILOT"));
check("pilot reset excludes confirmed clinical links", pilotReset.includes("confirmed_links > 0") && pilotReset.includes("l.status = 'confirmed'"));

const failed = checks.filter((item) => !item.ok);
const requiredVariables = [
  "PIPELINE_DATABASE_MODE",
  "PIPELINE_DATABASE_URL",
  "PIPELINE_DATABASE_SSL_MODE",
  "PIPELINE_REFERRAL_STORE_MODE",
  "PIPELINE_ASSESSMENT_STORE_MODE",
  "PIPELINE_RESIDENT_LINK_STORE_MODE",
];
const configuration = Object.fromEntries(
  requiredVariables.map((name) => [name, Boolean(process.env[name]?.trim())]),
);

console.log(JSON.stringify({
  ok: failed.length === 0,
  migrations: ["0001_pipeline_core", "0002_workflow_engine", "0003_operational_hardening", "0004_document_processing", "0005_collaboration", "0006_user_workspace_state"],
  checks,
  configuration_present: configuration,
  note: "Configuration reports presence only; values are never printed.",
}, null, 2));

if (failed.length > 0) process.exit(1);
