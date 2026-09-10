# Supervisor Review and Assessment Revision Architecture Narrative

Author: TARS machine trace, owner-authorized by Eric

Date: 2026-09-10

Status: approved and in progress

Starting commit: `1f98a663965850985eb1fcceb3049a442d5a2797`

Dedicated worktree: `/Users/eric/pipeline-refactor-supervisor-review-revision`

Branch: `codex/refactor-supervisor-review-revision`

## Purpose

Make the signed-assessment handoff a durable, reviewable workflow: a submitted recommendation binds an immutable signed assessment revision; the head supervisor can approve, decline, or request named corrections; corrections preserve the signed source and create an editable successor; and decisions and downstream delivery evidence remain pinned to the reviewed version.

## Product policy retained

- The referral creator and assigning supervisor retain their responsibility-labelled ownership. Assignment to an assessor does not erase supervisor participation.
- The assigned assessor, or an authorized supervisor taking over the assessment, submits the clinical recommendation.
- The head supervisor/admin remains the terminal decision authority. This slice does not grant decision power to every supervisor role.
- Approval for placement is distinct from the later, explicitly confirmed admission and EHR handoff.

## Canonical boundaries

- `lib/pipeline/workflow-store.ts` owns review submission, review outcome, optimistic versions, idempotency, audit, and the PostgreSQL transaction spanning referral, recommendation, review, decision, and correction revision.
- `lib/assessment/assessment-store.ts` remains the assessment persistence owner and exposes revision lineage to ordinary assessment reads.
- `lib/pipeline/workflow-records.ts` owns pure blockers and review-state policy.
- Routes authenticate, authorize, validate, and delegate; UI modules coordinate requests and render server-confirmed state.
- `pipeline.assessment_reviews` is the durable review-task and immutable submission ledger. Assessment lineage columns identify the revision root and the signed predecessor.

## State and transaction contract

1. A recommendation may be submitted only for the current signed assessment and only once per assessment revision.
2. Submission atomically creates the immutable recommendation and review row, advances the referral to `recommendation_submitted`, writes attributed audit, records replay identity, and bumps revisions in PostgreSQL.
3. A decision requires a currently submitted review unless the head supervisor records the existing explicit no-recommendation override. An accepted decision advances to `accepted`; it does not claim admission.
4. Requesting changes requires a reason and the current review version. Exactly one concurrent reviewer wins. PostgreSQL marks the review `changes_requested`, clones the signed assessment into a new editable successor with copied provenance, links both revisions, advances the referral to `changes_requested`, and writes audit in one transaction.
5. Resubmitting the successor creates a new immutable recommendation and review submission linked by assessment lineage. The earlier signed version, recommendation, review, reason, and timestamps remain readable.
6. Explicit `Mark admitted` remains the later move-in confirmation and projects `admitted`; the legacy stage string remains readable during compatibility cutover.

## Failure, replay, and recovery

- Same logical mutation identifiers replay without a second material effect.
- Stale referral, section, or review versions return a conflict and the current server record; they never overwrite a winner.
- A blocked command creates no review, recommendation, decision, revision, or audit side effect.
- The forward migration is additive. Its paired rollback maps new workflow statuses to prior readable states before dropping only the new review and lineage structures.
- The full slice can be reverted by commit, while the schema rollback is exercised only in a disposable database before release.

## Compatibility and non-goals

- Existing signed assessments, recommendations, decisions, stage values, routes, files, and audit history remain readable.
- Existing recommendation and decision controls keep their location; labels and state summaries become more explicit.
- No Entra invitation, external notification, automatic email send, automatic EHR write, billing service, or paid dependency is introduced.
- No historical client identity or referral episode is inferred or rewritten.

## Evidence boundary

Required evidence includes TypeScript/build, route policy, workflow contracts and fuzzing, focused local/PostgreSQL characterization, migration checksum and rollback, PostgreSQL concurrency/integrity, browser workflow, performance/artifact budgets, repository audit, and TARS certification. Claims remain limited to the named candidate commit and those exercised properties.

Approved to start by: Eric, 2026-09-10T01:45:41Z, through the repository owner fast lane and the directive “do what you think is best in that message, do it and deploy everything, bring everything up to date.”
