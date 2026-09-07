# Referral Store Technical Trace — Agent Prework

Author: TARS (agent-generated supporting evidence)

Status: observed technical prework; not an owner architecture narrative, approval, file disposition, or assurance decision

Observed commit: `ea076521654dcbb458ec39f666347d0818209a9a`

Observed worktree: `/Users/eric/pipeline-refactor-integration`

Observed branch: `codex/refactor-prerequisite-integration`

The human owner must read the scoped code and write `ARCHITECTURE_NARRATIVE_TEMPLATE.md` in their own words. This trace exists to make omissions and disputed assumptions easier to find afterward; it cannot be copied in as the initial owner narrative.

## Scope traced

- `lib/pipeline/referral-store.ts`
- `lib/pipeline/referral-types.ts`
- `lib/pipeline/referral-validation.ts`
- `lib/pipeline/referral-sections.ts`
- Direct importers of those modules, for boundary and fan-in discovery only.
- The local-file and PostgreSQL characterization suites recorded in `characterization/referral-store-boundaries-machine-run-ea076521.json`.

No application code was changed while producing this trace.

## Current responsibility map

| Responsibility | Current owner | Observed boundary |
| --- | --- | --- |
| Public referral persistence API and adapter selection | `referral-store.ts` | Exported functions select either the local-file or PostgreSQL `ReferralStore` adapter. |
| Store command/query contracts | `referral-store.ts` | Types for list, create, patch, conflict, actor, metadata, files, facets, and readiness are colocated with both adapter implementations. |
| Canonical referral/work-item data shapes | `referral-types.ts` | Shared by server routes, domain modules, and browser components; this file also imports extraction and workflow types. |
| HTTP input validation | `referral-validation.ts` | Create and public patch validation reject server-owned fields and validate sizes, enums, hashes, nested work items, decisions, and packet projections. |
| Field-to-section optimistic version policy | `referral-sections.ts` | Maps mutable fields to six independently versioned sections and owns default, normalization, increment, and section-name validation. |
| Local-file adapter | `referral-store.ts` | Process-global state plus serialized atomic file replacement; explicitly single-instance and non-production. |
| PostgreSQL adapter | `referral-store.ts` | Production transaction, lock, compare-and-swap, audit, work-item, and assessment-assignment behavior. |
| Store normalization, mapping, filtering, pagination, and file projection | `referral-store.ts` | Pure and effectful helpers are interleaved below both adapters. |

## Entry points and callers

`referral-store.ts` has broad fan-in: referral routes, trash/restore, assessment and workflow services, extraction synchronization, activity/history, files/search, operations reporting, calendars, health/readiness, access scoping, and browser-facing type imports.

Mutation entry points observed:

- Referral creation route calls `createReferral` after authentication, same-origin enforcement, request validation, actor construction, and suspected-duplicate access filtering.
- Referral item route calls `patchReferral` or `softDeleteReferral` after authentication, same-origin enforcement, public patch validation, and resource-level access checks.
- Trash restore calls `restoreReferral` after the same route and resource controls.
- Manual intake, extraction synchronization, workflow commands, work-item commands, recommendation, decision, and EHR handoff reach referral persistence through trusted internal services or `patchReferral` metadata.
- Referral reassignment synchronizes open assessment assignments. PostgreSQL does this in the referral transaction; local-file mode calls the assessment store before committing the referral state.

Read entry points include single-referral lookup, deleted lookup, packet lookup, revision polling, list/facet/file queries, activity support, and client/canonical-client document inventory.

## Main invariants observed

1. Public create validation requires a new referral to begin in the `New` stage and rejects server-owned identity, ownership, workflow, and decision fields.
2. Store-level create normalizes the displayed client name before either adapter receives it.
3. A create mutation identifier returns the original referral and does not emit a second create audit event.
4. Exact packet SHA-256 reuse is rejected before a second referral is created.
5. A normalized name plus canonical county is a review trigger, not an identity or merge key. Confirmation must equal the current accessible candidate set exactly.
6. PostgreSQL serializes the create mutation id, packet digest, and suspected-duplicate identity with transaction advisory locks.
7. Patch uses section versions when supplied. Two stale writes to the same touched section conflict; writes to disjoint sections may both persist. Whole-record version comparison is the fallback when section expectations are absent.
8. A direct stage change is blocked unless the workflow transition is valid or trusted workflow code records that it already validated the transition.
9. Material create, patch, trash, and restore mutations increment referral/store versions and emit attributed audit events.
10. PostgreSQL referral, work-item, assessment-assignment, audit, and store-revision effects remain inside one database transaction.
11. Trash retains a referral for 30 days and restore refuses an expired or stale command.
12. Local-file storage is explicitly process-local/single-instance; PostgreSQL is the production multi-instance-safe owner.

## Validation and trust boundaries

- `referral-validation.ts` is the public request boundary. It rejects fields that trusted internal commands may still place in a `ReferralPatch`.
- `sanitizePatch` in the store is an allowlist, but it is not authorization and is deliberately broader than the public HTTP patch validator.
- General resource authorization is owned by route/access modules, not by the store. The store therefore assumes its caller already has mutation authority.
- Suspected-duplicate confirmation is the exception: the store requires a caller-supplied access predicate for every reviewed candidate, preventing an assessor from confirming an inaccessible or guessed referral id.
- The store accepts and persists PHI-shaped referral fields. Runtime console output for local load failure is aggregate-only; referral audit values mask fields classified as sensitive by `referral-activity-presentation`.
- PostgreSQL `search_text` intentionally contains normalized referral content used for search. It is persisted application data, not log or metric output, and must remain inside the governed database boundary.

## Side effects and transaction boundaries

### Local-file adapter

- Loads one JSON file into a process-global state object, bounded to 100,000 referrals and 100,000 local audit events.
- Serializes persistence with a promise queue and replaces the file through a `0600` temporary file plus rename.
- Mutates in-memory state before waiting for persistence. A file-write failure can therefore reject the command after process memory has advanced.
- Reassignment calls the assessment store before replacing the referral in memory. Multiple assessment updates and the referral update are not one atomic local transaction.
- Local mode is suitable only for development and isolated tests; these limitations must not be flattened into the production adapter contract.

### PostgreSQL adapter

- Create writes/updates `people`, inserts `referrals`, synchronizes work items, emits referral audit, records idempotency, and bumps the referral revision within one transaction.
- Patch locks the referral row, verifies section or record versions, updates referral and person projections, synchronizes work items and open assessments, emits audits, and bumps revision within one transaction.
- Trash and restore lock the referral row and couple the state change, audit, and revision bump in one transaction.
- PostgreSQL-specific locks and transaction coupling are safety properties, not adapter details to hide behind a least-common-denominator implementation.

## Failure and recovery behavior

| Failure | Observed behavior | Recovery/retry boundary |
| --- | --- | --- |
| Store unavailable | `requireReferralStore` produces a 503 response with readiness metadata. | Correct the configured durable store; callers do not silently fall back in production. |
| Invalid public input | Validator returns a bounded 400-class failure before store mutation. | Correct request data and submit a new command. |
| Duplicate packet | `DuplicateReferralPacketError` identifies the existing referral. | Open the existing referral; no override path was observed. |
| Suspected duplicate person | `SuspectedDuplicateReferralError` returns the accessible candidate set and whether more matches exist. | Review every current candidate, then resubmit the exact id set only for a confirmed different person. |
| Stale section/version | Mutation returns the latest referral and the conflicting sections when known. | Reload/reconcile and submit against current versions; this is conflict recovery, not replay idempotency. |
| Invalid workflow transition | Mutation returns blockers without writing. | Resolve prerequisites or use the canonical workflow command. |
| Local file missing | Initializes an empty bounded store. | Expected for first local use. |
| Local file malformed/unreadable | Emits an aggregate warning and continues with empty state. | Operator inspects local data; no automated corrupt-file quarantine was observed. |
| Local persistence failure | Command rejects after in-memory mutation may have occurred. | Process restart reloads last durable snapshot; exact semantics need explicit characterization before adapter movement. |
| PostgreSQL statement failure | Transaction rejects and rolls back all coupled effects. | Retry only according to the command's documented idempotency/conflict contract. |
| Reassignment assessment conflict | Throws rather than completing referral reassignment. | PostgreSQL rolls back atomically; local mode may already have persisted earlier assessment changes and needs explicit test coverage. |
| Expired trash item | Restore returns no active result. | Retention/purge operator process owns final recovery boundaries. |

## Adapter parity already executed

At observed commit `ea076521`, the same synthetic API characterization passed 5/5 against isolated local-file storage and 5/5 against disposable PostgreSQL 16. Focused suspected-duplicate tests passed 2/2 against each adapter. Covered observations include create replay, disjoint and same-section writes, denials without side effects, packet duplication, exact duplicate-person review, concurrent unconfirmed creates, trash/restore, audit cardinality, and inaccessible-candidate protection.

Supplemental evidence in `characterization/referral-assessment-handoff-run-080e5f9c.json` adds one successful referral-to-open-assessment reassignment contract. Its first exact-commit run passed local-file mode but exposed an ambiguous PostgreSQL prepared-parameter type in the assessment JSON update; the transaction rolled back. Commit `080e5f9` added the narrow SQL text cast, after which the production build and all 6/6 scenarios passed against both isolated local-file storage and disposable PostgreSQL 16.

This is meaningful parity evidence, but not complete parity. It does not yet exercise every list/facet/file filter, local persistence failure, injected PostgreSQL rollback, same-referral reassignment races, completed/signed assessment reassignment boundaries, workflow transition, capacity limit, malformed local state, or retention purge boundary.

## Dependency direction and comprehension risks

- `referral-validation.ts` imports the `ReferralPatch` type from the server-only, effectful `referral-store.ts`. That makes public validation depend on the largest infrastructure owner for a pure mutation shape.
- Browser components also import `ReferralCreateInput` and `ReferralPatch` as types from the server-only store. Type erasure prevents a runtime client import today, but the conceptual direction is backwards and easy to break during future edits.
- `referral-types.ts` imports a workflow stage type while `referral-workflow.ts` imports `Referral`, creating a type-level cycle that must not be “fixed” until the owner selects the intended vocabulary owner.
- `referral-types.ts` also imports extraction response types, so a universal “domain types” split could accidentally collapse provenance and storage boundaries.
- `referral-store.ts` owns contracts, adapters, queries, mappers, local durability, PostgreSQL transactions, search/facets, file projection, normalization, audit formatting, duplicate review, and workflow/assessment synchronization. File size is a symptom; these independently testable responsibilities are the actual split candidates.

## Smallest proposed first structural iteration

Proposed bounded property: remove the pure public mutation shapes' type-only dependency on the effectful server store without changing any runtime import, export, validation, persistence, audit, conflict, or adapter behavior.

Proposed action:

1. Move only `ReferralCreateInput` and `ReferralPatch` to the existing `referral-types.ts` owner.
2. Re-export both types from `referral-store.ts`, preserving every existing caller and import path.
3. Change `referral-validation.ts` to import `ReferralPatch` directly from `referral-types.ts`.
4. Do not move adapter code, SQL, audit construction, normalization, workflow synchronization, or any runtime symbol in the same iteration.

Why this is the first rung that holds:

- It uses an existing canonical type module and adds no abstraction or dependency.
- It removes one backwards type edge while keeping the public store contract compatible.
- It touches only files already named in the registry scope.
- It is reviewable as a pure type-location change and can be reverted in one commit.

This proposal is not authorized until the human owner validates the responsibility, probe, proof obligations, file disposition, exact start commit, and adopted guidance bundle.

## Evidence still needed before start

- Human owner architecture narrative and explain-back in the owner's own words.
- Human validation of `referral_state_persistence`, `authentication_and_resource_authorization`, and `transaction_local_audit_and_retry`.
- Fresh-context answers to the referral stale-write/retry and audit-atomicity probes.
- Human approval of the same-section one-winner and retry/audit-atomicity proof obligations.
- Approved file audit disposition and exact allowed paths.
- Exact-start baseline and a green or approved non-regression complexity disposition.
- Human-adopted refactor-guidance comparison, including private holdout evidence.
- Independent reviewer/branch-protection path and commit-attached checks.
- Human disposition of the stale 530-versus-531 locked-package ceiling.

## Questions the owner narrative must answer

1. Which module should own the stable referral mutation shapes, and why is that dependency direction safer than the current one?
2. Which callers are trusted to bypass public patch validation, and what prevents an untrusted route from doing so?
3. Which local/PostgreSQL differences are intentional, particularly reassignment and persistence failure atomicity?
4. What exact retry promise applies to create, patch, trash, and restore, and which of those are conflicts rather than idempotent replays?
5. Which referral changes must share a transaction with work-item, assessment-assignment, audit, and revision effects?
6. What data may appear in audit values, search text, errors, logs, and metrics?
7. Which behavior test would fail if section-level concurrency, audit coupling, or duplicate-review access filtering were accidentally removed?
