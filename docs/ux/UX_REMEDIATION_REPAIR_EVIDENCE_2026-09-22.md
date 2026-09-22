# UX integration repair and verification

Requested integration head: `d5f0e68`; preserved later integration updates through `c6f3074` (including Calendar/Home and tsconfig cleanup). Production reference `9461fc8010d2c1d1fbddf1508874b44504d6dc8c`.
Owner approved the proposed repair scope on September 22. Automatic deployment is paused. This records the local repair evidence; hosted release checks remain required. No deployment or production mutations were performed. The unfinished Assessment rewrite `d510182` is excluded.

## Conflict audit

1. `client-navigation.ts`: retained the production history guard and additive context helpers. Context replacement spreads the existing history state, retaining navigation indices; contextual Back uses browser history and therefore the same save guard. Directory restoration checks the effective viewer. Free-text search remains in the mounted directory, not the history context.
2. `ReferralPacketCanvas.tsx`: retained `assessmentMode` through `navigatePage`, `openPage`, and `locationForPage`, together with the new chart-edit callback. Navigation still awaits the handoff and assessment save owners and intake queue; errors retain the editor. Chart return captures an element label/index, not clinical content.
3. `client-chart-transition.spec.ts`: retained both appended test groups (originating-list return and stay-history counts), alongside the recorded-motion tests.
4. `ReferralIntakeSummary.tsx` / `TransferredWorkspaceChart.tsx`: both assessment data and contact actions reach the intake chart; historical/assessment-only rendering remains distinct.
5. Decision/control styling: retained the administrative disclosure, secondary stage-transition action, accessible action explanation and shared target/typography changes. Corrected recommendation rendering from ordinary Chart to explicit assessment review only; removed its unused header portal. Owner approved these product choices. No authority, signing or sending behavior is intentionally changed.

## Initial failure diagnosis

- Existing test build `.next-integration-e2e` returns `Browser and server workspace-state settings must be enabled together` from the continuity API when run with desktop-state support. This build cannot qualify persistence behavior. Rebuild with `NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED=true` and run with the matching isolated store.
- Phone setup starts the interview via API and then requests the removed `Begin assessment` control. Tests must enter the already-started interview and retain their save/focus assertions.
- Scheduled preparation tests use old `Assessment prep` / `Begin assessment` wording. Approved semantics: prepare before start, explicit Begin interview to record start, continue after start.
- Held-press test releases the button, then clicks it again. Existing failure snapshot shows interview content after the release. Verify the original pointer activation and saved answer rather than waiting for a second click on an unmounted review button; retain the <=1px movement assertion.

## Repairs and product decisions

- Home uses the canonical Prepare assessment action before an interview starts, overriding the late Home-only Begin label. Preparation does not record a start; the explicit Begin interview action does. Return tests cover both deliberate modal cancellation and saved section/question restoration.
- Phone interview hides redundant phase summary while retaining the section chooser, scheduling and error controls. Question visibility and keyboard/save behavior pass at narrow widths.
- Escape in a native document preview stops propagation so Calendar's enclosing workspace does not also close.
- Ordinary Chart no longer eagerly requests the review recommendation chunk. This fixes the offline Chart transition crash while retaining recommendation in assessment review.
- Local presentation helpers reduce the merged complexity regressions without changing thresholds or recording a new baseline. Shared persistence and authorization owners remain intact.
- The held-press test now verifies the original release activation, retained answer and <=1px movement. It no longer asks for a second click on the already-unmounted control. Other test corrections follow intentional labels, the recorded bookmark, and the correct current assessment version; save/recovery assertions remain.

## Verification results

- Production webpack build: passed with matching desktop persistence build/runtime flags.
- Complete local `check:platform:fast`: passed, including complexity, TypeScript, scoped ESLint, workflow contracts and replay checks. No assertions/thresholds were weakened.
- `check:saving`: 35/35 passed.
- Identity/activity/working-view unit suites: 13 passed, one PostgreSQL-dependent case skipped locally; hosted PostgreSQL checks remain applicable.
- Final integrated browser run: **91 passed, zero failed, skipped or flaky**. Includes assessment return/footer/mobile, client-chart transition, chart field editing, Calendar, chart context, Decision, handoff journey, workflow resilience, offline reconciliation, chart-intake continuity and visual cases. JSON: `.data/ux-remediation-repair/final-browser.json`.
- Journey exercises scheduling, partial preparation, Files side trip, saved-data return without premature interview start, review/sign, authorized decision and handoff at desktop/tablet/phone widths. Admitted and historical chart behavior is covered by the chart suites; these records are not falsely treated as new referrals.
- Before/after synthetic Chart and focused assessment captures at 1440, 834 and 390px with empty, partial and populated data were inspected. Candidate visual cases run axe WCAG A/AA checks and horizontal-overflow assertions. Production baseline is exactly `9461fc8`; its accessibility output is recorded rather than asserted clean. Capture waits exclude transient restoration/decision loading.
- Local artifacts/logs: `.data/ux-remediation-repair`; before/after sheets: `.data/ux-remediation-repair/visual-comparisons`.

## Limits and release status

Hosted required CI must pass before release. Full-repository lint has five pre-existing errors documented in the integration handoff; the platform gate's scoped ESLint passes. No real-device testing was performed: viewport, WebKit and simulated keyboard checks do not certify physical-device behavior. No production clinical records were used and no real mail was sent. Automatic deployment remains paused; this repair does not integrate the separate queued Outlook changes.
