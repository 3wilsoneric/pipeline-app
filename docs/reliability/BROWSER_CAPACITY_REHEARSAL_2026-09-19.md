# Browser capacity rehearsal — isolated, not production certification

Application source: `ccd474433c05001ed621c30643bde3f1b3e8a201`.
No application code changes are required by this harness.

## What is prepared

`playwright.capacity.config.ts` starts two production-build Next.js processes
on loopback ports 4178/4179 behind a round-robin proxy on 4177. Both use the
same disposable PostgreSQL 16 database, pool limit 10 per process, with the
repository's unchanged migrations. No production database, browser profile,
email, Azure storage, or clinical feed is used.

The capacity spec creates 2–100 separate authenticated browser contexts,
one browser process per ten contexts. These are independent browser sessions,
**not independent laptops, networks, or Entra sign-ins**. Synthetic gateway
principals are accepted only by the isolated test server. Never deploy its build
or settings to a public endpoint.

Preparation creates synthetic records in bounded batches. The measured phase
runs all actors concurrently rather than serially calling an API. They type
into the actual intake UI, blur to save, navigate to Calendar, return, and check
their saved values. Thirty percent of the full run share records and edit
different fields; the small rehearsal always includes a shared pair.

Each acknowledged save is independently reread from the other app process.
Afterward the harness reconciles final field values directly with PostgreSQL,
and every acknowledged value against its actor's audit record. It requires
successful writes on both backends, progress by all actors, and no captured
browser exceptions/server errors. External census-directory requests alone
are fulfilled with an empty synthetic fixture; Pipeline APIs are real.

The JSON attachment records save p95/p99, actor overlap, generator event-loop
delay, free memory and the synthetic write ledger. Timing is reported, **not
automatically certified as meeting a production latency SLO**.

## Run safely

The spec is skipped unless the dedicated capacity config explicitly opts in via
`metadata.pipelineCapacityRehearsal`. Ordinary browser suites cannot accidentally
start it. With the dedicated config selected, missing/invalid database, profile,
or hardware requirements still fail; they do not silently skip the workload.

Use PostgreSQL 16 and a dedicated loopback-only database whose name starts
with `pipeline_capacity_`. Apply migrations using the canonical migration
script. Example for the existing local rehearsal database:

```bash
export PIPELINE_TEST_DATABASE_URL=postgresql://pipeline_test@127.0.0.1:55479/pipeline_capacity_20260919
PIPELINE_DATABASE_URL="$PIPELINE_TEST_DATABASE_URL" PIPELINE_DATABASE_SSL_MODE=disable node scripts/apply-database-migrations.mjs

NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED=false NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED=true NEXT_PUBLIC_PIPELINE_PERSONA_DEMO=false PIPELINE_AUTH_MODE=headers PIPELINE_TRUSTED_GATEWAY=true PIPELINE_DEPLOYMENT_ID=capacity-ccd4744 npm run build

PIPELINE_CAPACITY_USERS=2 PIPELINE_CAPACITY_SECONDS=60 node node_modules/@playwright/test/cli.js test --config=playwright.capacity.config.ts
```

The local PostgreSQL instance created for this preparation uses trust auth
**on loopback only**, not a production credential. Start/stop its exact owned
data directory with PostgreSQL's `pg_ctl`; never point this test at an existing
app database. Test rows remain only in the disposable capacity database.

For a full measured 20-minute run on a dedicated adequately sized runner:

```bash
PIPELINE_CAPACITY_USERS=100 PIPELINE_CAPACITY_SECONDS=1200 node node_modules/@playwright/test/cli.js test --config=playwright.capacity.config.ts
```

The harness refuses more than ten users on machines with less than 32 GiB
physical RAM. This is a safety floor, not proof that 32 GiB can sustain the run.
The current operator laptop has 16 GiB: **do not bypass that guard**. A temporary
Azure runner must be priced and created within the approved $50 rehearsal
allowance before using it; none has been provisioned by this preparation.

Output: `.data/capacity-20260919/playwright.json` and test attachments. These are
ignored, synthetic-only artifacts. The server controller terminates its own
children after a run; PostgreSQL is stopped separately by its owner.

## Not covered by this slice

- The full 100-user run and two-hour soak have not run.
- Azure resource saturation, replica placement, real Entra session continuity,
  Blob upload/preview idempotency, extraction worker claims, lost connections,
  and database failover require separate isolated production-like rehearsals.
- This spec focuses on intake saves, navigation and cross-process persistence;
  it does not replace assessment, submission, attachment, or same-field conflict
  tests. Do not report this single spec as the complete Chaos Extreme suite.
- Do not raise production limits based solely on a laptop timing result.

## Rehearsal result and blocking finding

Two users on separate records passed the 15-second local rehearsal, including
cross-process reads, final database values and per-write audit checks.

The shared-record rehearsal (run `capacity-1789846497761`) failed: simultaneous
phone/email edits produced a visible `Retry saving` / changed-in-another-session
state for one actor. Only one actor obtained acknowledged saves. Its 20 saves
had p95 297 ms and p99 599 ms; these timings do not qualify the failed run as
healthy. The other field remained pending in the browser. No acknowledged data
loss has been established by this result.

Read-only trace: `referral-sections.ts` maps both `phone` and `email` to
`identity`. The canvas sends that section's version with its field patch;
`patchPostgresReferral` rejects a stale section version, and the route returns
409. This is a section-granularity collision, not evidence of a database outage,
HA problem or a replica-specific defect. No production app code was altered to
hide or work around it.

Hold the planned second warm app replica and full capacity certification until
this conflict case is understood and the unchanged test passes. Existing maximum
three is not evidence of cross-instance correctness. Keep this failure visible;
do not serialize users or remove the shared-record case to make the test green.
