# Pipeline Refactor Baseline - 2026-08-27-setup

Generated: 2026-08-27T18:22:07.985Z

This report ranks maintainability pressure. It does not prove defects and must not be used as permission to delete code without characterization tests.

## Summary

- Source files: 410
- Source lines: 75459
- Local module cycles, including type-only imports: 3
- Cross-file duplicate groups: 49
- Duplicate groups touching control-plane code: 45
- Dead-export candidates requiring review: 291
- Static source-string contracts: 19
- Control-plane files: 146

## Overlapping Hotspots

Files appearing in at least two independent top-ten lists:

- `components/pipeline/AssessmentWorkspace.tsx` (3 measures)
- `components/pipeline/ClientProfileView.tsx` (3 measures)
- `components/pipeline/ReferralHome.tsx` (3 measures)
- `components/pipeline/ReferralPacketCanvas.tsx` (3 measures)
- `lib/assessment/assessment-store.ts` (3 measures)
- `lib/pipeline/referral-store.ts` (3 measures)
- `lib/pipeline/workflow-store.ts` (3 measures)
- `tests/e2e/pipeline-smoke.spec.ts` (3 measures)
- `scripts/api-behavior-fixtures.mjs` (2 measures)

## Size

| Rank | File | Lines |
| ---: | --- | ---: |
| 1 | `tests/e2e/pipeline-smoke.spec.ts` | 2731 |
| 2 | `lib/pipeline/referral-store.ts` | 2692 |
| 3 | `components/pipeline/ReferralPacketCanvas.tsx` | 2646 |
| 4 | `lib/assessment/assessment-store.ts` | 2074 |
| 5 | `scripts/api-behavior-fixtures.mjs` | 1635 |
| 6 | `components/pipeline/AssessmentWorkspace.tsx` | 1600 |
| 7 | `components/pipeline/ClientProfileView.tsx` | 1552 |
| 8 | `lib/pipeline/workflow-store.ts` | 1184 |
| 9 | `components/pipeline/ReferralHome.tsx` | 1085 |
| 10 | `lib/assessment/assessment-tool-schema.ts` | 917 |

## Complexity Proxy

| Rank | File | Branches + functions |
| ---: | --- | ---: |
| 1 | `components/pipeline/ReferralPacketCanvas.tsx` | 709 |
| 2 | `lib/pipeline/referral-store.ts` | 705 |
| 3 | `components/pipeline/AssessmentWorkspace.tsx` | 576 |
| 4 | `lib/assessment/assessment-store.ts` | 554 |
| 5 | `components/pipeline/ClientProfileView.tsx` | 357 |
| 6 | `components/pipeline/ReferralHome.tsx` | 328 |
| 7 | `lib/pipeline/workflow-store.ts` | 304 |
| 8 | `lib/pipeline/operations-snapshot.ts` | 279 |
| 9 | `tests/e2e/pipeline-smoke.spec.ts` | 228 |
| 10 | `lib/clinical/clinical-data.ts` | 219 |

## 90-Day Churn

| Rank | File | Changed lines |
| ---: | --- | ---: |
| 1 | `components/pipeline/ReferralPacketCanvas.tsx` | 6169 |
| 2 | `tests/e2e/pipeline-smoke.spec.ts` | 3868 |
| 3 | `components/pipeline/AssessmentWorkspace.tsx` | 3180 |
| 4 | `lib/pipeline/referral-store.ts` | 2976 |
| 5 | `lib/assessment/assessment-store.ts` | 2839 |
| 6 | `components/pipeline/ReferralHome.tsx` | 2492 |
| 7 | `components/pipeline/ClientProfileView.tsx` | 2343 |
| 8 | `scripts/api-behavior-fixtures.mjs` | 1720 |
| 9 | `lib/pipeline/workflow-store.ts` | 1385 |
| 10 | `components/pipeline/ClientProfileDirectory.tsx` | 1187 |

## Cross-File Duplication

| Rank | File | Shared token windows |
| ---: | --- | ---: |
| 1 | `app/api/assessments/[assessmentId]/start/route.ts` | 12 |
| 2 | `app/api/assessments/[assessmentId]/sign/route.ts` | 11 |
| 3 | `app/api/assessments/[assessmentId]/schedule/route.ts` | 9 |
| 4 | `app/api/profiles/[residentKey]/source-documents/[documentId]/preview/route.ts` | 6 |
| 5 | `app/api/profiles/[residentKey]/source-documents/[documentId]/thumbnail/route.ts` | 6 |
| 6 | `app/api/packets/[packetId]/fields/[fieldKey]/retry/route.ts` | 5 |
| 7 | `app/api/packets/[packetId]/fields/[fieldKey]/review/route.ts` | 5 |
| 8 | `app/api/referrals/[referralId]/progress/route.ts` | 5 |
| 9 | `app/api/referrals/[referralId]/activity/route.ts` | 5 |
| 10 | `app/api/referrals/[referralId]/work-items/route.ts` | 5 |

## Cycles

- lib/pipeline/referral-types.ts -> lib/pipeline/referral-workflow.ts -> lib/pipeline/referral-types.ts
- lib/pipeline/referral-types.ts -> lib/pipeline/referral-workflow.ts -> lib/pipeline/workflow-records.ts -> lib/pipeline/referral-types.ts
- lib/pipeline/referral-types.ts -> lib/pipeline/referral-workflow.ts -> lib/pipeline/workflow-status.ts -> lib/pipeline/referral-types.ts

## Test-Power Warning

The baseline found 19 source-string assertions. Keep them only as architecture-presence checks; pair every operational invariant with an executable behavior, database, or browser test.

## Interpretation

- Complexity and duplication are ranking proxies, not quality scores.
- Dead exports are candidates only. Confirm framework, dynamic-import, and external use before deletion.
- Control-plane duplication has a zero-tolerance target; ordinary UI duplication can wait until a third occurrence.
- Re-run after each bounded refactor slice and compare the JSON, behavior gates, performance, and visual output.
