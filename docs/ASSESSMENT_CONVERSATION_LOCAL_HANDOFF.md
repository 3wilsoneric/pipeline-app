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
