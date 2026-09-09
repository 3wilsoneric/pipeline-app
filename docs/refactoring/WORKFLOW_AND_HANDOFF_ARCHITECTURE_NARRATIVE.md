# Workflow and Handoff Architecture Narrative

Author: TARS machine trace, owner-authorized by Eric

Date: 2026-09-08

Status: approved

Starting commit: `b24dacb00621b5a007a360c4f31fec3c9b2f917f`

Dedicated worktree: `/Users/eric/pipeline-refactor-workflow-handoff`

Branch: `codex/refactor-workflow-handoff`

## Scope

- Runtime scope: `lib/pipeline/workflow-store.ts`, `referral-workflow.ts`, `workflow-records.ts`, and `workflow-status.ts`.
- Entry points: referral transition, work-item, recommendation, admission-decision, workflow-read, and EHR-handoff routes plus operations and activity projections.
- Explicit exclusions: no visual redesign, click-path change, staff-role redesign, referral identity change, schema migration, historical-row rewrite, automatic EHR integration, or UI-owned workflow state.
- Characterization: `tests/e2e/operational/workflow-store-characterization.spec.ts` and `scripts/workflow-store-characterization.mjs`.
- Canonical responsibilities: `workflow_transition_and_handoff`, `authentication_and_resource_authorization`, and `transaction_local_audit_and_retry`.
- Approved proof obligations: `workflow_authorized_finite_state_safety` and `ehr_handoff_truthful_at_most_once_effect`.
- File audit: `docs/refactoring/workflow-and-handoff-file-audit.json`.
- Assurance record: `docs/refactoring/workflow-and-handoff-assurance-record.json`.

## What it does

The workflow subsystem moves one referral through a finite admissions process, materializes the work still required, accepts the assigned assessor's signed recommendation, records the head supervisor's admission decision, and tracks Pipeline's knowledge of an EHR handoff. The pure stage policy owns legal transitions and blockers. The workflow store composes current referral, assessment, recommendation, decision, and work-item state, then applies optimistic and attributable mutations through the explicitly selected local-file or PostgreSQL adapter.

## Inputs and outputs

| Boundary | Input | Output | Validation |
| --- | --- | --- | --- |
| Workflow routes | Authenticated command, route identifier, versions, optional mutation identity | Private no-store mutation result or explicit error | Same-origin, role, resource scope, request schema, versions |
| Stage policy | Current referral, target stage, workflow context | Deterministic blockers or permitted target | Fixed adjacency, owner, packet, assessment, decision, requirement gates |
| Workflow record policy | Current recommendation, decision, requirements, and handoff | Deterministic blockers, normalized next record, workflow projection | Signed assessment, assigned assessor, reasons, evidence, readiness |
| Local adapter | Validated mutation | Atomically replaced referral JSON and audit event | Serialized mutation queue, whole/section version, mutation replay |
| PostgreSQL adapter | Validated mutation | Transactionally coupled workflow rows, referral projection, audit, idempotency, revisions | Row/advisory locks, compare-and-swap versions, constraints |

## Invariants

- Workflow stages cannot be skipped and terminal decisions cannot be reopened silently.
- Only authorized roles and permitted resource participants record recommendations, decisions, work-item changes, or EHR handoff outcomes.
- A stale command loses without a protected side effect; an acknowledged mutation replay does not apply a second material write.
- Decision and EHR handoff writes remain optimistic, attributable, and auditable.
- The referral remains the canonical aggregate; assessment, operations, activity, and UI projections do not become independent writers.
- Pipeline records only its own EHR handoff state. `sent` requires an explicit reported outcome and makes no claim that this repository performed an external clinical-system write.
- Local and PostgreSQL adapters preserve the same intended domain outcomes at the characterized HTTP boundary.

## Role and ownership model

- The referral creator owns the workspace. A supervisor assignment preserves supervisor participation while assigning the assessor's operational responsibility.
- Assigned assessors perform the assessment and submit the recommendation. Assessment participation alone does not grant terminal-decision authority.
- The head supervisor/admin records the final accept or decline decision after the required evidence and leadership discussion.
- Viewer-only users can inspect permitted resources but cannot mutate them. A reviewer outside the referral's resource scope receives a private not-found denial.
- Current executable behavior requires a signed assessment before either terminal outcome. The owner's earlier early-decline direction is a separately identified product-policy gap and is not silently introduced as part of structural movement.

## Retry, collision, and idempotency contract

| Command | Concurrency key | Acknowledged replay | Stale/different command | Material effect |
| --- | --- | --- | --- | --- |
| Stage transition | Referral and workflow-section versions plus optional mutation id | Returns current replayed referral | Conflict or workflow blocker | One referral patch and audit event |
| Recommendation | Referral and decision-section versions plus optional mutation id | Returns the stored recommendation/referral | Conflict, unsigned-assessment blocker, or access denial | One recommendation and coupled referral projection |
| Admission decision | Referral and decision-section versions plus optional mutation id | Returns the stored decision/referral | Exactly one winner for a stale concurrent pair | One decision and coupled stage/workflow projection |
| Work item | Work-item version plus optional mutation id | Returns the stored work item/referral | Conflict or evidence/reason blocker | One work-item update and audit event |
| EHR handoff | Referral and decision-section versions plus optional mutation id | Returns the stored handoff/referral | Conflict or readiness/state blocker | One Pipeline-owned status transition and audit event |

Mutation identities are scoped by command family. Callers reuse an identifier only for a retry of the same logical command and resource; they generate a new identifier after reviewing and intentionally changing the command.

## EHR handoff truth boundary

- `queue` requires an accepted/admitted referral, an accepted supervisor decision, and complete blocking requirements.
- `mark_failed` and `mark_sent` require a queued handoff. A failure requires an attributable reason.
- `retry` is available only from failed and returns to queued. A sent handoff cannot be queued again.
- Route metrics describe Pipeline command outcomes only. There is no external EHR client, outbox dispatch, or remote acknowledgement in this slice.
- Recovery is explicit: inspect the failed reason, retry once ready, and record sent only after the external outcome is known through the authorized operational process.

## Transaction and audit boundaries

- Local mode serializes referral mutations and atomically replaces the referral JSON snapshot, including its local audit and replay index.
- PostgreSQL recommendation, decision, work-item, referral projection, audit, idempotency, and store-revision effects execute inside the owning transaction.
- Expected conflicts and blockers return typed no-write outcomes. Unexpected persistence errors reject and rely on transaction/file atomicity rather than partial success responses.
- Activity and operations surfaces are read projections over canonical referral, assessment, work-item, decision, and audit state.

## Evidence used to verify understanding

- `docs/refactoring/characterization/workflow-and-handoff-machine-run-88149a3.json` records 6/6 scenarios passing on the isolated local-file adapter and the same 6/6 on disposable PostgreSQL 16.
- The scenarios cover finite stage order, optimistic conflicts, transition replay, signed assigned-assessor recommendation, viewer and wrong-resource denials, a single-winner supervisor decision collision, work-item validation and audit-neutral replay, and queued/failed/retried/sent EHR recovery.
- Exact-start `npm run check:workflow-fuzz` passed 2,000 generated traces and 840,009 cases.
- Exact-start `npm run test:critical-safety` passed 32/32 controls, `npm run certify:seeded-defects` killed 27/27 mutants, and `npm run check:route-policy` passed every route policy.
- Starting commit `b24dacb00621b5a007a360c4f31fec3c9b2f917f` is the green merged assessment-slice result from which this dedicated branch was created.

## Comprehension findings

- Stage authorization is layered: routes establish identity, role, same-origin, and resource scope; store policy then decides domain blockers. Neither layer can replace the other.
- Terminal stage adjacency is finite, but current decision persistence can update an existing decision when presented with fresh versions. The approved invariant forbids silent terminal reopening; this requires focused executable treatment rather than being obscured by a file move.
- The PostgreSQL workflow tables and referral JSON projection are intentionally coupled. Extracting pure policy must not introduce a repository or service that writes either representation independently.
- EHR handoff is a recoverable recorded workflow, not an external integration. Its at-most-once claim is limited to Pipeline's material status mutation for one acknowledged command.

## Owner explain-back

The assigned assessor completes the assessment and recommends. The head supervisor decides. Required information is collected as explicit work, every important change is attributable, stale users must review before overwriting, and a failed EHR handoff stays visibly failed until an authorized retry. The application must remain usable throughout the refactor, with no route, button, stored-data, or workflow change hidden inside structural cleanup.

## Assurance boundary

- Mechanically enforced: finite transitions, blockers, role/resource denial, optimistic conflicts, mutation replay, audit cardinality, and EHR status progression.
- Integration and concurrency evidence: matched adapters, PostgreSQL transaction/locking checks, operational role journeys, and stale-command collisions.
- Compatibility evidence before completion: current rows and prior/current artifacts remain readable without a migration or historical rewrite.
- This narrative does not claim universal absence of defects or an external EHR guarantee. It binds only the approved slice and exact recorded evidence.

Approved by: Eric, 2026-09-09T03:54:57Z
