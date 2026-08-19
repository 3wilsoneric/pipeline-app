# Azure + Databricks Backend Setup

## Current State

- Durable uploads, queues, retry/dead-letter handling, evidence review, and
  correction history are implemented in PostgreSQL and private Azure Blob.
- `databricks/pipeline_extraction_worker.py` provides the production worker.
- `databricks.yml` owns one isolated `pipeline-referral-extraction` job.
- The worker is deterministic, uses Azure Document Intelligence, and has no LLM
  dependency. Missing fields remain null for human review.
- Production stays in `manual` mode until the Pipeline-only Databricks identity,
  service credential, callback secret, and malware gate all pass.

## Production Target

```text
Next.js UI/API
  -> Azure Blob signed upload
  -> upload-complete sentinel
  -> Microsoft Defender scan result
  -> Pipeline Databricks extraction job
  -> Azure Document Intelligence + private evidence artifacts
  -> authenticated worker callback + PostgreSQL state
  -> Next.js status + fields APIs
  -> coordinator review
  -> field_audit_events
  -> EHR export queue
```

## Required Environment

```env
PIPELINE_AUTH_MODE=entra_jwt
PIPELINE_ENTRA_TENANT_ID=
PIPELINE_ENTRA_API_AUDIENCE=<PIPELINE_APP_ID>
PIPELINE_ENTRA_API_SCOPE=access_as_user
PIPELINE_ENTRA_SESSION_SECRET=
PIPELINE_ADMIN_EMAILS=
PIPELINE_COORDINATOR_EMAILS=
PIPELINE_REVIEWER_EMAILS=

AZURE_STORAGE_ACCOUNT=
AZURE_STORAGE_CONTAINER_RAW=raw
AZURE_STORAGE_CONTAINER_NORMALIZED=normalized
AZURE_STORAGE_CONTAINER_OCR=ocr
AZURE_STORAGE_CONTAINER_EVIDENCE=evidence
AZURE_STORAGE_CONTAINER_ARTIFACTS=artifacts

DATABRICKS_HOST=
DATABRICKS_JOB_ID=
PIPELINE_DATABRICKS_AUTH_MODE=oauth_m2m
DATABRICKS_CLIENT_ID=
DATABRICKS_CLIENT_SECRET=

DOCUMENT_INTELLIGENCE_ENDPOINT=
```

`ANTHROPIC_API_KEY` is intentionally not part of the initial production path.
The deterministic worker never calls Claude or another LLM.

## Plan and Apply

Run the non-mutating inventory first:

```bash
./scripts/configure-databricks-extraction.sh --plan
```

After reviewing that output, `--apply` creates only the named Pipeline service
principal, Pipeline secret scope, Pipeline Unity Catalog service credential, and
Pipeline bundle job. It does not run the job, modify an existing job, or delete
anything. The script also stores the generated Databricks OAuth secret in the
existing Pipeline Key Vault without printing it. It records the non-secret host,
job ID, and client ID for deployment, but it does not switch the production
extraction backend.

Microsoft Defender for Storage on-upload scanning must be enabled and proven on
the existing Pipeline storage account before production switches from `manual`
to `azure_databricks`. It is metered and is therefore a separate cost approval.

## Auth Integration

- Put the deployed app behind Entra ID or the existing platform gateway.
- In production, set `PIPELINE_AUTH_MODE=entra_jwt` and configure the Entra
  tenant, Pipeline API audience, delegated scope, session secret, and
  enterprise-app assignment.
- Legacy header mode is supported only when `PIPELINE_TRUSTED_GATEWAY=true`.
- Entra owns staff identity and role assignment. Client profiles are Pipeline
  records, not Entra users.
- The browser signs in with Authorization Code + PKCE and sends a bearer token
  to Pipeline. Pipeline validates the token with the Entra JWKS endpoint.
  Never trust browser-supplied identity headers.
- Use role envs to separate admin, assessment coordinator, reviewer, and viewer permissions.
- Prefer Entra app roles or groups that map to those Pipeline roles. The server
  derives the operator identity and role from the authenticated boundary; the
  browser must not submit a reviewer or owner identity as authority.

## Activation Order

1. Run `npm run check:extraction-worker` and the complete platform suite.
2. Run the Databricks setup script in plan mode.
3. Apply the isolated Databricks identity, credential, scope, and job.
4. Enable malware scanning only after cost approval and prove a synthetic file
   receives an authentic `No threats found` result.
5. Deploy Pipeline with `PIPELINE_EXTRACTION_BACKEND=azure_databricks`.
6. Run one approved, sanitized packet through upload, scan, OCR, evidence,
   correction, reopen, duplicate, retry, and dead-letter checks.
7. Keep the previous immutable web revision promotable for rollback.

## Production identities

- Pipeline calls the Databricks Jobs API with a dedicated Databricks service
  principal and OAuth M2M. Do not create or store a personal access token.
- Create the service principal in Databricks, assign it to the Pipeline
  workspace, grant only `CAN VIEW` and `CAN MANAGE RUN` on the extraction job,
  then generate a bounded-lifetime OAuth secret.
- The Azure Databricks Access Connector emitted by `main.bicep` owns data-plane
  access to Pipeline ADLS Gen2 and Document Intelligence. Configure it as the
  Unity Catalog storage credential; do not mount storage with a key or SAS.
- The Databricks job callback uses `PIPELINE_WORKER_SHARED_SECRET`, held in its
  Databricks secret scope and Pipeline Key Vault. It never uses a browser token.

## Durable Processing Records

Pipeline keeps workflow state in the existing Azure PostgreSQL database, not in
new Databricks tables. The worker writes only immutable OCR, extraction, and
evidence artifacts to private Pipeline Blob containers, then reports bounded
metadata to the authenticated callback. Relevant PostgreSQL tables include:

- `pipeline.packet_uploads`
- `pipeline.packet_upload_files`
- `pipeline.documents`
- `pipeline.extraction_jobs`
- `pipeline.extraction_candidates`
- `pipeline.field_review_events`
- `pipeline.document_preview_pages`
- `pipeline.document_artifacts`
- `pipeline.referral_fields`
- `pipeline.audit_events`

## Backlog Plan

- Start with a 500-page representative pilot.
- Measure Document Intelligence success, deterministic extraction coverage,
  human review rate, and cost per 1,000 pages.
- Process the digitized backlog in 10,000-25,000 page waves only after routing thresholds are tuned.
- Keep live intake separate from backlog batch triggers, but share schema, storage layout, validation, and review UI.

## Hard Rules

- Do not route raw packet binaries through the Next.js web container.
- Do not mutate raw blobs in place.
- Do not trust browser-submitted reviewer IDs.
- Do not write AI output into referral records without human approval.
- Do not send every page to Claude by default; route by confidence and page type.
