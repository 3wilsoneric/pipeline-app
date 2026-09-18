# Mobile assessment presentation

Phones use one canonical assessment question at a time. This is a presentation
of the same assessment record, not a second questionnaire or answer store.
Intake opens preparation in a full-screen interview; closing returns to that
referral through the existing save-before-exit guard. Wider tablet/desktop
layouts retain the preparation worksheet and open-book assessment.

## Interaction boundaries

- Next and Back never start, schedule, sign, or send anything. Those existing
  actions remain in the Review & finish disclosure.
- Conditional questions come from the existing schema. Unknowns stay blank;
  selecting an answer does not auto-advance or confirm extracted suggestions.
- Source evidence, verification controls, writing guidance, unable-to-assess
  context, disabled state and permissions use the existing field component.
- Question, section, reference and swipe navigation explicitly commit the
  focused field through `commitAnswer` before removing it. Responsive-layout
  cleanup also commits the outgoing field. Existing save queues and recovery
  remain the only persistence owners.
- Swipes apply only to deliberate horizontal gestures starting away from form
  controls and screen edges. Visible navigation is always available. Pinch zoom
  and vertical scrolling remain native.
- Native dialog sheets supply focus containment; the covering phone view makes
  the underlying workspace inert. App navigation is tap-only at narrow widths.
- No dependencies, timers, animation runtime, API or database changes were added.
  Entry motion is a 130ms CSS animation and respects reduced motion.

## Deliberate limits

The routed section is retained; the exact question cursor is local UI state.
Reopening a section starts at its first unfinished question, and question lookup
and recorded answers provide direct jumps. Add durable per-question cursor state
only if assessor testing shows that section-level resume is insufficient.

Browser tests exercise touch-sized layouts, native controls, synthetic gestures,
simulated keyboard viewport changes, real local save/reload, offline replay,
source review and responsive switching. They do not establish physical iOS or
iPadOS keyboard, safe-area, VoiceOver or edge-swipe behavior. Those remain device
acceptance checks before describing this as production-ready on those devices.

## Verification on 2026-09-17

The production build (`PIPELINE_NEXT_DIST_DIR=.next-phone-interview npm run build`),
focused ESLint and `git diff --check` pass. Fifty scoped Playwright checks pass
against that build, including Chromium and WebKit touch contexts, preparation
through Begin assessment on the same record, actual phone signing/chart access,
offline replay, responsive rotation, keyboard viewport simulation, source review,
desktop/tablet open-book behavior and intake/directory regressions. Artifacts:
`outputs/phone-interview-acceptance`.

One broader, unchanged test remains failing separately: "an existing signed chart
stays available during a later reassessment". It also fails against the previous
held `8d47957` build (`.next-mobile-final`), where these phone changes are absent.
Evidence is in `outputs/phone-interview-chart-baseline`. The test remains in the
suite; only the scoped 50-test run excludes it with `--grep-invert`. Reported to
the lifecycle and deployment owners; no chart-routing fix is included here.
No production deployment or physical-device certification is implied.
