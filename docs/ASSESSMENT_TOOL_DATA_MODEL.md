# Assessment Tool Data Model

The canonical assessment field registry lives in
`lib/assessment/assessment-tool-schema.ts`. It contains the 52 fields supplied
for identity, placement, history, clinical status, ADLs, risk, legal status,
medications, substance use, support, and extraction quality.

## Identity And History

- `assessment_id` is the server-generated technical primary key.
- `resident_number` is the ElderMark business join key and is required for a
  completed assessment.
- `resident_key` is the reviewed, community-qualified Alamo identity link.
- `assessment_date` is required and is never collapsed into a single current
  assessment.
- Query assessment history with an index on
  `(resident_number, assessment_date DESC, created_at DESC)`.
- Do not make `(resident_number, assessment_date)` unique. A correction or a
  second same-day assessment must not overwrite history. Use a job/source
  idempotency key to suppress a retried import of the same source artifact.
- Never infer `resident_number` or `resident_key` from a name. Ambiguous or
  missing identity remains a visible review blocker.

The current Alamo contract already supplies `resident_id` and `resident_key`.
It now accepts nullable `resident_number`, but Alamo must add the governed
ElderMark number to roster and resident responses before automatic joins can
be enabled. Pipeline must not assume `resident_id` is the ElderMark number.

## Implemented Pipeline Boundary

The current app includes a development adapter behind `AssessmentStore` and the
following authenticated server routes:

- `GET/POST /api/referrals/{referralId}/assessments`
- `POST /api/referrals/{referralId}/assessments/import`
- `GET/PATCH /api/assessments/{assessmentId}`
- `GET /api/assessments?resident_number=...` or `resident_key=...`

Mutations enforce same-origin requests, role gates, idempotency keys, optimistic
record versions, append-only audit events, and review before completion. Runtime
production mode fails closed unless the PostgreSQL assessment adapter and
database connection are configured.
Local CSV/JSON parsing is bounded and deterministic. XLSX/XLS files are reserved
for the Azure extraction worker; Pipeline does not pretend a browser upload was
successfully understood when that worker is unavailable.

## Storage Shape

The production `assessments` record should store canonical scalar fields and
real arrays for:

- `secondary_diagnoses`
- `medications_at_intake`
- `substances`

Do not store those lists as comma-separated strings. A source string containing
punctuation stays one list item unless the extraction result explicitly returns
a structured array.

Each assessment also stores:

- `field_provenance`: source field, file, page, confidence, evidence reference,
  and human review status for every mapped value.
- `unmapped_fields`: original keys and values that cannot be mapped safely.
- `assessment_notes`: reviewed rich text that does not fit a canonical field.
- `version`, `created_at`, and `updated_at` for optimistic concurrency and audit.

Large source files and rendered evidence pages remain in Azure Blob. Database
rows store authorized object references, checksums, and processing status.

## Extraction Rules

1. Referral creation runs only the initial referral intake targets.
2. Assessment extraction runs later from the referral/client canvas against
   `assessmentWorkbookExtractionTargets`.
3. Known aliases map conservatively. Semantically ambiguous legacy values are
   banked, not guessed.
4. Machine output is proposed data until accepted or edited by a user.
5. A mapped value never silently overwrites a reviewed human value.
6. Rejected and malformed values remain in the unmapped bank with provenance.
7. Completion is derived from the required identity fields, not a stored
   percentage.

## Required Production Tables

The durable migration still needs separate `assessments`,
`assessment_field_provenance`, and `assessment_unmapped_fields` records (or an
equivalent normalized design), plus foreign keys to the referral, reviewed
resident link, source document, extraction job, and audit event. The existing
local adapter is a working contract/test implementation; it is not the
production database.
