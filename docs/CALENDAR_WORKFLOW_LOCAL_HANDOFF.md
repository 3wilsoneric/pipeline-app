# Calendar workflow: local implementation

Status: **FROZEN FOR THE COORDINATED RELEASE**. The deployment coordinator relayed Eric's explicit “deploy all” authorization, releasing the earlier local-only hold. This task does not deploy independently; integration and release remain with task `01a098e2-ae78-7fe2-9ef0-54fb77e8dccd`.

Worktree: `/Users/eric/pipeline-calendar-workflow-20260918`

Branch: `codex/calendar-workflow-20260918`

Base: `91354f55a1d427887e5033d92aafe1381cae2492`

## Included

- Day working view with appointments, dated follow-ups, unfinished assessment work, and referrals needing a date. Existing Upcoming, Week, and Month views remain.
- Clearer cards and a responsive detail drawer with saved contacts, recent document previews, chart/assessment navigation, and edits to existing follow-up requests.
- Explicit interview completion, separately audited, preserving answers, appointment date, documentation editability, and existing signature/final-send rules. No invented interview start time or automatic send.
- Actual assessor shown independently of workspace ownership.
- Scheduling available even while contact/intake information is incomplete.
- In-session navigation restoration and bounded in-memory range snapshots. Drawer data is loaded only when opened.

No schema migration, external service, mail integration, production data change, or change to other tasks' worktrees. No push or deployment occurred.

## Verification

On September 18, 2026, for the workflow implementation before the cosmetic frame and recovery-copy follow-ups:

- Production-format local Next webpack build and TypeScript passed.
- Focused ESLint and `git diff --check` passed.
- `node scripts/api-behavior-fixtures.mjs` passed.
- Seven Chromium tests across `calendar-workflow.spec.ts` and `pipeline-calendar.spec.ts` passed. They cover the new workflow plus existing views, filters, scheduling, retry/overlap handling, cached recovery, and assessment-section resume.
- Desktop (1440), tablet (834), and phone (390) Day and drawer screenshots were inspected; calendar accessibility checks passed. Existing Upcoming coverage also includes 320px width.
- The interview-completion test also passed against a disposable local PostgreSQL database with repository migrations. It checks unchanged answers, original appointment time, editable follow-on answers, workflow status, an audit event, idempotent retry, and rejection of a stale version. The temporary PostgreSQL server was stopped afterward.

Screenshots and test output are under the worktree's ignored `test-results/` directory. Tests use synthetic records and a separate headless browser; no production browser/session was used.

## Local calendar frame iteration

Eric's cabinet-page reference informed a sage enamel frame, inset Calendar label, binding rings, paper layers, and framed controls. All four existing views share the frame. Desktop/tablet controls remain sticky; phone controls scroll away to leave room for the schedule. This is presentation-only, with no scheduling, saving, permission, or API changes.

The production-format local webpack build, TypeScript, and focused lint passed. Two focused browser tests passed for Day layouts at 1440/834/390px, contacts, previews, follow-up saving, view switching, filters, and drawer dismissal; the Day accessibility scan passed. The development webpack preview encountered a Node built-in bundling error, so visual verification used the successful production-format local build. No unrelated bundling fix was made. The local preview server is stopped.

## Recovery wording follow-up

The separately packaged copy change replaces “Recovered draft” with “Unfinished edits restored,” distinguishes restored edits from a saved chart and an uncreated referral, and makes the discard label specific to unsaved edits. Assessment save-status presentation distinguishes pending edits from an active save and preserves conflict, offline queue, and error precedence. Persistence, authorization, and recovery algorithms are unchanged.

`node --test scripts/recovery-copy.test.mjs` (3 tests), `node scripts/referral-intake-recovery-contracts.mjs` (17 checks), focused lint, and `git diff --check` passed. The later production-format calendar-frame build included these code changes. The full legacy `pipeline-smoke.spec.ts` suite was not rerun; only its recovery region-label expectation changed.

## Deliberate boundaries

- This is the initial calendar workflow build, not a new task management database. Follow-ups edit existing workspace requests; arbitrary personal tasks, availability/travel blocks, drag-to-reschedule, and external Outlook synchronization are not included.
- Continue working currently surfaces started drafts, past appointments without outcomes, and interviews marked completed with unfinished documentation on open active referrals. It is not a complete inventory of every draft or post-admission reassessment.
- Navigation preferences last within the current app session, not across full reloads.
- The coordinator should integrate with the current release branch and verify the affected calendar paths. No Learning Center changes or real-mail enablement are included; those remain paused/disabled as requested.
