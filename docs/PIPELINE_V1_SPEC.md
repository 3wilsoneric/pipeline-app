# Pipeline V1 Spec

Source: `/Users/eric/Downloads/Pipeline_V1_Spec.docx`

## Scope

End-to-end extraction of structured referral data from messy multi-format packets, from drag/drop upload through human-reviewed canonical fields, with confidence-based routing between Azure Document Intelligence and Claude vision.

## Stack

- Next.js standalone container on Azure Container Apps
- Azure Blob Storage
- Azure Functions / Event Grid
- Databricks Jobs
- Azure Document Intelligence
- Claude vision
- Delta Lake + Unity Catalog
- Pydantic
- Microsoft Entra ID browser sign-in with server-validated JWTs for internal users

## Volume Model

Pipeline V1 has two workloads:

1. A one-time backlog of about 100,000 already digitized pages.
2. Ongoing intake of about 500 new pages per week.

These should share the same extraction schema, storage layout, validation logic, and review UI, but they should not share the same trigger path.

### Backlog Workload

- Run as a controlled Databricks batch migration.
- Start with a 500-page pilot before any full run.
- Process later waves in 10,000-25,000 page chunks.
- Use a `batch_manifest` to track raw paths, packet IDs, source/facility, page counts, hashes, priority, and status.
- Run Document Intelligence broadly during the pilot, then tighten routing after measuring page classes.
- Send only low-confidence, handwritten, messy, or clinically ambiguous pages/fields to Claude.
- Human-review only exceptions and critical fields.
- Preserve raw files, normalized pages, OCR JSON, evidence crops, and candidate fields because storage is cheap relative to extraction and review.

### Steady-State Workload

- Run as async per-packet processing from the app upload flow.
- Expected scale: about 500 pages/week.
- Browser uploads directly to Azure Blob through signed URLs.
- Upload completion triggers a packet-level Databricks job.
- Latency target is minutes, not seconds.
- Same confidence routing applies: Document Intelligence first, Claude only on exceptions.

## Architecture Overview

Pipeline separates three concerns:

- Interactive UI/API layer: Next.js on Azure Container Apps.
- Binary handling and heavy compute: Azure + Databricks.
- Governed system of record: Delta Lake under Unity Catalog.

Packet binaries upload directly to private Blob Storage and never traverse the
Next.js web process. No AI output reaches the referral record without explicit
human approval.

End-to-end flow:

1. User drops files into a referral record.
2. Next.js requests a signed upload URL per file from its own API route.
3. Browser uploads each file directly to Azure Blob Storage using SAS.
4. Raw blobs are immutable and tagged with `packet_id`, `received_at`, `source_type`, and `submitting_facility`.
5. Next.js completes upload and triggers Databricks by direct Jobs REST call or Event Grid -> Azure Function -> Databricks.
6. Databricks normalizes packet pages to 200 DPI PNGs using PyMuPDF.
7. Azure Document Intelligence runs on every page.
8. Low-confidence fields/pages route to Claude vision.
9. Pydantic validates model output before merge/write.
10. Deterministic merge creates canonical proposed fields while preserving all candidates and evidence.
11. Next.js polls or receives webhook completion.
12. Human reviewer accepts, edits, or rejects extracted values.
13. Approved fields write to the referral record.
14. Accepted/admitted referrals become EHR create/export payloads.

Orchestration principle: boring and deterministic. One Databricks multi-task job per packet, idempotent tasks keyed by `packet_id`, explicit retries, and no autonomous agents making routing decisions outside confidence rules.

## Current App Status

- UI scaffold exists for referrals, communities, chat, reports, calendar, packet dropzones, and extraction review.
- The packet canvas now ends with a data-review step that shows field and document completeness for the current referral; it is still UI/local-state work until durable persistence is connected.
- Next.js API contracts exist for signed-upload creation, upload completion, packet status, extracted fields, field review, and field retry.
- Development uses a labeled mock flow. Production uses durable PostgreSQL
  state, per-blob Azure SAS, Databricks job dispatch/reconciliation,
  authenticated callbacks, bounded retry/dead-letter handling, and reviewable
  evidence.
- Auth seam exists for internal deployment: local mock mode for development, Entra JWT mode in production, and role-gated extraction routes.
- The adapters and audit persistence are implemented. Live operation still
  needs provisioned Azure resources, credentials, and the Databricks
  notebook/job implementation that conforms to the callback contract.

## Azure Resources Needed

| Resource | Purpose | Required configuration |
| --- | --- | --- |
| Storage Account / ADLS Gen2 | Additive raw packets, normalized pages, OCR JSON, evidence crops, artifacts | Hierarchical namespace on, Blob and container soft delete, approved network path, and CORS for the exact Pipeline production origin. Blob versioning and version-level WORM are unavailable with HNS; use unique raw object keys and approve/test any container-level WORM policy before enabling it. |
| User Delegation SAS | Short-lived signed upload URLs | Entra ID user delegation preferred, per-blob write-only SAS, 15 minute TTL, content type pinned |
| Event Grid System Topic | Trigger processing after upload | Filter to raw prefix and `.upload-complete` sentinel, dead-letter to Blob, retries enabled |
| Azure Function | Trigger Databricks Jobs REST API | Managed identity, no binary handling, secrets from Key Vault, short execution |
| Azure Databricks Workspace | Normalize, orchestrate DI/Claude, merge, write Delta | Unity Catalog enabled, job clusters, managed identity / storage credential |
| Azure Document Intelligence | OCR, layout, checkboxes, tables, general document extraction | S0 tier, private endpoint, `prebuilt-layout` and `prebuilt-document` first |
| Azure Key Vault | Secrets for Databricks, DI, Claude | RBAC, Databricks secret scope / Function references |
| Unity Catalog | Govern Delta tables and PHI access | Catalog `pipeline`, schemas `raw`, `silver`, `gold`, audit logs, row/column masking |
| Azure Monitor / Log Analytics | Job/queue/latency alerting | PHI-scrubbed logs and alerts on failures/dead letters |
| Claude API access | Vision fallback | Called from Databricks only, never browser |

## Databricks Job Design

Two Databricks entrypoints share the same underlying tasks:

- `packet_extraction_job`: parameterized by `packet_id` and raw blob prefix for live uploads.
- `backlog_batch_job`: parameterized by `batch_id`, manifest path, and page/packet wave boundaries for the one-time backlog.

Every task is idempotent.

| Task | Input | Output | Retry |
| --- | --- | --- | --- |
| `t1_ingest_manifest` | Raw blob prefix | Validated file list, packet `normalizing` | 2 retries |
| `t2_normalize` | Raw files | 200 DPI PNGs, manifest, `packet_pages` | 2 retries |
| `t3_document_intelligence` | Page PNGs | DI JSON, `document_intelligence_results` | 3 retries for 429/5xx |
| `t4_route` | DI results + manifest | Claude routing decisions | 1 retry |
| `t5_claude_fallback` | Selected page PNGs + field asks | Validated candidate fields, raw Claude artifacts | 2 retries, per-page isolation |
| `t6_validate` | DI + Claude candidates | Pydantic-validated candidates | 0 retries |
| `t7_merge` | Validated candidates | `extracted_fields`, `field_review_tasks` | 1 retry |
| `t8_finalize` | Extracted fields | Packet `ready_for_review`, webhook/poll signal | 2 retries |

Failure semantics:

- Exhausted task retries set packet `failed` with `failure_reason`.
- Claude fallback isolates per page so one bad page does not fail the packet.
- Re-running a packet is safe because writes are keyed by `packet_id`, `page_no`, and `field_key`.
- Max concurrent runs per packet is 1.
- Backlog re-runs are safe because writes are additionally partitioned by `batch_id` and wave.

## Backlog Batch Manifest

The backlog starts from a manifest, not from the app upload flow.

Required columns:

| Column | Purpose |
| --- | --- |
| `batch_id` | One-time migration batch |
| `packet_id` | Stable packet identifier |
| `raw_blob_path` | Existing digitized file path |
| `facility` | Source/community/facility |
| `source_type` | fax/email/portal/manual/backlog |
| `received_at` | Historical or loaded date |
| `page_count_estimate` | Used for wave sizing |
| `content_hash` | Dedupe |
| `priority` | Which packets process/review first |
| `status` | queued/processing/ready_for_review/failed/skipped |

## Blob Storage Layout

```text
raw/                                           IMMUTABLE
  {submitting_facility}/{packet_id}/
    original/{file_id}.{ext}
    .upload-complete

normalized/
  {packet_id}/pages/page-{n:04d}.png
  {packet_id}/manifest.json

ocr/
  {packet_id}/di/page-{n:04d}.json

evidence/
  {packet_id}/{field_key}/{candidate_id}.png

artifacts/
  {packet_id}/{job_run_id}/route.json
  {packet_id}/{job_run_id}/claude/page-{n:04d}.json
  {packet_id}/{job_run_id}/run.log
```

The `.upload-complete` sentinel is written after all files succeed so Event Grid fires once per packet.

## Delta / Unity Catalog Tables

Initial governed tables:

- `referral_packets`
- `packet_pages`
- `document_intelligence_results`
- `extraction_runs`
- `extracted_fields`
- `field_review_tasks`
- `field_audit_events`
- `ehr_export_queue`

Core columns are defined in [REFERRAL_PACKET_EXTRACTION_BUILD_SPEC.md](./REFERRAL_PACKET_EXTRACTION_BUILD_SPEC.md).

## API Contracts

All routes are authenticated. None accept or return packet binaries.

### `POST /api/uploads/create-url`

Request:

```json
{
  "referral_id": "ref_123",
  "submitting_facility": "County General ED",
  "source_type": "manual",
  "files": [
    {
      "file_id": "file_1",
      "filename": "packet.pdf",
      "content_type": "application/pdf",
      "size": 123456
    }
  ]
}
```

Response:

```json
{
  "packet_id": "pkt_123",
  "uploads": [
    {
      "file_id": "file_1",
      "signed_url": "https://...",
      "blob_path": "raw/facility/pkt_123/original/file_1.pdf",
      "expires_at": "2026-06-05T12:00:00.000Z"
    }
  ],
  "sentinel_url": "https://..."
}
```

### `POST /api/uploads/complete`

Request:

```json
{
  "packet_id": "pkt_123",
  "uploaded_file_ids": ["file_1"]
}
```

Response:

```json
{
  "packet_id": "pkt_123",
  "status": "received",
  "job_run_id": "mock_run_123"
}
```

### `GET /api/packets/{packet_id}/status`

Response includes packet status, page count, job run ID, review counts, and failure reason when present.

### `GET /api/packets/{packet_id}/fields`

Response includes proposed fields, canonical candidate, confidence, source evidence, conflicts, packet completeness, and EHR readiness.

### `POST /api/packets/{packet_id}/fields/{field_key}/review`

Request:

```json
{
  "action": "accept"
}
```

Actions: `accept`, `edit`, `reject`. The reviewer identity comes from the authenticated platform user, not from the browser body.

### `POST /api/packets/{packet_id}/fields/{field_key}/retry`

Request:

```json
{
  "force_claude": true
}
```

Response queues a single-field retry run.

## Implementation Milestones

1. Local mock: API contracts, static packet status, static fields, review action writes to mock state.
2. Azure Blob signed upload: real SAS URL creation, direct browser upload, sentinel write.
3. Databricks normalization job: Event Grid -> Function -> Databricks, 200 DPI pages, manifest, status polling.
4. Document Intelligence extraction: DI on all pages, fields from DI only, evidence surfaced.
5. Claude fallback + human review: confidence routing, strict JSON/Pydantic validation, merge conflicts, audit, EHR export queue.

V1 cutline: ship milestones 1-5 with prebuilt Document Intelligence models and confidence-based Claude routing. Custom DI models, auto-EHR submission, and deeper assignment/workflow routing are V2.
