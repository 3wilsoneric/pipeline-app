# Pipeline Control-Plane Map

Status: setup draft requiring owner validation before refactoring begins.

The control plane is code that decides who may act, what state may change, how the change is persisted and audited, and whether evidence can be trusted. A file may be large without being control-plane code; a small authorization or matching helper may be critical.

## Referral workflow

- Policy and vocabulary: `lib/pipeline/referral-workflow.ts`, `referral-types.ts`, `workflow-status.ts`, and `workflow-records.ts`.
- Mutation and decisions: `lib/pipeline/workflow-store.ts`.
- Referral persistence and transaction coupling: `lib/pipeline/referral-store.ts`.
- Input boundary: `lib/pipeline/referral-validation.ts` and referral API routes.

Preserve sequential stages, terminal outcomes, decision authorization, optimistic versions, work-item blockers, audit writes, and EHR handoff gates. The current type-level cycles among workflow modules should be removed only after the owner confirms the intended dependency direction.

## Assessment lifecycle

- Lifecycle policy: `lib/assessment/assessment-lifecycle-validation.ts`, `assessment-completion.ts`, and `assessment-access.ts`.
- Canonical records and provenance: `lib/assessment/assessment-records.ts`.
- Persistence and audit behavior: `lib/assessment/assessment-store.ts`.
- Packet handoff: `lib/assessment/assessment-seed.ts` and referral-owned evidence mapping.

Preserve assignment, schedule-before-start, medication carry-forward, field ownership, signed immutability, append-only addenda, provenance, and recommendation/decision separation.

## Authentication and authorization

- User identity and role mapping: `lib/auth/pipeline-auth.ts`.
- Same-origin mutation controls: `lib/auth/request-security.ts`.
- Worker boundary: `lib/auth/internal-worker-auth.ts`.
- Browser session and Entra clients: the remaining `lib/auth/*` modules and `proxy.ts`.
- Resource ownership: `lib/pipeline/referral-access.ts` and `lib/assessment/assessment-access.ts`.

Authentication wrappers do not replace resource-level authorization. Every mutation must retain both route identity enforcement and domain ownership/role checks.

## Audit and idempotency

Audit and idempotency writes currently live beside the transaction they protect in referral, workflow, assessment, resident-link, import, and retention modules. That distribution is intentional transaction coupling, not automatically a consolidation defect.

Consolidate policy and event construction where safe, but do not move an audit write outside its protected PostgreSQL transaction. Preserve actor identity, before/after state, versions, reason codes, and retry identity.

## Identity matching and merge

- Match policy: `lib/pipeline/master-record-matching.ts`.
- Candidate and reviewed links: `lib/pipeline/resident-link-store.ts`, `resident-link-records.ts`, and `resident-link-validation.ts`.
- Governed clinical identity: `lib/pipeline/unified-profile.ts` and `lib/clinical/*` contracts.

Names are display data, not identity keys. Preserve resident-number and DOB conflict blocking, human review for ambiguous candidates, immutable canonical IDs, and census truth for current status/community.

## Documents and extraction

- Upload and Blob boundaries: `lib/extraction/azure-blob.ts`, `blob-paths.ts`, and `document-processing.ts`.
- Job state and worker claims: `lib/extraction/extraction-state.ts`, `processing-worker.ts`, and internal extraction routes.
- Extraction projection and review: `lib/extraction/contracts.ts`, `extraction-service.ts`, and referral canvas extraction modules.
- Worker: `databricks/pipeline_extraction_worker.py`.

Preserve immutable source bytes, digest and malware checks, opaque Blob paths, bounded pages/bytes, leases, stale-callback rejection, retry/dead-letter semantics, field evidence, and human review.

## Retention and recovery

- Referral deletion: `lib/pipeline/referral-retention.ts`.
- Document retention: `lib/extraction/processing-worker.ts` and storage inventory.
- Workspace-state retention: `lib/pipeline/user-workspace-state-store.ts`.
- Operator boundary: internal retention routes, backup, restore, and purge scripts.

Preserve explicit recovery windows, dry-run defaults, bounded batches, Blob/row reconciliation, aggregate-only logs, and disposable-target restore protections.

## EHR handoff

- Handoff policy and persistence: `lib/pipeline/workflow-store.ts`.
- Route boundary: `app/api/referrals/[referralId]/ehr-handoff/route.ts`.
- Readiness evidence: work items, packet readiness, decision state, and workflow projections.

The current handoff is Pipeline-owned state and does not claim an external EHR write unless explicitly marked sent. Preserve accepted-referral gating, failure reasons, retries, optimistic versions, role checks, metrics, and audit events.

## Database evolution

- Forward-only schema: `database/migrations/*`.
- Rehearsed reversals: `database/rollbacks/*`.
- Checksums: `database/migration-checksums.json`.

Applied migrations are immutable. Refactoring database access never authorizes rewriting migration history. New constraints or indexes require a new migration, matching rollback strategy, checksum update, plan review, and restore-safe deployment order.

## Owner validation checklist

- Confirm the canonical owner for every state transition.
- Confirm every mutation and its audit transaction boundary.
- Confirm local versus PostgreSQL semantics that are intentionally equivalent.
- Confirm which type-only dependency cycles are safe to remove.
- Confirm extraction provenance and human-review requirements.
- Confirm identity match keys and forbidden auto-merge cases.
- Confirm retention, restore, and handoff semantics with operational owners.
