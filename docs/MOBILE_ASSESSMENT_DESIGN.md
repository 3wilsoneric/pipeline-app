# Pipeline mobile assessment: design decisions and evidence

Research and implementation pass: September 17, 2026. Starting point: `ca2446f9bf232b2b7a2ad30e70a03ac6e404c70e`.

## The product we are designing for

An assessor receives or creates a referral, reviews its chart and source material, prepares known answers, arranges an assessment, interviews the client, returns to unfinished documentation, then signs and makes a recommendation. A supervisor makes the admission decision. This is interrupted, nonlinear professional work, not a public survey or a sales funnel.

The mobile priority is **correct information, entered comfortably, without losing context or work**. Smaller cards and a responsive grid alone do not accomplish that. A phone must accommodate the software keyboard, one-handed use, long clinical answers, incomplete information, and switching between the client and supporting records.

No new question requirements, assignment locks, signature requirements, notifications, storage, external services, or automatic clinical interpretations are introduced in this pass. There are no new dependencies or paid services. Existing blur-based saves, navigation flushes, audit events, signed-record protections, and authorization remain the owners of those behaviors.

## What the research contributes

| Source | Relevant finding | Pipeline decision |
| --- | --- | --- |
| [NIST health IT interface research](https://www.nist.gov/publications/technical-basis-user-interface-design-health-it), [full report](https://doi.org/10.6028/NIST.GCR.15-996), especially workflow analysis and patient identification | Study established workflows and the environment of use. Keep the patient identifiable and make input clearly associated with that patient. Evaluate representative tasks with users, not just isolated controls. | Preserve the current open-book assessment. Keep the client's name visible above the editor, allow long names to wrap, and test entry, reference lookup, interruption, and return. A second identifier near the name merits a separate layout decision; this pass does not manufacture identity information. |
| [ODK field-data workflows](https://docs.getodk.org/data-collector-workflows/) | Consider before, during, and after data collection. Its hierarchy supports jumping between sections and revisiting incomplete work. | Retain section selection, question search, and access to captured answers. Do not impose a mandatory wizard or swipe-only navigation. |
| [ODK draft/finalization guidance](https://docs.getodk.org/guide-end-of-form/) | Draft, finalized, and sent are different workflow states, particularly when review is involved. | Preserve the distinction between saved answers, a signed assessment, and a recommendation/admission decision. No premature completion merely because every visible field contains something. |
| [GOV.UK question-page guidance](https://design-system.service.gov.uk/patterns/question-pages/) | Focused question pages help users concentrate; progress and grouping must fit the transaction. | Apply focused grouping and readable controls, not a literal one-question-per-screen rewrite. Our inference: experienced assessors need adjacent clinical context and nonlinear navigation more than a forced sequence. |
| [WCAG 2.2 target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | The AA minimum is 24 CSS pixels, subject to exceptions; larger targets are recommended for important controls. | Our mobile design target is 44px for navigation/actions and 48px high for assessment choices and entry controls. This is a product target, not a claim that WCAG AA requires 44px. |
| [WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) | Content should reflow at narrow widths, and sticky author-created UI must not completely hide focused controls. | Single-column phone answers and reference information; scroll padding under the section bar; visible focus; retain zoom. Automated checks do not establish complete WCAG conformance. |
| [Chrome's keyboard viewport explanation](https://developer.chrome.com/blog/viewport-resize-behavior), [MDN VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) | The on-screen keyboard can shrink the visual viewport while layout viewport units remain unchanged. Pinch zoom also changes the visual viewport. | Size the compact app shell to the visible viewport, coalesce events with animation frames, keep the focused assessment input visible, and leave geometry unchanged during pinch zoom. Dynamic viewport units provide a fallback, not a complete keyboard solution. |

These sources inform design choices; none independently validates Pipeline's clinical usability or its implementation.

## Findings in the actual application

- The latest assessment already uses one questionnaire with captured information and remaining questions. `AssessmentWorkingSection` is the canonical editor; `AssessmentPreparation` reuses its field renderer. Reuse these instead of shipping a separate mobile questionnaire.
- Global surface styling already sets assessment inputs to 16px. Keep this; do not mistake older component utility classes for the final computed appearance.
- Several controls were still 36–40px, the app-navigation reveal handle was 24px high, and help was 32px high. Mobile-specific rules enlarge the interactive targets while leaving desktop density intact.
- Captured information stacked above the editor on phones but retained two narrow columns and an independent scrolling area. The mobile reference now uses readable phone rows and the main scroll area. Selecting an answer closes the reference and focuses the existing editor.
- Empty-state instructions referred to answers being “on the left,” which was incorrect on a phone. The wording now identifies captured answers without assuming screen position.
- The app shell used `h-screen`. A phone can appear to fit while its keyboard covers the bottom. The shell now uses `dvh` plus a small visual-viewport adapter for compact widths; full-screen assessment scheduling uses the same dimensions.
- Phone app navigation reduced destinations to small icons in a horizontally scrollable dock. The same destinations now show their labels in a second header row with larger targets. The row remains collapsed while interviewing; no routes or permissions change.
- Existing home modules already include Continue working, new assignments, and upcoming assessments. A new mobile dashboard would duplicate navigation rather than fix the assessment. Preserve these entry points and test their real handoffs before redesigning them.

## Implemented interaction model

1. **Open the same client file.** No separate mobile record or extra loading step.
2. **Keep identity and navigation visible.** The assessment header reserves a 44px touch slot for app navigation; it does not overlap the client's name or require a permanently expanded global header.
3. **Review existing information when needed.** Captured answers expands into readable information. Tap an answer to edit/review it in its canonical section; the reference closes so the editor is immediately available.
4. **Enter answers in place.** Larger labels, touch targets, and writing-help disclosures. Existing conditional follow-ups stay beside their parent question. No automatic advance and no hiding a field during typing.
5. **Work around the keyboard.** The existing shell and scroll owners remain mounted. The visual viewport changes layout geometry, not values, focus ownership, or persistence. Pinch zoom is not treated as a keyboard.
6. **Leave and return using existing saves.** Blur and navigation continue to use current save/recovery handlers. Signature, recommendation, and admission remain separate actions.

Below 960px the assessment is stacked; below 640px its fields and captured answers use one column. Desktop remains the existing side-by-side open-book layout. Safe-area padding accommodates display cutouts without disabling user zoom. No new animation or decorative dashboard elements are added.

## Whole-app follow-through, in priority order

These are follow-up acceptance checks, **not claims that every mobile workflow has been certified**:

1. **Actual assessor session:** open an assigned referral from Home; confirm identity; review a packet; enter preparation; schedule; open from the calendar; answer nonlinear questions; interrupt; resume; sign; return to the same workspace. Observe two assessors using synthetic records before adding new navigation.
2. **Real phone interruption:** incoming call, lock/unlock, backgrounding, OS termination, connection loss/recovery, and expired authentication. Preserve whatever has durably saved and accurately distinguish device-pending data from server-confirmed data. Do not promise all operations are available offline.
3. **Files:** real camera/gallery/file-picker attachment, one resulting upload, a legible preview, close/back, deletion confirmation and restoration. PDF reading should not steal assessment progress or trap the user in nested viewers.
4. **Preparation and scheduling on short screens:** date/time controls, method-specific fields, keyboard dismissal, and all footer actions must remain reachable. Native date pickers differ between platforms.
5. **Identity and readability:** same-name clients, very long names, long answers, text enlargement, VoiceOver/TalkBack, reduced motion, and high contrast. Consider a compact truthful second identifier without renaming the client or adding visual status clutter.
6. **Mobile speed:** measure tap-to-usable-field, returning to an already opened workspace, PDF first page, and save acknowledgement on a mid-range phone with constrained CPU/network. Browser emulation is not evidence of real cellular latency, battery use, or low-memory reliability. Keep answer typing independent of network response.

## Verification boundary

The focused suite exercises real local application routes with synthetic records, not production PHI. It covers narrow/portrait/tablet/landscape layouts, touch navigation, reference-to-editor focus, conditional answers, real API persistence on blur, reload recovery, single assessment identity, and accessibility checks. A WebKit engine pass complements Chromium.

Visual-viewport events can be simulated in the test harness to check geometry and pinch-zoom handling. This does **not** simulate iOS's real keyboard, dictation, autofill, OS suspension, or a physical Android handset. Those remain explicit device acceptance checks. No physical-device or “best mobile app” certification is claimed.

The implementation adds no backend requests to viewport events and no second persistence path. Listeners are removed on unmount; desktop dimensions are cleared outside compact/touch layouts. Touch tablets keep keyboard-aware sizing even above the compact layout breakpoint. If physical-device testing reveals Safari panning or keyboard problems, revisit the small viewport owner rather than introducing per-field scroll timers or a mobile fork of the questionnaire.

### Executable evidence

The bounded browser run includes `assessment-mobile.spec.ts`, `assessment-working-view.spec.ts`, and `assessment-scheduling.spec.ts` on an isolated local server with synthetic records. The mobile suite also launches WebKit. The real persistence check uses application API records, not the reset-on-load practice fixture.

The pre-existing “Home uses a light emerald canvas” assertion is excluded: it expects `rgb(237, 243, 242)`, while the starting commit already styles Home with `rgb(245, 246, 248)`. This pass does not revert the newer Home design or claim that unrelated assertion passed. The exclusion was reported to the release owner.

Reproduce with the repository's ordinary Playwright configuration, local-file test stores, `PORT=3364`, `PIPELINE_E2E_CLINICAL_PORT=3365`, and `PIPELINE_DESKTOP_E2E=true`:

```sh
npx playwright test tests/e2e/assessment-mobile.spec.ts tests/e2e/assessment-working-view.spec.ts tests/e2e/assessment-scheduling.spec.ts --project=chromium --grep-invert 'Home uses a light emerald'
```

The default runner builds and type-checks the application before starting the server. Changed TypeScript files also receive focused ESLint checks, and `git diff --check` guards the patch. Screenshot artifacts live in the ignored `test-results/` directory, not the application bundle.

Final local result: **25 focused browser tests passed**, including the WebKit journey, real API blur-save/reload check, portrait/landscape scheduling, and visual-viewport contraction on a wide touch tablet. Build/type-check, focused ESLint, and patch whitespace checks passed. Phone screenshots were inspected. Production and physical devices were not used by this pass.
