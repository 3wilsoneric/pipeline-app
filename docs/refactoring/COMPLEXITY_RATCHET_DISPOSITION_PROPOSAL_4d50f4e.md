# Complexity Ratchet Disposition Proposal — `4d50f4e`

Author: TARS

Status: proposed inherited-debt disposition; not approved and not a replacement baseline

Exact observed commit: `4d50f4ea3a312525b3d0b8a277c18a2c87da7bc8`

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

## Recommended start disposition

Do not regenerate `cyclomatic-complexity-baseline.json`.

Before activating the referral-store slice, choose one of these legitimate paths:

1. Repair every inherited function in separately scoped prerequisite changes and require a green ratchet; or
2. Approve an exact-commit non-regression disposition that names the owners above, keeps the existing reviewed per-function ceilings, and requires the referral slice to introduce no new failure or growth. The referral-owned `matchesReferralFilters` failure must then be reduced in an approved, characterized iteration before the slice can complete.

The second path is recommended for starting the narrow type-only seam because that seam does not touch any listed function and TypeScript/build/characterization evidence can prove its behavior-neutral boundary. It does not excuse the debt or permit a new baseline.

## Human action

The human owner and independent reviewer must either approve the proposed non-regression path for the exact starting commit or direct the prerequisite repairs. TARS will record the decision without changing historical baseline values.
