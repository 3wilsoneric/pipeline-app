#!/usr/bin/env node

import postgres from "postgres";

const databaseUrl = process.env.PIPELINE_TEST_DATABASE_URL?.trim() || process.env.PIPELINE_DATABASE_URL?.trim();
if (!databaseUrl) fail("Configure PIPELINE_TEST_DATABASE_URL or PIPELINE_DATABASE_URL before running the integrity audit.");

const sql = postgres(databaseUrl, {
  ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : process.env.PIPELINE_DATABASE_SSL_MODE === "verify-full" ? "verify-full" : "require",
  max: 2,
  connect_timeout: 10,
  idle_timeout: 5,
  prepare: false,
  onnotice: () => undefined,
});

const checks = [];
const advisories = [];

try {
  await sql.begin(async (tx) => {
    await tx.unsafe("set local transaction read only");
    await tx.unsafe("set local statement_timeout = '30s'");

    await critical(tx, "referral document identity matches its referral", `
      select count(*)::integer as count
      from pipeline.documents d
      join pipeline.referrals r on r.referral_id = d.referral_id
      where d.referral_id is not null and d.person_id is distinct from r.person_id
    `);
    await critical(tx, "field evidence belongs to the same referral", `
      select count(*)::integer as count
      from pipeline.referral_fields f
      join pipeline.documents d on d.document_id = f.source_document_id
      where f.source_document_id is not null and d.referral_id is distinct from f.referral_id
    `);
    await critical(tx, "packet files belong to the reserved referral", `
      select count(*)::integer as count
      from pipeline.packet_upload_files file
      join pipeline.packet_uploads packet on packet.packet_id = file.packet_id
      join pipeline.documents d on d.document_id = file.document_id
      where d.referral_id is distinct from packet.referral_id
    `);
    await critical(tx, "signed assessments are complete and attributable", `
      select count(*)::integer as count
      from pipeline.assessments
      where signed_at is not null and (status <> 'complete' or signed_by is null or completed_at is null)
    `);
    await critical(tx, "terminal workflow status matches terminal board stage", `
      select count(*)::integer as count
      from pipeline.referrals
      where (workflow_status = 'accepted' and stage <> 'Accepted / Admitted')
         or (workflow_status = 'declined' and stage <> 'Declined')
         or (stage = 'Accepted / Admitted' and workflow_status <> 'accepted')
         or (stage = 'Declined' and workflow_status <> 'declined')
    `);
    await critical(tx, "published outbox events retain approval and publication evidence", `
      select count(*)::integer as count
      from pipeline.client_update_outbox
      where status = 'published' and (approved_at is null or approved_by is null or published_at is null)
    `);
    await critical(tx, "all PostgreSQL constraints are validated", `
      select count(*)::integer as count
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      where n.nspname = 'pipeline' and not c.convalidated
    `);
    await critical(tx, "PUBLIC has no Pipeline table privileges", `
      select count(*)::integer as count
      from information_schema.role_table_grants
      where table_schema = 'pipeline' and grantee = 'PUBLIC'
    `);

    await advisory(tx, "expired upload reservations awaiting reconciliation", `
      select count(*)::integer as count
      from pipeline.packet_upload_files
      where uploaded_at is null and reservation_expires_at < now()
    `);
    await advisory(tx, "running extraction jobs with an expired lease", `
      select count(*)::integer as count
      from pipeline.extraction_jobs
      where status = 'running' and lease_expires_at is not null and lease_expires_at < now()
    `);
    await advisory(tx, "terminal extraction jobs missing completion time", `
      select count(*)::integer as count
      from pipeline.extraction_jobs
      where status in ('succeeded', 'failed', 'cancelled', 'dead_letter') and completed_at is null
    `);
    await advisory(tx, "dead-letter extraction jobs requiring operator review", `
      select count(*)::integer as count
      from pipeline.extraction_jobs where status = 'dead_letter'
    `);
    await advisory(tx, "failed EHR outbox records requiring operator review", `
      select count(*)::integer as count
      from pipeline.client_update_outbox where status = 'failed'
    `);
    await advisory(tx, "soft-deleted referrals beyond their purge date", `
      select count(*)::integer as count
      from pipeline.referrals
      where deleted_at is not null and delete_after <= now()
    `);
  });

  const ok = checks.every((item) => item.ok);
  console.log(JSON.stringify({
    ok,
    critical_checks: checks,
    advisories,
    critical_violation_count: checks.reduce((sum, item) => sum + item.violation_count, 0),
    advisory_record_count: advisories.reduce((sum, item) => sum + item.record_count, 0),
    note: "This is a read-only aggregate audit. It emits no identifiers, field values, filenames, or connection details.",
  }, null, 2));
  if (!ok) process.exitCode = 1;
} catch {
  fail("PostgreSQL integrity audit failed. Review schema availability and query permissions.");
} finally {
  await sql.end({ timeout: 5 });
}

async function critical(tx, name, query) {
  const rows = await tx.unsafe(query);
  const count = Number(rows[0].count);
  checks.push({ name, ok: count === 0, violation_count: count });
}

async function advisory(tx, name, query) {
  const rows = await tx.unsafe(query);
  advisories.push({ name, record_count: Number(rows[0].count) });
}

function fail(message) {
  console.error(JSON.stringify({
    ok: false,
    error: message,
    configuration_present: {
      PIPELINE_TEST_DATABASE_URL: Boolean(process.env.PIPELINE_TEST_DATABASE_URL?.trim()),
      PIPELINE_DATABASE_URL: Boolean(process.env.PIPELINE_DATABASE_URL?.trim()),
    },
  }, null, 2));
  process.exit(1);
}
