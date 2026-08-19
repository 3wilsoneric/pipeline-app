#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.PIPELINE_TEST_DATABASE_URL?.trim();
if (!databaseUrl) fail("Configure PIPELINE_TEST_DATABASE_URL before running integration fixtures.");
if (databaseUrl === process.env.PIPELINE_DATABASE_URL?.trim() && process.env.PIPELINE_ALLOW_TEST_DATABASE_REUSE !== "true") {
  fail("PIPELINE_TEST_DATABASE_URL must not equal PIPELINE_DATABASE_URL unless PIPELINE_ALLOW_TEST_DATABASE_REUSE=true.");
}
const fixture = await readFile("database/fixtures/integration.sql", "utf8");
const sql = postgres(databaseUrl, databaseOptions(4));
const checks = [];
const rollbackSentinel = new Error("fixture_rollback");

try {
  try {
    await sql.begin(async (tx) => {
      const migrations = await tx`
        select migration_id from pipeline.schema_migrations
        where migration_id in ('0001_pipeline_core','0002_workflow_engine','0003_operational_hardening','0004_document_processing','0005_collaboration','0006_user_workspace_state','0007_canonical_client_assessments')
      `;
      checks.push({ name: "all migrations applied", ok: migrations.length === 7 });
      await tx`
        insert into pipeline.user_workspace_state (
          principal_id, state_kind, state_key, payload, expires_at
        ) values (
          'fixture-user', 'recent_destination', 'page:referrals',
          ${tx.json({ id: "page:referrals", kind: "page", screen: "referrals", title: "Referrals", detail: "Synthetic", visitedAt: new Date(0).toISOString() })},
          now() + interval '1 day'
        )
      `;
      await tx.unsafe(fixture);
      const rows = await tx`
        select
          (select count(*) from pipeline.people where external_client_id = 'pipeline-integration-fixture') as people,
          (select count(*) from pipeline.referrals r join pipeline.people p on p.person_id = r.person_id where p.external_client_id = 'pipeline-integration-fixture') as referrals,
          (select count(*) from pipeline.documents where blob_key = 'fixture/integration/synthetic-fixture.pdf') as documents,
          (select count(*) from pipeline.document_preview_pages p join pipeline.documents d on d.document_id = p.document_id where d.blob_key = 'fixture/integration/synthetic-fixture.pdf') as pages,
          (select count(*) from pipeline.editing_presence where actor_id = 'fixture-user') as presence
          ,(select count(*) from pipeline.user_workspace_state where principal_id = 'fixture-user') as workspace_state
      `;
      checks.push({
        name: "synthetic graph is queryable",
        ok: Number(rows[0].people) === 1 && Number(rows[0].referrals) === 1
          && Number(rows[0].documents) === 1 && Number(rows[0].pages) === 2 && Number(rows[0].presence) === 1
          && Number(rows[0].workspace_state) === 1,
      });
      throw rollbackSentinel;
    });
  } catch (error) {
    if (error !== rollbackSentinel) throw error;
  }
  const remaining = await sql`
    select count(*) as count from pipeline.people where external_client_id = 'pipeline-integration-fixture'
  `;
  checks.push({ name: "fixture transaction rolls back", ok: Number(remaining[0].count) === 0 });
  const failed = checks.filter((check) => !check.ok);
  console.log(JSON.stringify({
    ok: failed.length === 0,
    checks,
    configuration_present: { PIPELINE_TEST_DATABASE_URL: true },
    note: "All values are synthetic and the fixture transaction is rolled back.",
  }, null, 2));
  if (failed.length) process.exitCode = 1;
} catch {
  fail("PostgreSQL integration fixtures failed. Review test database connectivity and migration state.");
} finally {
  await sql.end({ timeout: 5 });
}

function databaseOptions(max) {
  return {
    ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full" ? "verify-full" : "require",
    max,
    connect_timeout: 10,
    idle_timeout: 5,
    prepare: false,
    onnotice: () => undefined,
  };
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_TEST_DATABASE_URL: Boolean(databaseUrl) } }, null, 2));
  process.exit(1);
}
