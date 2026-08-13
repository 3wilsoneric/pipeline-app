# Extraction Stack Implementation Checklist

## Operating Model

- One-time backlog: about 100,000 already digitized pages.
- Ongoing intake: about 500 new pages per week.
- Shared extraction stack: same storage layout, schema, validation, merge, and review UI.
- Different triggers:
  - Backlog uses a Databricks batch manifest and wave processing.
  - Ongoing intake uses app upload completion and one packet job.

## Milestone 0: Backlog Pilot

- Build `batch_manifest.csv` or Delta table for 500 representative pages.
- Include `batch_id`, `packet_id`, `raw_blob_path`, `facility`, `source_type`, `received_at`, `page_count_estimate`, `content_hash`, `priority`, and `status`.
- Run baseline OCR/Document Intelligence on the pilot.
- Classify page types:
  - structured data sheet
  - handwritten form
  - clinical note
  - irrelevant attachment
  - unknown
- Measure:
  - OCR success rate
  - handwritten/messy percentage
  - Claude fallback percentage
  - critical-field review rate
  - cost per 1,000 pages
- Tune routing before processing the remaining backlog.

## Milestone 1: Local Mock

- Add typed API contracts for uploads, packet status, fields, review, and retry.
- Add mock in-memory packet store.
- Add route handlers that never accept binary payloads.
- Return fake signed URLs so frontend integration can start.
- Return static extracted fields with confidence, evidence URL, and candidate conflict shape.
- Support accept/edit/reject review actions in mock state.
- Support single-field retry action in mock state.
- Protect extraction APIs behind the pipeline auth seam.
- Derive reviewer identity from server-validated Entra JWT claims instead of trusting browser-submitted IDs.

## Milestone 2: Azure Blob Signed Upload

- Add Azure Storage SDK or REST signer.
- Prefer managed identity or user delegation SAS over account keys.
- Configure required env vars:
  - `AZURE_STORAGE_ACCOUNT`
  - `AZURE_STORAGE_CONTAINER_RAW`
  - `AZURE_STORAGE_CONTAINER_NORMALIZED`
  - `AZURE_STORAGE_CONTAINER_OCR`
  - `AZURE_STORAGE_CONTAINER_EVIDENCE`
  - `AZURE_STORAGE_CONTAINER_ARTIFACTS`
- Generate per-blob write-only SAS URLs.
- Pin content type and expiration.
- Write raw blob tags at upload time:
  - `packet_id`
  - `received_at`
  - `source_type`
  - `submitting_facility`
- Add `.upload-complete` sentinel flow.
- Persist packet shell record outside in-memory mock.

## Milestone 2.5: Internal Auth + Roles

- Put the deployed app behind Entra ID or the existing platform gateway.
- Pass the Entra bearer token to Next.js and validate it server-side. Legacy
  trusted gateway headers are an explicit fallback only:
  - `x-ms-client-principal` for a trusted Azure EasyAuth gateway, or
  - `x-pipeline-user-email` from the platform gateway.
- Configure role allowlists:
  - `PIPELINE_ALLOWED_EMAILS`
  - `PIPELINE_ADMIN_EMAILS`
  - `PIPELINE_COORDINATOR_EMAILS`
  - `PIPELINE_REVIEWER_EMAILS`
- Keep `PIPELINE_AUTH_MODE=mock` only for local development.
- Use `PIPELINE_AUTH_MODE=entra_jwt` in production.
- Persist `field_audit_events` with the authenticated user email and role.

## Milestone 3: Databricks Trigger + Polling

- Configure required env vars:
  - `DATABRICKS_HOST`
  - `DATABRICKS_JOB_ID`
  - `PIPELINE_DATABRICKS_AUTH_MODE=oauth_m2m`
  - `DATABRICKS_CLIENT_ID`
  - `DATABRICKS_CLIENT_SECRET` (Key Vault only)
- Assign the Databricks service principal only `CAN VIEW` and `CAN MANAGE RUN`
  on the Pipeline extraction job.
- Configure the Bicep-created Access Connector as the Unity Catalog storage
  credential for Pipeline ADLS Gen2.
- Implement Databricks Jobs REST trigger.
- Store `job_run_id` when upload completes.
- Add job status polling adapter.
- Map Databricks states to packet statuses.
- Add retry-safe `packet_id` idempotency.
- Add a separate backlog batch job entrypoint parameterized by `batch_id` and manifest path.

## Milestone 4: Databricks Normalization

- Create Databricks notebook/job task `t1_ingest_manifest`.
- Create task `t2_normalize` with PyMuPDF.
- Render all pages to PNG at 200 DPI.
- Write normalized page images to Blob.
- Write `manifest.json`.
- Write `packet_pages` rows to Delta.
- Confirm rerun overwrites by partition/key instead of duplicating.
- For backlog, process in 10,000-25,000 page waves after the pilot.

## Milestone 5: Document Intelligence

- Create task `t3_document_intelligence`.
- Run DI on every normalized page.
- Persist raw DI JSON to `ocr/`.
- Flatten fields, confidence, polygons, handwritten hints.
- Write `document_intelligence_results`.
- Surface DI-only candidates in Next.js fields API.

## Milestone 6: Claude Fallback

- Create task `t4_route`.
- Route low-confidence, handwritten, messy, or clinical-note pages to Claude.
- Do not send all backlog pages to Claude.
- Create task `t5_claude_fallback`.
- Use schema-anchored system prompt.
- Require strict JSON only.
- Store raw Claude response under artifacts.
- Validate with Pydantic before merge.

## Milestone 7: Merge + Review

- Create task `t6_validate`.
- Create task `t7_merge`.
- Preserve all candidates in `extracted_fields`.
- Mark one deterministic canonical candidate.
- Create review tasks for critical, low-confidence, or conflicting fields.
- Implement evidence crop links.
- Wire UI review actions to write `field_audit_events`.

## Milestone 8: EHR Export Queue

- Compute packet completeness and EHR readiness.
- Only enqueue accepted/admitted referrals.
- Only use approved final values.
- Add CSV/XLSX export first.
- Add EHR API creation only after field mapping is stable.

## Near-Term Engineering Order

1. Provision Azure resources and apply all database migrations.
2. Configure server-only credentials and internal worker authorization.
3. Implement and deploy the Databricks job against the existing callback contract.
4. Run live upload, reconciliation, preview, evidence, retry, and retention smoke tests.
5. Run the 500-page backlog pilot.
6. Process backlog waves only after pilot routing/cost is known.
