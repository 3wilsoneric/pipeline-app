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
