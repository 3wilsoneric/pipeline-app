# Pipeline McMaster Certification

**Status:** PASS  
**Requirement coverage:** 37 of 37 (100%)  
**Performance runs:** 3 of 3 passed  
**Known failing local release gates:** 0

## Scope

This certification covers the Pipeline application artifact and its executable
contracts: cold rendering, warm navigation, real interaction latency, API
latency and errors, transfer size, layout stability, persistent-shell behavior,
bounded read models, drafts, optimistic concurrency, presence, extraction,
assessment completion, document safety, governed client profiles, recovery,
security boundaries, responsive behavior, cross-browser behavior, desktop
offline safety, visual stability, and release enforcement.

It uses sanitized or synthetic test records only. Runtime clinical data still
fails closed when Alamo is unavailable; no fake live data is introduced.

## Performance Decision

All metrics pass the approved certification rule: target plus the greater of 10
percent or 50 milliseconds. The only metric above its raw engineering goal is
the conservative worst observed warm navigation at 115.8 ms versus a 100 ms
goal; it is within the 150 ms certification ceiling. A later complete run
measured a 100.4 ms worst warm navigation.

See `docs/PERFORMANCE_BASELINE_2026-08-20.md` for the full table and load
evidence.

## Executed Evidence

- McMaster matrix: 37/37.
- Anti-false-pass contracts: 11/11.
- Full Playwright suite: 44 passed, 7 intentionally skipped by feature-gated
  projects; no failures.
- Cross-browser smoke: Chromium, Firefox, and WebKit passed.
- Visual regression: six reviewed desktop/mobile surfaces passed.
- Desktop gate: installability, protected-data cache exclusion, PHI-free offline
  fallback, cache kill switch, and server-side recents/drafts passed.
- Platform readiness: all 30 categories passed, including 21,004 generated
  property cases and 12 deterministic chaos scenarios.
- Ten-user local collaboration/load drill passed.
- Production build, TypeScript, ESLint, route policy, artifact, security,
  clinical, database, extraction, recovery, query, scale, and metrics checks
  passed.

## Defects Closed During Certification

1. INP previously accepted a zero value without a valid interaction sample. It
   now observes real Event Timing interactions and fails when none are captured.
2. API failures could escape the old scorecard. Every same-origin API response
   is now captured, and any error status fails certification.
3. Heavy endpoints were not independently required or budgeted. They now have a
   separate 500 ms goal and must be exercised.
4. Browser journeys used programmatic clicks and omitted meaningful profile,
   queue, filter, input, and assessment-adjacent paths. Certification now uses
   trusted Playwright interactions across complete useful surfaces.
5. Typed search had a 220 ms debounce and missed the interaction budget. It now
   coalesces for 40 ms and aborts obsolete work.
6. The standalone launcher staged CSS and JavaScript into `.next/static` even
   for custom Next distribution folders. Desktop and visual artifacts were
   therefore unstyled and unhydrated. Assets now stage into the configured
   distribution folder, with an anti-regression contract and passing behavior
   tests.
7. Production mock-auth readiness could not distinguish explicitly allowed
   loopback certification from public deployment. Health now accepts that mode
   only for an explicitly allowed loopback request and remains unhealthy on a
   public host.

## Release Rule

Run `npm run certify:mcmaster`. A release is not certified if any matrix item,
metric, API status, browser journey, visual snapshot, security boundary, or
platform contract fails. CI repeats the performance test from three fresh
standalone instances and separately validates PostgreSQL contention.

## Boundary

This is a 100 percent application certification, not a claim that an arbitrary
future Azure deployment has already met network and cold-replica latency. After
deployment, run the protected scorecard with an authenticated test storage state
and review Azure telemetry before assigning the same certification to that
specific environment.

