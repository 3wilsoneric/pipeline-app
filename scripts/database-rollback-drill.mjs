#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.PIPELINE_TEST_DATABASE_URL?.trim();
if (!databaseUrl) fail("Configure PIPELINE_TEST_DATABASE_URL before running a rollback drill.");
if (process.env.PIPELINE_ALLOW_MIGRATION_ROLLBACK_DRILL !== "true") {
  fail("Set PIPELINE_ALLOW_MIGRATION_ROLLBACK_DRILL=true to acknowledge transactional DDL testing.");
}
if (databaseUrl === process.env.PIPELINE_DATABASE_URL?.trim() && process.env.PIPELINE_ALLOW_TEST_DATABASE_REUSE !== "true") {
  fail("The rollback drill cannot target PIPELINE_DATABASE_URL without explicit test database reuse approval.");
}
const collaborationRollback = await readFile("database/rollbacks/0005_collaboration.sql", "utf8");
const workspaceStateRollback = await readFile("database/rollbacks/0006_user_workspace_state.sql", "utf8");
const canonicalClientRollback = await readFile("database/rollbacks/0007_canonical_client_assessments.sql", "utf8");
const clientWorkspaceRollback = await readFile("database/rollbacks/0008_client_workspaces.sql", "utf8");
const assessmentCollaborationRollback = await readFile("database/rollbacks/0009_assessment_collaboration.sql", "utf8");
const provisionalMembersRollback = await readFile("database/rollbacks/0010_provisional_workspace_members.sql", "utf8");
const historicalWorkspacesRollback = await readFile("database/rollbacks/0011_historical_material_workspaces.sql", "utf8");
const sql = postgres(databaseUrl, {
  ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full" ? "verify-full" : "require",
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  prepare: false,
  onnotice: () => undefined,
});
const connection = await sql.reserve();
const checks = [];

try {
  await connection`select pg_advisory_lock(hashtextextended('pipeline_schema_migrations', 0))`;
  await connection`begin`;
  const before = await connection`
    select to_regclass('pipeline.editing_presence') is not null as presence,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='section_versions') as sections,
      to_regclass('pipeline.user_workspace_state') is not null as workspace_state,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='assessments' and column_name='canonical_client_id') as canonical_client,
      to_regclass('pipeline.client_update_outbox') is not null as client_update_outbox,
      exists(select 1 from pipeline.schema_migrations where migration_id='0007_canonical_client_assessments') as canonical_client_history,
      to_regclass('pipeline.client_file_import_items') is not null as client_file_import_items,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='documents' and column_name='canonical_client_id') as client_document_identity,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='documents' and column_name='client_community') as client_document_community,
      exists(select 1 from pipeline.schema_migrations where migration_id='0008_client_workspaces') as client_workspace_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='assessments' and column_name='section_versions') as assessment_sections,
      to_regclass('pipeline.workspace_members') is not null as workspace_members,
      exists(select 1 from pipeline.schema_migrations where migration_id='0009_assessment_collaboration') as assessment_collaboration_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='workspace_members' and column_name='identity_status') as provisional_member_identity,
      exists(select 1 from pipeline.schema_migrations where migration_id='0010_provisional_workspace_members') as provisional_member_history,
      to_regclass('pipeline.workspace_import_batches') is not null as workspace_import_batches,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='workspace_status') as workspace_status,
      exists(select 1 from pipeline.schema_migrations where migration_id='0011_historical_material_workspaces') as historical_workspace_history
  `;
  checks.push({
    name: "latest migrations exist before drill",
    ok: Boolean(
      before[0].presence
      && before[0].sections
      && before[0].workspace_state
      && before[0].canonical_client
      && before[0].client_update_outbox
      && before[0].canonical_client_history
      && before[0].client_file_import_items
      && before[0].client_document_identity
      && before[0].client_document_community
      && before[0].client_workspace_history
      && before[0].assessment_sections
      && before[0].workspace_members
      && before[0].assessment_collaboration_history
      && before[0].provisional_member_identity
      && before[0].provisional_member_history
      && before[0].workspace_import_batches
      && before[0].workspace_status
      && before[0].historical_workspace_history
    ),
  });
  await connection.unsafe(historicalWorkspacesRollback);
  const historicalWorkspacesDuring = await connection`
    select to_regclass('pipeline.workspace_import_batches') is null as import_batches_removed,
      not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='workspace_status') as workspace_status_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0011_historical_material_workspaces') as history_removed
  `;
  checks.push({
    name: "rollback removes historical workspace extensions",
    ok: Boolean(
      historicalWorkspacesDuring[0].import_batches_removed
      && historicalWorkspacesDuring[0].workspace_status_removed
      && historicalWorkspacesDuring[0].history_removed
    ),
  });
  await connection.unsafe(provisionalMembersRollback);
  const provisionalMembersDuring = await connection`
    select to_regclass('pipeline.workspace_members') is not null as workspace_members_preserved,
      not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='workspace_members' and column_name='identity_status') as identity_status_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0010_provisional_workspace_members') as history_removed
  `;
  checks.push({
    name: "rollback removes provisional-member identity extensions",
    ok: Boolean(
      provisionalMembersDuring[0].workspace_members_preserved
      && provisionalMembersDuring[0].identity_status_removed
      && provisionalMembersDuring[0].history_removed
    ),
  });
  await connection.unsafe(assessmentCollaborationRollback);
  const assessmentCollaborationDuring = await connection`
    select to_regclass('pipeline.workspace_members') is null as workspace_members_removed,
      not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='assessments' and column_name='section_versions') as assessment_sections_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0009_assessment_collaboration') as history_removed,
      exists(
        select 1 from information_schema.check_constraints
        where constraint_schema = 'pipeline'
          and constraint_name = 'user_workspace_state_state_kind_check'
          and check_clause not like '%assessment_draft%'
      ) as assessment_drafts_removed
  `;
  checks.push({
    name: "rollback removes assessment-collaboration objects",
    ok: Boolean(
      assessmentCollaborationDuring[0].workspace_members_removed
      && assessmentCollaborationDuring[0].assessment_sections_removed
      && assessmentCollaborationDuring[0].history_removed
      && assessmentCollaborationDuring[0].assessment_drafts_removed
    ),
  });
  await connection.unsafe(clientWorkspaceRollback);
  const clientWorkspaceDuring = await connection`
    select to_regclass('pipeline.client_file_import_items') is null as import_items_removed,
      not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='documents' and column_name='canonical_client_id') as client_document_identity_removed,
      not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='documents' and column_name='client_community') as client_document_community_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0008_client_workspaces') as history_removed
  `;
  checks.push({
    name: "rollback removes client-workspace objects",
    ok: Boolean(clientWorkspaceDuring[0].import_items_removed && clientWorkspaceDuring[0].client_document_identity_removed && clientWorkspaceDuring[0].client_document_community_removed && clientWorkspaceDuring[0].history_removed),
  });
  await connection.unsafe(canonicalClientRollback);
  const canonicalClientDuring = await connection`
    select to_regclass('pipeline.client_update_outbox') is null as client_update_outbox_removed,
      not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='assessments' and column_name='canonical_client_id') as canonical_client_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0007_canonical_client_assessments') as history_removed
  `;
  checks.push({
    name: "rollback removes canonical-client objects",
    ok: Boolean(
      canonicalClientDuring[0].client_update_outbox_removed
      && canonicalClientDuring[0].canonical_client_removed
      && canonicalClientDuring[0].history_removed
    ),
  });
  await connection.unsafe(workspaceStateRollback);
  const workspaceDuring = await connection`
    select to_regclass('pipeline.user_workspace_state') is null as workspace_state_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0006_user_workspace_state') as history_removed
  `;
  checks.push({ name: "rollback removes workspace-state objects", ok: Boolean(workspaceDuring[0].workspace_state_removed && workspaceDuring[0].history_removed) });
  await connection.unsafe(collaborationRollback);
  const during = await connection`
    select to_regclass('pipeline.editing_presence') is null as presence_removed,
      not exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='section_versions') as sections_removed,
      not exists(select 1 from pipeline.schema_migrations where migration_id='0005_collaboration') as history_removed
  `;
  checks.push({ name: "rollback removes collaboration objects", ok: Boolean(during[0].presence_removed && during[0].sections_removed && during[0].history_removed) });
  await connection`rollback`;
  const after = await connection`
    select to_regclass('pipeline.editing_presence') is not null as presence,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='section_versions') as sections,
      exists(select 1 from pipeline.schema_migrations where migration_id='0005_collaboration') as collaboration_history,
      to_regclass('pipeline.user_workspace_state') is not null as workspace_state,
      exists(select 1 from pipeline.schema_migrations where migration_id='0006_user_workspace_state') as workspace_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='assessments' and column_name='canonical_client_id') as canonical_client,
      to_regclass('pipeline.client_update_outbox') is not null as client_update_outbox,
      exists(select 1 from pipeline.schema_migrations where migration_id='0007_canonical_client_assessments') as canonical_client_history,
      to_regclass('pipeline.client_file_import_items') is not null as client_file_import_items,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='documents' and column_name='canonical_client_id') as client_document_identity,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='documents' and column_name='client_community') as client_document_community,
      exists(select 1 from pipeline.schema_migrations where migration_id='0008_client_workspaces') as client_workspace_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='assessments' and column_name='section_versions') as assessment_sections,
      to_regclass('pipeline.workspace_members') is not null as workspace_members,
      exists(select 1 from pipeline.schema_migrations where migration_id='0009_assessment_collaboration') as assessment_collaboration_history,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='workspace_members' and column_name='identity_status') as provisional_member_identity,
      exists(select 1 from pipeline.schema_migrations where migration_id='0010_provisional_workspace_members') as provisional_member_history,
      to_regclass('pipeline.workspace_import_batches') is not null as workspace_import_batches,
      exists(select 1 from information_schema.columns where table_schema='pipeline' and table_name='referrals' and column_name='workspace_status') as workspace_status,
      exists(select 1 from pipeline.schema_migrations where migration_id='0011_historical_material_workspaces') as historical_workspace_history
  `;
  checks.push({
    name: "drill transaction restores original schema",
    ok: Boolean(
      after[0].presence
      && after[0].sections
      && after[0].collaboration_history
      && after[0].workspace_state
      && after[0].workspace_history
      && after[0].canonical_client
      && after[0].client_update_outbox
      && after[0].canonical_client_history
      && after[0].client_file_import_items
      && after[0].client_document_identity
      && after[0].client_document_community
      && after[0].client_workspace_history
      && after[0].assessment_sections
      && after[0].workspace_members
      && after[0].assessment_collaboration_history
      && after[0].provisional_member_identity
      && after[0].provisional_member_history
      && after[0].workspace_import_batches
      && after[0].workspace_status
      && after[0].historical_workspace_history
    ),
  });
  const failed = checks.filter((check) => !check.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, checks, transactional: true }, null, 2));
  if (failed.length) process.exitCode = 1;
} catch {
  await connection`rollback`.catch(() => undefined);
  fail("The migration rollback drill failed. The transaction was rolled back.");
} finally {
  await connection`select pg_advisory_unlock(hashtextextended('pipeline_schema_migrations', 0))`.catch(() => undefined);
  connection.release();
  await sql.end({ timeout: 5 });
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_TEST_DATABASE_URL: Boolean(databaseUrl) } }, null, 2));
  process.exit(1);
}
