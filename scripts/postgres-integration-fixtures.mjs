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
        where migration_id in ('0001_pipeline_core','0002_workflow_engine','0003_operational_hardening','0004_document_processing','0005_collaboration','0006_user_workspace_state','0007_canonical_client_assessments','0008_client_workspaces','0009_assessment_collaboration','0010_provisional_workspace_members','0011_historical_material_workspaces','0012_referral_trash','0013_search_performance','0014_workspace_county','0015_assessor_workflow')
      `;
      checks.push({ name: "all migrations applied", ok: migrations.length === 15 });
      await tx`
        insert into pipeline.user_workspace_state (
          principal_id, state_kind, state_key, payload, expires_at
        ) values (
          'fixture-user', 'recent_destination', 'page:referrals',
          ${tx.json({ id: "page:referrals", kind: "page", screen: "referrals", title: "Referrals", detail: "Synthetic", visitedAt: new Date(0).toISOString() })},
          now() + interval '1 day'
        )
      `;
      await tx`
        insert into pipeline.user_workspace_state (
          principal_id, state_kind, state_key, payload, expires_at
        ) values (
          'fixture-user', 'assessment_draft', 'assessment:fixture',
          ${tx.json({ assessment_id: "fixture", saved_at: new Date(0).toISOString(), base_version: 1, section_versions: { identity: 1 }, dirty_sections: ["identity"], data: {}, base_data: {} })},
          now() + interval '1 day'
        )
      `;
      await tx`
        insert into pipeline.workspace_members (
          principal_id, display_name, email, roles, identity_status
        ) values (
          'fixture-user', 'Synthetic Fixture User', 'fixture@example.invalid', array['reviewer'], 'entra_linked'
        )
      `;
      await tx`
        insert into pipeline.workspace_members (
          principal_id, display_name, email, roles, active, last_seen_at,
          identity_status, source_system, source_identity
        ) values (
          'provisional:fixture:assessor', 'Synthetic Pending Assessor', null,
          array['reviewer', 'viewer'], true, null,
          'provisional', 'synthetic_fixture', 'assessor'
        )
      `;
      await tx.unsafe(fixture);
      await tx`
        insert into pipeline.user_workspace_state (
          principal_id, state_kind, state_key, payload, expires_at
        ) values
          ('retention-fixture', 'recent_destination', 'expired', ${tx.json({ fixture: "expired" })}, now() - interval '1 minute'),
          ('retention-fixture', 'recent_destination', 'future', ${tx.json({ fixture: "future" })}, now() + interval '1 day')
      `;
      const retentionPeople = await tx`
        insert into pipeline.people (external_client_id, display_name)
        values ('pipeline-retention-fixture', 'Synthetic Retention Fixture')
        returning person_id
      `;
      const retentionReferrals = await tx`
        insert into pipeline.referrals (
          person_id, stage, community, source, created_by, created_by_name,
          updated_by, updated_by_name, deleted_at, delete_after, deleted_by, deleted_by_name
        ) values
          (
            ${retentionPeople[0].person_id}::uuid, 'New', 'San Pablo', 'synthetic',
            'fixture', 'Synthetic Fixture', 'fixture', 'Synthetic Fixture',
            now() - interval '31 days', now() - interval '1 day', 'fixture', 'Synthetic Fixture'
          ),
          (
            ${retentionPeople[0].person_id}::uuid, 'New', 'San Pablo', 'synthetic',
            'fixture', 'Synthetic Fixture', 'fixture', 'Synthetic Fixture',
            now(), now() + interval '30 days', 'fixture', 'Synthetic Fixture'
          )
        returning referral_id, delete_after
      `;
      const eligibleBefore = await tx`
        select
          (select count(*) from pipeline.user_workspace_state where principal_id = 'retention-fixture' and expires_at <= now()) as workspace_state,
          (select count(*) from pipeline.referrals where person_id = ${retentionPeople[0].person_id}::uuid and deleted_at is not null and delete_after <= now()) as referrals
      `;
      checks.push({
        name: "retention candidate predicates distinguish expired from recoverable records",
        ok: Number(eligibleBefore[0].workspace_state) === 1 && Number(eligibleBefore[0].referrals) === 1,
      });
      await tx`
        delete from pipeline.user_workspace_state
        where (principal_id, state_kind, state_key) in (
          select principal_id, state_kind, state_key
          from pipeline.user_workspace_state
          where expires_at <= now()
          order by expires_at
          limit 100
        )
      `;
      await tx`
        delete from pipeline.referrals
        where referral_id = ${retentionReferrals[0].referral_id}
          and deleted_at is not null
          and delete_after <= now()
      `;
      const retentionAfter = await tx`
        select
          (select count(*) from pipeline.user_workspace_state where principal_id = 'retention-fixture' and state_key = 'expired') as expired_state,
          (select count(*) from pipeline.user_workspace_state where principal_id = 'retention-fixture' and state_key = 'future') as future_state,
          (select count(*) from pipeline.referrals where referral_id = ${retentionReferrals[0].referral_id}) as expired_referral,
          (select count(*) from pipeline.referrals where referral_id = ${retentionReferrals[1].referral_id}) as recoverable_referral
      `;
      checks.push({
        name: "retention rehearsal deletes only expired rows and preserves recovery windows",
        ok: Number(retentionAfter[0].expired_state) === 0
          && Number(retentionAfter[0].future_state) === 1
          && Number(retentionAfter[0].expired_referral) === 0
          && Number(retentionAfter[0].recoverable_referral) === 1,
      });
      const rows = await tx`
        select
          (select count(*) from pipeline.people where external_client_id = 'pipeline-integration-fixture') as people,
          (select count(*) from pipeline.referrals r join pipeline.people p on p.person_id = r.person_id where p.external_client_id = 'pipeline-integration-fixture') as referrals,
          (select count(*) from pipeline.documents where blob_key = 'fixture/integration/synthetic-fixture.pdf') as documents,
          (select count(*) from pipeline.documents d join pipeline.people p on p.person_id = d.person_id where p.external_client_id = 'pipeline-integration-historical' and d.referral_id is null and d.identity_status = 'linked') as historical_documents,
          (select count(*) from pipeline.client_file_import_items where source_item_id = 'fixture-unmatched-item' and match_status = 'unmatched' and imported_document_id is null) as unmatched_imports,
          (select count(*) from pipeline.document_preview_pages p join pipeline.documents d on d.document_id = p.document_id where d.blob_key = 'fixture/integration/synthetic-fixture.pdf') as pages,
          (select count(*) from pipeline.editing_presence where actor_id = 'fixture-user') as presence
          ,(select count(*) from pipeline.user_workspace_state where principal_id = 'fixture-user') as workspace_state
          ,(select count(*) from pipeline.user_workspace_state where principal_id = 'fixture-user' and state_kind = 'assessment_draft') as assessment_drafts
          ,(select count(*) from pipeline.workspace_members where principal_id = 'fixture-user' and active and identity_status = 'entra_linked') as workspace_members
          ,(select count(*) from pipeline.workspace_members where principal_id = 'provisional:fixture:assessor' and active and identity_status = 'provisional' and email is null and last_seen_at is null) as provisional_members
      `;
      checks.push({
        name: "synthetic graph is queryable",
        ok: Number(rows[0].people) === 1 && Number(rows[0].referrals) === 1
          && Number(rows[0].documents) === 1 && Number(rows[0].pages) === 2 && Number(rows[0].presence) === 1
          && Number(rows[0].historical_documents) === 1 && Number(rows[0].unmatched_imports) === 1
          && Number(rows[0].workspace_state) === 2 && Number(rows[0].assessment_drafts) === 1
          && Number(rows[0].workspace_members) === 1 && Number(rows[0].provisional_members) === 1,
      });
      throw rollbackSentinel;
    });
  } catch (error) {
    if (error !== rollbackSentinel) throw error;
  }
  const remaining = await sql`
    select count(*) as count from pipeline.people where external_client_id in ('pipeline-integration-fixture', 'pipeline-integration-historical')
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
