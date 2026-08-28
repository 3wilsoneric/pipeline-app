# Pipeline Architecture for Developers

## The shortest useful mental model

Pipeline is a governed workflow system, not a collection of forms. Its durable purpose is to move a referral through intake, packet review, assessment, post-assessment decision, and EHR handoff without losing provenance, authorization, or history.

The primary dependency direction is:

```text
React UI
  -> authenticated HTTP client
    -> Next.js route handler
      -> authentication + resource authorization + runtime validation
        -> domain/store boundary
          -> PostgreSQL transaction + audit record
          -> Blob/extraction adapter when the operation owns documents
```

Dependencies should point inward toward domain contracts. Domain workflow logic should not depend on React, `Request`, Blob SDKs, or Databricks.

## Runtime zones

| Zone | Current owners | What belongs there | What must not belong there |
| --- | --- | --- | --- |
| Browser | `components/pipeline/*`, `lib/auth/authenticated-fetch.ts` | Interaction state, rendering, recovery drafts, bounded API calls | Database clients, service credentials, authoritative authorization |
| Next.js HTTP boundary | `app/api/*/route.ts` | Authentication, same-origin checks, request decoding, response mapping | Reimplemented workflow rules or raw SQL scattered per route |
| Domain and persistence | `lib/pipeline/*`, `lib/assessment/*` | State invariants, validation, store interfaces, projections, transactions | React components or browser-only APIs |
| Document processing | `lib/extraction/*` | Upload reservation, Blob metadata, job state, evidence, retries, review | Treating OCR/model output as accepted clinical truth |
| Database | `database/migrations/*` | Durable constraints, indexes, history, idempotency, audit records | Unversioned manual production schema changes |
| Worker | `databricks/pipeline_extraction_worker.py` | Normalization, provider routing, schema-bound extraction reports | Directly inventing authoritative referral decisions |
| Operations | `lib/observability/*`, `scripts/*`, Azure infrastructure | Bounded metrics, alerts, readiness, recovery, certification | PHI, raw requests, raw model output, or secrets in telemetry |

## Application shell

`app/(pipeline)/layout.tsx` wraps every authenticated product page in `PipelineAppShell`. `PipelineAppShell` is a client component because it owns interactive shell state: search text, search visibility, and the current home mode. It provides that state through `PipelineShellProvider`, renders `PipelineHeader`, and reserves the remaining viewport for route content.

This illustrates a key Next.js distinction:

- A file without `"use client"` is a server component by default.
- A client component can use React state, effects, refs, and browser APIs.
- Importing a server-only module into a client graph is prohibited. Sensitive adapters also declare `import "server-only"`.

## Referral ownership

The central referral types live in `lib/pipeline/referral-types.ts`:

- `Referral` is the broad application record used by the current UI and store adapters.
- `ReferralStage` in `referral-workflow.ts` is the user-facing stage state machine.
- `ReferralWorkflowStatus` is the operational status used by queues and projections.
- `ReferralSectionVersions` supports conflict detection at identity, intake, documents, assessment, workflow, and decision boundaries.
- `AdmissionRequirement`, `AdmissionDecision`, and `EhrHandoffRecord` represent governed workflow records.

The current `Referral` type is intentionally broad but is also a refactor hotspot. Do not treat every property as equally authoritative. PostgreSQL separates people, referrals, documents, fields, assessments, work items, decisions, resident links, audits, and idempotency records even though parts of the application project them into one referral view.

## Boundary validation

TypeScript is erased at runtime. A request body annotated as `CreateReferralBody` can still contain arbitrary JSON. The route therefore calls `readJsonBody` and then `validateReferralCreateInput`.

The validator:

- Rejects non-object values.
- Rejects server-owned identity and workflow fields.
- Applies length limits.
- Checks enumerations and timestamps.
- Requires new records to begin in the `New` stage.
- Validates nested requirements and extraction-related fields.

The cast at the end of validation is safe only to the extent that every meaningful field was actually checked. This is why validators and tests are security boundaries, not boilerplate.

## Referral persistence

`ReferralStore` defines the adapter contract. Development can use a local JSON store; production requires PostgreSQL. `getReferralStoreReadiness` fails production readiness when the durable store is not configured.

`createPostgresReferral` runs one database transaction that:

1. Acquires an advisory transaction lock for a client mutation ID.
2. Returns the existing referral if the same mutation already completed.
3. Locks the packet hash and rejects an already-linked packet.
4. Upserts the Pipeline person identity.
5. Inserts the referral projection and assignment state.
6. Materializes requirement work items.
7. Writes the referral audit event.
8. Writes the idempotency key.
9. Bumps the store revision.

`patchPostgresReferral` adds optimistic version checks and section-version checks. A stale edit to a touched section returns a conflict; disjoint sections can progress independently.

## Workflow ownership

`referral-workflow.ts` is the declared owner for stage sequencing and transition blockers. The sequence is:

```text
New
  -> Packet Needed
    -> Packet Review
      -> Assessment
        -> Community Review
          -> Accepted / Admitted
```

Every active stage may also move to `Declined` only when the decline decision and reason requirements are satisfied. Terminal stages cannot reopen through ordinary workflow transitions.

The UI may present stages, but it is not the authority. Routes and stores must enforce the same transition owner on the server.

## Documents and extraction

The browser hashes the initial packet, asks Pipeline to reserve opaque upload targets, and uploads bytes directly to Blob Storage. The binary does not pass through the normal Next.js production upload path. The browser then completes the reservation, reads packet status, and links extracted fields back to the referral with expected versions.

The durable document subsystem owns:

- Upload reservation and expiry.
- Size and SHA-256 verification.
- Blob/database reconciliation.
- Extraction queue leases and retries.
- Dead-letter state.
- Field candidates, confidence, page evidence, review state, and correction history.

An extraction result is a proposal with provenance. Human review or an explicit workflow rule determines whether it can satisfy a downstream gate.

## Assessment ownership

`AssessmentWorkspace` is the browser workspace. Assessment command validation, field ownership, completion rules, and persistence live under `lib/assessment`.

Important lifecycle distinctions include:

- Creating an assessment does not start its performance clock.
- Scheduling and starting are explicit commands.
- Packet evidence seeds reviewable values without overriding referral-owned context.
- Imported fields enter pending review.
- Signing creates immutable history.
- Corrections after signature use append-only addenda.
- Recommendations and final admission decisions have different role owners.

## Authentication and authorization

`requirePipelineUser` supports local mock mode and production Entra JWT/session mode. Production defaults to Entra and does not permit disabled authentication.

Authentication answers who the caller is. Route role checks answer whether their role may call the operation. Resource access modules answer whether they may act on this referral or assessment. Hiding a button in the browser answers none of those security questions.

Cookie-authenticated mutations also use `requireSameOriginMutation`. Sensitive adapters and secrets remain server-only.

## Database truth

The foundational migration creates separate tables for people, referrals, extracted fields, documents, extraction jobs, assessments, provenance, work items, decisions, resident links, audit events, and idempotency keys. Later append-only migrations add processing, collaboration, user state, canonical identity, import, trash, search, county, assessor workflow, Zoom scheduling, and received-month indexing.

Migration files are checksum-pinned. Never edit a migration that has shipped; add a new migration and an explicit rollback or forward-recovery strategy.

## Test architecture

Pipeline's assurance layers answer different questions:

- Contract tests: does a named invariant hold?
- API fixtures: do boundaries validate, authorize, and map responses correctly?
- Property tests and workflow fuzzing: do invariants survive generated inputs and histories?
- Seeded-defect certification: can the suite catch realistic deliberate defects?
- Storage and merge replays: do partial failures and identity collisions recover safely?
- Database assurance: do migrations, constraints, plans, concurrency, integrity, and restore behavior hold against PostgreSQL?
- Playwright: can a user complete journeys in rendered browsers?
- Build, TypeScript, and ESLint: can the product compile and meet static rules?

A green build proves compilation, not workflow correctness. A high assertion count proves activity, not test power.

## Current teaching hotspots

The largest current modules include the referral store, assessment store, referral packet canvas, assessment workspace, and workflow store. They are valuable teaching sources because they expose real complexity, but they are not patterns to copy wholesale. The refactoring protocol treats them as bounded slices requiring characterization before movement.

When learning these modules, distinguish:

- Domain complexity that is inherent to the workflow.
- Adapter parity needed for local and PostgreSQL modes.
- Accidental coupling that should eventually be separated.
- Safety behavior that must survive any separation.
