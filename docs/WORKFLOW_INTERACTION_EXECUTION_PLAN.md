# Pipeline Workflow And Interaction Execution Plan

Status: Eric authorized the bounded product implementation on 2026-09-11. Verification
continued on 2026-09-12. Eric explicitly authorized production deployment on
2026-09-12. Provisioning and structural refactoring remain outside this approval.
Release still requires the protected-branch checks and live verification.

Prepared: 2026-09-11. Repository baseline: `a70524295b708d46cea22eb99f1a127a2b5bf810`.

## Purpose And Boundaries

Make the existing referral journey understandable and dependable: know whose work
it is, open the right record, see what is saved, finish the assessment, and hand
off the correct chart and documents. Improve the interaction and its underlying
guarantees together, not as a decorative redesign or a broad refactor.

Use [Product Tenets](PRODUCT_TENETS.md) for product boundaries and
[Engineering Data Architecture](ENGINEERING_DATA_ARCHITECTURE.md) for data ownership.
Older build plans remain historical context; their field counts, role labels,
mock/live assumptions, and unfinished checklists are not current release evidence.
This document is the consolidated execution plan for the interaction/reliability pass.

Preserve:

- Workspaces, Calendar, Clients, Reports, and the existing application terminology.
- The Notes Lab's current layout, questions, examples, saved preferences, and isolated access.
- Current clinical questions, conditional meanings, source attribution, signature/addendum rules, and human decisions.
- Alamo's server-only clinical boundary and explicitly reviewed identity links; names are not sufficient join keys.
- Existing server permissions, assessment attribution, audit history, applied migrations, and private document access.

Do not add a chat assistant, admission classifier, automatic clinical decisions,
new dashboard clutter, speculative framework, dependency, notification service,
audio, haptics, sensor integration, or a new parallel workflow/state store.
Structural refactoring remains subject to the separate owner-approved slice protocol;
approval of this product plan does not waive it.

## Journeys And Scope

| Journey | Actual sequence and invariant |
| --- | --- |
| Intake | New referral -> collapsed documents/checklist at top -> verified intake -> assign -> explicitly create the referral -> continue in the same workspace. An unfinished draft is not an operational referral. |
| Receiving assessor | Home -> new assignment/current work -> exact workspace -> outstanding intake if necessary -> schedule -> begin -> assessment -> review -> sign -> recommend -> submit. Reassignment transfers the same open assessment, not a blank replacement. |
| Assessment | Client & referral -> Placement -> History -> Clinical -> Function -> Medication -> Substance use -> Behavior & safety -> Physical health -> Legal -> Support & goals -> Review. Preserve both the guided interview and the full section view, and make their relationship clear. |
| Supervisor | Home/team work -> unassigned, overdue, unscheduled, blocked, or review-needed records -> exact next action -> Calendar and Reports where relevant. Operational summaries are projections, not another source of truth. |
| Decision and handoff | Authorized review of the exact signed submittal -> recorded acceptance/decline or requested changes -> assessment-backed Chart -> Meet The Client and approved admission documents where eligible. Signing, recommendation, decision, email acceptance, and recipient delivery are different states. |
| Learning | Learning Center quick task help -> presentation explaining the whole journey -> synthetic practice -> deterministic guide on actual controls. Notes Lab remains a separate review environment, not a route granting Pipeline access. |

Current permission contracts must be preserved, not inferred from display titles:

- Reviewer-only assessors can access referrals they own, including retained creator ownership. Current primary assignment determines personal work; current assessment assignment determines assessment editing.
- A previous non-creator assignee loses access after reassignment. A retained creator does not thereby become the current assessment assignee.
- Admin/coordinator roles have supervisory access; eligibility for the active assessor roster is a separate rule. Andrew is not an assessor simply because he can supervise.
- Reports are admin/coordinator only. Final admission decisions and formal requests for assessment changes currently require admin.
- Viewers remain read-only. A Notes Lab-only principal cannot reach protected Pipeline pages or APIs by typing a different URL.
- Training choices or an assessor-perspective presentation never grant a role or broaden data scope.

## Visual Feedback At Each Workflow Moment

This is an explicit interaction deliverable, not just a layout/copy pass. Make
the transition from action to result visible where the action happened. Use the
existing green/mint accents, small status/check icons, restrained motion, and
persistent record state rather than adding a toast for every operation.

| Moment | Planned visual response | State it must actually represent |
| --- | --- | --- |
| Draft becomes a workspace | Preserve `Create referral` -> `Creating...` -> a small green `Workspace created` confirmation beside/in the existing control. Replace draft identity with the persistent workspace header; briefly accent its new row when already visible. Stay in the existing continuation path, not an automatic bounce to Home. | The referral exists with its durable ID. Queued files remain visibly uploading/pending until separately confirmed. Replaying creation does not create another row or repeated celebration. |
| An unfinished draft is saved | A quiet `Draft saved` status; its existing resume entry shows where to continue. | A recoverable draft, not a created/assigned operational referral. |
| Assignment is committed | The assignee label settles into its confirmed value and briefly receives a mint accent. The receiving assessor sees a distinct new-assignment row/badge with the next action. | Confirmed ownership. Loading the row alone must not acknowledge unseen work; assignment need not mean an appointment exists. |
| A file is dropped/uploaded | Highlight the accepting drop area while dragging; show the file row immediately as selected/uploading. Use real transfer progress where available, then a stored-file check and normal row appearance. | Selected, uploading, stored, processing, and reviewed are separate. Use an indeterminate indicator instead of a fabricated percentage. |
| Extracted facts need review | A restrained source/review accent identifies the affected fields. Confirmation updates that field's review marker and derived pending count without repainting the whole page. | A proposal becomes reviewed only after the human action is confirmed; no green treatment implying clinically verified truth merely because extraction finished. |
| Assessment answers autosave | One stable-location indicator changes from pending/saving to a small check and `Saved`; no popups on each keystroke. | All relevant pending edits are acknowledged. A local draft says so; a timeout or conflict cannot produce a false saved check. |
| An appointment is saved/rescheduled | The dialog completes into the existing next step; a quiet `Scheduled` confirmation and persistent appointment details remain. Its event appears/updates with a brief accent if Calendar is currently visible. | Confirmed date, operational time, method, duration, and assessor. No calendar-shaped success decoration before persistence. |
| A section's required answers are complete | The existing section rail/count and progress update together, with a restrained check/accent for completion. New content enters without a large page jump. | The current required-answer/conditional rules are satisfied, not that the section was opened or a guide step was clicked. This is not clinical approval. |
| An assessment is signed/submitted | `Signing...` or `Submitting...` completes into persistent signed/awaiting-review status and the correct controls. A small lock/check helps explain the new read-only state where appropriate. | Signed revision and submittal are distinct. The next authorized action is clear; no confetti, large success screen, or automatic admission implication. |
| A decision is recorded | The outcome/next-action area updates in place, showing remaining admission requirements where applicable. | Accepted, declined, and admitted remain distinct; use neutral clinical language, not reward/penalty animation. |
| Meet The Client is sent | The send control shows progress, then a quiet timestamped acceptance result with the existing recipient/attachment context retained. | Provider acceptance, not proof of delivery. Uncertain outcomes remain visibly uncertain and are reconciled before retry. |
| Another user changes the record | Briefly outline clean fields that were merged and show the existing author/update context without moving focus. Conflicts retain a readable, persistent marker and resolution control. | A remote update is different from a successful local save; a conflicting value is not silently replaced. |
| An operation fails or the connection drops | Replace pending feedback with a concise inline state and the real recovery action; retain entered content and place validation at the relevant field. | Failed, blocked, locally recoverable, and uncertain outcomes are different. Never flash success first or convert unavailable data into zero. |

Interaction rules:

- Keep controls dimensionally stable when labels/icons change; do not shift the form or move the click target underneath a second click.
- A transient accent reinforces the outcome, but persistent status carries it after the accent disappears. Important confirmation cannot exist only in a disappearing message.
- Use motion only to explain insertion, expansion, or a state transition. Keep it short and non-blocking, with an equivalent static result for reduced motion.
- Keep one primary confirmation per operation. Do not combine button check, toast, banner, modal, and whole-page animation for the same save.
- Preserve keyboard focus and intentional scroll. Newly arriving work does not force navigation, reorder the row being operated on, or steal focus from an assessment answer.
- Announce meaningful milestones through existing accessible status patterns, not every background save. Text accompanies color/icons.
- Reuse current components and state transitions; CSS/native behavior is enough unless a concrete limitation is demonstrated. No animation package, synthetic progress timer, or new notification subsystem.

Proof: visible pending -> confirmed/failed/uncertain states under delayed and lost
responses; creation replay; upload still pending after workspace creation; a full
assignment list; rapid edits; two users; reduced motion; keyboard focus; narrow
controls; and the same durable outcome after transient feedback has disappeared.

## Implementation Record

This is a product reliability pass against the baseline above, not an approved
refactor slice. No migrations, new dependencies, production data mutations,
real emails, or Notes Lab changes were made during implementation/testing.

Deployment preparation: current integration base and live rollback image are
`c0755a43410aec149b42a479cf1d47fafa700f88`. This preserves the chart/intake releases
merged after the original planning baseline. Use the existing Azure workflow;
retain runtime flags and hostname bindings, do not bootstrap the database, and
require successful CI on the merged candidate before dispatch. A dispatch is
not deployment success; verify the immutable image, healthy revision, traffic,
public health endpoints, and authenticated-route behavior after completion.

Implemented at the existing owners:

- `PipelineWelcome`, `home-continuity`, and `WorkspaceActivityFeed`: bypass stale
  Home cache on entry and focus/visibility refresh; single-flight visible-only 30-second
  refresh; preserve unseen assignment overflow; acknowledge only shown IDs;
  reject a delayed refresh that would resurrect acknowledged assignments.
- `ReferralPacketCanvas` and `PipelineOverviewRoute`: acknowledge durable
  workspace creation separately from file upload; distinguish a selected packet
  from stored documents; preserve the selected file during creation; isolate
  another client's editor and reject late navigation callbacks.
- `offline-assessment-store`: atomically remove only the acknowledged encrypted
  queue revision, including same-millisecond edits and 409 conflicts; select one
  encryption key atomically when first-use key generation overlaps across tabs.
- `AssessmentWorkspace` and `AssessmentSchedulingDialogs`: reuse Calendar's
  Pacific conversion helpers; label the timezone; avoid equating a timeout with
  confirmed offline status; keep truthful save feedback visible at narrow widths.
- `GuidedAssessmentInterview`: follow the canonical 12-section sequence and keep
  the current screen identified by its stable ID when earlier questions appear;
  keep exactly one visible save-status guide target in each assessment view.
- `ContinueWorkPanel`: improve resumed-intake metadata contrast without changing
  the resume path, saved state, or panel layout.
- `AssessmentChartWorkspace` and the Meet The Client route: reuse a logical send
  ID within the open chart, synchronously guard duplicate clicks, report provider
  acceptance rather than recipient delivery, and keep acceptance truthful if
  final audit bookkeeping fails. Invalid route IDs cannot reserve a delivery.
- `operator-guided-tutorials`: clarify that assignments appear on Home and that
  Calendar shows appointments and scoped unscheduled work; no new guide flow.

Focused evidence owners are
`tests/e2e/operational/workflow-interaction.spec.ts`,
`scripts/meet-client-delivery-fixtures.test.mjs`, the existing operational role,
reassignment, and golden-thread suites, and the existing responsive/training suites.
The operational runner explicitly wires its already-isolated desktop-state path;
no parallel continuity store was added. Tutorial fixtures use a synthetic roster,
not delegated Alamo access. Existing ambiguous tutorial selectors were narrowed
to the actual control rather than removing functional or browser-error assertions.

Reusable commands:

```sh
npm run test:e2e:workflow-interaction
npm run check:meet-client-delivery
npm run check:assessor-workflow
npm run training:route:check
npm run training:check
```

The workflow command uses synthetic principals, separate local-file stores and
an isolated Next build. It does not certify PostgreSQL, Blob, real accounts, or
traffic capacity. The mail fixtures stub provider and audit dependencies while
executing the actual route; they never send email.

Test-power check: executing the four mail fixtures against the original baseline
route catches the acceptance/audit failure, provider/failure-audit failure, and
malformed-ID defects. The normal accepted-send fixture passes against both versions.
This is a three-defect detection probe, not mutation-score certification of the
entire assurance suite.

Verification on 2026-09-12:

- Production Next build of the isolated candidate: passed.
- Expanded workflow command above with the existing role, reassignment, and
  golden-thread suites: 13 passed, zero failed/skipped. Includes synthetic PDF
  upload/private byte retrieval, delayed client A save after opening/editing B,
  delayed assignment refresh/remount, encrypted offline queue/key races, Pacific
  scheduling from a New York browser, rejected spring DST gap, all 12 guided
  sections, reverse direct-section jumps, and a 320/390/768/1024/1280/1440/1920
  assessment viewport matrix.
- Existing Learning Center, responsive navigation, and responsive accessibility
  suites: 29 passed across Chromium desktop and mobile projects. Includes the
  320/430/768/900/1024/1180/1280/1366/1440 navigation matrix, reduced motion,
  automated serious/critical accessibility checks, guide placement, scheduling
  checkpoints, pause/resume, and synthetic assessment autosave without live writes.
- Meet The Client route fixtures: four passed; the three-defect baseline probe
  described above passed its detection expectation.
- Assessor workflow and Notes Lab contracts, training route contracts, TypeScript,
  and focused ESLint: passed. The Notes Lab route, practice component, question
  specifications, examples, stores, and access rules have no diff in this pass.

Release correction: the initial PR CI rejected three added complexity increases.
The new conditions now live in the existing save-status component, one bounded
workspace-key helper, and the canonical nullable Pacific date formatter. No
complexity baseline or ceiling changed. The rebuilt correction passed the same
13 workflow tests, TypeScript, focused ESLint, and the complexity ratchet. The
local refactor-setup command separately encounters a pre-existing missing Git
worktree; this is not a completed refactor certification or authority to prune
another task's worktree. CI must certify the release candidate in its clean checkout.

The first full operational CI run passed 22 cases but exposed an outdated UI
expectation: the default report counts completed-assessment staff rows, not every
referral. The rehearsal now explicitly selects the visible Assessment calendar
report and checks its scheduled assessments. Exact 100-referral, community,
month, workflow, and dashboard reconciliation remains intact. The corrected
100-user product-day test passed locally against the rebuilt candidate. Academy
source indexes were refreshed after reviewing these bounded source changes.

Demo and Home/Reports browser tests now use a synthetic roster where clinical
delegation is outside their scope, current practice/Zoom control labels, scoped
save-status assertions, and an awaited report request. The retired experimental
graph UI expectation is replaced by a guard against mounting or fetching that
graph in Reports; its domain fixtures remain separate. The personal Home case
has a default-layout fixture rather than inheriting another case's customization.
All 29 cases passed locally with a fresh disposable desktop-state path.

The wider primary browser run exposed the same unconfigured delegated directory
in the packet-suite setup. Those fixtures now cover the warm directory read;
fault injection starts before prefetch, and packet status checks target the
canonical save indicator. Imported-chart fixtures use the existing unified
profile, while unfinished assessment drafts stay available through their API
without appearing as signed clinical chart entries. Selected-state assertions
use `aria-pressed`, not the retired black background class. The rebuilt primary
run passed 131 cases, with 17 feature/profile-conditional skips; its final stale
packet assertion was corrected and that entire case separately passed. CI still
must run the desktop, access-isolation, cross-browser, and Linux visual profiles.
The desktop profile subsequently passed all nine enabled cases after scoping
its draft/upload status assertions to the same indicator; its disabled-feature
case is intentionally skipped in that profile. The optional operator packet
smoke uses the same scoped assertion but was not run with real source material.
The next CI candidate passed its primary browser and isolated Notes Lab access
profiles. Its matrix then stopped on an outdated two-entry directory-cache
marker: the existing cache was already eight entries. That requirement now
checks the current bound, user key, generation invalidation, and eviction loop;
the cache implementation and measured performance limits are unchanged.

That run also detected a real identity-confirmation defect: mutation validation
could reuse a 15-second clinical display projection. The existing clinical TTL
owner now admits only GET/HEAD reads to the cache. POST/PATCH confirmation reads
fetch fresh governed evidence and fail closed when it is invalid; chart reads
retain their original TTLs and operator/authority isolation. The existing VM
contracts exercise warmed-cache mutation revalidation and invalid fresh evidence,
and the browser DOB-conflict test passed against the rebuilt correction. No
clinical matching policy, database schema, or Notes Lab UI changed.

Initial failures were retained as diagnostic evidence during iteration: invalid
synthetic PDF/name fixtures, stale tutorial selectors, missing synthetic roster
and desktop-state setup, and faint resumed-intake metadata. Fixes address the
owner or fixture involved; accessibility/browser-error assertions were not waived.
Operational tests without Alamo intentionally receive unavailable-directory
responses. Those responses and the synthetic tutorial roster are not clinical
integration evidence. PDF.js also emits a standard-font configuration warning;
byte preservation passed, but full rendering/extraction fidelity is not certified.

Latest local browser artifacts:
`/tmp/pipeline-workflow-interaction-20260912/test-results/` and the existing
`test-results/` / `playwright-report/` paths. These are disposable local outputs,
not durable release evidence. Commit the candidate and retain exact-run evidence
before deployment. Training fingerprints are refreshed only after this deliberate
path/source review; they do not constitute supervisor approval of clinical wording.

Rollback: before a release, record a committed candidate and deployment target.
Keep these bounded product changes as a separately reversible commit; rollback
must restore that commit's prior application revision, not reset unrelated work.
No database rollback is needed for this candidate because no schema or applied
migration changed. Do not discard drafts, uploaded bytes, or audit reservations
to make rollback appear clean.

Remaining proof and deliberate limits:

- Home refresh remains bounded polling plus focus/visibility, not push. Assignment
  history reads retain the existing 100-event ceiling; add paged unseen-event
  discovery if an operator can exceed 100 unacknowledged relevant events between
  visits. Full current work remains available through the existing scoped path.
- Send identity is stable within the open chart, not durable across reloads.
  Ambiguous reservations and accepted-but-audit-pending outcomes require operator
  reconciliation. Add a durable delivery-status/reconciliation projection before
  enabling automatic retries, reload-safe retry, or intentional same-content
  resend. Provider acceptance is not proof of physical recipient delivery.
- Hidden retained follow-ups and medication fallback policy remain unchanged.
  Clinical owners must resolve their interpretation before changing summaries,
  retention, or signed-record semantics; this pass does not delete answers.
- Real PostgreSQL transaction/lock/pool tests, Blob/PostgreSQL partial-failure
  tests, deployed-account checks, and a measured 100-user/100-GB rehearsal still
  require provisioned targets and explicit operating thresholds.
- Viewport emulation and automated accessibility checks are bounded evidence,
  not certification of physical iPads, screen readers, virtual keyboards, text
  scaling, every nested scroll surface, or every tooltip placement.
- Account switching during outstanding work, response-loss/reload recovery,
  storage exhaustion, email reconciliation, and the full production failure
  matrix remain release work. Do not infer these properties from a passing
  local happy path or from test count.
- Remaining visual refinements must be justified by a concrete workflow defect;
  this approval does not authorize rewriting the Notes Lab or clinical guidance.

## Prior Evidence

The preceding verification pass used isolated local-file stores, mock extraction,
and separate synthetic principals. Five focused automated tests passed:

- Role-separated packet-to-assessment-to-submission/decision/handoff API journey.
- Referral and open-assessment reassignment with audit attribution.
- Retained workspace-creator access after reassignment.
- Personal/team Home and Calendar scope with supervisor-only Reports.
- Assessor report navigation/direct-route denial.

Browser checks separately established fresh Home visibility, exact workspace
opening, Workspaces search, receiving-assessor scheduling, beginning the interview,
full 12-section navigation, questionnaire autosave, and appointment ownership.
Receiving-assessor API edits persisted; the former non-creator assessor was denied.

These checks did not certify production accounts, PostgreSQL transactions, real
PDF byte transfer, clinical correctness, all devices, or concurrent traffic.

The preceding pass found that Home's focus refresh could reuse its 15-second
client cache, automatic refresh ran every 60 seconds, and the current-work preview
showed only five items. The implementation above repairs cache reuse and overflow
discovery at the existing new-assignment surface; it does not add push delivery.

## Execution Packages

Work in this order. At the start of each package, reread its actual owners and
skip any proposed change that the current code already satisfies. Add focused
evidence at the risk boundary instead of accumulating decorative assertions.

### 1. Assignment Visibility And Correct Record Context

Visual:

- Home clearly distinguishes newly assigned work, current action items, and upcoming appointments without extra explanatory panels.
- A new assignment remains discoverable even when the five-row preview is full; provide the existing full scoped path and an accurate additional-item count.
- Every row opens the exact referral and relevant next step. Keep person profile, referral episode, assignment, and assessment distinguishable.
- Show unavailable/stale counts as unavailable/stale, not as a genuinely empty queue.

Engineering:

- Trace assignment commit -> referral/assessment/work-item ownership -> Home continuity -> scoped lists -> receiving user's refresh.
- Prevent focus/visibility refresh from falsely appearing fresh while reusing stale assignment data. Reuse existing change/refresh capabilities with bounded requests and no second polling engine.
- Define existing new-assignment tracking initialization, acknowledgement, and cross-session behavior before changing it; loading Home must not accidentally dismiss unseen work.
- Preserve transactional PostgreSQL reassignment, local-adapter behavior, signed-assessment attribution, creator access, and former-assignee denial.
- Bind save/upload/load completion to the initiating user, referral, assessment, and revision. A late response for A must never update B after navigation or account switching.

Owners: `PipelineWelcome`, `home-briefing`, `home-continuity`, `operations-snapshot`,
`referral-access`, `referral-ownership`, `referral-store`, existing continuity/change
APIs, and the workspace navigation/load owners.

Proof: A/B/coordinator browser contexts, existing Home during assignment, more than
five higher-ranked items, filtered Workspaces, reassignment during an edit, retained
creator versus non-creator, late A response after opening B, and server/queue failure.

### 2. Save Truth, Resumption, And Concurrency

Visual:

- Use one quiet, consistently placed save indicator that remains visible in narrow windows and focused assessment views.
- Distinguish unsaved changes, saving, saved on server, recoverable local draft, pending synchronization, conflict, and save failure.
- Keep typing and navigation immediate; never label an optimistic update as durably saved before acknowledgement.
- Resume the correct user's referral, section, and draft without creating a second referral or carrying previous-client completion into a new record.
- Explain an actual recovery action at the field/section involved; avoid generic repeated banners and blanket leave warnings.

Engineering:

- Reuse canonical versions, section conflicts, mutation IDs, encrypted offline drafts, server recovery state, and existing authenticated fetch behavior.
- Separate a confirmed offline condition from a timeout with uncertain server commit. Retry safely with the same logical operation identity or reconcile before claiming failure/success.
- Test the offline flush race: a newer queued edit written during an older flush must survive. Remove only the acknowledged queued revision.
- Merge clean remote fields, retain local dirty fields, and explicitly resolve overlapping edits. Never solve a conflict by silent last-write-wins.
- Protect draft/principal keys, session expiration, account switching, signature while a save is pending, and recovery after a successful server save whose response was lost.

Owners: `ReferralPacketCanvas`, `AssessmentWorkspace`, `assessment-workspace-state`,
`offline-assessment-store`, existing draft/workspace-state APIs and authenticated fetch.

Proof: delayed responses, response loss after commit, offline editing/reconnect while
typing, reload/reopen, two tabs, different-section and same-field edits, reassignment,
account change, pending save/sign, and storage unavailable/full behavior.

### 3. Documents, Intake, And Evidence

Visual:

- Keep the initial documents/checklist first and collapsed by default; its summary states what is actually stored or still queued.
- Distinguish selected locally, uploading, stored, processing, awaiting review, reviewed, and failed. A selected filename is not a stored packet.
- Make source files and requirement evidence easy to find without duplicating the upload controls throughout the record.
- Keep late admission documents attached to the same episode without resetting assessment progress.

Engineering:

- Trace file selection -> explicit referral creation -> private upload reservation -> binary upload -> completion -> processing -> evidence/review linkage.
- Preserve idempotent completion, document identity, permissions, partial failure recovery, and association with the initiating referral.
- Do not promise reload recovery of a browser `File` unless bytes are durably stored. If a queued selection is lost, state that reselection is required; do not serialize packet bytes into ordinary browser storage.
- Keep binary uploads out of application JSON/web-process payloads. Large archives need bounded metadata reads and private storage/worker processing, not client scans.
- Exercise Blob/PostgreSQL partial failures, duplicate filenames with different content, duplicate completion/retry, and late worker responses. No unrelated client receives a file or extraction result.

Owners: `ReferralPacketCanvas`, existing upload/completion APIs, document store,
requirements, extraction processing, and existing attachment/evidence policies.

Proof: queued versus stored summary, interrupted/partial upload, refresh/reselection,
duplicate completion, two files with the same name, wrong-principal document access,
late processing, and real synthetic PDF byte retrieval in an isolated integration target.

### 4. Scheduling And Assessment Navigation

Visual:

- Make the path schedule -> begin -> assessment explicit and short, without extra setup pages or competing primary buttons.
- Preserve guided interview and full section navigation; give users a clear way to switch. Beginning currently enters the guided interview, not a permanent 12-section rail.
- Keep all sections directly accessible in the full assessment, resume existing work where appropriate, and start a new client with no inherited completion checks.
- Keep inherited intake context identifiable with restrained styling and text, not color alone. Corrections go to the canonical owner.
- Answer Help stays small, expandable, and pertinent to that field. No generic modal on every question, no repeated four-bullet filler, and no Notes Lab redesign.
- Calendar shows relevant appointments, readiness, and actionable scheduling gaps, with named states as well as color.

Engineering:

- Reconcile scheduling dialog time conversion with the existing operational timezone helpers; verify timezone labels, browser timezone differences, and daylight-saving boundaries.
- Preserve appointment overlap checks, duration/method validation, cancellation/reschedule audit, readiness blockers, and active-roster eligibility.
- Preserve assessment identity through scheduling, start, and switching views; do not create extra drafts on repeat clicks.
- Keep navigation stable when conditional questions appear/disappear; do not rely on an index that now points at a different question.
- Apply existing conditional visibility consistently to completion/validation/display. Hidden retained answers require an explicit clinical retention/display policy before any deletion or summary change.
- Resolve whether assignment events belong on Calendar or only Home/work lists; the current Calendar request excludes them while training says they appear. Do not introduce a second event store.

Owners: `AssessmentWorkspace`, `AssessmentSchedulingDialogs`,
`GuidedAssessmentInterview`, assessment schema/access/store, Calendar model/store,
workspace routing, and relevant authored guide steps.

Proof: schedule-save -> begin -> answer, cancellation/reschedule, another browser
timezone, DST, overlap, every section jump, view switching, conditional changes,
return after refresh, inherited-field correction, and inactive/non-assessor roster entries.

### 5. Responsive Interaction, Accessibility, And Copy

Visual:

- Preserve the application's visual language. Consolidate cramped header actions, repeated titles/subtitles, nested decorative containers, and oversized competing buttons.
- Keep client identity, current stage, save state, and primary action legible before secondary activity/files controls.
- Make profiles and charts readable medical records: clear identity and important facts up top, readable cell values, stay context and noticeable files, no dashboard-style marketing masthead.
- Choose one main scroll owner per active surface, intentional nested scrolling where necessary, and a visible/reachable page ending. Tooltips and sticky elements must not hide inputs or final actions.
- Adapt to the actual container/window, not just a full desktop viewport: split-app window, laptop, large monitor, iPad portrait/landscape, touch, and small screen.
- Provide comfortable touch targets, visible keyboard focus, normal wrapping, and no page-wide horizontal overflow. Preserve dense tables with deliberate local scrolling when needed.

Interaction and feedback:

- Clicking produces immediate pressed/pending feedback; status text confirms the resulting saved state.
- Focus follows an opened dialog and returns to its trigger. Validation focuses the relevant problem without wiping entered data.
- Reuse existing focus trapping, Escape, scroll restoration, and dialog patterns rather than adding another overlay system.
- Use short transitions only to explain a changed section, expanded area, or loading state. Respect reduced motion; no animation is necessary for the workflow to operate.
- Use accessible names, labels, contrast, keyboard operation, and restrained live announcements. Color, movement, sound, and vibration are never the only signal.
- No default sounds/haptics. Loom captions and accessible playback remain relevant; ambient device features are not this pass's scope.

Owners: shared shell/action navigation, `CurrentWorkOverlay`, workspace/assessment
containers, existing profile/chart views, and current responsive/accessibility tests.

Proof: container widths around actual breakpoints, 390/768/1024/1280/1440/1920-pixel
viewports, iPad orientations, 200% zoom, browser text scaling, virtual keyboard,
keyboard-only and screen-reader smoke, reduced motion, long names/labels, empty and
large tables, open dialogs/tooltips, nested scrolling, and final controls in reach.

### 6. Chart, Meet The Client, And Supervisor Reporting

Visual:

- Chart reflects the assessment rather than introducing a parallel narrative record. Clearly distinguish draft, signed assessment, intake context, and source material where applicable.
- Meet The Client remains a concise face-sheet-style summary with identity, short bio, medications, and the approved admission packet.
- Show the selected signed version, recipients, attached documents, and actual send outcome without unrelated override features.
- Supervisor numbers lead to the scoped underlying records. Keep reports selector/filter/review/export straightforward and avoid additional vanity metrics.

Engineering:

- Trace summary/chart fields back to canonical assessment, source/review state, and signed revision. Examine medication fallback behavior before treating it as current assessed medication.
- Do not silently reuse a hidden conditional follow-up or historical source as a current finding. Resolve the policy with the owner; preserve existing signed records.
- Preserve accepted-case eligibility, recipient authorization, attachment readiness, private file access, and minimum-necessary disclosure.
- Audit provider acceptance separately from recipient delivery. If sending succeeds but final audit bookkeeping fails, do not report a definite non-send or blindly resend with a new operation ID.
- Reuse the existing send reservation/audit mechanism and stable logical mutation identity for uncertain outcomes and retry.
- Keep report scope and CSV exports server-gated, query-bounded, and tied to defined durable events; verify row/count parity, malformed filters, and CSV formula safety.

Owners: `AssessmentChartWorkspace`, assessment summary builder, signed submittal/
decision owners, Meet The Client API/attachment policy/audit reservation, and Reports.

Proof: current versus signed revision, conditional follow-up retention, medication
fallback source, rejected/unfinished case denial, missing/late documents, unauthorized
recipient, duplicate click, provider success/audit failure, response timeout/retry,
scoped report count/row parity, export restrictions, and large-result paging.

### 7. Learning Center And Release Proof

Visual and content:

- Learning Center stays quick help, with the full presentation clearly accessible at the top.
- Presentation follows a receiving assessor's day as well as intake and supervisor actions: Home -> assigned workspace -> schedule -> assessment sections/help -> review/submission -> authorized decision/handoff.
- Use actual synthetic screenshots only where they explain location or action; remove ornamental boxes, duplicated headings, icons, and generic business copy.
- Each guided step names what to do, the real target, and what success means. Section practice starts at that selected section rather than restarting the entire path.
- Relevant assessment writing guidance and the isolated Notes Lab remain connected conceptually without exposing restricted users to the main application.
- Optional Loom recordings demonstrate clickpaths. Supervisor-approved clinical training is distinct from software guidance.

Engineering:

- Update authored targets/routes only after the real product path is stable; verify guide placement, focus, scroll, resize, and missing-target recovery.
- Preserve deterministic observation and human checkpoints. Guides do not inspect field values, manufacture completion, sign, decide, export, or send for the operator.
- Align role terms, Calendar descriptions, presentation counts, schema-derived sections, and actual permissions. Source code/policies outrank stale documentation.
- Persist progress per user with existing revision rules; practice remains synthetic and writes require an explicitly isolated demo store.
- Use current test owners and the command surface already in the repository. Promote missing high-value scenarios into focused repeatable tests; no new test platform is needed.

Owners: `PipelineOperatorAcademy`, `OperatorGuidedTours`, `PipelineDemoCenter`,
authored training curriculum/guides/video catalog, existing demo boundary, and current
Playwright/support/contract runners. Notes Lab files are not an implementation target.

Proof: every visible quick-help entry, presentation through-line, selected-section
launch, each assessment section target, schedule transition, missing-target fallback,
role/account changes, saved progress, Loom absent/present, Notes Lab-only URL/API
denial, and no real send/export/write caused by tutorial navigation.

## Performance And Data-Scale Contract

Apply this across packages, not as a separate speculative infrastructure rebuild:

- Reuse bounded paginated queries, batched workflow projections, existing change polling, worker claims, and private binary storage.
- Avoid full-dataset browser scans, N+1 requests/queries, duplicate timers, synchronous extraction, unnecessary rerenders, and heavy chart/media work on initial route load.
- Abort superseded reads or ignore stale results; retain safe last-known context while clearly identifying failed refreshes.
- Check targeted PostgreSQL plans/index use, pool bounds, transaction/lock behavior, idempotency, and rollback under concurrent assignment/save/schedule operations.
- Agree the demo's user mix, operations, dataset size, and latency/error thresholds before running a 100-user rehearsal. Do not substitute 100 static pages for 100 users doing work.
- Large binary archives and high row counts need separate measurements. Local-file test success is not PostgreSQL/Blob capacity evidence, and this pass will not claim 100 GB certification without a provisioned measured target.
- No paid infrastructure or new external services are activated without separate approval.

## Execution And Approval Procedure

1. Eric says go. Confirm whether implementation only or deployment is also requested; deployment is not implicit in plan approval.
2. Capture fresh commit/worktree/deployment state and coordinate active tasks. Preserve unrelated edits. Read relevant installed Next.js guides before application changes.
3. Start with package 1 and package 2. Record current canonical owner, exact allowed files, behavior change, focused tests, and rollback per bounded package. Separate structural refactor slices from product fixes.
4. Complete each package through implementation and focused evidence before starting another. Reuse existing capabilities and stop at the smallest safe fix.
5. Run the actual assessor/coordinator/admin journey in separate authenticated contexts, including recovery and two-user conflicts. Run browser and PostgreSQL/Blob evidence separately and identify unavailable targets honestly.
6. Run repository-required checks at their applicable scope. Do not run all assurance controls after every minor copy/CSS edit; risk-specific checks are for iteration, release checks are for the candidate.
7. At release, record exact candidate commit, passed/failed/skipped tests, browser/device matrix, approved residual issues, rollback, and untouched Notes Lab boundaries. Do not call the app perfect or certified beyond the measured properties.
8. Deploy only with explicit authorization, then check protected route availability, real role scope, assignment visibility, schedule-to-assessment, persistence, and approved handoff behavior on that exact deployment. Use synthetic cases where permitted; never send real email as a smoke test without approval.

## Release Acceptance

- A receiving assessor can discover and open newly assigned work without a manual reload or searching through an arbitrary five-row cutoff. Existing live Home gets fresh assignment state on return; active-page updates have an explicitly measured bound.
- The same referral opens with its complete authorized record and existing open assessment. Late responses, reassignments, and account changes cannot cross record/principal boundaries.
- Unsaved, locally recoverable, server-saved, conflicted, and failed work are visibly different. Recovery/concurrent edits never silently erase a newer answer.
- Documents selected locally are never described as durably stored. Uploaded PDFs and evidence stay associated with the correct episode through partial failures and retry.
- Schedule, begin, guided/full assessment views, all 12 sections, review, signature, submission, and authorized decision/handoff form a coherent path with no dead end.
- Device/container changes preserve readable content, reachable final actions, focus, accessible feedback, and the existing app terminology.
- Workspace creation, assignment, upload, scheduling, saving, signing/submission, and handoff each provide a specific in-place visual transition plus an accurate persistent outcome. Feedback never claims a downstream operation is complete just because its upstream record was created.
- Chart/email source versions, medications, recipients, attachments, and uncertain send outcomes are honest and governed.
- Quick help and presentation teach the deployed behavior; Notes Lab remains unchanged and isolated.
- The release has recorded bounded browser, database, document, concurrency, and recovery evidence, with no unresolved critical/high finding in the approved scope.

## Deliberate Ceilings And Revisit Triggers

- Keep existing polling/change APIs, not a new push service. Revisit only if measured freshness or request-load targets cannot be met with bounded existing mechanisms.
- Keep deterministic field-specific help and supervisor-approved wording, not generative clinical suggestions. Revisit only through separate clinical/data/model approval with labeled evidence.
- Keep a small actionable supervisor surface. Add a signal only when a named supervisor needs it to make a specific decision and its source definition is testable.
- Keep current accepted document categories configurable through their existing owner. Change required packet content only after supervisors approve the list.
- Keep Notes Lab untouched during this pass. Any question, example, or access change requires a separate explicit request and its own regression boundary.
