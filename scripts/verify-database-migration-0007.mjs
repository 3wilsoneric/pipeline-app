#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import postgres from "postgres";

const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();
if (!databaseUrl) fail("Configure PIPELINE_DATABASE_URL before verifying migration 0007.");

const migrationId = "0007_canonical_client_assessments";
const migrationSource = await readFile(`database/migrations/${migrationId}.sql`, "utf8");
const expectedChecksum = createHash("sha256").update(migrationSource).digest("hex");
const sql = postgres(databaseUrl, {
  ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable"
    ? false
    : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full"
      ? "verify-full"
      : "require",
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  prepare: false,
  onnotice: () => undefined,
});

try {
  const rows = await sql`
    select
      exists(
        select 1 from pipeline.schema_migrations
        where migration_id = ${migrationId}
          and checksum_sha256 = ${expectedChecksum}
      ) as migration_checksum_matches,
      exists(
        select 1 from information_schema.columns
        where table_schema = 'pipeline'
          and table_name = 'assessments'
          and column_name = 'canonical_client_id'
      ) as canonical_client_column_exists,
      to_regclass('pipeline.assessments_canonical_client_date_idx') is not null as canonical_client_index_exists,
      to_regclass('pipeline.client_update_outbox') is not null as client_update_outbox_exists
  `;
  const grants = await sql`
    select privilege_type
    from information_schema.role_table_grants
    where grantee = 'pipeline_runtime'
      and table_schema = 'pipeline'
      and table_name = 'client_update_outbox'
    order by privilege_type
  `;
  const actualGrants = grants.map((row) => row.privilege_type);
  const expectedGrants = ["DELETE", "INSERT", "SELECT", "UPDATE"];
  const checks = [
    { name: "migration checksum matches", ok: Boolean(rows[0]?.migration_checksum_matches) },
    { name: "canonical client column exists", ok: Boolean(rows[0]?.canonical_client_column_exists) },
    { name: "canonical client index exists", ok: Boolean(rows[0]?.canonical_client_index_exists) },
    { name: "client update outbox exists", ok: Boolean(rows[0]?.client_update_outbox_exists) },
    { name: "runtime table grants are exact", ok: JSON.stringify(actualGrants) === JSON.stringify(expectedGrants) },
  ];
  const failed = checks.filter((check) => !check.ok);
  console.log(JSON.stringify({
    ok: failed.length === 0,
    migration: migrationId,
    checks,
    configuration_present: { PIPELINE_DATABASE_URL: true },
    note: "Verification reads schema metadata and grants only; it does not read client records.",
  }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
} catch {
  fail("Migration 0007 verification failed. No connection details or row data were logged.");
} finally {
  await sql.end({ timeout: 5 });
}

function fail(message) {
  console.error(JSON.stringify({
    ok: false,
    error: message,
    configuration_present: { PIPELINE_DATABASE_URL: Boolean(databaseUrl) },
  }, null, 2));
  process.exit(1);
}
