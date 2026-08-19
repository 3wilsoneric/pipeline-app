# Pipeline Production Baseline - 2026-08-19

## Scope

This is a read-only baseline. No resource was purchased, provisioned, deleted,
reconfigured, seeded, reset, migrated, or deployed. No secret value, client
record, packet, or other PHI was retrieved or logged.

The assessment form is frozen. Its fields, layout, validation, completion
rules, and workflow are outside the current scope.

## Source Candidate

- Repository: `pipeline-app`
- Branch: `codex/platform-admissions-zone`
- Last committed revision: `b4786ec6aab598ffd9b0b20e11863b081fb03aa5`
- Last committed date: 2026-08-13
- Worktree: materially dirty, including canonical-client integration,
  migration `0007`, admissions-zone work, authentication changes, and broader
  pre-existing application changes
- Safety consequence: do not reset, switch branches, or build a production
  image until the candidate changes are separated, reviewed, and preserved

## Deployed Surfaces

### Azure Container Apps

The custom production domains are bound to the existing Azure Container App:

- `https://alamo-pipeline.com`
- `https://www.alamo-pipeline.com`

The active runtime is healthy and currently runs immutable image revision
`b4786ec6aab598ffd9b0b20e11863b081fb03aa5`.

Live aggregate readiness on 2026-08-19 reported:

- liveness: ready
- PostgreSQL connection: ready
- referral store: PostgreSQL, ready
- assessment store: PostgreSQL, ready
- resident-link store: PostgreSQL, ready
- desktop workspace state: PostgreSQL, ready
- authentication: Entra JWT, ready
- Alamo clinical API: client credentials, connected and ready
- extraction backend: manual, ready for manual operation but not automated

An anonymous request to the protected clinical health endpoint returned `401`,
confirming that clinical data is not publicly readable.

### Vercel

The repository is also linked to the existing `alamo-hm/pipeline-app` Vercel
project. Its latest ready production deployment was created on 2026-08-14 and
has Vercel aliases only. The remote environment currently contains browser and
server Entra configuration but not the PostgreSQL, Blob, extraction-worker, or
Alamo service-to-service configuration required by the complete production
application.

The Azure custom-domain deployment is therefore the currently complete runtime.
Do not promote the Vercel project as an equivalent production target until its
architecture and configuration are deliberately reconciled.

## Existing Azure Foundation

Resource group `rg-pipeline-prod` already contains the required foundation:

- Azure Database for PostgreSQL Flexible Server
- Azure Storage with `raw`, `normalized`, `ocr`, `evidence`, and `artifacts`
  containers
- Azure Key Vault
- Azure AI Document Intelligence
- Azure Container Apps environment and web app
- Azure Container Registry
- managed identity and Databricks access connector
- Log Analytics, Application Insights, and seven operational alert rules
- a manual database migration Container Apps job

PostgreSQL baseline:

- PostgreSQL 16
- state: ready
- General Purpose `Standard_D2ds_v5`
- 128 GB storage
- 14-day backup retention
- public access disabled
- high availability disabled
- geo-redundant backup disabled

Storage baseline:

- ADLS Gen2 enabled
- HTTPS only with TLS 1.2 minimum
- public Blob access disabled
- shared-key access disabled
- runtime managed identity has Blob Data Contributor access
- runtime managed identity has Key Vault Secrets User and registry pull access
- the operator identity used for this baseline has no Blob data-plane read
  role; no attempt was made to bypass that boundary with account keys

## Migration State

The source tree contains migrations `0001` through `0007`, and release checks
validate that the sequence is contiguous and checksummed.

The deployed runtime and migration job still use image revision `b4786ec`, and
the latest successful migration execution was 2026-08-14. Migration `0007` was
created after that deployed revision and must be treated as unapplied until a
controlled migration plan proves otherwise.

Migration `0007` is additive:

- adds nullable `canonical_client_id` to assessments
- adds its supporting assessment-history index
- creates an approval-gated future client-update outbox
- does not activate new-client creation or Databricks publication

The incremental update flags must remain disabled.

## Verification Baseline

The current dirty source candidate passed:

- consolidated `check:platform`
- TypeScript
- ESLint
- API authorization policy
- clinical integration contracts
- database and migration-readiness contracts
- security boundary checks
- recovery and chaos contracts
- 21,004 generated property cases
- synthetic 1,300-profile and 12,000-document scale checks
- production Next.js build
- production browser artifact audit
- Playwright: 41 passed, 7 intentionally skipped

`check:deployment` fails in the local shell because production credentials and
configuration are intentionally absent locally. This is a local configuration
finding, not a live outage; the deployed Azure `/api/health` endpoint returned
`200` and verified the production adapters directly.

The upstream Alamo repository has a separate existing full-suite failure: the
daily workflow contract does not pass the explicit business date into
`tool_context_views`. Focused client-database and Pipeline clinical API checks
pass, but this upstream gate should be resolved before a final release.

## Production Blockers

1. Preserve and review the dirty source candidate before producing an image.
2. Create and verify a production database rollback point without downloading
   PHI to a developer machine.
3. Prove the deployed migration level and apply migration `0007` only through
   the existing migrator job and an immutable reviewed image.
4. Keep new-client and incremental Databricks updates disabled.
5. Activate and prove the real packet extraction worker; production is still in
   manual extraction mode.
6. Validate the four assessor identities, supervisor identity, role matrix,
   My Queue ownership, and audit attribution.
7. Reconcile or explicitly retire the incomplete Vercel deployment path without
   deleting anything during the current work.
8. Resolve the upstream Alamo business-date release gate.

## Next Safe Gate

Before applying migration `0007`:

1. Freeze the exact reviewed source commit and build an immutable candidate
   image.
2. Run all source, migration, security, build, and browser checks against that
   commit.
3. Create an Azure-side PostgreSQL backup/restore point and verify its metadata.
4. Point only the existing manual migration job at the reviewed image.
5. Run a migration plan/readiness check before executing the job.
6. Apply `0007`, verify schema migration history and application health, and
   retain the documented rollback path.
7. Do not seed, pilot-reset, publish to Databricks, or enable incremental client
   updates.

No new paid resource is required for this next gate. Existing Azure resources
already incur their normal operating costs; real Document Intelligence and
future Databricks executions remain metered and require separate activation and
cost review.

## Phase 2 Completion Checkpoint

Completed at `2026-08-19T16:24:42Z`. This section supersedes the migration-state
and next-gate statements above while preserving the original baseline record.

- A connected migration plan proved that `0001` through `0006` were already
  applied and only `0007_canonical_client_assessments` was pending.
- Azure PostgreSQL retained its successful 2026-08-19 automatic full backup and
  14-day point-in-time restore window. The service's explicit on-demand-backup
  request returned an Azure internal error and was not counted as a backup.
- The private migrator job created and verified a separate logical schema
  backup at
  `artifacts/database-recovery/pre-0007-20260819/20260819t155700z/pipeline.dump`.
  Its manifest recorded six migrations, 79,084 bytes, and SHA-256
  `9941fad19aae8cfcd1584f79abafca57ac9d5b9d09afb4a7c909dc3341691fd5`.
  Backup bytes and credentials remained inside Azure.
- Migration `0007` applied successfully as one PostgreSQL transaction.
- The metadata verifier confirmed the migration checksum, nullable canonical
  client column, supporting index, approval-gated outbox, and exact
  `pipeline_runtime` table grants without reading client records.
- A post-migration connected plan reported zero pending migrations.
- The normal migration-job command ran again and applied nothing, proving the
  standing job is idempotent. The job is pinned to operations-image digest
  `sha256:e6cf76ad3a51eb6ac67b9fdf91d9d2e86a2220b3f45d7b02a037d6f3ce9f7e6f`.
- The reference-only production seed inserted one missing system revision on
  its first run and zero rows on its second run. It created no users, referrals,
  residents, assessments, documents, or synthetic clients.
- Pilot reset ran in dry-run mode and found zero eligible records. No reset or
  deletion occurred.
- `/api/health/live` and `/api/health` remained healthy, all production stores
  remained PostgreSQL-backed, and anonymous clinical access continued to return
  `401`.
- The rollback drill now covers migrations `0007`, `0006`, and `0005` inside a
  transaction. It passed static release/readiness gates and was intentionally
  not run against the production database.

The running web revision was not changed. The assessment form, its fields,
validation, completion rules, and workflow were not changed. New-client and
incremental Databricks publication remain disabled. The ACR builds, short
Container Apps job executions, and 79 KB backup are expected to cost well below
a few dollars; no paid resource was created.
