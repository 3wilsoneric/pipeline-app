# Referral Store Refactor Start Decision Packet

Status: ready for consolidated owner and independent review; implementation is not yet authorized

Prepared from machine-evidence commit: `ef2b7d2b393ad5d36ac9d726e2c65ec21be5f08a`

Human owner: Eric

Proposed independent reviewer: unassigned

This packet reduces the remaining referral-store start decision to one owner response and one independent review. It does not replace either human decision. After both are recorded, TARS will create the final exact-start commit, create a fresh dedicated execution worktree from that commit, activate only this slice, and run the first bounded code iteration without another planning round.

## What is already established

Eric's recorded product purpose is to gather the complete profile needed for an eventual admission decision, with the assessment contributing to that decision. The person who creates a referral workspace ordinarily owns it through the process. When a supervisor assigns a workspace, both the creator and assigned person have ownership. Assessment-only users normally change assessment information, may make verified profile corrections, and every accepted change must be attributable and visible in history.

The following product behaviors already exist and are outside the structural refactor:

- A suspected duplicate based on the same name and county requires explicit human confirmation before a distinct referral can be created. Name and county never become automatic identity or merge keys.
- Saves are field-aware. Same-section stale writes conflict; disjoint-section edits may succeed.
- Create replay uses its mutation identity; duplicate execution must not apply the same material creation twice.
- Material changes preserve actor and version attribution in visible audit history.
- Trash is soft deletion with confirmation, a recoverable trash view, and a 30-day restore window.
- Referral assignment, related assessment assignment, work items, workflow projections, and audit effects retain their characterized behavior.

Machine evidence covers the current local-file and PostgreSQL behavior for create replay, duplicate review, disjoint and conflicting section writes, denied mutations, reassignment to an open assessment, trash, restore, access changes, audit cardinality, representative filters, facets, ordering, totals, and pagination. The production build, repository setup checks, 23 critical safety checks, and all 20 seeded-defect checks pass on the recorded candidate. The only intentionally unresolved machine result is the exact inherited complexity set recorded in `complexity-disposition.json`; no new complexity growth is approved.

## Current responsibility boundary

`lib/pipeline/referral-store.ts` is the server-only persistence boundary. It currently owns public store contracts, adapter selection, local-file persistence, PostgreSQL queries and transactions, mapping, filtering, normalization, audit construction, duplicate review, trash/restore, and referral-coupled work-item and assessment effects.

The approved design must preserve these canonical owners:

- `lib/pipeline/referral-types.ts`: stable referral data and mutation shapes.
- `lib/pipeline/referral-validation.ts`: pure public-input validation.
- `lib/pipeline/referral-sections.ts`: pure optimistic section/version policy.
- `lib/pipeline/referral-store.ts`: persistence orchestration and transaction-local effects until a later responsibility has its own characterized and approved move.
- API routes: authentication, request integrity, resource authorization, input validation, and response mapping; they do not become persistence-policy owners.

The local-file adapter remains an explicitly single-instance, non-production adapter. PostgreSQL remains the production adapter and keeps protected mutations and their audit writes in the same transaction. The refactor must not flatten these deliberately different durability models into a least-common-denominator abstraction.

## Proposed first code iteration

Property: pure referral create and patch types no longer require a type-only dependency on the effectful server store, while every existing store import path and all runtime behavior remain compatible.

Allowed changed files:

- `lib/pipeline/referral-store.ts`
- `lib/pipeline/referral-types.ts`
- `lib/pipeline/referral-validation.ts`

Planned change:

1. Move only `ReferralCreateInput` and `ReferralPatch` to the existing stable type owner.
2. Re-export both types from `referral-store.ts` so existing callers remain compatible.
3. Point the pure validator's type-only dependency at `referral-types.ts`.
4. Make no runtime logic, SQL, transaction, lock, retry, authorization, audit, duplicate-review, workflow, assessment, UI, dependency, configuration, migration, or feature change.

Explicitly excluded:

- Moving either persistence adapter.
- Introducing a generic repository, universal domain type, compatibility implementation, feature flag, dependency, or migration.
- Changing browser imports or components.
- Opportunistic cleanup outside the three allowed files.
- Regenerating the historical complexity baseline.

Required evidence for this iteration includes TypeScript/build compatibility, referral-store characterization, API behavior, local/PostgreSQL parity, workflow fuzzing, critical safety checks, database integration/concurrency, performance/query budgets, and the refactor assurance gate. A failed obligation stops or reverts the iteration; it does not expand scope.

## Owner decision — one response

The owner must review the scoped code and the linked technical trace, then send one response containing all four lines below. The first line must be in the owner's own words; the remaining lines may use the exact acceptance text.

1. `MY EXPLANATION: <In your own words, explain what the referral store is responsible for and the worst failure this refactor must prevent.>`
2. `BOUNDARIES: I approve the responsibilities, invariants, adapter differences, failure/recovery behavior, and explicit exclusions in this packet.`
3. `FIRST ITERATION: I approve the three-file type-boundary iteration exactly as written.`
4. `INDEPENDENT REVIEWER: <GitHub username of a real person other than Eric who will review the complexity disposition, file audit, architecture comprehension, proof obligations, pull request, and guidance evaluation.>`

If the independent reviewer will not also custody the private guidance holdout, add one fifth line:

`HOLDOUT CUSTODIAN: <name or GitHub username of another human>`

## Independent review — one pass

The independent reviewer must:

1. Confirm the exact inherited complexity ceilings and that growth or unlisted failures still fail.
2. Accept or reject each proposed file disposition in `referral-store-file-audit-agent-prework.json`.
3. Answer and cite executable evidence for the two referral comprehension probes: create-retry/stale-patch behavior and PostgreSQL audit atomicity/local-adapter difference.
4. Accept or reject the two critical proof obligations: same-section one-winner and retry/audit atomicity.
5. Review the exact candidate pull request and its commit-attached `verify`, `browser`, `operational`, `postgres`, `dependency-review`, and `codeql` contexts.
6. Custody or coordinate the private holdout and blind matched guidance comparison; the implementation agent cannot see the holdout or approve the result.

## Exact-start sequence after approval

TARS will then perform this as one batch:

1. Record the owner narrative and decisions verbatim.
2. Record the independent dispositions and the adopted guidance comparison.
3. Freeze the final file/dependency inventory and exact risk baseline.
4. Set the exact allowed paths, branch, worktree, starting commit, assurance record, and approval metadata in the slice registry.
5. Create `/Users/eric/pipeline-refactor-referral-store-v2` on `codex/refactor-referral-store-v2` from the approved starting commit.
6. Run all before-start gates; activate the slice only if they pass.
7. Execute the approved type-boundary iteration, run its focused and full proof set, compare baselines, and commit or revert based on evidence.

No later iteration begins merely because the first succeeds. Each additional responsibility still requires its recorded property, allowed files, proof obligations, and independent review, but those iterations can run consecutively without returning to conversational planning when their approvals are already present.
