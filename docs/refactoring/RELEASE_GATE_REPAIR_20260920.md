# Owner-authorized release gate repair

Owner: Eric. Authority: “Repair the gate failures, then deploy,” followed by “just fix this … do it in this chat,” and “repair go” approving the start-only exception. Recorded 2026-09-20.

The exception permits starting with the target complexity gate failing and from the reviewed unmerged candidate. It replaces the contradictory TARS start-registration requirements for this repair only. It does not lower limits, regenerate the complexity baseline, waive executable release gates, authorize product changes, or claim historical setup evidence covers this repair.

Exact source: `9ecd2cd2e3b1b6c3409d3a098f43615475acfb1e`. Dedicated branch: `codex/refactor-release-gates-20260920`. Worktree: `/Users/eric/pipeline-release-gate-repair-20260920`. Deploy task is stopped; this task owns implementation and release.

## Scope and invariants

Repair the 42 failing functions and two aggregate violations identified by the source complexity report. Implementation paths are the 24 files containing those failures: admission-summary and meet-client-email routes; AssessmentChartWorkspace, AssessmentPhoneInterview, AssessmentWorkspace, ClientProfileDirectory, ClientProfileView, PacketExtractionReview, PipelineCalendar, PipelineHeader, PipelineOverviewRoute, ReferralPacketCanvas, ReferralWorkflowPanelPresentation, pipeline-calendar-model; assessment-lifecycle-validation, assessment-store, assessment-validation, authenticated-fetch, processing-worker, assessment-calendar, calendar-store, referral-canvas-persistence, referral-store; and browser-capacity.spec.ts. Focused tests for these responsibilities and this evidence record may also change. No other product work is included.

Keep public exports, rendered layout, field names, click paths, hooks and state ordering, draft reconciliation, save acknowledgment, conflict checks, authentication, route error mapping, transaction clients, locks, version checks, audit atomicity, extraction fencing/provenance, and notification/packet side-effect order unchanged. Extract coherent same-owner helpers; do not split arbitrary code merely to move a score. No schema, dependency, CSS, baseline, threshold, assertion, or source-exclusion changes.

Before-change evidence from the exact source: 116 API checks, 28 save/recovery cases, 43 critical-safety cases passed in Deploy's isolated worktree. Complexity failed 44 checks; evidence is preserved in `.data/releases/core-complexity-attribution-20260920/` in that worktree. Repository audit, guidance, setup and baseline checks ran there; those setup results describe prior completed slices, not authorization for this exception.

## Release conditions

The first unchanged platform gate also identified stale generated Academy/training fingerprints and a stale guide target ownership map: the existing `chart-meet-client-tab` is on `ReferralPacketCanvas`, not `AssessmentChartWorkspace`. Refresh the canonical generated atlas/registries and correct that single source mapping as release evidence maintenance. No guide steps, UI target, curriculum, validator, or threshold is removed or weakened.

Focused behavior tests, type/build checks, the unchanged complexity gate, required CI and certification must pass on the final candidate. No unresolved critical/high finding may ship. Record exact final commit and observed results. Production remains unchanged until then.

Rollback: runtime revision `pipeline-prod-web--991c9a279e848e49`, source `991c9a279e848e49578131504d16c49d5bb92ba0`, immutable image digest `sha256:e5d5effd597afc1cc965f379015e83805e2beafc727d22bedb82b72c1a4c5e06`. There are no database migrations; accepted data and audit history must be retained.
