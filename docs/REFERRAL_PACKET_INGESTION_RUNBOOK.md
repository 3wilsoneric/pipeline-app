# Referral Packet Ingestion Runbook

## Local Demo Ingestion

With `PIPELINE_EXTRACTION_BACKEND=mock`, the New packet surface accepts a PDF or supported image without requiring demographics, owner, or community first. The local path:

1. Validates the reservation, size, digest, and file signature.
2. Stores the complete original under the ignored local document root.
3. Reads embedded text when present and uses on-device OCR for scanned pages.
4. Processes the first three intake pages by default while preserving the full packet and page count.
5. Produces 13 explicit review rows with source-page references. Missing values stay visible and require manual entry.
6. Populates the referral form only from extracted values and keeps every value pending until a user confirms or corrects it.

Set `PIPELINE_LOCAL_OCR_MAX_PAGES` from 1 to 10 when a demo packet keeps its face sheet deeper in the document. This is a single-instance development path. Production continues to use Azure Blob Storage and the Databricks worker; production mock extraction remains blocked.

For a private local demonstration, place an operator-supplied packet under the ignored `.data/demo-packets/` directory. Do not commit that directory or copy the packet into a public fixture. The standard New packet drag-and-drop surface must be used for the demo so the same upload, extraction, review, and persistence boundaries are exercised.

## Organization After Ingestion

Every original packet belongs to one referral record. That referral is the source of truth for:

- stable Pipeline client identity
- referral episode routing and intended community
- owner and stage
- received and created dates
- packet tags
- original-document metadata and extraction review

The referral browser derives its routing community, month, and tag counts from these persisted records. A packet with no referral community stays under `Unassigned`; Pipeline does not infer one from a name or filename. Current admitted community is a separate Alamo census value and is not written back into the referral.

Joining Pipeline backlog to an admitted Alamo census profile is a separate reviewed identity operation. A daily internal reconciliation creates candidates from one fresh governed roster snapshot, then a reviewer confirms or rejects them. Packet ingestion never waits for this job. Pipeline never joins by name alone. Only a confirmed resident link exposes Pipeline referrals, assessments, documents, and open work on the admitted-client profile.

## Current Pilot Finding

The provided pilot packet is an 86-page, 25.7 MB, letter-size scanned PDF. The first sampled pages have no embedded PDF text, so local text extraction returns empty strings. Treat this as an image/OCR workload:

- Normalize pages first.
- Run OCR/layout before field extraction.
- Classify pages before sending anything to a fallback LLM.
- Store source page numbers and evidence for every proposed field.

This sample includes the mix the production workflow must support:

- structured demographic and billing grids
- checkbox and handwritten clinical forms
- narrative psychiatric/intake assessment pages
- medical/allergy/testing pages

## Immediate Backlog Workflow

Use this for the initial historical backlog, including the expected 20 large packets.

1. Put the packet PDFs in one local source folder.
2. Generate a batch manifest:

```bash
npm run manifest:packets -- --input /path/to/referral-packets --out /private/tmp/batch_manifest.csv --batch-id backlog-20260622 --facility "unknown"
```

If `page_count_estimate` is blank because `pdfinfo` is not on PATH, pass it explicitly:

```bash
npm run manifest:packets -- --input /path/to/referral-packets --out /private/tmp/batch_manifest.csv --pdfinfo /path/to/pdfinfo
```

3. Review the manifest columns:

```text
batch_id
packet_id
raw_blob_path
facility
source_type
received_at
page_count_estimate
content_hash
priority
status
```

4. Upload raw packets to immutable Blob storage under the existing layout:

```text
raw/{submitting_facility}/{packet_id}/original/{file_id}.pdf
```

5. Run a pilot wave before the full backlog:

```text
pilot size: 500 pages or 1-2 representative packets
goal: tune OCR, page classes, routing, review load, and cost
```

6. Process the remaining backlog in waves after the pilot:

```text
recommended wave size: 10,000-25,000 pages
retry key: batch_id + packet_id + page_no
human review: critical fields, conflicts, low confidence, missing required fields
```

## Shared Extraction Target

The app now has one shared schema source for:

- New referral intake fields.
- Packet assessment checklist fields.
- Page classification targets.
- Field hints for Document Intelligence and Claude fallback routing.

Source file:

```text
lib/extraction/referral-intake-schema.ts
```

The first extraction target should populate these surfaces:

- `components/pipeline/ReferralPacketCanvas.tsx`
- `components/pipeline/PacketExtractionReview.tsx`
- `components/pipeline/AssessmentWorkspace.tsx`

## Page Classes

Classify every normalized page into one of these classes before field extraction:

```text
demographics
assessment
medication_list
diagnosis_problem_list
risk_safety
allergies_medical
legal_consent
financial_payer
duplicate_irrelevant
unknown
```

Routing rule:

- Use Document Intelligence for structured grids, forms, checkboxes, med lists, demographics, payer, legal, and testing pages.
- Use Claude fallback only for low-confidence, handwritten, messy, unknown, or narrative clinical pages.
- Skip duplicate or irrelevant pages after classification, but preserve their manifest rows.

## Review Policy

Critical fields require human approval before writeback:

- name
- DOB
- diagnosis
- risk/safety flags
- medications
- allergies
- legal status
- medical clearance
- admission decision

Standard fields can be accepted in bulk when confidence is high and there is no conflict.

## Storage Policy

Store all layers because reprocessing is cheaper than recollecting packets:

```text
raw packet
normalized page images
OCR/layout JSON
page classification artifacts
model output artifacts
candidate extracted fields
field review events
approved canonical referral/assessment fields
```

Do not commit raw packets, rendered page images, OCR JSON, or PHI-bearing manifests to git.

## Next Build Steps

1. Replace mock upload targets with Azure Blob SAS.
2. Persist packet shell records outside the in-memory mock store.
3. Trigger Databricks on upload completion.
4. Write normalized page manifests and OCR results.
5. Expose Delta-backed proposed fields through the existing packet field API.
6. Add review/audit persistence for accept, edit, reject, and retry actions.
