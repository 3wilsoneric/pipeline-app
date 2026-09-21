# Assessment conversation: local review only

User authorization: implement and test locally; queue for a later deployment. Do not
include this branch in the current deploy-all release without new deployment authorization.
Base: `10f9061ecd320368bc7c65d723219f8da3308ad0`.

## Behavior

- The same folder and reading layout offer **Prepare from records** and **Interview**.
- Preparation reuses the canonical five document-friendly groups and conditional questions.
  It is a filtered view of the assessment, not a second form or answer store.
- Existing entry links retain their interview behavior. The mode control is explicit:
  switching views does not infer that an appointment has begun or finished.
- The preparation footer continues to the first conversation section needing an answer
  or verification. The mode control instead preserves the current topic for quick revisits.
- During desktop/tablet editing, the reference keeps the previous answer until the input
  loses focus. The updated answer receives a short highlight, disabled for reduced motion.
  The question remains in place for the current section visit.
- Phone preparation uses the existing focused questionnaire and reference sheet. Closing
  the sheet returns to the current question. Conditional answers and unknowns are retained.
- The reference displays existing source provenance and keeps pending verification visible.
  Neither a nonempty field nor an accepted extraction is labeled client-confirmed.

## Boundaries

No database, API, lifecycle, clinical schema, workbook mapping, signature, or email changes.
The existing autosave/recovery path remains authoritative; reference presentation is not
a persistence acknowledgment. Excel contracts still cover 162 fields and 44 conditional parents.

Mode choice is local component state, matching the existing notebook behavior. If restoring
the chosen mode across sessions becomes a requirement, extend the canonical workspace route
rather than adding a separate persistence store.

Existing provenance distinguishes source documents, manual entries, and workbook restores;
it does not attest that a particular answer was confirmed with a client. If per-answer
confirmation is required, extend the canonical provenance/audit and workbook contracts first.
Do not infer confirmation from the selected mode or an interview timestamp.

## Verification and release hold

Final focused run: **53 passed**. Browser coverage: `assessment-conversation`, `assessment-gap-flow`,
`assessment-open-book`, `assessment-phone-interview`, `assessment-preparation`, and
`assessment-working-view`. Includes Chromium/WebKit phone exercises, desktop/tablet
layouts, source review, conditional answers, keyboard/reference interaction, immediate
navigation, reload persistence, and no implicit start/signature.

Executed against an optimized local build with `PIPELINE_DESKTOP_E2E=true` using the
standard isolated Playwright stores. An earlier 51/53 run exposed two outdated signing
click paths, corrected below without removing assertions. Initial runs against the
persona preview are not persistence evidence: its active assessor directory differs
from the test fixtures. The final run used the standard test server, not that preview.

The older open-book signing test now enters **Review assessment** before signing, matching
the already-approved release behavior; its answer-persistence and signature assertions remain.

Repository audit, guidance/setup gates, TypeScript, focused lint, workbook and assessor
workflow contracts, and the optimized build were exercised. `certify:refactor` stopped at
Developer Academy reviewed-source fingerprint freshness. Full release certification is
not claimed: review/refresh that evidence and rerun release gates on the later integration
candidate. No assurance thresholds or generated baselines were changed.

Synthetic local preview: `http://127.0.0.1:3385/`. No live data or email configuration used.

## Follow-up: secondary backup and recovery path

Excel download and drag-and-drop now live under **Details > Backup & recovery**,
alongside the canonical save/sync status. No Excel strip occupies the questionnaire.
The small footer save indicator, errors, and remote-conflict choices stay visible;
no persistence, encryption, retry, workbook mapping, or conflict policy changed.
The existing import preview still requires explicit commit. Cancel returns to the
tools panel; closing that panel preserves the assessment question and restores focus.
Template preloading remains mounted so moving the controls does not break offline export.

The panel uses native modal dialogs and the existing workbook component rather than
a new route or answer store. This deliberately does not provide a global recovery
dashboard. Revisit routing only if recovery across multiple assessments is requested.
Short-screen touch spacing was tightened after a landscape test exposed a clipped answer.

Follow-up optimized-build run: **31 passed** across Excel backup, recovery, workbook
provenance, offline reconciliation, conversation, and footer suites. Includes Chromium
phone/landscape and iPad WebKit interactions. The phone recovery-panel axe scan reported
no WCAG A/AA violations. TypeScript, focused lint, complexity, repository audit, and
guidance/setup gates passed. `certify:refactor` again stopped at the reviewed-source
fingerprint freshness check; the release hold above remains in force.

## Follow-up: one labeled document intake

Documents and Files now use one shared multi-file drop/picker. A native dialog asks
for a canonical document type per file before any upload or extraction can start.
Filename suggestions are editable; unknown files require a choice. Signed agreements
are never inferred from filenames. Cancel and removing a modal row are neutral.
The checklist is a collapsed status list, not eight competing upload controls.

Confirmed labels travel through the existing upload API and server-side evidence
reconciliation. The first explicitly labeled face sheet/combined packet can establish
the primary document; subsequent uploads do not silently replace it. Multiple files
of the same type retain their individual bytes and names. The encrypted local draft
now serializes each queued file's category, validates it on recovery, and still reads
prior on-device copies without category metadata as Other. Queued files can be removed
before upload; in-flight uploads cannot be removed from their queue.

An intake loading-time edge case surfaced during testing. Its native fieldset now
stays disabled until recovery completes, in addition to the existing inert overlay.
This prevents typing from racing initialization. Stored-file editing permissions,
API contracts, data model, lifecycle, signature, and email behavior are unchanged.

Pipeline workbook selection is a separate route through the same labeling dialog.
With an existing assessment it opens the canonical import preview, including identity,
mapping, conflict, read-only, and explicit-commit safeguards. Before an assessment exists,
the dialog explains the required route instead of uploading the workbook as clinical
evidence. Mixed workbook/document batches must be separated. A filename only suggests
the route; the existing workbook parser remains authoritative about its contents.

Boundaries: automatic document extraction remains disabled by the existing
`referralDocumentAutofillEnabled` flag. No OCR rollout is claimed. Correct labels before
adding files; an already-stored file does not yet have a relabel operation. If post-upload
reclassification is requested, implement an authorized, audited metadata mutation with
checklist reconciliation and explicit local/PostgreSQL parity, not client-only labels.

Final optimized-build run: **21 passed** in `test-results/document-labels-complete`:
`intake-file-drop`, `referral-file-batches`, `attachment-only`, `referral-workbook-upload`,
and `assessment-excel-backup`. Includes original-byte/category checks after draft reload,
same-category batches, cancellation/removal, read-only blocking, Chromium/WebKit phone
dialogs, iPad workbook flows, and two clean WCAG A/AA modal scans. The encrypted recovery
fixture, TypeScript, focused lint, and complexity checks also passed.

Earlier attempts exposed the corrected intake initialization race. One intermediate
Excel snapshot test failed, then passed three isolated repeats and both subsequent
combined runs; retain that timing-sensitive test as a release regression guard. One
intermediate upload run hit ECONNRESET; the final run passed without retries.
Upload-related selectors and tutorial copy were migrated to the confirmation step;
the entire wider test suite was not executed. The client-workspace source contract
still fails its unchanged unassigned-file-only-access string check. Full certification
continues to stop at Developer Academy source freshness; do not change its baselines
merely to turn the gate green. No production deployment or external service enabled.

## Follow-up: preparation before Begin assessment

The two-way preparation/interview switch is superseded by a sequential flow. Unsigned,
unstarted assessments open the five existing record-preparation groups. A visible
Begin assessment action (also at the end of preparation) opens the existing confirmation
dialog. Confirming uses the canonical start endpoint, then opens the first conversation
section with unresolved questions. Already-started and signed assessments do not return
to preparation on reload. Both phases still edit the same assessment and retain source
verification, conditional questions, signature rules, and chart navigation.

The phase indicator is informational, not another set of tabs. During interview the
reference follows the current section, remains editable, and updates after answers are
committed. Section changes now commit the focused answer before unmount, just like phone
layout/mode changes. Touch Begin gives the native dialog a concrete focus-return target.

If saving the start fails, the confirmed action still opens the interview in this mounted
session. A visible warning and Retry start time action remain until a server-confirmed
start exists. No fictitious timestamp is saved. Deliberate ceiling: start requests are
not a new offline mutation type; a reload before successful retry returns an unstarted
record to preparation, while existing answer recovery remains authoritative. If durable
offline encounter-start timing is required, add it to the canonical lifecycle queue with
idempotency, original-time semantics, and local/PostgreSQL evidence rather than browser
flags masquerading as a clinical event.

This is a bounded product-flow change, not an approved structural refactor. Deployment
remains held. Repository audit, guidance/setup, TypeScript, focused lint, and complexity
checks passed. Full certification again stops at Developer Academy reviewed-source
freshness; no assurance baselines were relaxed.

Final optimized-build run: **48 passed** in `test-results/assessment-flow-verified`
across conversation, preparation, working-view, footer, footer-layout, and phone-interview
suites. Coverage includes desktop/tablet/phone, iPad WebKit focus, conditional questions,
same-record persistence, source verification, failed-start continuation/retry, answer
recovery, and clean accessibility scans. A delayed recovery response previously could
restore an older section after the assessor had navigated elsewhere. Recovery now
restores position only if navigation has not advanced since that read began; recovered
answers still merge through the canonical path. The delayed-response regression passed.
Earlier failures exposed that race, focused-answer commit on section changes, and
touch focus return; the final combined run passed without retries. The wider operational
suite was not run. Local preview on port 3385 responds successfully; nothing was deployed.

## Follow-up: handoff overview and email preview

Finish & send now leads with the canonical signed-assessment handoff, with medication
and injection information followed by behavior/safety, arrival, daily support, and
billing. The side summary shows signature, acceptance, recipient count, attachments,
and existing delivery blockers. Unsigned assessments retain a clear review/sign route;
the UI does not invent a signed summary. Duplicate dietary labels are consolidated
for display from the same summary data, not a second clinical model.

Preview email opens a native modal with From, the existing editable To/Cc chips,
subject, packet attachments, and the unchanged sandboxed email preview. The modal
fills the phone screen and uses a bounded window on desktop/tablet. Send confirmation
and send results remain outside the scrolling message area. Close/Escape return focus;
closing is blocked while a send is pending. Opening, closing, and reopening never sends.
Reopening or changing recipients clears confirmation. Example-only, authorization,
recipient persistence, version checks, idempotency, packet inventory, and provider
acceptance semantics remain owned by the existing send path. No mail was sent.

Review & sign has a readable document width, larger labels/answers, a compact assessor,
date, and recorded-answer overview, and an expandable list linking directly to sections
with unresolved items. Signing and subsequent decision navigation are unchanged.
Signing errors now stay beside the persistent action rather than above a long record.

Deliberate limits: the email body/subject remain generated, not independently editable;
corrections go through the chart. If custom email copy becomes a requirement, introduce
an authorized, versioned and audited message draft before allowing it to diverge from
the clinical source. The iframe keeps its existing sandbox and independent scrolling;
no same-origin/script permission was added to resize or manipulate its document.

This is a bounded UI behavior change, not structural refactoring. Repository audit,
guidance/setup, TypeScript, focused lint, and the complexity ratchet passed. Full
certification remains stopped at Developer Academy source freshness; release baselines
were not relaxed. Local preview remains on port 3385; no deployment was performed.

Final regression run: **37 passed** in `test-results/handoff-polish-confirmed` using
the verified production build. Covers the 21 email/review/handoff cases plus assessment
conversation and footer regressions: phone to desktop layouts, iPad WebKit, recipient
persistence and 18-person lists, explicit confirmation reset, unsigned/sent states,
version-conflict recovery, pending-send navigation lock, signing failures and complete
synthetic intake-to-handoff journeys. Main overview and modal WCAG A/AA scans passed.
Screenshots were inspected at desktop and phone widths. No provider email was sent.

Earlier runs caught low-contrast contact metadata and a contrast scan taken during the
modal opening animation. Contact text is darker; the modal now moves without fading
its text, and the scan waits for active animations. One wider WebKit menu test pressed
Enter during workspace restoration; it now asserts the canonical recovery-ready state
before acting and passed three isolated repeats plus the final combined run. A first
cold-load assertion timed out once; subsequent combined runs passed that case without
retries. The wider repository suite was not run and full certification is still held.

## Follow-up: decision hierarchy and outcome-specific continuation

Local only. The decision page now has a wider reading area, distinct Accept / Deny /
Under review choices, a readable note field, and a contextual client/assessment column.
The current assessment state is shown without assuming it has been started or signed.
The generic stage-forward action is now inside Admission details, not competing with
the placement decision. Administrative stage changes and their existing safeguards
remain available; this is not a change to the backend lifecycle.

Recorded acceptance reveals the optional admission date and packet-preview action.
Deny and Under review do not present an admission handoff. An unchanged saved Under
review no longer offers a redundant save button; editing its note restores that action.
Recording acceptance/denial moves keyboard focus to the saved result. Read-only accounts
cannot edit the decision note. Existing confirmations, version checks, audit mutations,
failed-save recovery, signature requirements and example-only email behavior are retained.

Validation: production build and focused lint passed. **14 tests passed** in
`test-results/decision-refinement-final`, covering 320/390/834/1440px layouts, WCAG A/AA
scans, cancellation, acceptance, denial, Under review, reload persistence, read-only
presentation, keyboard focus, full intake-to-handoff journeys and failure recovery,
including iPad WebKit. Desktop/tablet/phone screenshots were inspected. The updated
page was also verified in the port 3385 in-app preview without changing referral data.
No email or deployment occurred. The wider repository suite was not run for this pass;
the owner's current bounded-change policy supersedes historical mandatory audit rituals.

## Follow-up: Home folder expansion and outcome visibility

Local only. Each board stage now lifts slightly on hover and expands from its own
header/background into a near-full-screen folder. Existing individual file clicks
still open the workspace directly. The expanded folder shows every supplied stage
file in a non-overlapping, scrollable grid; phone uses one column and the full screen.
One close control, Escape, or desktop backdrop returns to the source folder with focus
restored. Reduced motion skips the transition. Scrolling inside a folder cannot turn
the Home carousel, and resizing keeps the selected stage visible. Finished referrals
uses the same folder treatment instead of a separate plain disclosure list.

Outcome behavior remains: Under review stays active, accepted work stays in Decision,
and denied referrals / recorded admissions are available under Finished referrals.
An active later reassessment remains current work. Fixed a Home projection gap where
accepted work disappeared after its tasks were complete but before admission was
recorded. This only retains the file on the existing owner-scoped board; lifecycle,
active-task totals, authorization, mutations and audit events are unchanged.

Validation: production build, focused ESLint and diff checks passed. **21 tests passed**
in `test-results/home-folder-final`, covering 320/390/834/1440px layouts, ten-file
folders, WCAG A/AA scans, focus return, nested-dialog Escape, reduced motion, resize,
iPad WebKit touch, and unchanged card destinations. A real-API acceptance-to-admission
regression reproduced the missing board file before the fix and passes afterward.
Desktop and phone screenshots were inspected; opening/closing was also verified in
the port 3385 in-app preview without changing referral data. No deployment or email.
The wider repository suite was not run.

Deliberate limit: expansion reuses the board's existing authorized dataset and load
ceiling, with no extra request or pagination layer. Revisit server-side paging if
measured stage sizes make this full-list rendering slow; do not silently truncate files.

## Follow-up: expanded folder materials and hierarchy

Local only. Expanded board folders now have a shaped, stage-colored jacket, raised
paper label, file count and folded lower rim rather than a rectangular modal header.
The interior is neutral paper with a shallow spine crease. Client files have larger
name tabs, layered paper edges, restrained lift/shadows and readable metadata without
the boxed four-cell appearance. These treatments are scoped to the expanded folder;
collapsed stacks, destinations, lifecycle and data loading are unchanged. Phones use
a compact label bar and single-column reading surface instead of the desktop tab shape.
The existing native dialog, close control, focus return and reduced-motion behavior
remain in use. No image assets, dependencies or new navigation controls were added.

Validation: production build and focused lint passed. The 21-test Home suite passed
in `test-results/home-folder-design`; the additional stage-color/long-label/high-contrast
case passed in `test-results/home-folder-materials`. Desktop, tablet and phone layouts,
ten-file contents, WCAG A/AA, iPad WebKit touch and lifecycle checks are covered.
Screenshots were inspected at desktop and 320px, including long names, Decision and
forced colors. The expanded folder is also verified in the port 3385 in-app preview.
No deployment, client-data edits or email occurred; the wider repository suite was not run.

## Follow-up: cleaner expanded folders and explicit collection target

Supersedes the preceding material-heavy visual treatment, which the owner rejected.
Expanded folders now borrow the app's clean white surfaces, soft depth, restrained
stage accents and translucent header treatment. Removed the cardboard jacket,
beveled label frame, paper seams and oversized lip; retained the tab silhouette and
readable client information. The collapsed client-file design remains unchanged.

The entire stage header is now an 82px-high native button spanning the column, with
the stage name, file count, visible View all cue and expand icon. The redundant stage
number stamp is removed. Existing background/rim clicks still expand the collection;
client clicks still open that client's workspace. Finished referrals also shows the
expand icon. No lifecycle, data-loading or authorization changes in this pass.

Validation: build, focused ESLint and diff checks passed. **22 tests passed** in
`test-results/home-folder-modern`, including full-width hit-area assertions and clicks
at the control's far edge at 320/390/834/1440px. Ten-file layouts, WCAG A/AA, iPad
WebKit touch, long labels, stage accents, reduced motion, nested dialogs, focus return
and the real-API acceptance/admission regression pass. Desktop and phone screenshots
were inspected, and local in-app opening/closing was verified without editing data.
Local preview remains on port 3385. Nothing deployed; the wider suite was not run.

## Follow-up: aligned acrylic Home trays

The outer Home carousel now uses a translucent edge treatment, recessed white
content surface, contact shadows and three aligned tray rims. Attached selector
tabs replace the floating segmented pill; selection moves the existing panels
with a short 420ms depth transition. The Home background is neutral rather than
warm green/beige. No images, dependencies, extra buttons or data changes. Existing
client folders and expanded collections retain their own styling and destinations.

The active tray still owns page height for five-to-ten-file vertical stacks.
Background content stays inert and visually hidden. Reduced motion, forced colors,
keyboard tabs, swipe cancellation and normal vertical scrolling remain supported.
At 320px the tab counts sit below labels instead of crowding them.

Validation: production build, focused ESLint and diff checks passed; all 22 Home
carousel tests passed in `test-results/home-acrylic-tray-final`. Added label-bound
checks and WCAG A/AA/touch-target checks for all three foreground panels. Inspected
desktop, iPad, 320px and high-contrast screenshots, and switched trays in the local
in-app preview. Local only on port 3385; no deployment or client-data edits.

Color follow-up: increased the outer tray's sea-glass tint, with distinct slate-blue
and muted copper rear layers, against a neutral gray Home canvas. Reading surfaces
stay white and client-folder colors are unchanged. Build and five focused visual/
accessibility checks passed in `test-results/home-tray-color`; inspected desktop,
320px and the local in-app preview. No layout, motion, workflow or data changes.

Superseding material correction: the owner rejected reusing the folder palette.
All outer trays now share smoked graphite with silver edge reflections and neutral
shadows. Removed module-specific shell and selector colors; only the selected tab
uses emerald. Colored stage folders and warm client files are unchanged. Build,
focused lint and five visual/accessibility checks passed in
`test-results/home-graphite-tray-final`; desktop and 320px screenshots inspected.
The new shared-material assertion initially ran before Home loaded; it now waits
for exactly three tray panels before comparing them. Local only, no data changes.

Owner-requested rollback: removed the entire acrylic/graphite carousel experiment
and restored the pre-pass plain, lightly stacked panels, original selectors and
Home background. Removed tests specific to that discarded treatment. Earlier
folder designs, expansion targets, dialog gesture protection and workflows remain.
The preceding material/color entries are historical, not the current design.

Navigation follow-up: Home selectors are three separate rounded navigation buttons,
white at rest with an emerald active state and small count badges. Phone labels are
Board / Upcoming / New; full accessible labels remain unchanged. Plain carousel and
folders are untouched. Build, lint and five responsive/keyboard checks passed in
`test-results/home-nav-buttons`; desktop, 320px and in-app visuals inspected. Local only.


## Follow-up: contextual Finish & send hierarchy

Local only. Replaced the handoff sidebar and detached action list with a three-step
progress row and a single prominent next action: review/sign the assessment, review
the admission decision, then preview the email and packet. The next action comes
from the existing signed-report and admission eligibility flags. Preview remains
available before prerequisites are complete; the clinical record, file management,
recipient editing, explicit send confirmation, draft recovery, navigation guards,
and delivery behavior are preserved. Close workspace is now a secondary control.
The phone header is compact so the primary action stays above the sticky footer.

Validation: production build (including workbook contracts and TypeScript), focused
ESLint, and diff checks passed. All **24 tests passed** in
`test-results/handoff-flow-verified`, covering 320/390/834/1280/1440px previews,
state-dependent action destinations, full primary-button visibility above the footer,
WCAG A/AA scans, keyboard focus return, recipient draft recovery, explicit send
confirmation, send failure recovery, recorded sends, navigation while sending, and
iPad WebKit touch. Desktop and phone screenshots were inspected; the running Chrome
preview on port 3385 was also visually checked. An initial test run hit the build
startup timeout; the build was completed separately. A lost status role was restored,
and an incorrect new footer test locator was corrected before the passing final run.
No live data or email was changed; no deployment or full repository audit was run.

Scope limit: this is next-step guidance using existing server readiness, not a new
workflow gate. Delivery configuration and attachment blockers remain visible through
the existing details and composer. Revisit the three-step presentation if the server
introduces an additional operator-resolvable handoff prerequisite.


## Follow-up: one task at a time in Finish & send

Supersedes the preceding contextual-hierarchy presentation after owner feedback
that it still offered too much prose and too many competing choices. The Finish
page now offers only assessment review until signed, then only Decision until
acceptance, then the client summary with a single sticky Preview email action.
Removed the extra progress strip, overview file controls, premature preview, and
Back to decision/Close workspace footer. Existing workspace stage navigation remains
available. Client identity stays in the header; clinical summary content is unchanged.

Packet repair belongs inside email review and is shown only when attachment readiness
fails: Add admission packet when only the generated chart is present, otherwise
Review packet files. Healthy packets have no file-management action. Demo review has
an explicit Done reviewing action that leads to Close workspace; actual sends use
the recorded/provider-accepted result. Neither demo review nor preview marks an
email sent. The completion screen focuses its Close workspace button and retains
email inspection under a disclosure. Closing still uses the existing flush/recovery
handler; send authorization, recipient confirmation, idempotency, and pending-send
navigation guards are unchanged.

Validation: build (including workbook contracts), TypeScript, focused ESLint, and
diff checks passed. All **25 tests passed** in `test-results/handoff-guided-final`.
They cover exactly one visible action per task, blocked premature preview, stage
navigation, keyboard focus on completion, packet repair, normal packet controls,
320/390/834/1280/1440px layouts, WCAG A/AA scans, recipient recovery, explicit send
confirmation, failed and recorded sends, pending-send navigation, and iPad WebKit.
Accessibility scans wait for the actual page and its finite entry animation before
measurement; no contrast assertions were relaxed. Desktop and phone images were
inspected and the current port 3385 Chrome preview was checked. No live data edits,
email delivery, deployment, or full repository audit were performed.

Scope limit: demo review completion is local UI state and resets when the workspace
is reopened; no new persisted workflow stage was introduced. Revisit persistence
only if cross-session demo review progress becomes a product requirement.

## September 21: creation handoff and deliberate scheduling

After a new referral and its queued files finish saving, the intake becomes the
chart and a Workspace created dialog offers Schedule assessment or Prepare from
records. Dismissing it leaves the existing workspace tabs available. The handoff
is an in-session completion prompt, not a new persisted workflow stage; reopening
an existing workspace does not replay it. Scheduling reuses the canonical
assessment draft and schedule endpoint and stays separate from Begin assessment.
The shared appointment UI is a centered desktop dialog and a full-height phone
dialog, with scrollable fields and reachable actions. Preparation exposes booking
directly rather than burying it in Details.

The actual interview date no longer appears among client questions. Begin
assessment initializes a blank date using the recorded start in Pacific time;
existing historical dates are preserved. The shared local/PostgreSQL patch owner
records the field change in the same audit/version operation as the start.
Details > Interview date and chart field editing use the existing answer editor,
provenance review, autosave and recovery paths. Canonical schema and Excel cell
mapping are unchanged. Booking never supplies the actual interview date.

Validation: production build including workbook contracts, focused ESLint and
diff checks passed. All 41 affected browser cases passed across
`test-results/creation-handoff-verified` and the corrected WebKit-menu rerun in
`test-results/creation-handoff-webkit`. Eight scheduling API boundary fixtures
also passed. Coverage includes creation choices, cancel/retry, persistence,
historical dates, audit fields, optimistic concurrency, phone/iPad layouts,
keyboard focus, accessibility, calendar operations and answer recovery. Desktop
and phone screenshots were inspected; port 3385 was checked in the in-app
browser. Test data used isolated local storage. No production deployment, email
delivery or PostgreSQL integration run was performed.

## September 21: distinct preparation and interview surfaces

Preparation now presents all applicable record-based questions in one editable
form. Filled answers remain in place when changing groups or reopening the
assessment; there is no duplicate reference column while preparing. Begin
assessment remains the explicit, confirmed transition. During the interview,
the same canonical answers populate Current information alongside questions
still needing an answer, verification or an unable-to-assess reason. Reference
edits and newly revealed conditional fields retain the existing save owner.

A shared section picker now names both columns instead of using an emerald
block above only the question side. Section position, recorded counts and a
thin progress line replace the previous unfinished-count badge. Paper surfaces,
readable answer typography and restrained dividers keep the folder language.
The reference page turn moves subtly without fading its text: diagnostic scans
found transient contrast failures in the previous opacity animation.

Phones use the scrollable record form before Begin and the existing focused
question/swipe experience after it. Preparation instructions scroll away;
group navigation and save/details remain reachable. Keyboard section changes
focus the shared picker. No schema, Excel mapping, persistence or authorization
rules changed, and source provenance is not presented as client confirmation.

Scope ceiling: preparation is still a curated view of the canonical assessment,
not a separate snapshot or a new clinical confirmation state. Revisit that
model only if explicit per-answer interview confirmation becomes a requirement.

Validation: build (including workbook contracts), focused ESLint and diff checks
passed. All 47 affected checks passed in
`test-results/assessment-reference-complete`, covering preparation persistence,
explicit start/cancel/retry, conditional questions, source verification, offline
save recovery, immediate navigation, keyboard focus, reduced motion, contrast
at the start of the page-turn animation, 320-1440px layouts, phone Chromium and
WebKit, and iPad WebKit. Desktop and phone screenshots were inspected and the
updated port 3385 practice view was checked in the in-app browser. Isolated test
stores were used; no production deployment or email delivery was performed.

## September 21: deliberate entry and return

"Assessment prep" replaces "Prepare from records" and "Open questionnaire" at
the entry points. Appointment date/time (Pacific), Edit, and Begin assessment
now sit together. Scheduling still books only the appointment; confirming Begin
records the actual interview date and start through the existing save owner.
An unplanned interview can still begin without booking an appointment first.

Home appointments have explicit Begin, Resume, or Review actions. Begin opens
the existing confirmation, never starts from a click on the Home card alone.
Resume restores the last assessment section when available; otherwise the
existing missing-question/recovery behavior applies. Entry requests are
transient UI state, not persisted resume destinations. They recheck the loaded
assessment and edit permission, so an outdated Begin card does not restart an
already-started interview. Scheduling-queue actions open the booking dialog.

Local-only verification: 39 focused tests passed in
`test-results/assessment-entry-complete`, including actual schedule/start APIs,
leave/cancel/reload/resume, a stale Home action, start failure/retry, existing
historical dates, keyboard/contrast checks, phone and iPad layouts. The final
phone Home adjustment stacks the action below the client name; all 8 targeted
Home/return checks passed in `test-results/assessment-entry-mobile-final`, with
the rebuilt phone screenshots inspected at 320px and the scheduled header at
390px and 1440px. Focused ESLint and diff checks passed.
No assessment schema, database migration, email delivery, or production
deployment was added in this pass.

## September 21: centered confirmation prompts

Replaced the app's browser confirmation calls with a small confirmation variant
of the existing HomeDialog. Prompts use the Pipeline paper/emerald palette,
center in the viewport, and name the pending action instead of using OK. The
shared hook cancels pending work when its screen unmounts and rejects duplicate
requests. Cancel, Escape and backdrop dismissal never approve an action.
Signing explicitly focuses its trigger before opening, following the existing
Begin assessment pattern so Safari can restore focus after cancellation.

Converted signing, decisions/admission/EHR handoffs, calendar outcomes and
unsaved follow-ups, contact-list replacement, contact removal, identity review,
and file restoration. Existing inline errors stay with their fields; no native
alert calls were present. Browser tab-close/reload warnings still use the
browser's required beforeunload mechanism, whose appearance cannot be styled.

Validation: production build with workbook contracts, TypeScript, focused
ESLint and diff checks passed. Fifteen browser checks passed in
`test-results/confirmations-verified`, plus the isolated contact-list
cancel/conflict/reload check in `test-results/confirmations-contact-lists`.
Coverage includes 320–1440px positioning, Chrome/WebKit, accessibility, keyboard
and pointer cancellation, focus return, single signature submission, retained
answers, decisions, calendar edits, contacts and file restoration. Desktop and
phone screenshots were inspected. The older contact journey setup now dismisses
the existing Workspace created dialog before editing; the new fixture uses a
valid owner value. These setup failures were separate from the Safari focus
issue repaired above. No production deployment or email delivery was performed.

## September 21: compact, persistent gap flow

This supersedes the earlier all-fields preparation behavior above. Both prep
and interview now filter completed answers on section reentry or reopening.
They derive gaps from the same current assessment data, conditional questions,
pending verification, and missing unable-to-assess reasons. Zero is a valid
answer; clearing an answer restores its question. No separate progress cache,
time-based reset, schema change, or new save owner was introduced.

Prep's existing recorded count opens completed answers in a native popover;
selecting an answer closes it and focuses that question for correction. The
interview retains its Current information reference. Redundant editor headings
and instructions were removed, section navigation is compact, and short grid
rows no longer stretch into blank header space.

Deliberate interaction limit: edited questions stay put during the current
section visit so autosave cannot move the next pointer or keyboard target.
The form contracts on return; it does not automatically skip completed sections.
Revisit this only if user testing establishes a need for an explicit compact-now
action. Existing completed sections remain available for review and correction.

Validation: build, focused ESLint and diff checks passed. All 60 focused checks
passed in `test-results/assessment-gaps-complete`, including repeated real-API
save/reload/correct/clear cycles, prep-to-interview continuity, conditional fields,
verification, offline replay and late recovery, explicit start/resume, keyboard
focus, contrast, and 320-1440px layouts. The short-phone recorded-answer popover
was checked for clipping and Escape dismissal. Desktop/phone screenshots were
inspected, and the local in-app browser was checked. Repeated visits were tested;
this was not a multi-day soak test. Isolated test stores only; no production
deployment or email delivery.

## September 21: local workflow and interruption check

The check uses synthetic referrals in the isolated Playwright local-file stores,
not the operator's port 3385 data. It exercises browser file drops, labeling,
original-byte downloads, duplicate selections, same-name/new-content revisions,
pending-draft recovery, assessment conditions, Excel mapping and restoration,
conflict handling, scheduling, signing, decisions, and the example email preview.

Upload, Excel, recommendation, and signing failures use neutral, readable notices
instead of red text blocks. Alert semantics and retry controls remain. The compact
workspace failure message is now 14px rather than 10px; successful saves remain
quiet. Clinical status colors and destructive-action confirmations are unchanged.

The new resilience tests simulate a committed upload whose response is lost,
followed by another failed file in the same batch. Retry must preserve original
bytes, upload only the remaining file, and avoid duplicate records. Another test
loses an assessment save response and verifies mutation-ID reuse, exactly one
audit update, and preservation of the next answer through navigation and reload.

One later repetition exposed an intermittent first-entry loss before any PATCH.
It did not recur in 28 traced pre-change repetitions. Inspection found that the
selected assessment's initialization could reset answers in a passive effect
after editable fields painted. Initialization now runs in the existing layout
phase, before interaction; asynchronous recovery still preserves touched fields.
A focused test enters an answer on the first focusable frame and checks both
the saved record and the reference panel. A subsequent fast-navigation failure
also exposed passive state-to-ref synchronization as a stale-answer window. The
selected record, draft, dirty-section and remote-change refs now synchronize in
the same layout phase, rather than after interaction. The 18 affected preparation,
upload and interruption checks passed three consecutive runs (54 cases) against
the rebuilt candidate. This closes the inspected timing windows, but passing
tests are not proof that every timing failure is eliminated.

Older test setups now explicitly start interviews when they require interview
sections, dismiss the Workspace created modal before editing, and follow the
current decision-status/email-preview controls. Save, conflict, provenance,
signature, and no-send assertions remain; thresholds and release checks were not
relaxed.

The artificial phone file-drop test now waits for packet readiness before
dispatching a native drop event. Unlike a user's interaction, programmatic event
dispatch bypasses the uploader's disabled state during draft recovery. The
read-only rejection test remains separate and unchanged.

Final evidence: all 129 cases passed in `test-results/workflow-check-complete`,
after 54 repeated cases passed in `test-results/workflow-race-fixed`. The final
run includes name propagation, chart consistency, conditional questions,
preparation/re-entry, phone/iPad WebKit, Excel recovery and conflicts, complete
intake-to-unsent-handoff journeys, and the new interruption regressions. Build,
focused ESLint and diff checks passed. Desktop/phone failure screenshots were
inspected, and port 3385 responded successfully. Test-generated TypeScript
include paths were removed. These results apply to the built workflow candidate;
concurrent settings/header edits made after that build are outside this evidence.

Scope limit: automatic referral-document extraction remains disabled. These
checks prove attachment storage and mapped-workbook handling, not OCR accuracy.
Live email delivery, Azure blob durability, and PostgreSQL capacity/recovery
were not exercised. No production deployment was performed.

## September 21: phone and iPad check

Checked the assessment at narrow phone, portrait/landscape phone, iPad portrait
and landscape, and 507px tablet-window sizes. The appointment modal was retaining
the full layout-viewport height when the keyboard reduced the visible viewport.
Its shared overlay now owns the existing `useMobileViewport` hook, including
calendar portals outside the application shell. The title, focused input and
footer remain inside the visible area. Removed the obsolete fullscreen-dialog
CSS selector. Phone landscape also hides the completed prep/interview progress
row, as portrait already does, and removes excess paging padding; touch targets
and start-time retry messages remain available.

The existing mobile checks needed two fixture repairs: explicitly begin an
interview before testing interview controls, and scope the New navigation label
to its button so it cannot match a notification badge. Neither changed product
behavior or relaxed the assertions. New WebKit checks cover appointment keyboard
contraction/offset, focus, retained input, dismissal, 44px controls and accessibility.
The app manifest, icons, zoom availability and offline launch/reconnect also pass
in WebKit. Its initial `setOffline` navigation failed inside the test browser;
the replacement test cuts every connection at an isolated forwarding server and
retains the actual cached-fallback and reconnect assertions.

Evidence: 29 focused checks passed across `test-results/mobile-ipad-final`
(17 passing cases), `test-results/mobile-ipad-recovery` (the two repaired cases),
and `test-results/mobile-ipad-application` (10 cases). Coverage includes real
answer saving/reload, rotation, reference editing, phone offline answers,
encrypted recovery/conflict handling, calendar scheduling, explicit start,
signature/decision confirmations and iPad email preview. The production build,
TypeScript, focused ESLint and diff checks passed; screenshots were inspected. This is browser touch
emulation, with simulated visual-viewport contraction, not a physical iPad or
Home Screen installation test. Hardware keyboard/safe-area/OS install validation
remains a device check. All data was synthetic in isolated test stores; no
production deployment or email delivery.

## September 21: assessment lifecycle and handoff logic

Traced preparation, explicit start, section saves, leaving/reopening, recovery,
review, signing, decision, email preview and confirmed delivery. Reproduced and
repaired three gaps: stage navigation could leave while signing was pending;
leaving Decision through a stage tab discarded an edited admission date; and
the send endpoint validated the referral version but not the assessment version
the user actually previewed, allowing unseen later assessment edits to be sent.

The folder now owns shell navigation and invokes the current page's save guard
dynamically. It no longer retains a departed assessment's callback. Assessment
actions must settle before navigation; a late signature response cannot redirect
a different assessment session. Decision navigation saves a pending admission
date, remains in place on failure, and uses the existing centered confirmation
for unrecorded decision changes (Keep editing or explicitly Discard changes).
Inline decision links use the same guard as stage tabs and shell navigation.
Reload/close and account-switch guards also recognize pending decision changes.
Decision recording remains explicit; these changes do not auto-accept or deny.

Meet the Client now submits `assessment_id` and `if_match_assessment` from its
preview report. The server rejects missing, invalid, mismatched or stale values
before reserving a send or calling the provider. The existing assessment lock
still checks for edits during packet preparation. Signing remains editable and
audited until confirmed delivery; opening or closing a preview sends nothing.
Starting is recorded once, resuming retains its section, and a failed start-time
request remains visible without preventing the interview or signing. Recovery
copies do not falsely become canonical saved answers or a signed assessment.

Validation: 55 distinct browser cases passed across
`test-results/assessment-lifecycle-fixed` (50 passing cases) and
`test-results/assessment-lifecycle-final` (8 cases, three repeated).
These include desktop/phone/WebKit navigation, queued and lost-reply saves,
reopening, failed start/signature/decision/date operations, explicit discard,
unsigned/accepted/sent states, recipient preservation, stale-preview request
contents, and delivery-in-progress controls. The initial new decision test
incorrectly tried to change an already recorded decision; that fixture was split
into accepted-date and unrecorded-decision cases without relaxing its assertions.
Twenty save/send boundary checks passed across the three fixture suites, with
the PostgreSQL store case skipped because no test database was configured.
Build, TypeScript, focused ESLint and diff checks passed. No applied migrations,
store adapters, real client data, email delivery or deployment were changed.

## September 21: Settings clarity and contact access

Settings now starts with Contacts: the existing community To/Cc editor is the
first action, with contact/facility CSV import in a separate expandable row.
Your profile follows, then Home layout and organization-managed account access.
Repeated account copy was removed. Profile fields use 16px text; save and import
controls have at least 44px touch targets, with a single-column phone form.

The local 3385 preview was missing its recipient-list file. Restored the five
lists from the private, ignored source at
`/Users/eric/pipeline-app/.data/contact-lists/community-contact-lists.md` into
`.data/persona-demo-3385/community-recipient-lists.json`, with canonical validation,
original lane/order and source dates, exclusive creation and 0600 permissions.
The source was preserved. Addresses remain outside tracked files. No email was
sent and no deployment or live account-role change was made.

Fresh isolated previews now read five empty community lists instead of failing;
only an explicit Save creates the file through the existing atomic writer.
Malformed data and missing production template files still fail closed. Readers
can inspect recipients without being offered controls that would fail at Save;
the API reports edit capability and retains admin/coordinator write enforcement.

Profile saves disable editing and guarded navigation while pending. Failed
loads can retry. Failed writes retain entered text. A version conflict preserves
locally edited fields and carries remote changes forward on untouched fields,
then requires an explicit reviewed save. Guarded navigation with unsaved edits
uses the shared centered confirmation dialog; closing/reloading retains the
browser unload warning. This is not an offline profile draft: save before using
browser history to leave.

Focused evidence is in `tests/e2e/staff-profile.spec.ts`,
`tests/e2e/community-contact-lists.spec.ts`, and
`scripts/community-recipient-lists.test.mjs`. Touch layout checks use WebKit
emulation at 320, 390, 834, and 1194px; no physical iPad check was performed.

Validation for this pass: 26 browser checks passed (15 Settings and 11 contact
editor cases), plus nine recipient-store/API checks. Build, TypeScript, focused
ESLint, and diff whitespace checks passed. Screenshots are under
`test-results/settings-pass-final`; contact editor results are under
`test-results/settings-contact-lists-final`. The account parity cases use
synthetic profile responses with Eric's admin role and Andrew/Sandeep's
coordinator roles; they do not sign in to or change those live accounts.


## September 21: admission packet contents and demo labeling

The admission packet preview now explicitly describes the message plus every
file uploaded to the workspace. Its shared inventory follows every file cursor
and includes all document categories, keeping unavailable files visible and
retaining referral isolation. The delivery count/size/scanning checks still
block an incomplete or oversized send; the display no longer truncates at the
20-file delivery cap. The generated client data sheet remains included.

Finish & send and its email preview display “Demo — not live. No email will be
sent.” The generated demo message repeats the notice and uses a `[DEMO]` subject.
Live template rendering remains separate, and the server's existing demo send
rejection is retained. Attachment and Message headings identify both parts of
the packet, with one scroll area for the uploaded file list and message.

Focused evidence adds a 205-upload/two-page inventory case and actual mixed-label
uploads in phone/iPad browser tests. The tests use synthetic documents and a
separate local store, with no real mail provider calls or changes to user records.

Validation: 22 packet/template/send checks passed, including a configured-provider
demo rejection with no reservation or provider call. Thirty focused browser
cases passed across `admission-packet-pass` and `admission-packet-final`; after
removing the nested attachment scroller, the eight affected preview/upload cases
passed again in `test-results/admission-packet-final-layout`. Build, TypeScript,
focused ESLint, and diff whitespace checks passed. Changes remain local.
