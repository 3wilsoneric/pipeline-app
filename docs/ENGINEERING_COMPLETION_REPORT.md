# Pipeline engineering completion report

Updated: 2026-08-09

## Completed in code

- Durable PostgreSQL workflow state, optimistic versions, idempotency, audit
  events, reviewed resident links, assessments, decisions, and work items.
- Per-blob Azure upload signing, SHA-256 and byte-size verification, malware
  gating, authenticated preview/evidence proxying, and full derivative manifest
  retention.
- Databricks dispatch, `SKIP LOCKED` leases, heartbeat/reconciliation, bounded
  retry, dead-letter replay, and callbacks protected by job ID, attempt count,
  and an opaque attempt token.
- Stable keyset pagination and matching indexes for referrals, files,
  assessments, and resident links. High-volume routes are bounded.
- PHI-safe logs and metrics use route templates, status classes, operation
  names, job types, counts, and durations only.
- Synthetic scale coverage for 1,300 profiles, 50 active referrals, four
  assessors, 12,000 documents, and 46.9 GB of simulated corpus metadata.
- Desktop/mobile workflow tests, serious/critical WCAG checks, stale-write
  concurrency tests, worker authorization tests, and bounded HTTP load smoke.
- Section-scoped optimistic concurrency, expected versions for extracted-field
  review, three-second active-canvas change checks, expiring editing-presence
  leases, and same-field draft-versus-saved conflict recovery.
- Every visible referral-info field, tags, field source, and document-slot
  evidence name persists. Existing canvases have 1.5-second section autosave,
  350 ms tab recovery drafts, unload protection, and race-safe dirty clearing.
- Authenticated document metadata now pages preview thumbnails in bounded
  batches. Preview streams validate ranges, cap declared and streamed bytes,
  enforce malware state, and fail closed when PostgreSQL or Blob is unavailable.
- A ten-user collaboration harness covers polling, presence, disjoint merges,
  same-section contention, and lease cleanup. Disposable PostgreSQL fixtures,
  a transactional migration-rollback drill, reference-only production seed,
  and guarded pilot reset are checked in.
- Structured metrics cover save conflicts, stale presence leases, every
  extraction failure disposition, oldest queue age, and all API latency paths.
- The supervisor exception queue is derived from canonical referrals,
  requirements, extraction review, identity links, decisions, and EHR handoff
  failures. Accepted referrals remain visible when downstream handoff fails.
- Reassignment, requirement evidence, waivers, circle-back changes, decline
  reasons, and EHR queue/failure/retry/sent actions have distinct audit meaning.
- Generated properties cover cursors, HTTP ranges, upload bounds, section
  contention, and transition ordering. Golden extraction fixtures score field
  recall, evidence-page accuracy, and correction rate without logging values.
- CI runs the canonical release gate, desktop/mobile Axe journeys, and Chromium,
  Firefox, and WebKit smoke tests, then publishes a PHI-free release manifest.
- Azure Bicep foundation and runtime layers for private PostgreSQL, Blob,
  Key Vault, Document Intelligence, Databricks, Log Analytics, Application
  Insights, ACR, Container Apps, managed identities, GitHub OIDC, database
  bootstrap, and scheduled jobs.

## External work still required

1. Choose the Azure subscription, resource group, region, networking, DNS,
   retention, and legal-hold policy. Run Azure `what-if` before deployment.
2. Create the Pipeline Entra API and SPA registration. Expose delegated scope
   `access_as_user`, assign Pipeline user/group app roles, configure exact Azure
   and custom-domain redirect/logout URLs, grant consent, and provide the IDs.
3. On the Alamo API registration, expose application role
   `Pipeline.Clinical.Read.All`. Assign it to the Pipeline service principal and
   grant tenant admin consent. Pipeline requests
   `api://<ALAMO_API_APP_ID>/.default`.
4. Deploy the Azure foundation, populate Key Vault, and run the manual
   VNet-scoped role/migration job. The web process uses only `pipeline_runtime`.
5. Confirm managed-identity user-delegation SAS generation and exact-origin
   Blob CORS. Shared-key authorization is disabled.
6. Implement and deploy the Databricks job using the checked-in dispatch and
   callback contract. Put Document Intelligence and model credentials in Key
   Vault/Databricks secret scope. Register every normalized, OCR, preview,
   evidence, and extraction-output blob in the callback artifact manifest.
7. Connect Azure alert action groups, bind the custom domain, and run a
   representative packet pilot before the backlog wave.

## Required runtime configuration

Database:

```text
PIPELINE_DATABASE_MODE=postgres
PIPELINE_DATABASE_URL
PIPELINE_DATABASE_SSL_MODE=require
PIPELINE_REFERRAL_STORE_MODE=postgres
PIPELINE_ASSESSMENT_STORE_MODE=postgres
PIPELINE_RESIDENT_LINK_STORE_MODE=postgres
```

Pipeline user authentication:

```text
NEXT_PUBLIC_ENTRA_TENANT_ID
NEXT_PUBLIC_ENTRA_CLIENT_ID
NEXT_PUBLIC_PIPELINE_API_SCOPE=api://<PIPELINE_APP_ID>/access_as_user
NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED=true
PIPELINE_AUTH_MODE=entra_jwt
PIPELINE_ENTRA_TENANT_ID
PIPELINE_ENTRA_API_AUDIENCE=<PIPELINE_APP_ID>
PIPELINE_ENTRA_API_SCOPE=access_as_user
PIPELINE_ENTRA_SESSION_SECRET
```

Alamo clinical API:

```text
PIPELINE_CLINICAL_DATA_MODE=alamo_api
PIPELINE_ALAMO_API_BASE_URL=https://www.alamoplatform.com
PIPELINE_ALAMO_AUTH_MODE=client_credentials
PIPELINE_ALAMO_TENANT_ID
PIPELINE_ALAMO_CLIENT_ID
PIPELINE_ALAMO_CLIENT_SECRET
PIPELINE_ALAMO_API_SCOPE=api://<ALAMO_API_APP_ID>/.default
PIPELINE_CLINICAL_TIMEOUT_MS=10000
PIPELINE_CLINICAL_MAX_RESPONSE_BYTES=2097152
```

Packet processing:

```text
PIPELINE_EXTRACTION_BACKEND=azure_databricks
AZURE_STORAGE_ACCOUNT
PIPELINE_AZURE_BLOB_AUTH_MODE=managed_identity
AZURE_CLIENT_ID
AZURE_STORAGE_CONTAINER_RAW=raw
AZURE_STORAGE_CONTAINER_NORMALIZED=normalized
AZURE_STORAGE_CONTAINER_OCR=ocr
AZURE_STORAGE_CONTAINER_EVIDENCE=evidence
AZURE_STORAGE_CONTAINER_ARTIFACTS=artifacts
DATABRICKS_HOST
DATABRICKS_JOB_ID
PIPELINE_DATABRICKS_AUTH_MODE=oauth_m2m
DATABRICKS_CLIENT_ID
DATABRICKS_CLIENT_SECRET
PIPELINE_WORKER_SHARED_SECRET
CRON_SECRET
```

Defaults in `.env.example` cover the bounded database pool, upload TTL,
preview cap, and Databricks timeout/response limit. Review them before launch.

## Deployment order

1. Entra registrations, scopes, roles, consent, and service principals.
2. Azure resource deployment and network/DNS review.
3. PostgreSQL identities and migrations `0001` through `0006`.
4. Key Vault secrets and Databricks job deployment.
5. Deploy the immutable Azure Container Apps revision with retention disabled.
6. Test `/api/health`, then `/api/clinical/health` as a signed-in Pipeline user.
7. Test one upload through preview, evidence, review, retry, and retention dry run.
8. Verify dispatch/reconciliation jobs and alerts; enable retention only after
   written policy approval and a restore drill.
9. Run the packet pilot, then approve the backlog wave.

Pipeline is prepared but is not connected to live Azure, PostgreSQL, Entra, or
Alamo in this workspace because no production credentials or IDs were supplied.
Runtime production paths fail closed while configuration is absent.

## Verification commands

```text
npm run check:platform
npm run check:deployment
npm run check:metrics
PORT=3187 npm run test:e2e
PIPELINE_LOAD_BASE_URL=http://127.0.0.1:3188 npm run check:load
```

See `docs/PRODUCTION_DATA_OPERATIONS.md` for the sample-packet result, ten-user
PostgreSQL command, fixture/rollback procedure, pilot reset, and alert guidance.

`check:deployment` is expected to fail until the variables above are present;
it reports presence booleans only and never prints values.

## Reference inventory

[`docs/FILE_MAP.md`](./FILE_MAP.md) is the maintained inventory for current
routes, adapters, scripts, migrations, UI components, and operating docs. The
historical list below records the earlier production-data hardening pass; it is
not intended to duplicate the live file map.

```text
.env.example
package.json
package-lock.json
playwright.config.ts
Dockerfile
.github/workflows/deploy-azure.yml
infra/azure/runtime.bicep
database/migrations/0004_document_processing.sql
database/migrations/0005_collaboration.sql
database/fixtures/integration.sql
database/rollbacks/0005_collaboration.sql
infra/azure/main.bicep
infra/azure/main.parameters.example.json
infra/azure/README.md
lib/extraction/azure-blob.ts
lib/extraction/backend-config.ts
lib/extraction/contracts.ts
lib/extraction/databricks.ts
lib/extraction/document-assets.ts
lib/extraction/document-processing.ts
lib/extraction/extraction-service.ts
lib/extraction/extraction-state.ts
lib/extraction/processing-worker.ts
lib/observability/api-logging.ts
lib/observability/pipeline-metrics.ts
lib/pipeline/keyset-cursor.ts
lib/pipeline/collaboration-types.ts
lib/pipeline/editing-presence.ts
lib/pipeline/referral-query.ts
lib/pipeline/referral-sections.ts
lib/pipeline/referral-store.ts
lib/pipeline/referral-types.ts
lib/pipeline/resident-link-store.ts
lib/assessment/assessment-store.ts
app/api/assessments/route.ts
app/api/resident-links/route.ts
app/api/files/[documentId]/preview/route.ts
app/api/files/[documentId]/route.ts
app/api/packets/[packetId]/evidence/[fieldKey]/route.ts
app/api/referrals/[referralId]/changes/route.ts
app/api/referrals/[referralId]/presence/route.ts
app/api/internal/extraction/dispatch/route.ts
app/api/internal/extraction/reconcile/route.ts
app/api/internal/extraction/report/route.ts
app/api/internal/extraction/queue/route.ts
app/api/internal/extraction/dead-letter/route.ts
app/api/internal/retention/route.ts
components/pipeline/PipelineActionNav.tsx
components/pipeline/PipelineHeader.tsx
components/pipeline/ReferralHome.tsx
components/pipeline/ReferralPacketCanvas.tsx
components/pipeline/ReferralProgressPanel.tsx
tests/e2e/pipeline-smoke.spec.ts
tests/e2e/responsive-accessibility.spec.ts
scripts/api-behavior-fixtures.mjs
scripts/database-readiness.mjs
scripts/deployment-readiness.mjs
scripts/extraction-state-machine-replay.mjs
scripts/http-load-smoke.mjs
scripts/collaboration-load-smoke.mjs
scripts/database-rollback-drill.mjs
scripts/infrastructure-readiness.mjs
scripts/platform-readiness.mjs
scripts/query-plan-audit.mjs
scripts/operational-metrics-readiness.mjs
scripts/pilot-reset.mjs
scripts/postgres-integration-fixtures.mjs
scripts/referral-reliability-replay.mjs
scripts/security-boundary-check.mjs
scripts/synthetic-scale-benchmark.mjs
scripts/sample-packet-extraction-smoke.mjs
scripts/seed-production-reference-data.mjs
docs/BUILD_BACKLOG.md
docs/CURRENT_TASK.md
docs/DOCUMENT_PROCESSING_RUNBOOK.md
docs/ENGINEERING_COMPLETION_REPORT.md
docs/EXTRACTION_STACK_IMPLEMENTATION_CHECKLIST.md
docs/PIPELINE_V1_SPEC.md
docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md
docs/PRODUCTION_DATA_OPERATIONS.md
docs/WORKFLOW_BUILD_QUEUE.md
```
