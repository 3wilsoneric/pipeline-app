# Current application tests

The tests exercise the current application, not retired UI or workflow gates.
Test-only changes must preserve checks for authorization, saved data, duplicate
uploads, cross-tab conflicts, draft recovery, accessibility and unintended writes.
A real application defect stays a failing test; do not change its expectation
merely to make a run green.

Latest refresh evidence and remaining failures: [September 26 results](TEST_REFRESH_2026-09-26.md).

## Commands

- `npm run test:unit`: discovers every `scripts/*.test.mjs` native Node test.
- `PORT=3187 npm run test:e2e`: all default Playwright cases, with an isolated
  local mock identity, synthetic clinical service and local stores.
- `npm run test:e2e:desktop`: enables the workspace-state store and includes the
  cross-tab, offline recovery, handoff, upload and assessment cases that otherwise
  skip when that capability is disabled.
- `npm run test:e2e:cross-browser`: configured browser-engine matrix.
- `npm run test:e2e:visual`: the separate screenshot-regression suite. Do not
  regenerate snapshots simply to accept an unexplained change.
- The community-contact editor suite uses the isolated persona demo on port
  3355. A normal mock-identity server on that port is not equivalent: its
  permissions, storage and compile-time persona flag differ.
- For one affected behavior, run `PORT=3187 npx playwright test
  tests/e2e/<name>.spec.ts --project=chromium` instead of repeating the full suite.
  Set `PIPELINE_DESKTOP_E2E=true` for tests requiring its isolated state store.

Existing `check:*` contract commands still cover domain rules, adapter parity and
fixtures. PostgreSQL/live integration and operational load tests have their own
environment requirements; a skipped local test is not evidence they passed.
Never aim synthetic writes or load generation at production by changing a URL.

## Current workflow conventions

- Preparation exposes all assessment questions; Interview is the focused subset.
  Opening Interview does not itself record an encounter start or assessment date.
- Saved work may remain mounted but hidden across workspace tabs. Check visibility
  for navigation and persisted answers for durability, not unmount counts.
- Tablet reference information collapses when editing or changing sections. Phones
  use Client info and questionnaire navigation instead of desktop reference controls.
- File selection opens the labeling dialog. Creation opens Workspace created.
  Confirm or dismiss these actual dialogs before attempting controls behind them.
- Home has Referral received, In progress and Decision folders. Worklist fixtures
  include their canonical `board` state. Calendar starts in Mine; assessor filtering
  belongs to Team.
- Tutorials use a fictional referral walkthrough. Assert no clinical/upload writes
  during practice; current report guidance still operates beside the reports UI.
- Handoff follows admit-date, summary, packet and recipient review before preview.
  Reuse `tests/e2e/support/handoff-review.ts` rather than bypassing that workflow.

## Isolation and evidence

Use synthetic names and `.invalid` addresses. Supply complete mock response shapes
and reset any persisted user layout changed by a test. Mocked network tests must
account for service workers; block them only in tests that require interception,
not in installed-app/offline coverage.

Concurrent local runs need distinct ports, store paths and Next build directories.
The standalone launcher prepares its own static output; sharing one build directory
between running servers can corrupt the test environment. An unchanged prebuilt
candidate can be reused with `PIPELINE_E2E_PREBUILT=true` and
`PIPELINE_NEXT_DIST_DIR=<its-build-directory>`.
Compile-time `NEXT_PUBLIC_*` settings must match the intended test mode. Changing
runtime variables cannot turn a desktop build into a browser-only or persona build.

Retain failing screenshots, error contexts and JSON results. Report actual executed,
failed and skipped cases separately. Passing local mock-store tests does not certify
production Entra login, delegated Alamo access, live PostgreSQL or traffic capacity.
