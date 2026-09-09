# Test Suite Structure Architecture Narrative

## Approved outcome

The test-structure slice separates the Pipeline home journeys from the referral packet journey file, centralizes only immutable sanitized clinical fixtures, and adds a machine-enforced assertion manifest. It does not change product code, test expectations, retry behavior, cleanup behavior, browser configuration, or synthetic data isolation.

## Current owners and seams

- `tests/e2e/pipeline-smoke.spec.ts` owns referral intake, packet, assessment, conflict, identity, workflow, and handoff journeys. Its loopback clinical server remains inside that describe block, with `beforeAll`, `beforeEach`, and `afterAll` visibly paired.
- `tests/e2e/pipeline-home.spec.ts` will own the already-independent Pipeline home, search, client directory/profile, identity-review, and report-navigation journeys.
- `tests/e2e/support/pipeline-clinical-fixtures.ts` will own immutable sanitized fixture loading and derived fixture shapes. It will contain no Playwright assertions, routes, retries, cleanup, or error handling.
- `scripts/api-behavior-fixtures.mjs` remains the executable API behavior owner. Its 108 named cases and 353 direct assertions remain in place.
- `scripts/test-assertion-inventory.mjs` will compare the exact ordered case names, per-case normalized assertion expressions, hook inventory, and critical-journey trace against the exact-start manifest.
- `scripts/referral-intake-recovery-contracts.mjs` will execute save reconciliation directly instead of treating source text as operational proof.

## Critical journey trace

The two-session canvas journey retains 18 direct assertions. The referral describe owns loopback clinical-server startup, per-test error capture and navigation, and server shutdown. The journey itself owns both browser contexts and referral mutations. Failures remain visible through direct expectations for presence, disjoint saved values, same-section conflict UI, and server truth. No helper may catch a Playwright error, retry a failed assertion, or convert failure into a default value.

## Boundaries

- Shared fixture code is data-only and may not import Playwright.
- User-visible expectations stay in `.spec.ts` journey files.
- Helpers may construct deterministic data but may not assert outcomes or swallow failures.
- Case names and assertion digests must remain one-to-one with the exact-start inventory.
- The API fixture runner must still exit nonzero when any named behavior case fails.
- Source inspection remains appropriate only for architecture-fitness rules; operational behavior must execute the canonical implementation.

## Rollback

The slice is test-only. Reverting its bounded commits restores the single test file and prior contract layout. It contains no migration, product runtime, persisted-data, environment, or deployment change.
