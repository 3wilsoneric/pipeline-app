# Azure + Databricks Backend Setup

## Current State

- The app has a mock extraction vertical slice.
- Browser upload flow is shaped correctly: create upload target, complete upload, poll packet status, review extracted fields.
- No route accepts packet binaries.
- Extraction APIs are protected by the pipeline auth seam.
- Reviewer identity is derived server-side from the authenticated user.

## Production Target

```text
Next.js UI/API
  -> Azure Blob signed upload
  -> upload-complete sentinel
  -> Databricks packet_extraction_job
  -> Delta Lake / Unity Catalog tables
  -> Next.js status + fields APIs
  -> coordinator review
  -> field_audit_events
  -> EHR export queue
```

## Required Environment

```env
PIPELINE_AUTH_MODE=entra_jwt
PIPELINE_ENTRA_TENANT_ID=
PIPELINE_ENTRA_API_AUDIENCE=api://<PIPELINE_APP_ID>
PIPELINE_ENTRA_API_SCOPE=access_as_user
PIPELINE_ENTRA_SESSION_SECRET=
PIPELINE_ALLOWED_EMAILS=
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
ANTHROPIC_API_KEY=
```

## Auth Integration

- Put the deployed app behind Entra ID or the existing platform gateway.
- In production, set `PIPELINE_AUTH_MODE=entra_jwt` and configure the Entra
  tenant, Pipeline API audience, delegated scope, session secret, and a
  populated `PIPELINE_ALLOWED_EMAILS` list.
- Legacy header mode is supported only when `PIPELINE_TRUSTED_GATEWAY=true`.
- Entra owns staff identity and role assignment. Client profiles are Pipeline
  records, not Entra users.
- The browser signs in with Authorization Code + PKCE and sends a bearer token
  to Pipeline. Pipeline validates the token with the Entra JWKS endpoint.
  Never trust browser-supplied identity headers.
- Keep `PIPELINE_ALLOWED_EMAILS` populated for the first internal rollout.
- Use role envs to separate admin, assessment coordinator, reviewer, and viewer permissions.
- Prefer Entra app roles or groups that map to those Pipeline roles. The server
  derives the operator identity and role from the authenticated boundary; the
  browser must not submit a reviewer or owner identity as authority.

## Adapter Replacement Order

1. Replace `lib/extraction/mock-store.ts:createUploadTargets` with Azure Blob SAS generation.
2. Replace `lib/extraction/mock-store.ts:completeUpload` with upload sentinel creation plus Databricks Jobs REST trigger.
3. Replace `getPacketStatus` with Databricks job state + Delta packet state reads.
4. Replace `getPacketFields` with Unity Catalog / Delta-backed reads from `extracted_fields` and `field_review_tasks`.
5. Replace `reviewField` with transactional writes to `field_audit_events` and updated final field values.
6. Replace `retryField` with a Databricks repair/retry task for one field/page.

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

## Unity Catalog Tables

- `referral_packets`
- `packet_pages`
- `document_intelligence_results`
- `extraction_runs`
- `extracted_fields`
- `field_review_tasks`
- `field_audit_events`
- `ehr_export_queue`

## Backlog Plan

- Start with a 500-page representative pilot.
- Measure Document Intelligence success, Claude fallback rate, review rate, and cost per 1,000 pages.
- Process the digitized backlog in 10,000-25,000 page waves only after routing thresholds are tuned.
- Keep live intake separate from backlog batch triggers, but share schema, storage layout, validation, and review UI.

## Hard Rules

- Do not route raw packet binaries through the Next.js web container.
- Do not mutate raw blobs in place.
- Do not trust browser-submitted reviewer IDs.
- Do not write AI output into referral records without human approval.
- Do not send every page to Claude by default; route by confidence and page type.
