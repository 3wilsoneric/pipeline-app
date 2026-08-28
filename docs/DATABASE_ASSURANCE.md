# Database Assurance

This is the operator entrypoint for proving Pipeline's PostgreSQL behavior. It composes the existing migration, transaction, query-plan, rollback, backup, and restore tools with dedicated concurrency and cross-table integrity tests.

The assurance runner emits a timestamped JSON result and a readable Markdown report under `outputs/database-assurance/`. It also updates `latest.json` and `latest.md`. Artifacts contain statuses and aggregate counts only, are written with owner-only permissions, and never contain database URLs or row values.

## One Command

```bash
npm run database:assurance
```

The command loads `.env.local` when present. It selects the `integration` profile when `PIPELINE_TEST_DATABASE_URL` is configured; otherwise it runs the safe `local` profile. It never selects the disaster profile automatically.

Review the latest result at any time:

```bash
npm run database:assurance:status
```

## Profiles

### Local

```bash
npm run database:assurance:local
```

This requires no database. It validates the migration and rollback structure, transactional repository contracts, high-volume query boundaries, test registry, reporting behavior, and destructive-test safeguards.

### Integration

Use a disposable PostgreSQL 16+ database with all migrations applied. Never point this at the production database.

```bash
export PIPELINE_TEST_DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/pipeline_test'
export PIPELINE_DATABASE_SSL_MODE='require'
PIPELINE_DATABASE_URL="$PIPELINE_TEST_DATABASE_URL" npm run database:migrate
npm run database:assurance:integration
```

For a local PostgreSQL instance without TLS, set `PIPELINE_DATABASE_SSL_MODE=disable`.

The target database name must contain `test`, `ci`, `drill`, or `disposable`. Reusing the configured application database requires `PIPELINE_ALLOW_TEST_DATABASE_REUSE=true`; this acknowledgement should be used only for a dedicated CI or disposable environment.

The integration profile runs:

- Migration checksum and pending-migration planning.
- Live schema, constraint, and transaction rollback smoke tests.
- Transactionally rolled-back relational fixtures.
- PostgreSQL 16 index-plan assertions.
- Optimistic-write races with 24 competing actors by default.
- Idempotency and EHR outbox duplicate races.
- Forty-eight-job `FOR UPDATE SKIP LOCKED` worker contention.
- Active extraction-job uniqueness races.
- Injected constraint failure and committed-retry tests.
- Bounded lock timeout and deliberate deadlock recovery.
- Read-only cross-table and workflow integrity reconciliation.
- Transactional rollback and schema-restoration drill.

Increase the concurrency and queue dimensions without changing code:

```bash
PIPELINE_DATABASE_CONCURRENCY=64 \
PIPELINE_DATABASE_QUEUE_SIZE=500 \
npm run database:assurance:integration
```

Allowed ranges are 4-64 concurrent actors and 4-500 queued jobs. The harness creates run-scoped synthetic records and removes them in `finally`; use only a disposable database because process termination or infrastructure failure can interrupt cleanup.

### Capacity

The capacity profile includes all integration evidence, then creates a production-shaped synthetic dataset and benchmarks concurrent real queries using the planner's normal settings.

```bash
npm run database:assurance:capacity
```

The default is 25,000 referrals, 200 queries, 16 concurrent readers, a 512-byte JSON payload per referral, and a 250 ms p95 budget. Scale it up to one million referrals:

```bash
PIPELINE_DATABASE_SCALE_ROWS=1000000 \
PIPELINE_DATABASE_SCALE_QUERIES=5000 \
PIPELINE_DATABASE_SCALE_CONCURRENCY=64 \
PIPELINE_DATABASE_SCALE_PAYLOAD_BYTES=16384 \
PIPELINE_DATABASE_SCALE_P95_MS=500 \
npm run database:assurance:capacity
```

Capacity records are run-scoped and cleaned up, but this profile can consume substantial storage, WAL, I/O, and cleanup time. Run it only on a disposable database sized for the requested dataset.

### Disaster

The disaster profile includes every capacity gate and performs an actual restore into the disposable target. It is never automatic.

```bash
export PIPELINE_TEST_DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/pipeline_restore_drill'
export PIPELINE_RESTORE_BACKUP_PATH='/secure/path/pipeline.dump'
npm run database:assurance:disaster
```

The backup must have its adjacent `.manifest.json`. The restore tool validates its SHA-256 checksum, requires a disposable-looking database name, replaces the Pipeline schema, and verifies migration history plus aggregate table counts. Destroy the restore target after reviewing the report.

## Individual Tests

Use these when developing a specific database behavior:

```bash
npm run check:database-assurance
npm run database:concurrency
npm run database:capacity
npm run database:integrity
npm run database:fixtures
npm run database:query-plans
npm run database:rollback:drill
```

`database:integrity` is read-only and can audit the configured application database when no test URL is present. It returns only aggregate violation and advisory counts. The other live commands should use `PIPELINE_TEST_DATABASE_URL`.

## Reading Results

A passing profile means every selected control has executable evidence. Missing infrastructure is reported as `blocked`, never as passed. Controls from higher profiles appear as `pending_profile`.

Critical integrity violations fail certification. Operational conditions that may be legitimate but need attention, such as expired upload reservations, dead-letter extraction jobs, failed outbox records, or referrals awaiting retention cleanup, appear as advisories and do not silently become failures.

This framework is intentionally expandable. Add a gate in `scripts/database-assurance-registry.mjs`, attach one or more controls, and the runner automatically includes it in the scorecard, result artifact, and profile totals.
