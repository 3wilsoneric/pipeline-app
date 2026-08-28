#!/usr/bin/env node

import postgres from "postgres";

const databaseUrl = process.env.PIPELINE_DATABASE_URL?.trim();
if (!databaseUrl) fail("Configure PIPELINE_DATABASE_URL before seeding production reference data.");
const sql = postgres(databaseUrl, {
  ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full" ? "verify-full" : "require",
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  prepare: false,
  onnotice: () => undefined,
});

try {
  const result = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('pipeline_production_seed', 0))`;
    const migrations = await tx`
      select migration_id from pipeline.schema_migrations
      where migration_id in ('0001_pipeline_core','0002_workflow_engine','0003_operational_hardening','0004_document_processing','0005_collaboration','0006_user_workspace_state','0007_canonical_client_assessments','0008_client_workspaces','0009_assessment_collaboration','0010_provisional_workspace_members','0011_historical_material_workspaces','0012_referral_trash','0013_search_performance','0014_workspace_county','0015_assessor_workflow','0016_zoom_assessment_method','0017_referral_received_month','0018_academy_progress','0019_operator_training_progress')
    `;
    if (migrations.length !== 19) throw new Error("missing_migrations");
    const rows = await tx`
      insert into pipeline.store_revisions (store_name)
      values ('referrals'), ('assessments'), ('resident_links'), ('workflow'), ('documents'), ('extraction_jobs'), ('client_workspaces'), ('client_file_imports')
      on conflict (store_name) do nothing
      returning store_name
    `;
    return { inserted: rows.length };
  });
  console.log(JSON.stringify({
    ok: true,
    inserted_reference_rows: result.inserted,
    synthetic_client_rows: 0,
    note: "This idempotent seed creates no users, credentials, referrals, residents, assessments, or documents.",
  }, null, 2));
} catch {
  fail("Production reference seeding failed. Confirm all migrations are applied first.");
} finally {
  await sql.end({ timeout: 5 });
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message, configuration_present: { PIPELINE_DATABASE_URL: Boolean(databaseUrl) } }, null, 2));
  process.exit(1);
}
