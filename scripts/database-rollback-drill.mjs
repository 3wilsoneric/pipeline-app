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
      to_regclass('pipeline.user_workspace_state') is not null as workspace_state
  `;
  checks.push({ name: "latest migrations exist before drill", ok: Boolean(before[0].presence && before[0].sections && before[0].workspace_state) });
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
      exists(select 1 from pipeline.schema_migrations where migration_id='0006_user_workspace_state') as workspace_history
  `;
  checks.push({
    name: "drill transaction restores original schema",
    ok: Boolean(after[0].presence && after[0].sections && after[0].collaboration_history && after[0].workspace_state && after[0].workspace_history),
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
