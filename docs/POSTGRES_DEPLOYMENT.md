# Pipeline PostgreSQL Deployment

Pipeline uses Azure Database for PostgreSQL Flexible Server for shared
transactional workflow data and Azure Blob Storage for document bytes. The
application never stores packet binaries in PostgreSQL.

## Deployment Order

1. Provision the PostgreSQL server, private networking/firewall rules, backups,
   and a least-privilege application role.
2. Set the migration-owner connection in `PIPELINE_DATABASE_URL`, run
   `npm run database:migrate:plan`, then `npm run database:migrate`. The runner
   applies migrations `0001` through `0006` in order under a PostgreSQL advisory lock
   and rejects edited migration history by SHA-256 checksum.
3. Grant the runtime role usage on the `pipeline` schema and only the table and
   sequence privileges required by the adapters. Do not use the server admin as
   the application identity.
4. Configure the server-only deployment variables below.
5. Deploy Pipeline with local stores disabled.
6. Run `npm run check:database`, `npm run check:database:live`, then call
   `/api/health`. Readiness reports configuration presence and adapter state;
   neither command returns the database URL.
7. Connect Blob uploads and the asynchronous extraction worker before enabling
   production packet ingestion.
8. Before pilot traffic, run `database:fixtures` and
   `database:rollback:drill` against a separate disposable database, then run
   the ten-user collaboration check against the PostgreSQL-backed pilot app.

## Server-Only Variables

```text
PIPELINE_DATABASE_MODE=postgres
PIPELINE_DATABASE_URL=<Azure PostgreSQL connection string>
PIPELINE_DATABASE_SSL_MODE=require
PIPELINE_DATABASE_POOL_MAX=5
PIPELINE_DATABASE_CONNECT_TIMEOUT_SECONDS=10
PIPELINE_DATABASE_IDLE_TIMEOUT_SECONDS=20
PIPELINE_DATABASE_MAX_LIFETIME_SECONDS=1800
PIPELINE_REFERRAL_STORE_MODE=postgres
PIPELINE_ASSESSMENT_STORE_MODE=postgres
PIPELINE_RESIDENT_LINK_STORE_MODE=postgres
```

Never prefix the database URL with `NEXT_PUBLIC_`. Keep the application pool
small at first because serverless instances multiply the configured pool size.

## Current Adapter Coverage

- Referrals, assessments, assessment provenance/unmapped values,
  `resident_links`, people, revisions, idempotency keys, and their audit events
  have transactional PostgreSQL adapters.
- Local JSON adapters remain available only for single-process development.
  Normal production mode fails closed unless all three store modes use
  PostgreSQL and the database URL is configured.
- The migrations define the first production relational shape for
  referrals, extraction, documents, assessments, work items, decisions, audit,
  reviewed resident links, document previews, malware state, retention,
  extraction leases, and idempotency expiry.
- Referral lists, workflow filters, and facets execute on the server with bounded
  pages. The operations snapshot reads the same canonical referral,
  assessment, decision, and work-item records.
- Document bytes remain in Blob Storage. PostgreSQL stores immutable Blob keys,
  content metadata, preview state, scan state, page counts, and evidence links.

## Identity Join Rule

One confirmed Alamo `resident_key` may link to one Pipeline person, and one
Pipeline person may link to one confirmed Alamo resident. The database enforces
both constraints. Candidate links require reviewer confirmation; names never
create an automatic join.

The admitted-client profile contains the review surface: an authorized user
selects a specific referral, creates a candidate, and a reviewer/admin confirms
or rejects it. A confirmed link is the only path that exposes Pipeline work on
an Alamo resident profile.

Fixture, rollback, production seed, pilot reset, and collaboration commands are
documented in `docs/PRODUCTION_DATA_OPERATIONS.md`.

CI provisions a disposable PostgreSQL 16 service and runs the complete migration,
live smoke, transactionally rolled-back fixture, migration rollback drill,
production reference seed, 10-user referral/workspace-state contention, and HTTP
load smoke. This catches SQL and locking regressions before Azure deployment;
it does not replace the Azure networking, role, backup, or restore checks.
