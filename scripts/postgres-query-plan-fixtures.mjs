#!/usr/bin/env node

import postgres from "postgres";

const databaseUrl = process.env.PIPELINE_TEST_DATABASE_URL?.trim();
if (!databaseUrl) fail("Configure PIPELINE_TEST_DATABASE_URL before running PostgreSQL query-plan fixtures.");
if (databaseUrl === process.env.PIPELINE_DATABASE_URL?.trim() && process.env.PIPELINE_ALLOW_TEST_DATABASE_REUSE !== "true") {
  fail("Query-plan fixtures require an explicitly reusable test database.");
}

const sql = postgres(databaseUrl, {
  ssl: process.env.PIPELINE_DATABASE_SSL_MODE === "disable" ? false : "require",
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  prepare: false,
  onnotice: () => undefined,
});
const checks = [];

try {
  const version = await sql`select current_setting('server_version_num')::integer as version_num`;
  const versionNumber = Number(version[0].version_num);
  checks.push({ name: "certification database is PostgreSQL 16 or newer", ok: versionNumber >= 160_000 });

  await sql.begin(async (tx) => {
    await tx`set local enable_seqscan = off`;
    await expectIndex(tx, "active workspace paging", `
      select referral_id from pipeline.referrals
      where deleted_at is null
      order by updated_at desc, referral_id desc
      limit 200
    `, "referrals_active_updated_idx");
    await expectIndex(tx, "community workspace paging", `
      select referral_id from pipeline.referrals
      where community = 'San Pablo' and deleted_at is null
      order by created_at desc, referral_id desc
      limit 200
    `, "referrals_community_created_idx");
    await expectIndex(tx, "trash retention paging", `
      select referral_id from pipeline.referrals
      where deleted_at is not null and delete_after <= now()
      order by delete_after, referral_id
      limit 100
    `, "referrals_trash_retention_idx");
    await expectIndex(tx, "document keyset paging", `
      select document_id from pipeline.documents
      where deleted_at is null
      order by uploaded_at desc, document_id desc
      limit 200
    `, "documents_uploaded_keyset_idx");
    await expectIndex(tx, "assessment keyset paging", `
      select assessment_id from pipeline.assessments
      order by updated_at desc, assessment_id desc
      limit 200
    `, "assessments_updated_keyset_idx");
  });

  console.log(JSON.stringify({
    ok: checks.every((check) => check.ok),
    postgres_major: Math.trunc(versionNumber / 10_000),
    checks,
    note: "Plans contain schema and index names only; no row values are emitted.",
  }, null, 2));
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
} catch {
  fail("PostgreSQL query-plan fixtures failed. Review migration state and index compatibility.");
} finally {
  await sql.end({ timeout: 5 });
}

async function expectIndex(tx, name, query, expectedIndex) {
  const rows = await tx.unsafe(`explain (format json, costs false) ${query}`);
  const plan = JSON.stringify(rows);
  checks.push({ name, ok: plan.includes(expectedIndex) });
}

function fail(message) {
  console.error(JSON.stringify({
    ok: false,
    error: message,
    configuration_present: { PIPELINE_TEST_DATABASE_URL: Boolean(databaseUrl) },
  }, null, 2));
  process.exit(1);
}
