# Browser capacity rehearsal — isolated evidence

Baseline: `ccd474433c05001ed621c30643bde3f1b3e8a201`.
Runtime candidate: `1bae62b1d0a81a0a92d9f07a2e7a3afc9ffe6211`.
Latest harness: `1bd61d64de8d508b48a35003030cf32215f1d591`.
See [runtime rationale and boundary evidence](SAVE_RELIABILITY_EXECUTION_2026-09-19.md).

## Target and workload

Two production-build Next.js processes (4178/4179, pool 10 each) behind a
round-robin proxy on 4177 share disposable PostgreSQL 16. The split target is a
D4s_v6 VM, 4 CPU/16 GiB: app processes share CPUs 0–1, PostgreSQL uses CPUs 2–3.
Four separate 8-CPU/64-GiB VMs generate 25 actors each. Private SSH tunnels expose
only loopback ports. This is not an exact managed Azure production replica.

The first three-process profile on the same VM constrained PostgreSQL to one
CPU; it failed and is not used as a production sizing model. The corrected
three-process profile dedicates app CPUs 0–2 on that VM and PostgreSQL CPUs 6–7
on the original 8-CPU browser runner. That runner's browser processes are pinned
to CPUs 0–5; other generators also use six cores. The database was moved via a
consistent dump to `pipeline_capacity_three_20260919`, preserving 39 migrations,
1,065 synthetic referrals and 25,402 audit rows at transfer. The dump SHA-256 is
`8fd7887bfee884f002af90ec4ab7307daeb4853c67950e0f957f0a46c9b94dea`.
The three-process correction initially reused existing resources. No production
scale/cost change occurred.

A subsequent one-second database wait profile identified a durable-log flush
stall: during a sampled interval 19 WAL syncs consumed 1,751.777 ms (92.2 ms mean),
coinciding with governor rejections. The test DB used the VM's Standard SSD OS
disk, unlike production's 128-GiB Premium P10. A new disposable 128-GiB P10 data
disk (`pipeline-rehearsal-pg-premium`, no host caching) was therefore attached to
the same runner, at $17.92/month retail (about $0.025/hour while retained).
The cleanly stopped synthetic cluster was copied to
`/mnt/pipeline-pg-premium/postgres`; the original copy remains intact. CPU,
memory, connection pool, governor limits, application build, and workload remain
unchanged. `fsync` and `synchronous_commit` were verified on and all 39 migrations
retained. This is still not a managed PostgreSQL HA/production certification.

Actors use separate Chromium contexts, one browser process per ten contexts.
Distinct synthetic offsets 0/25/50/75 avoid identity reuse across generators.
Preparation is batched; measured loops run concurrently after a common barrier.
Actors fill and blur actual intake fields, navigate to Calendar and back every
third save, and pause 1–1.8 seconds per cycle. Approximately 30% share records and
edit different fields. This exceeds normal ten-assessor reading/interview activity.

Every acknowledged value is read from the other app process. Final database
values and exactly one audit entry per acknowledged write are independently
reconciled with SQL. Zero captured 429/5xx/browser exceptions and progress from
every actor in each steady 30-second window are required. Attachments report
p95/p99 saves, navigation, RSS/free RAM, generator delay, progress and write ledger.

`reload` mode loads full documents for Calendar/return. `in-app` uses the existing
Open calendar button and browser Back, verifies unchanged document time origin,
and reuses the warm editor. Never combine these profiles into one passing claim.

Only external census-directory responses are synthetic fixtures. Pipeline APIs
and PostgreSQL are real. Separate boundary tests opt into real isolated Azure
Blob storage. No production storage/clinical feed/email is used. Synthetic gateway
authentication and its build must never be deployed publicly.

## Results

| Profile | Candidate | Result |
| --- | --- | --- |
| Initial shared two-user | old runtime | Failed section-level phone/email collision; motivated field-aware rebase, shared case retained. |
| Monolithic 50-user reload | f127c81 | Failed browser/app CPU saturation on one machine; unsuitable for isolated app measurement. |
| Split 50-user reload, 120 s | 291561d | Failed: 1,946 acknowledgements, 64 captured 429s, one editor reopening failure. Only one shard reached final SQL/audit reconciliation. |
| Split 10-user in-app, 60 s | 2ffdc0a | Passed 414 saves; p95 231 ms/p99 419 ms; navigation p95 153 ms. |
| Split 25-user in-app, 60 s | 2ffdc0a | Passed 966 saves; p95 191 ms/p99 440 ms; navigation p95 487 ms. |
| Split 50-user in-app, 120 s | 2ffdc0a | Passed 3,665 saves, all actors/both backends, zero captured errors, SQL/audit match. Shard save p95 304/359 ms, p99 706/738 ms; navigation p95 595/548 ms. |
| Split 100-user in-app, two processes, 120 s | 85b960c | Failed: 5,227 acknowledgements, 1,084 captured 429s; three actors missed steady progress. |
| Same, recovery-clear optimization | f4096c7 / runtime 1bae62b | Failed: 5,521 acknowledgements, 418 captured 429s; five actors missed steady progress across the shards. |
| Three processes / one DB CPU, 120 s | 5b3d27b | Failed: 4,751 acknowledgements, 214 captured 429s; one actor missed steady progress. DB CPU constrained. |
| Three processes / two dedicated DB CPUs, 120 s | 2a91b2f | Failed: 5,679 acknowledgements, 89 captured 429s; four actors missed steady progress. |
| Same, click/focus actionability before typing, 120 s | 698e3a8 | Failed: 5,018 acknowledgements, 59 captured 429s. All actors progressed; final SQL/audit reconciliation passed. |
| Same, stable 100-person synthetic staff roster, 120 s | 1bd61d6 | Failed: 5,166 acknowledgements, 83 captured 429s. All actors progressed; final SQL/audit reconciliation passed. Shard save p95 664/637/932/910 ms; p99 2,071/1,886/2,151/2,082 ms. |
| Same, 60-second wait-profile diagnostic | 1bd61d6 | Failed: 2,692 acknowledgements, 84 captured 429s. All actors progressed; final SQL/audit reconciliation passed. |
| Same, production-class Premium P10 disk, 120 s | 1bd61d6 | Passed: 5,274 acknowledgements, zero captured errors, all 100 actors progressing, all three backends, final SQL/audit match. Shard save p95 322/314/453/459 ms; p99 520/619/731/757 ms. |
| Same, Premium P10, 20-minute peak | 1bd61d6 | Failed on three of four shards: direct cross-process `APIRequestContext.get` probes reported `socket hang up`. 28,829 acknowledged saves, zero captured browser HTTP 429/5xx/page errors; six actors ceased steady progress. Independent post-hoc SQL/audit reconciliation passed for every acknowledgement. |
| Same, two-hour soak | 1bd61d6 | Not run: controller correctly stopped after the failed peak. Sustained 100-user qualification remains open. |

Shard percentiles are not combined percentiles. Runtime `2ffdc0a` equals
`b443ec7`; `85b960c` adds recovered assessment-conflict deduplication only.
One initial ten-user run immediately after the DB outage captured a directory
500 and failed; the subsequent recovered run passed. Keep the transient visible.

Post-hoc SQL reconciliation matched all 12,694 acknowledged values and exactly
one audit entry per acknowledgement across the failed split 50-user reload and
both two-process 100-user runs. Failed runs remain failures. Unacknowledged
attempts are not counted as durable saved work.

The harness now waits for recovery to finish and actually clicks/focuses the
input before typing. Playwright `fill()` alone could alter an inert input without
a real user's focus/blur sequence. This is a test actionability correction, not
a relaxed persistence assertion. Reruns also reuse 100 staff principal IDs:
earlier run-scoped IDs had accumulated 804 active synthetic staff members. Those
exact old synthetic members were deactivated, not deleted; run-specific referral
records, values, and audit ledgers remain distinct. Neither correction removed
the overload failures. Changing only the test DB storage class subsequently
passed the short ramp. Calendar-and-return p95 was 808/802/1,300/1,326 ms across
the four browser generators; these are not production or combined percentiles.

### Peak failure and data reconciliation

The measured peak began at `2026-09-19T23:01:43.217Z`; the controller ended at
`23:21:53.068Z`. Shard acknowledged saves were 8,410 / 8,919 / 5,701 / 5,799.
Only the fourth shard completed every assertion. The other three threw the first
rejected actor outcome before their normal final SQL checks; their `measuredEnd`
is consequently zero, not evidence of a completed qualifying interval for all
actors. The controller did not start the soak or retry the peak.

The first exposed exceptions were direct test read probes on ports 4178 and
4179, after successful browser writes. These probes bypass the application's
authenticated fetch/retry path and use private SSH forwarding. The captured
browser-error array therefore does **not** encompass these transport exceptions.
Keep-alive/tunnel/client behavior versus an application transport fault remains
unresolved: there is no packet-level trace proving the root cause. Do not label
this harmless test flakiness, silently retry it away, or certify 100-user capacity.
Preserve reset counts/timestamps and actor outcomes in the next diagnostic;
first isolate the read-probe path from browser-visible behavior, then rerun the
unchanged persistence/progress obligations before any new soak.

Post-hoc reconciliation after all actors stopped verified all 28,829 peak
acknowledgements and 100 final actor-field values: zero mismatches and exactly
one matching audit event per acknowledged write. The two earlier three-process
failures were also reconciled: 10,430 additional acknowledgements, zero value or
audit mismatches. This is saved-data evidence only; failed load runs remain failed.

Shard peak save p95 was 828 / 657 / 1,167 / 1,238 ms; p99 was
1,083 / 800 / 1,393 / 1,460 ms. Calendar-and-return p95 was
2,915 / 2,323 / 4,508 / 4,743 ms. First-minute save p95 was
334 / 369 / 449 / 414 ms, rising in the last minute to
1,104 / 827 / 1,463 / 1,466 ms. That degradation remains a performance finding,
even with correct stored data and no captured browser HTTP errors.

### Memory and preserved evidence

Across 239 peak samples, all three application PIDs remained the same; aggregate
RSS moved from 1,176.7 to 1,328.4 MiB with a 1,340.7-MiB sampled maximum. The app
service reported zero restarts and a 1,538,478,080-byte memory peak. All five VMs'
retained kernel logs contained no OOM-kill events. The four generators' aggregate
Chromium RSS rose from roughly 6.2–6.3 GiB to 7.2–7.7 GiB; event-loop p99 was
109–205 ms. These observations do not distinguish bounded caches from a slow
leak or separate generator overhead from application latency. The skipped soak
means long-duration memory stability is **not** proved. No hard 2-GiB-per-app
container memory limit was enforced in this VM profile.

The final synthetic database retained 39 migrations, 2,265 referrals and 79,260
audit events, with `fsync=on` and `synchronous_commit=on`. Its custom-format dump
SHA-256 is `d511f6d655e182b1859827f4f421e8b324c0c11a680aff6f0af5a0cb21fd719e`.
All five evidence archives were downloaded, checked against remote SHA-256,
and inspected for required reports/logs/dump and exclusion of private keys/raw
database clusters. They remain in ignored `.data/readiness-runner/`:

| Archive | SHA-256 |
| --- | --- |
| `evidence-runner.tgz` | `ae5b818fcb24972adad2423438404a3a3ae57472e0c08934a4d974c9e9d09c00` |
| `evidence-app.tgz` | `b5b964588efe52671d8ba4f717298791756f8c303b081117f6164efdd4b7039f` |
| `evidence-browser2.tgz` | `ef0b596a985d7abcdb43d2184eeb4310ea769297582da754048b1736427e5e36` |
| `evidence-browser3.tgz` | `ef119b953a8a7433a07331c48e05c532605c323104a29ba17c81970c870c9d0c` |
| `evidence-browser4.tgz` | `b74dd1919562ad3a8e2d8657f6351ba1a7493d733a844233344eb3e6074298a8` |

Compact summaries, the final post-hoc reconciliation, archive verification and
the pre-deletion resource inventory are retained alongside those archives.
No production records or personal-browser sessions were used.

## Temporary testing cost checkpoint

Azure retail Linux rates checked 2026-09-19: D4s_v6 $0.202/hour, E8s_v6
$0.529/hour, E8ds_v6 $0.654/hour, E8as_v6 $0.477/hour, E8ads_v6 $0.581/hour.
The five existing VMs total $2.443/hour compute. Standard SSD allocation and five
standard static IPv4 addresses bring the base to approximately $2.51/hour before
disk operations, Blob transactions, and data transfer. Creation-time arithmetic
at 22:42 UTC estimated $5.28 compute; Cost Management had not reported any rows
for this new resource group, so that is not a finalized bill or a zero-cost claim.
All five VM auto-shutdown schedules were verified enabled for 01:30 UTC, then
extended to 01:50 UTC to permit evidence collection if the full soak passed.
After the failed peak, all evidence was collected early and the verified
synthetic resource group `rg-pipeline-rehearsal-20260919` was deleted.
`az group exists` returned `false` at `2026-09-19T23:33:38Z`: five VMs, six disks,
five public IPs, their networking, shutdown schedules and the synthetic Blob
account were removed. Evidence/backup archives remain local, not dependent on
those deleted resources. The local synthetic PostgreSQL server was stopped;
its files were retained. The approved temporary allowance is $50;
recurring production hosting is separate. No production resize was performed.
The final Cost Management query was rate-limited (HTTP 429), so no final billed
amount is claimed. Based on creation-to-cleanup hours, expected test-environment
cost is approximately $8–10; this is an estimate, not the Azure invoice.

## Reproduction and safety

### Follow-up diagnosis authorized September 20 UTC

Eric authorized targeted diagnosis, fixes and a new peak/endurance sequence
after reviewing the failure. The isolated branch now includes core-only
integration `991969a26a6be5c40e4cf96490607227c6ddfd2b` (live UI plus save
reliability and the defensive offline-reconciliation generation guard), without
Excel. Production remains untouched. New disposable resources are exclusively
in `rg-pipeline-diagnostic-20260920`; the previous rehearsal group remains deleted.
The same $50 total allowance includes the previous estimated $8–10 spend.

The retained peak's **server-side** PATCH duration p95 was 118 ms in minute zero,
100 ms in minute one and 106 ms in minute nineteen. GET p95 fell from 20 to
10 ms. Those measurements do not explain the simultaneous growth in browser
elapsed time and do not justify a speculative production database upgrade.

Two harness defects were identified and corrected without changing the browser
workload or weakening save/progress/audit assertions:

- Verification API response bodies and logs remained retained until context
  closure. Each is now disposed after its value is checked, including non-200
  responses. [Playwright's documented response lifecycle](https://playwright.dev/docs/api/class-apiresponse#api-response-dispose).
- Unscoped sustained actions repeatedly searched Playwright's growing step tree
  for a parent. Each actor now uses the public `test.step` context; no dependency
  internals were changed. An isolated 12,000-action real-browser comparison
  showed the flat log's later batches climbing to 922 ms per 1,000 actions,
  while the scoped batches remained approximately 630–700 ms. This is evidence
  of runner overhead, not by itself proof that all application slowdown is fixed.

The corrected harness records native browser HTTP duration separately from
server timing and blur-to-ack duration, per-minute API traffic, runner heap/RSS,
and CDP heap/DOM/script/layout samples for two pages per generator. Actor failure
timestamps and all cross-replica probe timings are retained. Failed actor runs
now still execute final acknowledged-write SQL/audit reconciliation before
reporting failure. Network retries remain explicitly zero.

A two-minute read-only connection diagnostic exercised loopback, SSH-tunneled
and VNet-direct paths with retained connections and `Connection: close` controls:
2,760 reads, all HTTP 200, zero resets. It **did not reproduce** the intermittent
failure. The subsequent 180-second, 100-user run (`aa654f4` harness) reproduced
one verification socket reset on actor 45. All 8,359 acknowledged saves and final
values reconciled. Shard save p95 was 328 / 372 / 285 / 280 ms; Calendar-and-back
p95 was 954 / 1,221 / 766 / 820 ms. No captured browser 429/5xx/page errors occurred.
The run remains **failed**, and the connection's cause remains unresolved.

That diagnostic also isolated retained test-runner memory: one generator's
JavaScript heap grew from 174 to 606 MiB in three minutes, while the sampled
application pages remained around 8–14 MiB with DOM counts falling after garbage
collection. Named steps fix parent lookup but do not release Playwright Test's
action history. A two-hour run through that reporter would confound application
memory measurement with test-runner growth.

Harness `6d36b015cb2371f2b93f25c5330cfab71e5bda43` therefore provides an explicit
standalone executor of the **same canonical workload callback**, using the
repository's existing TypeScript loader and installed Playwright browser APIs
and assertions. It replaces test registration/reporting only; no browser action,
SQL check, progress requirement, timeout, synthetic-only restriction, or failure
is stubbed or bypassed. It emits a distinguishable JSON report. A two-user,
30-second real-browser smoke passed including SQL/audit reconciliation; invalid
database targeting and an incorrect-value assertion were separately verified to
fail. Native HTTP diagnostics now capture socket reuse and idle age on failures.
The 180-second standalone 100-user diagnostic retained the original keep-alive
policy and zero retries. It passed 9,306 acknowledged saves, all SQL/audit checks,
all actors and all three backends, with zero captured failures. Shard save p95
was 274 / 280 / 248 / 246 ms; Calendar-and-back p95 was 781 / 820 / 631 / 665 ms.
Runner RSS ended around 662–781 MB rather than approximately 980 MB in the
instrumented Test-runner profile; longer observation is still required to
separate bounded Playwright request-object caching from continued growth.
The intermittent reset is not proved fixed by this short pass. A 20-minute peak
with the same `6d36b01` harness is now running with socket-error and FIN/RST-header
diagnostics. No sustained capacity/endurance pass is claimed yet.

### Standalone peak and captured idle-connection race

The 20-minute standalone peak ran from `2026-09-20T00:31:39.824Z` and **failed**
one actor on browser generator 2. All 66,445 acknowledged writes and final values
passed SQL/audit reconciliation before that failure was reported. Three shards
passed; the affected shard lost steady progress from actor 49. No captured
browser 429/5xx/page exceptions occurred. Shard save p95 was 214 / 216 / 224 /
226 ms and Calendar-and-back p95 was 604 / 652 / 564 / 576 ms. The failed run
does not certify sustained progress by all 100 users.

The new diagnostics identify the specific failing verification connection:

- At epoch-ms `1789864405412`, the Node verification request reused local socket
  `48148` to backend `4178`, idle for 5,968 ms. It raised `ECONNRESET` after 16 ms.
- Browser-generator TCP capture shows a server FIN to that exact socket at
  epoch-seconds `1789864405.412606`; application-host capture shows backend
  `4178` issuing a reset at `1789864405.412198`.
- This is the verification client's reused idle connection racing the server's
  closure, after a successful browser write. It is not evidence of a lost write.
  It does not retroactively prove the cause of every older uninstrumented reset.

Runner RSS reached a plateau rather than the Test reporter's unbounded action
history growth: last full five-minute medians were approximately 865 / 703 /
732 / 761 MB. Sampled application-page heaps ended around 11–19 MB. The app
service had zero restarts, a 1,979,412,480-byte aggregate memory peak and
1,253,347,328 bytes after the run. Longer endurance remains unqualified.

A distinctly labeled 180-second `freshprobe100` control is now running. It sends
`Connection: close` on the independent cross-replica verification GET only,
with zero retries. Actual browser connections, UI actions, actors, think times,
field checks and SQL/audit obligations are unchanged. Only if it passes may one
corrected peak, then one two-hour soak proceed. Prior failed profiles stay failed;
the connection-policy change must remain explicit in all reported results.

That fresh-connection control passed 9,922 saves, all 100 actors' steady progress,
SQL/audit reconciliation, all HTTP 200 verification reads and zero captured
transport/browser failures. Shard save p95 was 222 / 222 / 240 / 261 ms;
Calendar-and-back p95 was 557 / 520 / 600 / 674 ms. The corrected 20-minute peak
(`freshprobe100-peak`, same `6d36b01` harness, explicit `close` verification policy)
is running. It must pass before endurance; no production application change or
capacity certification follows from this short control alone.

Use only loopback PostgreSQL named `pipeline_capacity_*` and unchanged canonical
migrations. Never deploy the synthetic build or point this harness at production.

```bash
export PIPELINE_TEST_DATABASE_URL=postgresql://pipeline_test@127.0.0.1:55479/pipeline_capacity_20260919
PIPELINE_DATABASE_URL="$PIPELINE_TEST_DATABASE_URL" PIPELINE_DATABASE_SSL_MODE=disable node scripts/apply-database-migrations.mjs
NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED=false NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED=true NEXT_PUBLIC_PIPELINE_PERSONA_DEMO=false PIPELINE_AUTH_MODE=headers PIPELINE_TRUSTED_GATEWAY=true PIPELINE_DEPLOYMENT_ID=capacity-rehearsal npm run build
PIPELINE_CAPACITY_USERS=2 PIPELINE_CAPACITY_SECONDS=60 PIPELINE_CAPACITY_NAVIGATION=in-app node node_modules/@playwright/test/cli.js test --config=playwright.capacity.config.ts browser-capacity
```

Distributed runs set `PIPELINE_CAPACITY_REMOTE=true`, exact 40-character
`PIPELINE_CAPACITY_COMMIT`, common future epoch-ms `PIPELINE_CAPACITY_START_AT`,
distinct `PIPELINE_CAPACITY_ACTOR_OFFSET`, and `PIPELINE_CAPACITY_REPLICAS=2|3`
matching the target and forwarded backend ports. Use 25 actors per generator,
1,200 seconds for peak and 7,200 for soak. Dedicated-config metadata is mandatory.
More than ten users on less than 32 GiB is refused; do not bypass this laptop guard.

DB outage tests additionally require explicit fault opt-in and the exact disposable
Linux data directory. Never enable faults on a browser VM forwarding another DB.

Ignored outputs: `.data/capacity-20260919/` and `.data/readiness-runner/`. Preserve
failed runs, source IDs, target/generator metrics and recovery artifacts before
deleting temporary Azure resources.

## Limits

This is intake saves/navigation/cross-process persistence, not the entire
assessment/upload/submission suite (separate browser fixtures cover those).
It does not certify production latency, independent computers/networks, Entra,
Databricks, real mobile devices, zone outages, or 1,000 users. Do not remove the
governor or raise production limits merely to turn a failed test green.
