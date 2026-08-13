# Pipeline Architecture

## System overview

Pipeline is a Next.js 16 App Router application for referral intake, packet extraction review, assessment completion, admission decisions, follow-up requirements, and admitted-client context. The browser talks only to authenticated Pipeline route handlers. Server-only adapters own PostgreSQL, Azure Blob, Databricks, Entra service credentials, and the governed Alamo clinical API.

```text
Browser -> Pipeline route handlers -> PostgreSQL referral/assessment/workflow records
                                  -> Azure Blob + Databricks extraction worker
                                  -> Alamo governed clinical API
ElderMark -> Alamo ingestion/QA/snapshot -> Alamo clinical API -> Pipeline
```

Pipeline never connects directly to ElderMark, Databricks SQL, or Alamo snapshot storage. Clinical records fail closed when Alamo is unavailable; sanitized fixtures are test-only.

## Canonical state

- `pipeline.people` owns stable Pipeline client identity.
- `pipeline.referrals` owns referral episode state, assignment, tags, section versions, extraction projection, and EHR handoff state.
- `pipeline.assessments` and provenance tables own assessment history and field evidence.
- `pipeline.work_items` owns independent follow-up requirements, evidence references, owners, due dates, and waivers.
- `pipeline.admission_decisions` owns the authenticated Yes/No decision and decline reason.
- `pipeline.resident_links` owns reviewed joins between Pipeline identity and governed Alamo resident keys.
- `pipeline.audit_events` records material mutations. Progress, queues, profiles, and supervisor exceptions are projections over these records, not parallel state stores.

Local JSON adapters exist only for development and isolated browser tests. Production requires PostgreSQL for every transactional store.

## Concurrency

Referral writes use optimistic referral versions plus section versions for identity, intake, documents, assessment, workflow, and decision. Disjoint sections can merge; stale same-section writes return `409`. Active canvases poll a change sequence every three seconds. Editing presence uses 15-second heartbeats and 45-second advisory leases; leases never bypass version checks.

## Documents and extraction

The application reserves opaque Blob paths, verifies upload size and SHA-256, and dispatches durable extraction jobs. Jobs use bounded retries, leases, stale-callback protection, dead letters, and idempotent page/document state. Extracted fields preserve confidence, page/evidence references, review status, corrections, and audit events. Browser previews are authenticated, malware-gated, byte-range validated, response-bounded, and paginated by page metadata.

## Identity and clinical data

The active admitted-client roster comes from Alamo. Pipeline adds referral, assessment, requirement, and document context only after a human-reviewed resident link. Names are display values and never identity keys. `resident_number` is the preferred ElderMark join key when governed data supplies it.

## Operational projections

- My Queue is derived from work owned by the signed-in user and ranks overdue, blocked, due-soon, and stale records.
- Operations derives active flow, requirements, data gaps, assessor load, and system readiness.
- The supervisor exception queue derives unresolved canonical conditions, including overdue/unassigned work, extraction failures/conflicts, stale/blocked referrals, missing decisions, resident-link candidates/collisions, and failed EHR handoffs.
- Client profiles begin with Alamo resident scope and join Pipeline episodes only through confirmed identity links.

## Deployment boundaries

- User authentication uses Microsoft Entra delegated access and an encrypted server session.
- The Alamo clinical adapter uses a separate server-side Entra client credential.
- No credential, database URL, Blob key, clinical token, or service secret may use a `NEXT_PUBLIC_` variable.
- Runtime logs and metrics use route templates, status classes, counts, bounded dimensions, and latency only. They exclude query strings, names, resident/referral/document ids, clinical values, tokens, and upstream bodies.
- Historical migrations are append-only and checksum-pinned. CI runs contract, property, quality, backlog, recovery, type, lint, build, accessibility, and browser gates.

## Primary modules

- `app/api/*` - authenticated HTTP boundary.
- `lib/pipeline/*` - referral, workflow, identity-link, profile, queue, collaboration, and activity boundaries.
- `lib/assessment/*` - canonical assessment schema, import, provenance, and persistence.
- `lib/extraction/*` - upload, Blob, extraction worker, review, preview, and evidence contracts.
- `lib/clinical/*` - server-only Alamo adapter and strict response contracts.
- `lib/auth/*` - Entra, session, role, and same-origin mutation controls.
- `database/migrations/*` - append-only production schema.
- `scripts/*` - release, recovery, load, quality, ingestion, and readiness checks.
- `docs/*` - operating and deployment runbooks.
