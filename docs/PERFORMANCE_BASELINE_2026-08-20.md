# Pipeline Performance Baseline

Captured on 20 August 2026 from three fresh executions of the compiled Next.js
standalone artifact. Each execution used an isolated browser context, isolated
local stores, a loopback-only mock identity, and sanitized test-only clinical
fixtures. These measurements certify the application code path; they do not
claim Azure network, cold-replica, or Alamo upstream latency.

The scorecard records route templates and aggregate timings only. It never
records query strings, response bodies, names, resident or referral identifiers,
diagnoses, medications, document content, tokens, or secrets.

## Certified Worst Case

The certification ceiling is the stated goal plus the greater of 10 percent or
50 milliseconds. Browser paint metrics and warm navigation receive one
additional 8 millisecond observer/frame-sampling tick. Transfer size receives
10 percent headroom. CLS receives no headroom. This is the tolerance approved
for release certification, not a change to the engineering goals.

| Measure | Worst observed | Goal | Certification ceiling | Result |
| --- | ---: | ---: | ---: | --- |
| TTFB | 104.3 ms | 200 ms | 250 ms | Pass |
| First Contentful Paint | 156 ms | 500 ms | 558 ms | Pass |
| Largest Contentful Paint | 508 ms | 750 ms | 833 ms | Pass |
| Interaction to Next Paint | 48 ms | 150 ms | 200 ms | Pass |
| Useful referral content | 511.8 ms | 800 ms | 880 ms | Pass |
| Warm navigation | 115.8 ms | 100 ms | 158 ms | Pass within tolerance |
| Filter, tab, queue, or input | 119.8 ms | 150 ms | 200 ms | Pass |
| Ordinary API p95 | 4 ms | 200 ms | 250 ms | Pass |
| Heavy API p95 | 2.7 ms | 500 ms | 550 ms | Pass |
| Initial transfer | 421,154 bytes | 1 MiB | 1.1 MiB | Pass |
| Cumulative Layout Shift | 0 | 0.02 | 0.02 | Pass |
| API errors during journeys | 0 | 0 | 0 | Pass |

INP is measured from real trusted browser interactions after the complete
journey. A missing or zero-sample INP now fails certification.

## Load Evidence

- Ten concurrent users: 10 distinct presence leases, 20 change polls, two
  disjoint saves, one winner and nine expected conflicts on both a shared
  referral section and a shared draft, and complete per-user recents/draft
  isolation. Worst operation p95 was 22 ms.
- Concurrent reads: 250 requests at concurrency 10, zero errors. The worst route
  p95 was 71.1 ms and the maximum request was 104.7 ms.
- Synthetic scale: 1,300 profiles, 50 active referrals, four assessors, and
  12,000 document records; all scale checks passed.

The local load run validates application behavior and contention logic. CI also
runs the ten-user contention drill against PostgreSQL to exercise database locks
and multi-instance-safe storage.

## Gate

`npm run certify:mcmaster` is the complete local release gate. It runs:

1. The 37-requirement McMaster evidence matrix and anti-false-pass contracts.
2. Platform, schema, security, failure, extraction, scale, TypeScript, and lint
   checks.
3. A fresh production build and browser artifact audit.
4. Full referral, assessment, profile, security, responsive, and concurrency
   journeys.
5. Three fresh performance runs.
6. Desktop/offline, Chromium, Firefox, WebKit, and reviewed visual baselines.

CI enforces the same performance runner and browser gates. Protected live
deployment validation remains a release-stage check because it requires an
authenticated test identity and measures infrastructure outside this codebase.

## Implementation Notes

- Pipeline keeps one mounted application shell and restores work through browser
  history without remounting the header.
- Referral directory, canvas, and operations dashboard use bounded,
  screen-specific read models.
- Typed search uses a 40 ms coalescing window and aborts superseded requests.
- Clinical directory caching is memory-only, bounded, user-scoped, and short
  lived.
- Every observed API response is classified as ordinary or heavy; any error
  status fails performance certification.
- Custom Next distribution folders stage their assets into the matching
  standalone directory, preserving CSS, hydration, service workers, and visual
  tests.
