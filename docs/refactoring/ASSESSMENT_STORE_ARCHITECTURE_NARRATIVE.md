# Assessment Store Boundaries Architecture Narrative

Author: TARS machine trace, owner-authorized by Eric

Date: 2026-09-08

Status: approved

Starting commit: `ba76a0c2871c443eb297fe5bfe0a700eda426aa1`

Dedicated worktree: `/Users/eric/pipeline-refactor-assessment-store`

Branch: `codex/refactor-assessment-store`

## Scope

- Runtime scope: `lib/assessment/assessment-store.ts`, `assessment-records.ts`, `assessment-lifecycle-validation.ts`, and `assessment-access.ts`.
- Entry points: assessment create, read, patch, import, schedule, start, sign, addendum, calendar, reporting, referral activity, and workflow consumers.
- Explicit exclusions: no visual redesign, click-path change, role redesign, schema migration, historical-row rewrite, clinical identity change, or referral-workflow behavior change.
- Characterization: `tests/e2e/operational/assessment-store-characterization.spec.ts` and `scripts/assessment-store-characterization.mjs`.
- File audit: `docs/refactoring/assessment-store-file-audit.json`.
- Canonical responsibilities: `assessment_lifecycle_persistence`, `authentication_and_resource_authorization`, and `transaction_local_audit_and_retry`.
- Approved proof obligations: `assessment_signed_immutability` and `assessment_authorized_atomic_workflow_sync`.
- Assurance record: `docs/refactoring/assessment-store-assurance-record.json`.

## What it does

The assessment subsystem creates a referral-owned assessment, assigns it from the referral's authoritative owner, accepts validated draft and extraction updates, schedules and starts the encounter, signs a complete assessment, and permits only append-only addenda afterward. The store selects an explicit local-file or PostgreSQL adapter. It owns optimistic versions, section versions, idempotency, provenance, audit events, schedule collision detection, reporting, and synchronization of assessment lifecycle state back into the referral workflow.

## Inputs and outputs

| Boundary | Input | Output | Validation |
| --- | --- | --- | --- |
| Public assessment routes | Authenticated JSON commands and route identifiers | Private no-store assessment mutation or expected error | Same-origin, role, resource access, request schemas, optimistic versions |
| Local adapter | Validated domain inputs | Serialized JSON state and typed mutation result | Capacity, record normalization, mutation queues, section/version conflicts |
| PostgreSQL adapter | Validated domain inputs | Transactionally hydrated record and typed mutation result | Row locks, advisory locks, compare-and-swap versions, schema constraints |
| Extraction import | Extracted fields, source context, actor, mutation identity | Draft requiring review with retained provenance | Field mapping, value validation, identity preservation, replay identity |
| Lifecycle policy | Current assessment plus schedule/start/sign/update command | Candidate status, blockers, audit action, workflow projection | Signed immutability, completeness, pending evidence, schedule prerequisites |

## Invariants

- Signed clinical content, signer attribution, and provenance cannot be overwritten; later clarification is an append-only addendum.
- Field evidence, review state, and accountable actor attribution survive every persistence boundary.
- An assessment mutation requires both an authenticated role and the permitted referral/assessor relationship.
- Same-section stale writers lose; disjoint section writers retain their characterized merge behavior.
- A replayed create, patch, schedule, start, sign, or import mutation does not apply a second material write.
- PostgreSQL assessment, audit, idempotency, provenance, addendum, and referral-workflow effects remain transactionally coupled.
- Local and PostgreSQL adapters preserve the same intended domain outcomes while retaining the documented local cross-store atomicity limitation.

## Side effects and transaction boundaries

- Local mode serializes in-process mutations, atomically replaces the assessment JSON file, and then synchronizes the separate referral store. A referral-sync failure can occur after the assessment file is durable and is reported explicitly.
- PostgreSQL mode wraps each material mutation, provenance rows, audit row, idempotency key, store revision, and referral workflow synchronization in one transaction.
- Schedule overlap checks serialize by assessor with an advisory transaction lock in PostgreSQL; local mode checks inside the process mutation queue.
- The subsystem performs no Blob write, queue dispatch, model call, or external clinical-system write.
- Runtime logging is aggregate-only and does not include assessment values, names, identifiers, tokens, queries, or upstream bodies.

## Failure and recovery

| Failure | Current behavior | Retry/idempotency | Recovery |
| --- | --- | --- | --- |
| Stale whole-record or section version | Returns conflict with the latest assessment | Caller reviews current state and retries intentionally | No losing write or audit event is applied |
| Duplicate acknowledged mutation | Returns the stored assessment | Same mutation identity is replay-idempotent | No second material write |
| Incomplete or unreviewed assessment | Returns blockers and preserves the current record | Complete missing fields or review evidence | Sign remains unavailable |
| Signed assessment edit/import | Rejects the command | Not retryable as a mutable edit | Record an addendum or create a separate assessment |
| Schedule overlap | Returns characterized conflicts | Supervisor may explicitly override | Select a new time or record the authorized override |
| PostgreSQL transaction failure | Rolls back coupled assessment, audit, and workflow effects | Safe according to command mutation/version contract | Retry after the database recovers |
| Local referral synchronization failure | Assessment may already be durable and an explicit error is returned | The limitation is preserved, not hidden by this refactor | Single-instance operator reconciles the referral workflow |

## Authorization and PHI

- Admins and assessment coordinators supervise; assigned reviewers perform assessment work. Viewer-only users cannot mutate.
- Route authentication never substitutes for referral and assessment resource authorization.
- The assessment-only assessor receives assigned assessment access and does not ordinarily alter referral-creation information.
- Clinical fields and provenance are PHI-capable and remain in governed stores and private responses; synthetic fixtures contain no PHI.
- Logs, metrics, test reports, and committed characterization artifacts contain only aggregate status and synthetic assertions.

## Evidence used to verify understanding

- `docs/refactoring/characterization/assessment-store-boundaries-machine-run-14ed5ca.json` records 6/6 scenarios passing against both isolated local-file and PostgreSQL 16 adapters.
- The scenarios cover create replay and audit cardinality; disjoint and stale section writes; denied actor side effects; extraction provenance and review; schedule collisions and override; schedule/start/sign workflow synchronization; signed immutability; and append-only addenda.
- Pre-change evidence commit `14ed5cae392037df5f41c7aa2ad7a9ddb0f3be54` passed TypeScript, focused ESLint, and the complete PR CI matrix before activation.
- Starting commit `ba76a0c2871c443eb297fe5bfe0a700eda426aa1` passed the complete CI, security, and guarded production-deployment gates before this branch was created.

## Comprehension findings

- The PostgreSQL path is atomic across assessment and referral workflow state; the local adapter deliberately is not because it persists two files through separate stores.
- Signing is the terminal assessment content boundary. A `complete` legacy row without a signature remains compatible and maps to ready-to-sign workflow state without inventing timestamps.
- The current supervisor capability includes both admin and assessment coordinator roles. This slice preserves that authorization contract rather than redesigning staff roles.

## Owner explain-back

The assessment gathers the full clinical profile needed for an admission decision. The assigned assessor generally owns the referral through assessment; supervisors can assign and supervise, and the head supervisor retains the separate terminal admission decision. Losing signed immutability, provenance, actor attribution, or referral-workflow synchronization would make the record clinically and operationally untrustworthy.

## Assurance boundary

- Mechanically enforced: validation, role/resource denial, optimistic conflicts, idempotency, signed immutability, addendum-only history, audit cardinality, and stored provenance.
- Integration and concurrency evidence: adapter parity, PostgreSQL transactions, schedule locking, mutation replay, referral workflow synchronization, and query plans.
- Compatibility evidence before completion: historical drafts, completed legacy rows, signatures, field evidence, and addenda remain readable without rewriting.
- This narrative does not prove universal absence of defects or validate a new clinical workflow; it binds only the approved structural slice and exact candidate evidence.

Approved by: Eric, 2026-09-09T02:20:44Z
