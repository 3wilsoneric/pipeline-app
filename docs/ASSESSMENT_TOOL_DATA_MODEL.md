# Assessment Tool Data Model

The canonical assessment field registry lives in
`lib/assessment/assessment-tool-schema.ts`. It contains 155 governed fields for
identity, referral context, placement, history, clinical status, ADLs, risk,
legal status, medication, substance use, physical health, support, preferences,
and extraction quality. The interview presentation and conditional rules live
in `lib/assessment/assessment-interview-schema.ts`; presentation metadata never
creates a second copy of the stored data.

Of the 155 fields, 150 are available to the guided interview. `assessor`,
`source_file`, `match_confidence`, and `extraction_date` are server- or
extraction-owned and cannot be supplied as browser-authored clinical facts.
`unable_to_assess_reasons` is a structured support map keyed by interview field;
it stores required explanations without duplicating a reason column for every
yes/no question and is never sent to the extraction model.

## Identity And History

- `assessment_id` is the server-generated technical primary key.
- `canonical_client_id` is the immutable Alamo client identity for a confirmed
  existing client. Pipeline resolves it server-side from the reviewed resident
  link; the browser does not submit or guess it.
- `resident_number` is the ElderMark business join key when one exists. It is
  optional during pre-admission assessment because a referred client may not
  have an ElderMark record yet.
- `resident_key` is the reviewed, community-qualified Alamo identity link.
- `assessment_date` is required and is never collapsed into a single current
  assessment.
- Query assessment history with an index on
  `(canonical_client_id, assessment_date DESC, created_at DESC)` when a
  canonical identity exists, with resident number/key retained as rollout and
  compatibility lookups.
- Do not make `(resident_number, assessment_date)` unique. A correction or a
  second same-day assessment must not overwrite history. Use a job/source
  idempotency key to suppress a retried import of the same source artifact.
- Never infer `resident_number` or `resident_key` from a name. Ambiguous or
  missing identity remains a visible review blocker.

The governed Alamo contract supplies `resident_id`, `resident_key`, nullable
`resident_number`, and nullable `canonical_client_id`. A confirmed Pipeline
resident link is required before assessment writes attach a canonical ID. If
the link is ambiguous, the ID is missing, or identity services are unavailable,
the mutation fails closed instead of linking by name.

## Implemented Pipeline Boundary

The current app includes a development adapter behind `AssessmentStore` and the
following authenticated server routes:

- `GET/POST /api/referrals/{referralId}/assessments`
- `POST /api/referrals/{referralId}/assessments/import`
- `GET/PATCH /api/assessments/{assessmentId}`
- `GET /api/assessments?canonical_client_id=...`, `resident_number=...`, or
  `resident_key=...`

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

Every assessment has its own `assessment_id`; same-day or corrected assessments
remain separate history records. The August 18, 2026 client-database baseline
is never updated by an assessment save. Assessment values and evidence remain
Pipeline-owned records joined to the Alamo client at read time.

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
7. Completion is derived from required core and currently applicable
   conditional interview answers, not a stored percentage.

## Guided Interview And Completion

The assessment is organized into 12 interview sections: client and referral,
placement, history, clinical, function, legal, medication, substance use,
behavior and safety, physical health, support and goals, and review.

- The form starts with 54 required core answers. Conditional follow-ups become
  visible and required only when their controlling answer applies.
- Multi-value diagnoses and substances remain arrays. They are never stored as
  comma-separated text.
- Yes/no controls store explicit `yes`, `no`, or `unable_to_assess`; the app
  never treats an empty answer as no. Every `unable_to_assess` response requires
  a question-specific explanation before signing.
- Assistance details are required when dressing or bathing needs some or total
  assistance.
- Safety, health, medication-refusal, forensic, substance-use, and hallucination
  details open only from their applicable parent answer.
- The interview snapshot derives active substance use, medication compliance,
  ADL assistance, programming, ambulatory status, dietary restrictions, and
  language barriers from the canonical answers. It does not duplicate them.
- Admission or denial reason remains the downstream supervisor decision record;
  it is not copied into the signed clinical interview.
- Draft recovery, section autosave, section versions, presence leases, remote
  change merging, and same-field conflict review continue to operate on the
  existing assessment record.

## Prepared Incremental Updates

Migration `0007_canonical_client_assessments` adds canonical assessment identity
and a `client_update_outbox` for future new-client and incremental assessment
publication. The outbox is inert by default, accepts only `pending_approval`
records, preserves `source_baseline_date=2026-08-18`, and has no Databricks
publisher or active API route.

Do not set both `PIPELINE_CLIENT_INCREMENTAL_UPDATES_ENABLED=true` and
`PIPELINE_CLIENT_INCREMENTAL_UPDATES_APPROVAL=APPROVED` until the payload
contract, Databricks merge notebook, rollback procedure, cost, and owner
approval have been reviewed. Enabling those flags alone still does not publish;
a separately approved worker is required.
