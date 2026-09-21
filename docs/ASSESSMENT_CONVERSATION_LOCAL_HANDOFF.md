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
