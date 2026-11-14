# Assessor scorecard

Open **Reports → Assessor scorecard**, on desktop or phone.
The dedicated page is `/?screen=operations&report=assessor_scorecard`.
Reports tabs retain browser Back/Forward, reload and direct-link behavior.
The existing named-owner policy protects both the entry and
`GET /api/operations/assessor-scorecard`; other administrators, assessors,
delegated sessions and workshop personas cannot read it.

Periods are this Pacific week, the last 30 Pacific calendar days, or since
Pipeline launch. Records use the admissions-flow cohort: genuine Pipeline
workspaces created on/after September 18, 2026, excluding historical imports and
trash. Denied, admitted and archived outcomes remain eligible. This is a staff
contribution report, not an acceptance-rate ranking or an overall performance
grade. Current assignments and completion items are deliberately independent of
the selected activity period.

## Measures and attribution

| Measure | Counting rule |
| --- | --- |
| Interviews finished | First `assessment_interview_completed` event per assessment revision root. |
| Charts confirmed | First `assessment_signed` event per revision root. The product calls this chart confirmation. |
| Clients worked | Distinct workspaces with an audited human contribution in the period, including scheduling, answer review, document work and post-send corrections. |
| Assessment fields touched | Distinct canonical fields per assessor and assessment root; repeated autosaves do not add credit. Includes extracted answers a person reviewed. |
| Files uploaded | Distinct uploaded document IDs. |
| Handoffs sent | First accepted send per workspace; repeated delivery acknowledgments are deduplicated. This is not proof of recipient delivery. |
| Additional handoffs | Distinct subsequent accepted deliveries, including when the first send predates the period. |
| Failed / unknown send attempts | Distinct failed or unconfirmed attempts in the period, not a claim that delivery remains unresolved today. |
| Assigned / overdue | Current active work and due dates from the canonical Home workflow projection. |
| Open completion items | Existing completion-memo rules, assigned to the recorded assessment assessor or referral owner. A gap may depend on another team. |
| Clicks / taps | Foreground control activations, including keyboard activation; typing text is not counted as clicks. |
| Active minutes | Distinct minutes containing a foreground interaction. The same minute across tabs or merged identities counts once. This is not elapsed work time. |

Audit credit follows the actor who performed the work, not today's workspace
owner. Member merges resolve by ID, never by a matching name. Inactive people
with evidence remain visible. Unlinked events and unassigned work/gaps are
reported separately rather than guessed. Assessment lifecycle projections on
referrals do not count as additional assessments. Recorded God mode actions are
excluded. Notes have no complete author history and contribute no totals.

At the owner's request, Eric Wilson and Andrew Dominici are excluded from the
comparison and PDF by principal ID, including merged identities. Their work is
not reassigned or mislabeled as unattributed. This report-only exclusion does
not change accounts, permissions or clinical records. Revisit the explicit list
only when the owner changes the reporting roster.

Each work total opens the underlying workspaces and dated evidence. The median
start-to-finish interval uses first recorded interview starts and completions;
it includes pauses and shows the sample count. Missing milestones remain
missing instead of being inferred from today's status or a planned date.

## Usage collection and limits

Migration `0049_assessor_usage` adds a separate aggregate table. Each row contains
only authenticated principal ID, random per-tab session ID, minute and cumulative
control-activation count. No entered text, patient IDs, page paths, email content,
keystroke values or screen recordings are collected. Nothing can reconstruct
historical clicks. The UI shows the migration's coverage start date.

The observer sends changed minute aggregates every 30 seconds and on page hide,
with at most four minutes of in-memory retry. An upsert keeps the greatest total
per tab/minute, making concurrent retries and lost acknowledgments idempotent.
The server owns actor identity, rejects stale-account headers, requires same
origin, bounds request size/timestamps/counts, and ignores mock, demo and
delegated sessions. Collection failure is isolated from clinical saves and never
initiates a sign-in refresh.

Usage is approximate: offline operation, blocked requests, clock skew, old app
versions and abrupt exits can lose samples. Browser counters are operational
telemetry, not a tamper-proof employment time ledger. A reported zero means no
samples received, not proof of no work. Requiring complete time accounting would
need a separately specified system, not stronger claims about these counts.

The first version loads at most 5,000 workspace records and 50,000 audit events.
It fails explicitly above these limits instead of silently truncating. Revisit
server-side aggregation/pagination if the real cohort approaches either ceiling
or measured report latency becomes unacceptable. Notes authorship metrics should
only be added after the canonical notes store records complete author history.

## Release and verification

Use the normal backup/migration-before-traffic workflow, apply 0049 with the migrator
role, and verify runtime permissions inherited from the existing database
bootstrap. Without that migration the scorecard's audit measures still work and
usage collection remains disabled. An app rollback can leave the additive table
intact; do not drop collected data. No clinical records or audit history are
rewritten by this feature.

**Export PDF** downloads a fresh read of the selected period in the selected sort
order through the same owner-only endpoint. Its dated comparison and activity
tables use the report palette, embedded fonts, repeated column headings and
page numbers; counting notes travel with the report. Client-level evidence is
kept in the authenticated drill-down rather than copied into the summary PDF.
Both JSON and PDF responses are private and no-store. The native PDF writer is
already a production dependency; no browser, external service or new package is
needed to generate it.

Focused checks:

- `PIPELINE_TEST_DATABASE_URL=postgresql://<local-user>@127.0.0.1:5432/postgres node --test scripts/assessor-scorecard.test.mjs` creates and drops a disposable database, applies all migrations, tests real joins, concurrent usage retries and read-only report behavior.
- `node --test scripts/application-activity.test.mjs scripts/admission-flow-measures.test.mjs scripts/weekly-completion-memo.test.mjs` checks reused access/cohort/memo behavior.
- `PORT=3342 PIPELINE_E2E_CLINICAL_PORT=3343 PIPELINE_E2E_PREBUILT=true npx playwright test tests/e2e/assessor-scorecard.spec.ts tests/e2e/application-activity.spec.ts --project=chromium` exercises synthetic eight-person data, long names, period/sort/drill-down, keyboard focus, responsive accessibility, reporting failure and aggregate usage collection.

Test fixtures contain no real clients and send no mail.

Production verification on November 13 found chart confirmations and starts but no explicit interview-finished events. The comparison therefore leads with Charts confirmed. Interviews finished remains a separate, explicitly recorded measure; missing events cannot establish that an interview did not happen.
