# Workflow Permutation Hardening Architecture Narrative

Author: TARS machine trace, owner-authorized by Eric

Date: 2026-09-10

Status: approved and in progress

Starting commit: `8da6634eaa0b9cc74e3576012b8e0e2e33872a31`

Dedicated worktree: `/Users/eric/pipeline-refactor-workflow-permutation-hardening`

Branch: `codex/refactor-workflow-permutation-hardening`

## Purpose

Close the concrete workflow-integrity gap found by the all-permutation audit and strengthen permanent evidence for referral, assessment, review, decision, recovery, and authorization behavior. Extraction is explicitly outside this slice.

## Observed defect at the exact start

Two stale-concurrent `request_changes` commands can both create assessment successors while only one review update wins. Both the local-file and PostgreSQL adapters can therefore retain an orphan draft correction revision. The public response pair is correctly one success and one conflict, but the persisted lineage is not atomic. Existing characterization did not exercise the review-correction branch despite an earlier assurance claim that it did.

## Canonical boundaries

- `lib/pipeline/workflow-store.ts` remains the cross-record command and PostgreSQL transaction owner. It must lock and validate the referral, review, and terminal-decision state before creating a correction successor.
- `lib/assessment/assessment-store.ts` remains the assessment persistence owner. Local-mode compensation may remove only an uncommitted draft successor created by the failed workflow command; signed or linked history is never deleted.
- `lib/pipeline/referral-workflow.ts` remains the finite transition-policy owner. The workflow fuzz harness independently enumerates its bounded input space rather than replacing that policy.
- API routes remain the authentication, same-origin, role, and resource-access boundary. Runtime role tests complement the repository-wide static route inventory.

## Preserved product behavior

- No UI, label, click path, route shape, role assignment, Entra configuration, schema, migration, or production data changes.
- The head supervisor/admin remains the only final decision and review-return authority.
- The assigned assessor or authorized supervisor retains assessment and recommendation behavior.
- Signed assessments remain immutable; a successful correction request creates exactly one editable successor.
- Stable mutation identifiers replay the stored result without a second assessment, review, audit, or referral write.
- Trash/restore, scheduling/no-show, admission, EHR handoff, client activation, and all non-extraction workflows retain current behavior.

## Failure, contention, and recovery contract

1. A stale referral, decision-section, or review version creates no assessment successor and no audit event.
2. Two different correction commands against the same submitted review produce exactly one committed successor.
3. A correction command racing the final decision produces one coherent winner: either a linked correction successor with no decision, or an immutable decision with no successor.
4. PostgreSQL enforces this inside one transaction. Local mode remains development-only and compensates a just-created unsigned successor when its referral compare-and-swap fails.
5. Reverting the bounded implementation commit restores the exact-start code. No schema rollback or data transformation is required.

## Evidence boundary

The candidate must pass focused local/PostgreSQL correction-cycle characterization, bounded exhaustive transition enumeration, runtime role/resource denial tests, static policy coverage of every API method, database integration/concurrency/integrity, test-effectiveness mutation gates, recovery/chaos/load/performance checks, the full browser suite, build, artifact, and TARS certification. Live Entra or external infrastructure is exercised only when already configured; this slice does not create or alter external identities or paid services.

Approved to start by Eric on 2026-09-10 through the owner fast lane and the directive: “do everything but i dont care about extracction right now”.
