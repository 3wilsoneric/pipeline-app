# Complexity Ratchet Disposition Record

Author: TARS

Status: owner-approved inherited-debt disposition; independent review pending; not a replacement baseline

Exact approval-context commit: `141982d908d07da06dcb9d7c19e83df2f1c7ec4b`

Approved by: Eric (application owner)

Approved at: `2026-09-07T13:57:45Z`

Recorded decision: freeze the 11 inherited failures at their current levels, permit no new failure or growth, reduce `matchesReferralFilters` during the approved referral-store slice, and keep the other ten as separately owned prerequisite cleanup. The historical baseline must not be regenerated to absorb them.

Machine-readable enforcement: `docs/refactoring/complexity-disposition.json`. The overlay is deliberately inactive until a distinct independent reviewer is recorded. Once approved, only the exact function and aggregate ceilings in that file may be applied; growth and unlisted failures remain red.

## Current result

`npm run complexity:check` remains red against the reviewed baseline:

- 272 hotspots versus 271.
- 130 critical hotspots versus 130.
- 136 control-plane hotspots versus 135.
- Maximum complexity improved from 89 to 81.
- The new referral characterization runner contributes no hotspot; its former 24-complexity function is now 5 and its current maximum is 9.

The red result is not caused by the proposed referral type seam. No structural application refactor has started.

## Exact inherited function failures

| Path / function | Baseline → candidate | Proposed owner/disposition |
| --- | ---: | --- |
| `app/api/calendar/events/route.ts::resolveQueueOptions` | new, 11 > 10 | Calendar/API owner; reduce in a separate behavior-preserving prerequisite or explicitly approve non-regression before the referral slice. |
| `components/pipeline/ClientProfileDirectory.tsx::ClientProfileDirectory` | 30 → 31 | Client profile UI owner; preserve current behavior and reduce in its own reviewed UI change. |
| `lib/pipeline/assessment-calendar.ts::assessmentPreparationItem` | 9 → 14 | Assessment/calendar owner; focused calendar evidence required before reduction. |
| `lib/pipeline/operations-snapshot.ts::toReferralWorklistItem` | 27 → 28 | Operations/workflow owner; reduce with snapshot contract coverage. |
| `lib/pipeline/referral-progress.ts::getNextAction` | 24 → 46 | Referral workflow owner; high-priority prerequisite cleanup with executable decision-table coverage. |
| `lib/pipeline/referral-store.ts::matchesReferralFilters` | 24 → 26 | Referral-store slice owner; characterize local/PostgreSQL filter parity, then reduce as an approved iteration after the pure type seam or as a separate prerequisite. |
| `lib/pipeline/workflow-store.ts::getReferralWorkflowSnapshot` | 28 → 32 | Workflow slice owner; do not mix into referral-store work. |
| `lib/pipeline/workflow-store.ts::getReferralWorkflowContexts` | 20 → 22 | Workflow slice owner; do not mix into referral-store work. |
| `lib/pipeline/workspace-state.ts::resolveFocus` | new, 17 > 15 | Workspace-state owner; reduce with focus-state characterization. |
| `scripts/import-allo-material-workspaces.mjs::processWorkspace` | 33 → 37 | Import/operator owner; preserve resumability, validation, and failure evidence. |
| `scripts/operator-training-route-contracts.mjs` callback | 8 → 12 | Test/academy owner; reduce without hiding assertions. |

## Owner-approved start disposition

Do not regenerate `cyclomatic-complexity-baseline.json`.

Before activating the referral-store slice, the owner considered these legitimate paths:

1. Repair every inherited function in separately scoped prerequisite changes and require a green ratchet; or
2. Approve an exact-commit non-regression disposition that names the owners above, keeps the existing reviewed per-function ceilings, and requires the referral slice to introduce no new failure or growth. The referral-owned `matchesReferralFilters` failure must then be reduced in an approved, characterized iteration before the slice can complete.

The owner approved the second path. It does not excuse the debt or permit a new baseline. Independent review must confirm that the exact starting commit contains the same bounded failures and that the approved referral-store scope introduces no new failure or growth.

## Remaining human action

An independent reviewer must approve this non-regression disposition for the exact starting commit before the referral-store slice begins. No historical baseline value changes under this disposition.
