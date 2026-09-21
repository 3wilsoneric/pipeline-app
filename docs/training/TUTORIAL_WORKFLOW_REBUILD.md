# Tutorials: Workflow Rebuild

## Access Check (2026-09-21)

Checked against deployed revision `ead9008b73b3ee51` and its matching source.
Production inspection was read-only: Microsoft application settings, staff
assignments, account status, latest sign-in results, and anonymous HTTP responses.
Eric, Andrew, Sandeep, Jazmine, Vince, and Annette each have enabled accounts,
appropriate app roles, and a successful Pipeline sign-in in Microsoft's logs.
All five invited staff have accepted their invitations. Production's client ID,
API audience/scope, and sign-in redirect URLs match. This does not claim a fresh
interactive login or MFA test as each person.

Two local corrections follow the existing shared-workspace policy:

- All approved Pipeline roles, including Viewer, receive every non-Reports
  tutorial. Assignment is not required for the fictional referral.
- The Reports tutorial uses the actual named-account Reports permission, not
  only the supervisor role. The three authorized supervisors also match by their
  verified, tenant-scoped Microsoft object IDs to tolerate guest/email aliases.
  God mode uses the selected user's identity, not the administrator behind it.

Evidence: 19 operational browser tests cover role resolution, personal filters,
team calendar, cross-owner edits, uploads, assessment/signing/decision access,
private draft isolation, Reports reads/exports, and tutorial access for every
role. Another 26 browser tests cover the complete fictional flow, mobile layout,
Reports visibility, and God mode. All 49 focused unit tests, API behavior
fixtures, affected lint, and the production build passed.

The operational fixture intentionally has no clinical database or extraction
worker: those optional services report unavailable there. It is evidence for
the exercised access/workflow paths, not a claim of complete production service
health. Authentication, Note Lab-only isolation, concurrency checks, historical
read-only records, and post-send finalization remain intact. No production
deployment, Entra changes, or real referral mutations were performed.

## Current: Fictional Referral Walkthrough (2026-09-20)

The current pass supersedes the live-referral selection behavior documented below.
Those sections remain as implementation history, not current instructions.

- Tutorials opens one complete referral walkthrough or a direct task shortcut.
- Referral tasks use `/tutorials/referral`, with a new browser-local Taylor Rivera
  sample. They never select or create a real referral. Existing live edits are
  flushed through the shell's save guard before leaving for the tutorial.
- Nine steps cover the Home board, intake, scheduling, assessment, signing,
  decision, email/packet, admission, and the resulting board. Each has one short
  instruction, a numbered step picker, and Back/Next step (Done at the end).
- `Show control` is now `Show me where`: scroll to and focus the highlighted
  control without activating it or changing a value.
- Scheduling, signing, decisions, and confirming admission use the existing
  component controls with local callbacks. Saving an appointment advances into
  the sample assessment. Signing advances to Decision.
- Jumping ahead supplies missing sample prerequisites; it does not replace edited
  answers, reverse a denial/under-review outcome, or claim that an email was sent.
- Intake and assessment edits are retained while moving between tutorial steps.
  Restart and page refresh restore the original fictional case. Closing returns
  to ordinary work, without setting any global demo/persona flags.
- File selection and labels stay in browser memory. Packet/email previews use
  the existing summary and email renderers; Simulate send sends nothing.
- Reports remains a role-restricted, read-only guide to the existing report UI.
  No new access is granted and this walkthrough does not award training credit.

Deliberate limits: this is application navigation help, not assessor competency
training or a replica of extraction, delivery, and audit infrastructure. The
sample intake reuses the real field and upload controls but shows the core intake
fields; it does not run OCR, create appointments on a server, upload documents,
or send emails. Revisit those boundaries only if a requested tutorial needs to
demonstrate their real server outcomes; do not connect this sample to production.

Focused evidence: `scripts/tutorial-referral-fixtures.test.mjs` and
`tests/e2e/tutorial-workflows.spec.ts` cover progression, reset, edit retention,
decision branches, file selection, no clinical mutation requests, role filtering,
return navigation, and desktop/tablet/phone layout. Production build and affected
component lint are also checked. No deployment is included in this pass.

## Earlier Passes

First implementation pass, 2026-09-19. Base: 991c9a279e848e49578131504d16c49d5bb92ba0.
Branch: codex/tutorial-workflows-20260919.

## Scope

Application-use walkthroughs only: where to click, what a control changes, how
to return, and how to recognize saved work. No assessment philosophy, clinical
instruction, language lab, or competency claims.

The existing Help entry is labeled Tutorials. Its menu groups related tasks
under four plain-language topics, plus role-filtered team/report tools.
Practice options are explicitly labeled. Existing /training routes still redirect home. No deployment,
activation of retired pages, real invitations, or email deliveries are included.

## First-Pass Catalog

| Entry | Context |
| --- | --- |
| Find my next task | Home and Workspaces |
| Find and reopen a referral | Workspaces, search, existing record |
| Start a referral | Separate practice intake |
| Schedule an assessment | Current referral |
| Use the assessment | Current assessment controls |
| Try the assessment controls | Fresh local synthetic case |
| Review and sign | Current assessment review; signature remains explicit |
| Decision and admission date | Current referral decision page |
| Add and open files | Current workspace Files |
| Check change history | Current workspace Activity |
| Preview the packet and email | Current Finish & send page |
| Use Calendar | Available calendar scope and views |
| Find a client chart | Clients and Workspaces |
| Check team work | Supervisor task navigation |
| Run a report | Role-filtered report controls |

These describe the current base commit, not a proposed future workflow. In
particular, signing, recording a decision, setting an admission date, and sending
are separate actions. No guide executes them for the user. Stage-specific controls
can be unavailable on a given referral; the guide says so instead of advancing
the referral or bypassing a permission.

## Behavior

- Workspace navigation preserves referral/draft identity and uses the existing
  workspace-location helpers. From Home, selecting a workspace guide highlights
  the Board and waits for the user's card selection. Workspaces is an alternate,
  not a forced detour. An unsaved intake stays open and help continues after the
  user creates it. Starting help rechecks the effective role.
- Navigation awaits the shell's existing save guard. A failed guard leaves the
  current page and step in place and reports the failure.
- Practice starts with a new draft identifier and never inherits a live referral
  identifier. Ordinary page destinations drop practice parameters.
- Scheduling advances on the existing successful-save event, not a raw click.
- Skipped steps and starts partway through a tutorial do not earn completion.
  Completion means the walkthrough was reviewed, not that a clinical task,
  assessment signature, or packet delivery happened.
- Existing role/access owners remain authoritative. Direct tutorial start events
  also check the effective user's role. Guides add no permissions.
- Progress stores step identifiers and timestamps, not field contents.
- Mobile assessment targets point to the phone controls; other layouts use the
  full assessment. Guidance occupies its own layout area instead of covering work.

## Second Pass: Contextual Task Guide (2026-09-20)

The floating modal and full-page scrim are replaced by a docked Tutorials rail.
Desktop reserves 352px beside the working area; smaller screens reserve a bounded
bottom area. Collapse reduces it to a slim rail or one-line bar. Scheduling stays
inside the working area while the tutorial is open; closing Tutorials restores
the ordinary layout. Native top-layer dialogs still take precedence.

Each step includes the action and expected screen result. The numbered outline
allows direct navigation without crediting skipped steps. Show control reveals
and focuses the actual target. Highlights clip to workspace scrollers and do not
cover the sticky folder header or assessment action footer. Guidance is opt-in,
can be closed immediately, and remembers its step without reopening on refresh.

Practice starts in a section with both recorded and unanswered information. Code
inspection and browser tests confirmed the existing synthetic assessment is held
in component state and resets on refresh. The new guide explicitly states this;
it does not promise persistent practice answers. Guide progress can resume, but
that is separate from practice answers and from live assessment autosave. No new
answer store, live save path, or production-data behavior is introduced.

Design references: [Scribe's step-by-step capture model](https://support.scribehow.com/hc/en-us/articles/8951146003741-New-User-Guide-Scribe-101)
and [NN/g's contextual-help guidance](https://www.nngroup.com/articles/onboarding-tutorials/).
The useful patterns here are task-sized instructions, an observable result,
context beside the work, and easy dismissal/re-entry. Pipeline uses live control
anchors instead of capturing client screenshots. It does not install Scribe or
send screenshots, field values, or PHI to an external service.

Deliberate ceiling: this pass documents expected outcomes; it does not claim to
verify clinical competence or every business action. Only already-supported
interaction/completion events advance automatically. Add new automatic checks
only when a canonical success signal exists and has a failure-path test.

## Earlier Menu Simplification (2026-09-20)

Historical pass; the task-helper changes below supersede the sample-first entry
and forced Workspaces selection described here.

The gray disabled list and search box are removed. Create a referral starts the
explicitly labeled sample intake. Schedule & assess, Decide & admit, and Find
work & files expand into short action labels, with only one group open at a time.
Team & reports appears only when the role catalog allows those guides. Each
existing guide appears exactly once; identifiers and stored progress are unchanged.
Repeated summaries and time/step estimates are removed from the menu.

A guide that needs a referral remains clickable from Home. It opens the existing
Workspaces directory, then starts on the referral the user selects. This uses
the same save guard and workspace identity resolver as other guide navigation;
it does not create a blank referral or change data. The user can cancel, close,
or choose a clearly labeled sample assessment instead. A canceled selection does
not survive closing the menu; resuming an already-started guide still does.

Deliberate ceiling: the menu has four core topics and one supervisor group, so
search adds unnecessary clutter. Reconsider search if topic lists grow beyond
the current six short actions in the largest group.

## Task Helper Revision (2026-09-20)

The guide is for getting unstuck in the application, not completing a course.
The Home entry is "Where do I go next?" and current pages offer relevant help.
Each guide has an explicit step picker, "I'm stuck here" instructions, and a
concrete next-action screen. "Next tip" advances the explanation, not the task.
"What next?" shows related help without claiming that a signature, save, decision,
or delivery occurred. Conditional controls disappearing do not block reading tips.

- Home Board cards are the first path to scheduling and ongoing work. Help
  follows whichever card the user selects, not only the first card, and waits
  for actual workspace navigation. Empty/filtered Board guidance points to the
  stage selector, alternate Workspaces search, or supervisor ownership check.
- Create a referral now accompanies real intake. Practice intake has a separate,
  explicit entry. Existing drafts are reused; practice never inherits a live ID.
  Pending scheduling help stays with an unsaved intake and starts on the same
  referral after the user creates it. The last intake tip also remains usable
  when creation removes its highlighted button; the next message recognizes the
  newly created referral rather than telling the user to create another one.
- Scheduling recognizes an already-open form and observes its opening only once.
  A failed save leaves both form and guide in place. The existing success event
  advances help; the guide itself never schedules an appointment.
- Recovery text names actual controls and provides relevant routes for files,
  saving, scheduling, signatures, decisions, admission dates, and packet delivery.
  Existing permission and save guards remain authoritative.
- Closing help leaves the working page intact. Going to the Board is explicit.
  Practice is still optional and resets according to the existing practice code.

Deliberate ceiling: next-step recommendations are curated per task, not a second
workflow-state engine. The app's actual status, controls, errors, and permissions
remain the source of truth. Revisit a recommendation when its workflow changes;
do not infer a completed clinical action from tutorial progress.

## Deliberate Limits

This pass reuses the existing coach, progress API, practice fixtures, and real
controls. It does not build a second simulated app or map tutorial clicks to the
retired clinical curriculum. Consequently new task guides have no curriculum
module mappings. Revisit that choice only if a separately approved nonclinical
curriculum needs those mappings.

Remaining dedicated guides: contact directory/import, extraction suggestions and
evidence review, profile settings, ownership reassignment, and save/conflict
recovery. Expand behavior-dependent decision/send guides only against the actual
next release, especially rescission and post-sign editing rules.

The old training readiness/certification scripts and operator-training.spec.ts
still encode the retired presentation, clinical chapters, and /training entry.
They are not acceptance evidence for this rebuild and have not been relabeled
as passing. Keep retired training routes disabled until the next scope explicitly
replaces those legacy contracts.

## Focused Evidence

Task-helper result: nine contract tests and twenty-five browser tests passed.
The production Webpack build (including TypeScript), focused ESLint, and diff
checks passed. Final desktop/phone screenshots were inspected, including the
real intake recovery panel, next-action screen, Board handoff, and scheduling.
Nothing was deployed or sent to the deployment task.

Task-helper checks additionally cover Home Board selection (including a second
card), real intake versus separate practice, pending help after referral creation,
successful and failed real appointment saves in the local test store, already-open
scheduling forms, and next-help navigation retaining the chosen referral.
Desktop/phone next-action screens have scoped accessibility and hover-contrast
checks. A double-advance on schedule opening was found and corrected during this
pass; it is not accepted as baseline behavior.

Menu-simplification result: seven contract tests and eighteen browser tests passed.
Desktop and phone menu screenshots were inspected. Scoped axe WCAG A/AA checks
passed for the expanded menu at both sizes. The Home-to-referral test verifies
the chosen referral ID and unchanged record contents, while allowing the app's
existing presence heartbeat. Cancellation and switching to a sample are covered.
The production Webpack build (including TypeScript), focused ESLint, and diff
checks passed. No deployment was performed.

Second-pass result: six executable contract tests and fifteen browser tests
passed. The production Webpack build, TypeScript, focused ESLint, and diff checks
passed. Desktop (1440px), tablet (1024px), and phone (390px/375px) screenshots were
inspected, including scheduling and the collapsed guide. This does not
certify every state of every authored guide or real email delivery.

- node --test scripts/tutorial-workflow-fixtures.test.mjs
- npx tsc --noEmit
- npx eslint on the changed tutorial modules and new browser test
- npm run build -- --webpack (isolated output directory)
- tests/e2e/tutorial-workflows.spec.ts: real Help entry, grouped menu, stage/context
  restrictions, desktop/phone highlights, practice reset, no live practice
  writes, skipped progress, preserved referral context, restricted-role event,
  continued /training redirect, non-overlapping work/guide areas, sticky-control
  highlight bounds, direct jumps, focus return, collapse, progress resume,
  scheduling form access, and practice edit/reopen plus refresh reset.

An exploratory test initially assumed practice answers survived a browser reload.
That failed on the existing training implementation, which recreates the synthetic
case on mount. The final acceptance tests explicitly cover both in-session answer
retention and the existing refresh reset; tutorial copy now explains the limit.

Tests use the repository's isolated local E2E stores and mock authentication, not
production client records. The worktree's shared node_modules symlink prevents a
Turbopack build; the Webpack production build is the verified build path here.
The first dev-server run also hit a node:crypto browser-bundle error; browser
evidence was collected from the successful production build, not that dev run.

Before release, replay these guides against the actual candidate and record
changed controls. This document is not a deployment instruction or approval.

Local preview: http://127.0.0.1:3391/ using mock authentication and isolated data.
Open Tutorials in the sidebar, or More > Tutorials on a phone. The practice
assessment walkthrough can start without an existing referral.

## Release integration (2026-09-20)

Updated anchors for the current Files uploader, section picker, and separate
email window. The packet guide finishes by opening that window; it does not put
interactive tutorial controls behind a native modal. Recipients, attachments,
and the separate confirmation/send action are explained before the preview.
The phone dock reserves more work space on short screens.

Release contracts now check the current Help entry, task guides, canonical
assessment controls, and reviewed-step completion rather than the retired
chapter UI. The existing four-step minimum is retained. Automatic advancement
is only required for actions with observed input or successful-save events;
reading a checkpoint is explicitly confirmed. Negative progress fixtures prove
that skipping or jumping cannot earn completion. Complexity limits are unchanged.

Integration evidence: all 20 focused browser cases passed (19 in the final
full pass plus the updated Files sequence in a focused rerun). This includes
phone practice editing at 375×667, desktop/tablet/phone layout checks, and opening
and closing the email preview with zero send requests. The seven state/navigation
fixtures, source/route contracts, production Webpack build, scoped lint, and
unchanged complexity ratchet passed. This verifies guide behavior, not live
email delivery or clinical competence.

## Task-helper production integration (2026-09-20)

Integrated the task helper with production a0d921e, preserving the current Files,
signing dialog, admission follow-through, and separate email preview. The Home
Board walkthrough retains four checkpoints, including keeping updates in the
selected workspace. Recovery copy and rendering reuse small local helpers;
existing complexity ceilings remain unchanged. The catalog contract now includes
the separate practice-intake guide, and completion contracts assert the new
next-action screen while retaining skipped-step and premature-finish checks.

Integrated evidence: production Webpack build and TypeScript, scoped ESLint,
nine state/navigation fixtures, training source/route contracts, and the
unchanged complexity ratchet pass. All 27 focused browser cases pass: 26 in the
full run plus the Board case after updating its expected fourth checkpoint.
Coverage includes desktop/phone help, actual local appointment save/failure,
referral handoff, preview with zero sends, and scoped accessibility. The Board
next-action screenshot was inspected. No production records were used.
