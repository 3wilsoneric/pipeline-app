// Runs inside the private Azure network. Never emits connection details or rows.
const postgres = require('postgres');
const { createHash } = require('node:crypto');
const { readdirSync, readFileSync } = require('node:fs');

(async () => {
  const url = new URL(process.env.SOURCE_DATABASE_URL);
  const target = process.env.RESTORED_HOST;
  if (target !== 'pipeline-readiness-drill-20260919.postgres.database.azure.com' || url.hostname === target) throw Error('target_guard');
  url.hostname = target;
  const sql = postgres(url.href, { ssl: 'require', max: 1, prepare: false, connect_timeout: 20, idle_timeout: 5, onnotice: () => {} });
  try {
    const report = await sql.begin(async tx => {
      await tx.unsafe('SET TRANSACTION READ ONLY');
      await tx.unsafe("SET LOCAL statement_timeout = '30s'");
      const migrations = await tx`select migration_id, checksum_sha256 from pipeline.schema_migrations order by migration_id`;
      const expected = readdirSync('/app/database/migrations').filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name));
      const byId = new Map(migrations.map(row => [row.migration_id, row.checksum_sha256]));
      const migrationsMatch = expected.every(name => byId.get(name.replace(/\.sql$/, '')) === createHash('sha256').update(readFileSync('/app/database/migrations/' + name)).digest('hex'));
      const [counts] = await tx`select (select count(*) from pipeline.referrals) as referrals, (select count(*) from pipeline.assessments) as assessments, (select count(*) from pipeline.documents) as documents, (select count(*) from pipeline.audit_events) as audit_events`;
      const [constraints] = await tx`select count(*)::int as invalid from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='pipeline' and not c.convalidated`;
      return { ok: migrationsMatch && constraints.invalid === 0, restored_database_readable: true, migration_checksums_match_image: migrationsMatch, migration_count: migrations.length, aggregate_counts: counts, invalid_constraints: constraints.invalid, read_only: true };
    });
    console.log(JSON.stringify({ operation: 'pipeline_restore_probe', ...report }));
    if (!report.ok) process.exitCode = 1;
  } finally { await sql.end({ timeout: 5 }); }
})().catch(() => { console.error(JSON.stringify({ operation: 'pipeline_restore_probe', ok: false, error: 'restore_probe_failed_redacted' })); process.exitCode = 1; });
