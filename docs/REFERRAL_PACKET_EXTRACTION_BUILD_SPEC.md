# Referral Packet Extraction Build Spec

## Objective

Turn a dragged-and-dropped referral packet into a reviewed, coordinator-approved referral record.

The system should not silently write AI output into the referral profile. It should:

1. Store the original packet.
2. Strip text, layout, pages, tables, handwriting/signatures where possible.
3. Classify packet sections.
4. Extract structured fields into a strict schema.
5. Normalize/validate those fields.
6. Show the coordinator every proposed value with confidence and source evidence.
7. Write only approved fields to the referral record.
8. When accepted/admitted, package the approved referral data for EHR record creation.

## Product Flow

## Volume Model

The system has two different workloads and they should not be treated the same.

### One-Time Backlog

- Estimated size: about 100,000 already digitized pages.
- Purpose: convert historical packets into searchable, structured, reviewable records.
- Processing style: controlled batch migration, not live intake.
- Batch size: start with a 500-page pilot, then run 10,000-25,000 page waves.
- Cost control: Document Intelligence baseline first; Claude only for low-confidence, handwritten, messy, or clinically ambiguous pages.
- Human review: exceptions only, not every page.
- Storage posture: keep raw files, normalized page images, OCR JSON, evidence crops, and merge outputs because storage is cheap relative to extraction/review.

### Steady-State Intake

- Estimated size: about 500 new pages per week.
- Purpose: process new referral packets as they arrive.
- Processing style: async per-packet jobs triggered by upload completion.
- Latency target: minutes, not seconds.
- Cost control: run Document Intelligence on the full packet, route only hard pages/fields to Claude, and human-review required/low-confidence fields.
- Databricks role: useful for governance, Delta/Unity Catalog, auditability, and sharing the same pipeline as the backlog; not required for raw scale at 500 pages/week.

### Practical Cost Assumptions

- Azure Blob storage for 100,000 pages should be cheap enough to preserve all source/evidence artifacts.
- The main cost variables are pages analyzed by Document Intelligence, percentage of pages routed to Claude vision, Databricks compute time, and human review labor.
- Do not estimate the 100,000-page backlog from list prices alone. Run a 500-page pilot and calculate:
  - page type distribution
  - OCR success rate
  - handwritten/messy percentage
  - Claude fallback percentage
  - critical-field review rate
  - cost per 1,000 pages

### Current UI Entry Points

- New referral modal packet dropzone.
- Expanded referral card packet dropzone.
- Referral-list and canvas packet drop.

### Target UI After Drop

The dropzone becomes an extraction toolbox with these states:

- `Queued`: file attached and extraction job created.
- `Stripping`: OCR/layout/table/page processing.
- `Classifying`: packet sections detected.
- `Extracting`: fields proposed.
- `Needs review`: coordinator must confirm values.
- `Approved`: approved fields written to referral record.
- `Failed`: retry/manual-entry path.

### Confirmation Screen

Each extracted field should show:

- Field name.
- Proposed value.
- Confidence.
- Source document/page.
- Evidence snippet or image crop.
- Current referral record value.
- Actions: `Accept`, `Reject`, `Edit`, `Mark missing`.

The coordinator should be able to approve by section:

- Demographics.
- Referral source.
- Clinical/diagnosis.
- Medications.
- Functional needs.
- Legal/consent.
- Payer/insurance.
- Risk/safety.
- Community fit.

## Data Model

### `referral_packets`

- `id`
- `referral_id`
- `original_file_name`
- `blob_url`
- `mime_type`
- `file_hash`
- `uploaded_by`
- `uploaded_at`
- `status`
- `page_count`
- `document_intelligence_job_id`
- `extraction_job_id`
- `error_message`

### `packet_pages`

- `id`
- `packet_id`
- `page_number`
- `image_blob_url`
- `ocr_text`
- `layout_json`
- `section_type`
- `section_confidence`

### `extracted_fields`

- `id`
- `packet_id`
- `referral_id`
- `field_key`
- `proposed_value`
- `normalized_value`
- `confidence`
- `source_page`
- `source_span`
- `source_crop_url`
- `extractor`
- `validation_status`
- `review_status`
- `reviewed_by`
- `reviewed_at`
- `final_value`

### `field_audit_events`

- `id`
- `referral_id`
- `packet_id`
- `field_key`
- `event_type`
- `old_value`
- `new_value`
- `actor`
- `created_at`
- `model_version`
- `prompt_version`

## Extraction Schema

### Demographics

- `first_name`
- `middle_name`
- `last_name`
- `preferred_name`
- `date_of_birth`
- `age`
- `sex`
- `gender_identity`
- `phone`
- `email`
- `address`
- `emergency_contact_name`
- `emergency_contact_phone`
- `primary_language`

### Referral

- `referral_source`
- `referring_facility`
- `referring_contact`
- `referring_contact_phone`
- `referral_date`
- `requested_community`
- `target_admission_date`
- `priority`

### Clinical

- `primary_diagnosis`
- `secondary_diagnoses`
- `current_medications`
- `allergies`
- `mobility_status`
- `adl_needs`
- `cognitive_status`
- `behavioral_risks`
- `fall_risk`
- `dietary_needs`
- `special_needs`

### Packet Completeness

- `release_on_file`
- `med_list_received`
- `clinical_notes_received`
- `facesheet_received`
- `insurance_received`
- `assessment_required`
- `missing_items`

### Payer/EHR

- `payer_type`
- `insurance_plan`
- `policy_number`
- `medicare_id`
- `medicaid_id`
- `responsible_party`
- `ehr_create_ready`

## Recommended Stack

### Storage

- Azure Blob Storage for original packets, page images, OCR JSON, field evidence crops.
- Immutable file hash to dedupe packets and preserve chain of custody.
- Optional virus/malware scan before extraction.

### OCR/Layout/Base Document Understanding

Primary: Azure AI Document Intelligence.

Why:

- It returns structured JSON for forms/documents.
- It supports custom classification plus custom extraction models.
- The current v4.0 GA documentation describes custom neural extraction for structured, semi-structured, and unstructured documents, and custom classifiers for identifying document type before extraction.
- It supports confidence at table/row/cell level in v4.0.

Source: Microsoft Document Intelligence custom model docs: https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/train/custom-model?tabs=fott&view=doc-intel-4.0.0

Use:

- `prebuilt-layout` / layout model for baseline OCR and page structure.
- Custom classifier for packet section detection.
- Custom neural extraction models for recurring facility packet formats.
- Composed models when multiple packet templates exist.

Fallback:

- Tesseract only for local/dev or emergency OCR fallback.
- Do not make Tesseract the production primary unless cost is the only priority.

### LLM Extraction and Reasoning

Use LLMs after OCR/layout, not instead of OCR/layout.

Primary production pattern:

- Azure Document Intelligence strips and structures raw content.
- LLM converts OCR/layout chunks into normalized domain fields.
- Strict JSON Schema output.
- Validator checks schema, business rules, and source evidence.
- Reviewer confirms before record write.

OpenAI:

- Use Structured Outputs for strict schema extraction and type-safe parsing.
- The official docs recommend clear key names/descriptions and evals for schema quality.
- Structured Outputs can constrain output to JSON Schema and parse into typed objects.

Source: OpenAI Structured Outputs docs: https://developers.openai.com/api/docs/guides/structured-outputs

Claude:

- Use Claude as a strong secondary reviewer for messy PDFs, visual layouts, handwritten-looking pages, and clinical note summarization.
- Claude PDF support can process PDFs visually and as text; docs describe visual PDF analysis that understands layouts, charts, images, and pages as both text and image.

Source: Claude PDF support docs: https://platform.claude.com/docs/en/build-with-claude/pdf-support

Recommended model routing:

- Fast/cheap pass: OpenAI structured extraction from OCR text/layout.
- Complex visual pass: Claude PDF/vision for pages with poor OCR, scans, tables, or handwritten annotations.
- Tie-breaker pass: second model reviews low-confidence or conflicting fields.
- Never accept fields merely because two models agree; still require confidence/evidence and human confirmation for critical fields.

### Azure / Databricks Backend Architecture

This is the target backend. Next.js owns the UI and lightweight orchestration. Azure Blob Storage, Databricks, Delta Lake, and Unity Catalog own packet processing, durable structured records, and PHI governance.

```text
Azure Container Apps / Next.js  Azure Blob / Databricks
──────────────────────────────  ──────────────────────────────
Upload UI                     Azure Blob Storage: raw packets
API Route ──POST─────────→    Databricks Job: extraction pipeline
Poll / webhook ←─────────     Delta Lake: structured records
Results UI                    Unity Catalog: governed access
```

Rules:

- Upload raw PDF/image directly to Azure Blob Storage through a signed URL.
- Never route packet binaries through Next.js.
- Next.js creates the packet record, requests a signed upload URL, receives `job_run_id`, and polls or receives a webhook.
- Next.js never holds a serverless function open waiting for a multi-page extraction job.
- Raw packet blobs are immutable. All processing is additive.
- Full identifiable records live under Unity Catalog governance.

### V1 Azure Resource Baseline

V1 should provision these resources before real extraction begins:

| Resource | Purpose | Required configuration |
| --- | --- | --- |
| ADLS Gen2 Storage Account | Raw packets, normalized pages, OCR JSON, evidence crops, artifacts | Hierarchical namespace, Blob and container soft delete, additive raw object keys, and CORS for the exact Pipeline production origin. Blob versioning and version-level WORM are unavailable with HNS; add a tested container-level WORM policy only after retention requirements are approved. |
| User Delegation SAS | Browser direct uploads | Per-blob write-only SAS, short TTL, content-type pinned |
| Event Grid System Topic | Blob-created processing trigger | Filter to `.upload-complete` sentinel; dead-letter and retry enabled |
| Azure Function | Databricks trigger | Managed identity, no binary handling, secrets from Key Vault |
| Azure Databricks Workspace | Normalization, DI orchestration, Claude routing, merge, Delta writes | Unity Catalog enabled, job clusters, storage credential/external location |
| Azure Document Intelligence | OCR/layout/table/checkbox extraction | `prebuilt-layout` and `prebuilt-document` first; private endpoint preferred |
| Azure Key Vault | Secrets | Databricks, Document Intelligence, Claude keys/tokens |
| Unity Catalog | PHI governance | Catalog `pipeline`; schemas `raw`, `silver`, `gold`; auditing and masking |

### V1 Databricks Job DAG

One multi-task Databricks Job runs per packet, parameterized by `packet_id` and raw blob prefix. Every task must be idempotent.

| Task | Input | Output | Retry |
| --- | --- | --- | --- |
| `t1_ingest_manifest` | Raw blob prefix | Validated file list; packet `normalizing` | 2 retries |
| `t2_normalize` | Raw files | 200 DPI PNGs, manifest, `packet_pages` | 2 retries |
| `t3_document_intelligence` | Page PNGs | DI JSON, `document_intelligence_results` | 3 retries on 429/5xx |
| `t4_route` | DI results + manifest | Claude routing decisions | 1 retry |
| `t5_claude_fallback` | Selected page PNGs + field asks | Validated candidate fields; raw Claude artifacts | 2 retries, per-page isolation |
| `t6_validate` | DI + Claude candidates | Pydantic-validated candidates | 0 retries |
| `t7_merge` | Validated candidates | `extracted_fields`, `field_review_tasks` | 1 retry |
| `t8_finalize` | Extracted fields | Packet `ready_for_review`; webhook/poll signal | 2 retries |

### V1 Blob Layout

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

### V1 Governed Tables

Initial Unity Catalog / Delta tables:

- `referral_packets`
- `packet_pages`
- `document_intelligence_results`
- `extraction_runs`
- `extracted_fields`
- `field_review_tasks`
- `field_audit_events`
- `ehr_export_queue`

The full V1 source spec lives in [PIPELINE_V1_SPEC.md](./PIPELINE_V1_SPEC.md). The implementation checklist lives in [EXTRACTION_STACK_IMPLEMENTATION_CHECKLIST.md](./EXTRACTION_STACK_IMPLEMENTATION_CHECKLIST.md).

## Four-Stage Extraction Pipeline

This pipeline supports both the backlog and steady-state intake. The difference is the trigger:

- Backlog: Databricks reads a batch manifest and processes packets in waves.
- Steady-state: Next.js upload completion triggers one packet job.

### 1. Ingest

Steady-state upload:

- Next.js API creates a packet shell record and signed Azure Blob upload URL.
- Browser uploads the raw PDF/image directly to Azure Blob Storage.
- Tag every blob at write time:
  - `packet_id`
  - `received_at`
  - `source_type`
  - `submitting_facility`
- Hash the raw file on ingest and dedupe against Delta before processing.
- Trigger a Databricks Job through REST API, or through Event Grid -> Azure Function -> Databricks.
- Store `job_run_id` on the packet record.
- Set packet status to `queued`.
- Attach packet to the referral record.

Backlog upload:

- Create a `batch_manifest.csv` or Delta table before extraction begins.
- Required manifest fields:
  - `batch_id`
  - `packet_id`
  - `raw_blob_path`
  - `facility`
  - `source_type`
  - `received_at`
  - `page_count_estimate`
  - `content_hash`
  - `priority`
- Hash and dedupe before processing.
- Process in waves of 10,000-25,000 pages after the 500-page pilot.
- Store batch status separately from live referral status.

Raw blobs are never transformed in place. If extraction improves later, reprocess from the immutable raw source.

### 2. Normalize

Databricks normalizes all inputs before extraction:

- Validate file type, file size, and page count.
- Convert every input to per-page PNG images using PyMuPDF.
- Target 200 DPI minimum for reliable handwriting and visual recognition.
- Write normalized page images back to Azure Blob Storage.
- Write a page manifest to Delta before any extraction runs.
- Preserve page number, image blob URL, dimensions, source file hash, and packet ID.
- Re-sequence pages by manifest page number before downstream extraction.

### 3. OCR & Extract

Use Azure Document Intelligence and Claude vision together.

Azure Document Intelligence:

- Run on every steady-state packet page first.
- For backlog waves, run on pages selected by the batch manifest/page classifier. Start broad during the pilot, then skip obvious non-useful pages if classification proves safe.
- Use for typed/printed pages, structured forms, checkboxes, tables, and predictable layouts.
- Persist OCR text, tables, key-value pairs, checkboxes, confidence, and page geometry.
- Treat it as the cheap, fast, HIPAA-eligible baseline extractor.

Claude vision:

- Use for pages or fields that Document Intelligence struggles with.
- Escalate handwritten sections, ambiguous mixed layouts, unstructured clinical notes, messy scans, and low-confidence fields.
- Pass base64 page images with a schema-anchored system prompt.
- Claude must return only valid JSON matching the target schema.
- Never send the entire backlog to Claude. Target exception pages/fields only.

Routing logic:

- Run Document Intelligence on everything.
- If field confidence is below threshold, escalate that field/page to Claude.
- Optionally run both on high-risk pages and merge.
- Prefer Document Intelligence for structured form fields.
- Prefer Claude for free text, handwriting, clinical note reasoning, and ambiguous layouts.
- Never let a model overwrite higher-confidence sourced data without recording a conflict.
- For backlog pages, classify first: structured data sheet, handwritten form, clinical note, irrelevant attachment, unknown.

### 4. Parse, Validate & Output

Databricks owns parse, validation, merge, and durable output:

- Keep the exact target JSON schema in the model system prompt, not the user turn.
- Run Pydantic validation immediately on every Claude response.
- Malformed output goes to an exception queue and never touches Delta.
- Retry invalid Claude JSON once with a stricter prompt, then exception queue.
- Merge Document Intelligence structured fields and Claude extracted fields into one canonical packet record.
- Store confidence, extractor, source page, evidence span/crop, model version, and prompt version.
- Write canonical records to Delta Lake under Unity Catalog.
- Restrict table access to credentialed internal roles.
- Enable audit logging on every query.
- Notify Next.js by webhook or expose completion for polling by `job_run_id`.

## Recursive Repair Pipeline

For missing or low-confidence fields:

1. Search the packet manifest and OCR output again using field-specific queries.
2. Re-run extraction only on likely pages or fields.
3. Escalate only the unresolved field/page to Claude vision.
4. Ask the model to explain why the field is missing or ambiguous.
5. If still unresolved, write `null`, confidence flag, source reason, and human review task.

Never loop forever. Max 2 repair attempts per field.

## Human Confirmation

Coordinator reviews fields before writeback.

Critical fields require explicit approval:

- Name.
- DOB.
- Payer.
- Community.
- Medications.
- Allergies.
- Diagnosis.
- Risk/safety flags.
- Legal/consent.

## Writeback

Only approved fields write to:

- Referral profile.
- Referral workflow state.
- Packet completeness status.
- EHR export/create queue if accepted/admitted.

## EHR Record Creation

When referral reaches `Accepted / Admitted`:

- Build EHR create payload from approved fields only.
- Validate EHR required fields.
- Push through EHR API if available.
- If no API, export CSV/XLSX in exact import template.
- Store EHR creation response/status.

## Failure Modes

| Failure | Handling |
| --- | --- |
| Handwriting illegible | Write `null`, confidence flag, source page, and human review task. |
| Claude returns invalid JSON | Retry once with stricter schema prompt, then exception queue. |
| Document Intelligence misses a field | Escalate only that field/page to Claude vision. |
| Pages out of order | Re-sequence by page number from Delta page manifest before extraction. |
| Duplicate submission | Hash raw file on ingest and dedupe against Delta before processing. |
| Low-confidence critical field | Keep proposed value out of writeback until coordinator approval. |
| Conflicting values across pages | Store both candidates, source evidence, confidence, and review task. |
| Databricks job fails | Mark packet `failed`, store run/error metadata, expose retry from UI. |

## Key Decisions

- Schema-first prompting: target JSON schema lives in the Claude system prompt. Fields match the downstream EHR/referral schema exactly.
- Pydantic gate: every Claude response is validated in Databricks before it can be merged or written to Delta.
- Confidence-based routing: Document Intelligence runs on everything; Claude runs only where DI confidence is low or the page needs visual reasoning.
- Immutable raw storage: raw packet blobs are the source of truth and are never transformed in place.
- Additive processing: normalized pages, OCR JSON, field proposals, and canonical records are separate outputs.
- Async always: Next.js fires the job, stores `job_run_id`, and receives webhook/polling completion.
- Unity Catalog is the PHI boundary: full identifiable records live in governed schemas with role-based access and audit logging.
- Human confirmation before writeback: no AI-extracted critical field silently changes the referral or EHR payload.

## Agent Design

### Agent Responsibilities

The extraction agent should have tools, not free rein.

Tools:

- `read_packet_page(packet_id, page_number)`
- `search_packet(packet_id, query)`
- `get_ocr_layout(packet_id)`
- `propose_fields(packet_id, schema_section)`
- `validate_field(field_key, value, evidence)`
- `create_review_task(field_key, reason)`
- `write_approved_field(referral_id, field_key, value)`
- `prepare_ehr_payload(referral_id)`

The agent can:

- Decide which pages to inspect.
- Ask for second-pass extraction.
- Flag conflicts.
- Create review tasks.

The agent cannot:

- Write unapproved fields.
- Override coordinator edits.
- Create an EHR record without acceptance/admission state and required field validation.

## UI Requirements

### Dropzone

Show:

- Packet filename.
- Extraction status.
- Current step.
- Progress/provenance.
- Retry failed extraction.

### Review Drawer/Page

Columns:

- Field.
- Proposed value.
- Confidence.
- Evidence.
- Action.

Actions:

- Accept.
- Edit.
- Reject.
- Mark missing.
- Ask extractor to retry field.

### Confidence Display

Confidence should be explainable:

- OCR confidence.
- Extraction confidence.
- Validation status.
- Source evidence present/absent.
- Conflict count.

Do not show one fake “AI confidence” number unless it is composed from those signals.

## V1 Next.js API Contracts

All routes are authenticated in production. None accept or return packet binaries.

- `POST /api/uploads/create-url`: create packet shell and signed direct-to-Blob upload URLs.
- `POST /api/uploads/complete`: mark upload complete and trigger Databricks job or sentinel flow.
- `GET /api/packets/{packet_id}/status`: return packet status, page count, job run, pending field counts, and failure reason.
- `GET /api/packets/{packet_id}/fields`: return proposed fields, candidates, confidence, source evidence, completeness, and EHR readiness.
- `POST /api/packets/{packet_id}/fields/{field_key}/review`: accept, edit, or reject one field and write audit event.
- `POST /api/packets/{packet_id}/fields/{field_key}/retry`: queue field/page retry, optionally forcing Claude.

The current repo scaffold implements these contracts as mock App Router handlers under `app/api/**`. The shared TypeScript contracts live in `lib/extraction/contracts.ts`.

## EHR Automation

EHR creation should only happen after:

- Referral stage is `Accepted / Admitted`.
- Required fields are coordinator-approved.
- Packet evidence is retained.
- Export/create payload validates.

EHR queue statuses:

- `not_ready`
- `ready_for_review`
- `ready_for_ehr`
- `submitted`
- `created`
- `failed`

## Security and Compliance

- Encrypt files at rest.
- Use signed URLs for temporary document access.
- Avoid sending full packet to LLM if only a few pages are needed.
- Redact unnecessary PHI for evals/debug logs.
- Keep prompt/model/version audit history.
- Log every field write.
- Role-gate EHR export and EHR create.
- Preserve original packet and evidence for audit.

## Implementation Phases

### Phase 1: UI + Local Mock

- Dropzone creates packet state.
- Mock extracted fields.
- Review UI with accept/edit/reject.
- Approved fields write to referral object.

### Phase 2: Azure Document Intelligence

- Blob upload.
- Layout/OCR extraction.
- Page text and table persistence.
- Basic section classification.

### Phase 3: Structured LLM Extraction

- Strict schema per section.
- Source citations/page refs.
- Field validation.
- Human review queue.

### Phase 4: Recursive Repair

- Low-confidence field retry.
- Second-model review.
- Conflict detection.
- Missing-field explanation.

### Phase 5: EHR Automation

- Accepted-referral EHR payload.
- CSV/XLSX export first.
- EHR API create after mapping is stable.
- Error/retry/created statuses.

## Recommended First Build

Build this first:

1. Real Blob upload.
2. Packet row attached to referral.
3. Azure Document Intelligence layout OCR.
4. Store OCR JSON.
5. One strict extraction schema for demographics/referral source.
6. Review drawer.
7. Approved field writeback.
8. Accepted-referral CSV export.

Do not start by building a huge autonomous agent. Start with deterministic ingestion plus constrained LLM extraction plus human confirmation. Then add agentic recursion only around missing/low-confidence fields.
