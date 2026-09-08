# Architecture Narrative: Referral Store Boundaries

Author: TARS machine trace  
Human owner and approver: Eric  
Date: 2026-09-08  
Status: approved under `owner_fast_lane`  
Starting commit: `1956139851eb83d6d785762461466355af0524e4`  
Worktree: `/Users/eric/pipeline-refactor-referral-store-v2`  
Branch: `codex/refactor-referral-store-v2`

Eric approved this bounded slice by replying “okay go” after TARS identified Referral Store Boundaries as the next structural slice and stated that duplicate review, autosave conflicts, ownership, audit history, trash/restore, retries, assignments, assessment synchronization, and existing screens and workflows would be preserved. The owner-fast-lane directive is controlling. This is a code- and test-traced fast-lane record, not an independently authored or reviewed narrative.

## Scope

- Change only `lib/pipeline/referral-store.ts`, `lib/pipeline/referral-types.ts`, and `lib/pipeline/referral-validation.ts` in iteration one.
- Review but do not change `lib/pipeline/referral-sections.ts`.
- Move only `ReferralCreateInput` and `ReferralPatch` to the stable type owner, re-export both from the store, and point validation directly at the type owner.
- Exclude UI, routes, SQL, adapters, transactions, locks, migrations, dependencies, flags, duplicate policy, workflow, assessment synchronization, authorization, and runtime behavior.
- Preserve the canonical responsibilities `referral_state_persistence`, `authentication_and_resource_authorization`, and `transaction_local_audit_and_retry`.
- Verify `referral_same_section_one_winner` and `referral_retry_and_audit_atomicity`.

## Current boundary

`referral-store.ts` is the server-only persistence boundary. It chooses the explicitly single-instance local-file adapter for development and isolated tests or PostgreSQL for production. It owns store commands and queries, normalization, mapping, list and facet reads, duplicate review, optimistic mutations, recoverable trash, and transaction-local referral, work-item, assessment-assignment, audit, idempotency, and revision effects.

`referral-validation.ts` is the public untrusted-input boundary. `referral-sections.ts` is the pure field-to-section concurrency policy. `referral-types.ts` is the stable shared type owner. The first iteration corrects only the dependency direction between those existing owners.

## Inputs, outputs, and trust

| Boundary | Input | Output | Enforcement |
| --- | --- | --- | --- |
| Public create route | Unknown JSON, actor, mutation id, duplicate confirmation | Created referral or bounded validation/duplicate response | Authentication, same-origin protection, create validation, candidate access filtering |
| Public item route | Unknown JSON patch, expected record/section versions, actor, mutation id | Updated referral, conflict, blocker, or bounded error | Authentication, same-origin protection, resource access, patch and version validation |
| Trusted services | Typed patch plus actor and command metadata | Referral mutation result | Service command authorization plus store persistence sanitation |
| Store queries | Bounded list, facet, and file options | Stable ordered projections and cursors | Parsers and store clamps reject unsafe cursors and page sizes |

Routes retain authentication, same-origin checks, role capabilities, and resource ownership. The store does not become an authorization owner. Suspected-duplicate confirmation continues filtering every candidate through resource access. Logs and evidence contain no names, packet values, tokens, query strings, or upstream bodies, and sensitive audit values remain masked.

## Preserved invariants

- Same-section stale writes have at most one winner; disjoint-section writes retain their characterized ability to succeed.
- Create replay with the same mutation id returns the original result without a second material create or audit event.
- Patch, trash, and restore retain their characterized replay or conflict behavior; an unapplied command emits no protected side effect.
- PostgreSQL referral, work-item, assessment, audit, idempotency, and revision effects remain within their current transaction.
- Names and counties identify only accessible suspected-duplicate candidates for explicit review; they never become automatic identity or merge keys.
- Trash remains recoverable for 30 days and stale or expired restore fails safely.
- Public validation continues rejecting server-owned identity, workflow, decision, and provenance fields.
- No browser-capable module gains a runtime import from the server-only store.

## Side effects and failures

Local-file mode retains process-global state, serialized file replacement, and bounded local audit and mutation maps. It remains non-production and does not claim PostgreSQL transaction semantics. PostgreSQL create, patch, trash, and restore retain their current database transactions and coupled effects. This iteration adds no Blob, queue, network, external-service, migration, or database side effect.

Invalid public input fails before persistence. Duplicate packets return the existing record path. Suspected duplicates require an exact-set human confirmation. Stale commands return the latest known conflict state for reconciliation. Recorded lifecycle mutation ids replay the original success. PostgreSQL statement failure rolls back the transaction. Local persistence failure rejects and reload-on-restart recovers the last durable snapshot.

Exact-start characterization found a pre-existing trash replay regression: active-workspace access checking ran before the idempotency lookup and rejected the second identical command. Commit `ddc29da95a78c3a65ebb2995c4beb3a1bb5e45c1` restored the established replay order while retaining first-attempt authorization. The exact starting commit passes all nine scenarios against local-file and PostgreSQL 16 adapters.

## Comprehension probes

### `referral_stale_write_and_retry`

The create route parses unknown JSON, validates it, constructs the actor, and invokes `createReferral`. A repeated create mutation id returns the original referral without another audit event. Patch requests validate public fields and expected section versions before `patchReferral`. Both adapters compare touched section versions: a stale same-section command returns conflict without mutation or audit, while a disjoint section can advance independently. Create replay is replay-idempotent; a stale patch is conflict-safe and requires reconciliation.

Evidence: `npm run check:api`, `npm run check:workflow-fuzz`, and `npm run characterize:referral-store` at `1956139851eb83d6d785762461466355af0524e4`.

### `referral_audit_atomicity`

PostgreSQL create, patch, trash, and restore use the same transaction handle for the protected referral and its audit record, including actor and from/to versions; statement failure rejects the transaction. Local mode appends bounded audit state and persists the serialized snapshot but cannot offer equivalent multi-store rollback. That difference is intentional and local mode remains prohibited for production multi-instance use.

Evidence: local/PostgreSQL characterization, `database:assurance:integration`, `database:integrity`, and `database:concurrency`.

## Assurance and owner explain-back

Type ownership and import direction are checked by TypeScript and the production build. Section behavior and workflow transitions are covered by deterministic and stateful-fuzz tests. Retry, transaction, audit, and concurrency behavior are checked through dual-adapter characterization and PostgreSQL integration, concurrency, integrity, and seeded-defect gates.

The referral workspace gathers the profile needed for eventual admission. Its creator ordinarily carries ownership through the process; a supervisor assignment can add shared ownership, while an assessment-only user normally changes assessment information and any verified profile correction remains attributable. Breaking section versions could overwrite accepted work. Moving audit or assignment effects out of the transaction could create an untruthful history. Treating names as identity could join different people. These behaviors are preserved, not redesigned.

The evidence supports only the named candidate and obligations recorded for this slice. It does not prove every production failure mode or justify a bug-free, perfect, or formally verified claim.

Approved by Eric through the owner-authorized fast-lane “okay go” directive on 2026-09-08. TARS is the machine-trace author and verifier; independent review remains advisory.
