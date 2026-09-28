# Current-application test refresh — September 26, 2026

## Scope

Branch: `codex/tests-current-20260926`, based on application candidate `e813fa47`.
The initial refresh changed only tests, test commands, fixtures, snapshots and
testing documentation. The subsequently authorized local fixes are documented
below. Database schema, production data and deployments remain untouched.
The original working tree and other tasks' edits were preserved.

Updated coverage follows Preparation versus Interview, optional explicit interview
start, current scheduling and signing dialogs, persistent hidden workspace panels,
phone/tablet reference controls, current Home folders, Calendar Mine/Team, labeled
uploads, same-tab file previews, handoff review and fictional tutorials. Contract
fixtures now reflect shared workspace access, nonblocking scheduling warnings and
preserved import provenance. Native Node tests have a discovery command; the desktop
command includes recovery/concurrency suites previously omitted from that entry point.

## Initial test-refresh results (before application fixes)

| Coverage | Result |
| --- | --- |
| Native Node tests (`scripts/*.test.mjs`) | 346 passed; 14 environment-gated skips; no failures |
| Current Chromium test inventory, across applicable local modes | 869 passed; 3 failing; 34 not verified/gated, out of 906 cases |
| Additional Firefox and WebKit navigation smoke | 2 passed |
| Dedicated mobile-Chromium accessibility project | 3 passed |
| Five repaired contract scripts | Client workspace, contacts, historical profile, launch projection and note lab passed |
| TypeScript, lint on changed test/script files, diff whitespace | Passed |
| macOS screenshot verification | 5 passed; mobile intake remains flagged |

The Chromium rollup uses the latest applicable result for each current test title,
not a sum of repeated attempts and not a claim of one clean full-suite run.
Obsolete test names and runs with mismatched build/runtime fixtures are excluded.
The persona editor supplied nine passing cases; its handoff case passed separately
with the local workspace-state test setting enabled. The two persona Settings
navigation cases remain unverified, as described below.

## Follow-up: corrected resume tests

The initial report incorrectly classified three outdated expectations as resume
defects. `PipelineOverviewRoute.navigate` deliberately honors explicit Board
destinations, and the existing Home test requires the named Board action to win
over an earlier Chart visit. Workspaces, by contrast, opens with resume semantics.

The two assessment tests now verify that Workspaces restores Schedule/Begin
interview, while Board navigation opens preparation without booking or starting an
interview. The creation-choice test verifies resume through Workspaces, including
the transition from the choice to scheduling and then preparation. All 11 cases
in those two specs pass. No application behavior was changed to satisfy them.

## Defects exposed by the refresh

1. **Partial upload retry — one case.** After the first upload commits but its reply
   is lost, and the second upload is interrupted, removing the injected failure and
   selecting Retry leaves only one file in the inventory. The test also reports
   the existing small error text/style mismatch. Its readability checks are soft
   assertions so they no longer prevent execution of the durability assertions;
   they still fail the test.
   Test: `tests/e2e/workflow-resilience.spec.ts`.
2. **Legacy tab-storage recovery — one case.** With sessionStorage writes forced to
   fail, the app warns and permits navigation, but returning to intake loses the
   typed name. This reproduces in the browser-only mock mode, without authenticated
   server-backed drafts; it is not proof that production Entra recovery has the
   same defect. The encrypted/server-backed recovery cases passed.
   Test: `tests/e2e/intake-exit-guard.spec.ts`.
3. **Mobile intake visual — one case.** The current create control displays its SVG
   plus and a CSS-generated plus, producing a doubled symbol above “Intake.” The
   old snapshot also predates the current upload panel and intake fields. It was
   not regenerated to silently approve that defect.
   Test: `tests/e2e/visual-regression.spec.ts`.

These failures were retained during the test-only pass, then fixed locally at the
owner's request as described below. Assertions were not weakened to hide them.

## Authorized local application fixes

- **Partial uploads:** reconciliation now runs even when a later file fails.
  Completed files remain committed and only unfinished files stay queued. A change
  poll can also reconcile unchanged evidence while additive uploads are pending,
  covering a failed chart refresh. Only resolved document conflicts are removed;
  unrelated field conflicts and pending document replacements retain their checks.
  Save errors and Retry now use readable 14px text without truncating the message.
- **Browser-only recovery:** the legacy path reads the existing encrypted and
  principal-scoped in-memory copies as well as tab storage. Failed tab writes use
  those fallbacks; a newer valid tab draft wins over an older encrypted copy.
  Unreadable tab storage no longer deletes the encrypted copy. Canonical saves
  retire legacy encrypted recovery too. In-memory-only recovery survives in-app
  navigation, not closing or reloading the browser; the warning remains visible.
- **Mobile Intake:** removed the generated second plus and retained the existing
  accessible button and SVG. Reviewed the corrected macOS screenshot before
  accepting its updated baseline; Linux baseline work remains separate.

Focused verification on the fixed local code:

| Scope | Result |
| --- | --- |
| Desktop-enabled upload/recovery/cross-tab run | 21 passed; 5 browser-only cases skipped in this mode |
| Browser-only intake recovery run | 9 passed; 7 desktop-only cases skipped in this mode |
| Saving and recovery-clear native tests | 43 passed; no failures or skips |
| Intake recovery contracts | Passed |
| macOS screenshot verification and desktop/mobile accessibility | 12 passed |
| Fresh desktop/browser-only builds, TypeScript and affected-file lint | Passed |

The upload cases verify lost completion replies, partial batches, simultaneous
chart-refresh failures, duplicate suppression, distinct same-name revisions and
downloaded bytes. Recovery cases cover Home/Back, two-tab isolation, immediate
typing, storage failures and stale-copy cleanup. The initial full inventory was
not rerun against these application changes; this is focused local evidence, not
production or full-suite certification.

## Remaining environment boundaries

- 17 capacity cases require their dedicated load-test setup; no production load was
  generated. The separate operational configuration was not certified by this pass.
- 12 extraction cases are gated off because document autofill is disabled in the
  application. This pass does not certify re-enabling that feature.
- Two community-contact Settings navigation cases need a correctly compiled persona
  demo. A reused non-persona build lacks the Settings link; the attempted isolated
  webpack development build instead failed on a client import of `node:crypto`.
  Neither result was classified as a production contact-permission failure. Direct
  editor, server permission, recipient persistence and handoff coverage passed.
- One private-packet case needs an explicitly supplied packet, one preview-cache
  case needs its development-preview configuration, and one Home-module case is an
  opt-in screenshot asset capture.
- The 14 skipped Node tests require disposable PostgreSQL and/or dedicated UI
  environments. Local-file results do not establish PostgreSQL parity.
- Linux screenshot baselines were not regenerated on macOS. Docker is installed,
  but its local daemon was unavailable. Refresh and review those on the matching
  Linux runner; do not copy macOS font-rendered images into Linux baselines.
- No claim is made about live Entra sign-in, delegated Alamo access, Outlook email
  delivery, production database capacity or production deployment readiness.

## Evidence locations

Playwright failure screenshots and contexts are in this worktree's `test-results/`.
Useful subdirectories: `confirm-regressions`, `browser-recovery-final`,
`visual-verification`, `persona-final`, `contact-handoff-final`, `browser-matrix`,
`mobile-project`, `fix-resume`, `fix-board`, and `reviewer-final` (only its explicitly
assessor-role case is applicable to the role override).
Application-fix evidence: `fix-application-desktop`, `fix-application-web`,
`fix-mobile-visual`, and `fix-visual-verification`.

Machine-readable run reports and command logs were retained under
`/tmp/pipeline-tests-current-*.json`, `/tmp/pipeline-tests-current-*.log`,
`/tmp/pipeline-tests-fix-*.json` and `/tmp/pipeline-tests-fix-*.log`.
Application-fix logs and JSON reports use `/tmp/pipeline-fix-*`.
These local temporary outputs are not committed artifacts or permanent CI records.
Use [current test commands](CURRENT_TESTING.md) to reproduce the relevant scope.
