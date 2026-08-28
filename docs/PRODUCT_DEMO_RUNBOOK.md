# Pipeline Product Demo Runbook

## Product Promise

Pipeline gives an admissions team one governed record from inbound referral through
packet review, assessment, decision, and EHR handoff. The demo must prove that the
right person sees the right work, operational totals agree, retries do not create
duplicates, and read-only users cannot change records.

This is a PHI-free product rehearsal, not a production load test. It uses isolated
local stores that are cleared around the run and never writes to live Azure,
Databricks, EHR, or identity systems.

## Demo Story

1. An intake coordinator receives a county referral, creates the referral record,
   records source and medication context, and assigns an assessor.
2. The referral moves from `New` to `Packet Needed`, `Packet Review`, or
   `Assessment` as its packet becomes complete and reviewed.
3. Assigned assessors find their own work in `My queue`; selected cases receive a
   Zoom assessment schedule and some are started.
4. Operations leads open Home, Referrals, and Operations, then reconcile totals by
   stage, community, and referral-received month.
5. Executive viewers can read approved operational surfaces but a referral-create
   attempt is rejected.
6. Retry pressure produces one referral, and a second assessor cannot read another
   assessor's assigned record.

## Scenario Contract

The versioned `product-demo-v1` fixture always creates:

| Dimension | Distribution |
| --- | --- |
| Users | 5 operations leads, 20 intake coordinators, 60 assessors, 15 executive viewers |
| Referrals | 100 synthetic records containing no PHI |
| Communities | 20 each across San Pablo, Santa Clarita, Turlock, Victoria's House, and JC Wallace |
| Received month | 50 current month, 30 previous month, 20 two months back |
| Workflow | 10 New, 20 Packet Needed, 30 Packet Review, 40 Assessment |
| Assessment work | 12 scheduled with Zoom, including 8 started |

## Run

```bash
npm run demo:100
```

The command builds the production app, starts an isolated server, runs the product
rehearsal, and writes a Playwright report. The JSON summary and Operations screenshot
are attached to the test result.

## Release Contract

The demo fails if any of these conditions are false:

- All 100 referrals are unique and every assessor has assigned work.
- List, dashboard, community, stage, and referral-received-month totals reconcile.
- Home, Referrals, and Operations load without an application error or horizontal overflow.
- Every API response is below 750KB, carries a request ID, and disables caching.
- Product-report p95 is below five seconds in the local rehearsal.
- Viewer mutation is denied, cross-assessor reads are hidden, and retry creates deduplicate.
- No request returns a server error.

## Deliberate Boundary

The 100-user scenario currently stops at active assessment work because recommendation,
decision, and EHR handoff rules are still being finalized. Dedicated lifecycle tests
cover those seams separately. Once the workflow is locked, extend this same scenario
with signed assessments, recommendation outcomes, final decisions, and accepted-only
EHR exports rather than inventing a parallel demo path.
