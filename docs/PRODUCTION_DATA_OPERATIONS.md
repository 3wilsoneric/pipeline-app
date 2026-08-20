# Pipeline production data operations

Updated: 2026-08-20

## Referral canvas durability

The referral record is the source of truth for every visible referral-info
control: name, gender, reported age, DOB, SSN, owner, referral-received date,
admission date, community, referral source, responsible person, summary,
interview, conserved status, tags, field-source filenames, and requirement
evidence filenames. PostgreSQL stores the referral projection in `data` JSONB
and separately indexes canonical workflow columns. No additional migration is
required when optional canvas fields are added to that projection.

Existing referrals autosave changed sections after 1.5 seconds. Saves include
only dirty fields and the expected versions of the touched sections. Separate
sections may merge; a stale save to the same section returns `409` and presents
the local and latest values for explicit resolution. The Save button remains
available for an immediate checkpoint.

Accepting or correcting an extracted value also persists its mapped canonical
canvas value and field-source provenance in the same version-checked referral
save. The referral record therefore does not depend on a later autosave to
catch up with extraction review history.

While a field is dirty, an authenticated, per-user recovery draft is written to
PostgreSQL after 350 ms and retained for 30 days. Refreshes, new tabs, and later
signed-in sessions restore the draft for that user without exposing it to a
different principal. Local mock development keeps the legacy tab-scoped
`sessionStorage` fallback. A `beforeunload` warning protects unsaved work, and
recovery drafts never replace the versioned referral record. Neither browser nor
server recovery storage contains selected file bytes, so an unsaved initial
packet must be reselected after recovery; its name is shown as a reminder.

## Document browsing

`GET /api/files/{documentId}` returns PHI-scoped file metadata plus at most 100
preview-page records. Use `after_page` and `limit`; the default is 24. A
response includes `next_page_after` only when another page exists.

`GET /api/files/{documentId}/preview?page={page}` proxies one authenticated,
malware-cleared page. Omitting `page` requests the safe document preview or a
browser-previewable original. Responses are private/no-store, sandboxed,
same-origin, range-validated, timeout-bounded, and stream-bounded. Originals
over `PIPELINE_PREVIEW_MAX_BYTES` return `413`; use page previews instead.
Malformed IDs return `404`. Invalid pagination returns `400`. A disconnected
durable file store returns `503`. Blob keys, SAS URLs, hashes, uploader IDs, and
upstream bodies are never returned by the metadata API.

## Provided packet exercise

The supplied sample packet was exercised through the real upload, extraction,
field-review, audit-history, and referral-linking API sequence using the mock
worker boundary. The script verified the actual local bytes and PDF page count
without printing the path, client identity, text, digest, or field values.

Observed sanitized result: 86 pages, 25,679,993 bytes, `ready_for_review`, three
fields, two evidence-backed fields, page references to pages 1 and 2, and one
durable correction-history event. This proves the Pipeline workflow envelope;
it does not validate production OCR/model quality. Repeat against the deployed
Azure/Databricks worker before approving backlog ingestion:

```text
PIPELINE_SAMPLE_PACKET_PATH=/absolute/path/to/sample.pdf \
PIPELINE_SAMPLE_BASE_URL=http://127.0.0.1:3000 \
npm run check:sample-packet
```

## Ten-user collaboration check

The load check creates one synthetic referral and ten distinct authenticated
editors. It exercises ten simultaneous presence heartbeats, 20 change polls,
two parallel disjoint-section saves, ten contended same-section saves, exactly
one winner and nine `409` responses, and ten lease releases. Output contains
only counts, status classes, backend mode, and latency aggregates.

```text
PIPELINE_COLLABORATION_BASE_URL=https://pilot.example \
PIPELINE_COLLABORATION_REQUIRE_POSTGRES=true \
npm run check:collaboration-load -- --allow-remote
```

Run only against an authorized pilot environment configured to accept the
synthetic load identities. A local run validates application semantics; only a
PostgreSQL-backed run validates database contention.

## PostgreSQL drills

Use a disposable, fully migrated database for both commands below. The fixture
creates a synthetic person/referral/document/two-page-preview/presence graph in
one transaction, validates it, deliberately rolls it back, and verifies no
fixture remains.

```text
PIPELINE_TEST_DATABASE_URL=<disposable-test-url> npm run database:fixtures

PIPELINE_TEST_DATABASE_URL=<disposable-test-url> \
PIPELINE_ALLOW_MIGRATION_ROLLBACK_DRILL=true \
npm run database:rollback:drill
```

The rollback drill acquires the migration advisory lock, removes migration
`0007`, `0006`, and `0005` objects inside one transaction, validates their
absence, rolls back, and validates the original schema. It never persists a
rollback.

After production migrations, run the idempotent reference-only seed. It creates
store revision rows and no users, referrals, residents, assessments, documents,
or credentials:

```text
npm run database:seed:production
```

Pilot reset is dry-run by default and targets only referrals with both tag
`pilot-resettable` and source `Pilot synthetic seed`. It refuses any target
with a confirmed clinical link. Execution requires both controls:

```text
npm run database:pilot:reset

PIPELINE_PILOT_RESET_ENABLED=true npm run database:pilot:reset -- \
  --execute --confirm=RESET_PIPELINE_PILOT
```

## Operational metrics

Metrics are structured log events intended for the deployment log drain and
Azure Monitor/Application Insights. Dimensions are bounded to route templates,
HTTP method/status class, operation, result, job type, and backend. They never
include query strings, names, referral/resident/document IDs, diagnoses,
medications, tokens, secrets, response bodies, or error text.

| Metric | Unit | Suggested pilot alert |
| --- | --- | --- |
| `pipeline.referral.save_conflicts` | count | sustained increase by route/result |
| `pipeline.presence.stale_leases` | count | repeated expiry bursts |
| `pipeline.extraction.failures` | count | any dead letter; elevated retry rate |
| `pipeline.queue.oldest_age` | milliseconds | oldest active referral over operating SLA |
| `pipeline.api.duration` | milliseconds | p95 over 1 s or material 5xx latency |

Run `npm run check:metrics` in CI. Alert thresholds should be tuned during the
pilot; do not guess production baselines from synthetic traffic.

## Extraction quality and backlog rehearsal

`npm run check:extraction-quality` compares a versioned expected corpus with
reviewed output and reports only aggregate field recall, exact match, required
field recall, evidence-page accuracy, edit rate, and low-confidence rate. Add
sanitized pilot expectations as separate operator-controlled fixtures; never
commit real packet values.

`npm run check:backlog-rehearsal` exercises resumable orchestration for 20
synthetic 600-page packets. It checks checkpoint recovery, retry bounds,
dead-letter outcomes, and duplicate page-batch claims. Its capacity estimate is
a planning calculation, not a measurement of Document Intelligence,
Databricks, Blob, or network throughput. Real throughput must come from the
representative pilot.

## Backup, restore, and release

Use [`DATABASE_RECOVERY.md`](./DATABASE_RECOVERY.md) for logical backups,
managed point-in-time recovery, disposable restore drills, retention, and
ownership. Use [`RELEASE_OPERATIONS.md`](./RELEASE_OPERATIONS.md) for migration
order, compatibility, smoke checks, and rollback decisions. CI pins historical
migration checksums and fails when an applied migration is edited.

## Required external validation

The repository can validate local semantics without credentials. It cannot run
a true PostgreSQL contention test, durable fixture/rollback drill, Azure page
preview, or production extraction-quality pilot until the corresponding test
database, Blob containers, Databricks worker, Entra configuration, and secrets
are supplied. Runtime production paths fail closed while they are absent.
