# Historical multi-user simulation

This apparatus replays a deterministic cohort of private ALLO workspaces through the real Pipeline workflow in a separate local data plane. It is designed to answer one question: can the application carry a real, messy, multi-file workload across simultaneous owner accounts without losing access boundaries, files, state, audit history, or workflow progress?

It does not modify ALLO source files or production Pipeline data. Corpus objects, truth packs, browser traces, screenshots, local stores, and run evidence stay under the gitignored `.data/simulations/` tree with private filesystem permissions.

## What it sets up

- A proportional, seeded sample of 100 workspaces across every represented community.
- Every material belonging to each selected workspace, not only the primary referral packet.
- Historical owners represented as distinct reviewer principals, with Sandeep as the supervisor/admin principal.
- A valid logical timeline anchored to a unique profile admit date when available and otherwise to the first material date.
- Explicit handling for uploadable, missing, unsupported, undersized, oversized, and invalid-descriptor materials.
- Deterministic behavior profiles: straight-through, stop/resume, reopen, reschedule, concurrent reads, duplicate retry, and supervisor review.
- Coverage of Home/My Queue, referral directory, Calendar, Profiles, Operations, Intake, Files, Activity, Assessment, and Chart.
- Browser verification that every historical owner appears in God Mode and that an owner context can open its generated client profile.
- A source-grounded full-lifecycle gate. No assessment answer or clinical outcome is invented by the runner.

## 1. Dry-run the cohort selection

```bash
npm run simulation:historical:prepare -- \
  --dry-run \
  --count=100 \
  --seed=pipeline-allo-100-v1
```

The default inputs are:

- `.data/private-allo-workspace-import.json`
- `.data/private-allo-scanned-import.json`

The dry run validates both manifests, requires a valid clean malware-scan attestation, cross-checks every selected source item, and prints only aggregate counts. It writes nothing.

## 2. Materialize the private corpus

```bash
npm run simulation:historical:prepare -- \
  --execute \
  --confirm=MATERIALIZE-HISTORICAL-SIMULATION \
  --count=100 \
  --seed=pipeline-allo-100-v1
```

Materialization copies source files into a content-addressed object store, verifies byte sizes and SHA-256 digests, removes original source paths from the finished plan, and creates:

- `simulation.private.json` — private case, owner, timeline, file, and action plan.
- `simulation.summary.json` — aggregate, name-free summary.
- `truth-packs.template.json` — untouched template for source review.
- `truth-packs.private.json` — working private truth-pack file used by the runner.
- `objects/sha256/` — verified immutable corpus objects.

Existing output directories are never overwritten.

## 3. Preflight the files-and-surfaces run

```bash
npm run simulation:historical:run -- \
  --dry-run \
  --manifest=.data/simulations/<simulation-id>/simulation.private.json \
  --phase=files \
  --mode=busy_day
```

The preflight requires a complete materialized corpus and performs no application writes.

## 4. Run the isolated files-and-surfaces simulation

```bash
npm run simulation:historical:run -- \
  --execute \
  --confirm=RUN-ISOLATED-HISTORICAL-SIMULATION \
  --manifest=.data/simulations/<simulation-id>/simulation.private.json \
  --phase=files \
  --mode=busy_day
```

This run:

1. Registers every historical owner principal and the supervisor.
2. Has the supervisor create and assign all 100 referrals concurrently.
3. Replays duplicate create requests with the same mutation key where planned.
4. Uploads the real bytes for every supported material and confirms expected API rejection for every non-uploadable material.
5. Advances each workspace through packet review into Assessment.
6. Opens all global and per-workspace surfaces under the correct assigned account.
7. Reconciles the created cohort and reads each activity stream.

To leave the populated isolated application open for manual inspection, add `--inspect` to the execution command. The runner opens a headed browser at the God Mode account picker after the automated checks finish. Select any historical owner, open **Clients**, search for one of that owner’s assigned people, and inspect the complete profile and workspace. Resume or close the Playwright session when finished.

```bash
npm run simulation:historical:run -- \
  --execute \
  --inspect \
  --confirm=RUN-ISOLATED-HISTORICAL-SIMULATION \
  --manifest=.data/simulations/<simulation-id>/simulation.private.json \
  --phase=files \
  --mode=busy_day
```

## 5. Prepare source-grounded truth packs

Populate `truth-packs.private.json` case by case. The file is prefilled with the case name, any unique identity candidate, logical timeline, and material index so the reviewer can trace each value back to the staged corpus. Each case must contain:

- `review_status: "verified"`
- a complete `assessment_data` object supported by the source material
- a reviewed recommendation
- a reviewed supervisor decision
- at least one provenance entry identifying the supporting material and location

The runner refuses `--phase=full` until every selected case passes this gate. For the current admitted-client rehearsal, recommendation and decision outcomes must be `accept` and `accepted`.

## 6. Run the full lifecycle

```bash
npm run simulation:historical:run -- \
  --execute \
  --confirm=RUN-ISOLATED-HISTORICAL-SIMULATION \
  --manifest=.data/simulations/<simulation-id>/simulation.private.json \
  --phase=full \
  --mode=busy_day
```

The full phase adds schedule/reschedule, start, save/reopen, verified assessment entry, signature, recommendation, supervisor decision, move-in requirements, EHR handoff, and final reconciliation.

## Modes

- `historical_replay` — low concurrency, stable case order.
- `busy_day` — normal simultaneous referral and file pressure.
- `interrupted` — lower write concurrency with stop/resume emphasis.
- `chaos` — highest bounded concurrency and retry pressure.
- `chaos_extreme` — 100 independent, stateful virtual users with deterministic multi-tab, reconnect, retry, access-probe, collision, crash/restart, and replay behavior.
- `soak` — conservative concurrency for repeated long-running passes.

The same materialized manifest and mode are replayable. Every execution receives a new immutable run directory, so a new run is the reset mechanism and prior evidence remains intact.

## Chaos Lab product

`--mode=chaos` activates the versioned `pipeline-chaos-lab-v1` certification policy. The runner writes the exact private run plan to the immutable run directory and passes it to the browser harness; the plan is executable control data, not descriptive documentation.

The extreme policy deliberately combines:

- 20 simultaneous referral writers and a same-mutation replay of every one of the 100 create requests.
- Eight concurrent real-file ingestion workers, planned rejection boundaries, and digest/byte reconciliation.
- Unrelated-account access attempts for every case plus 40-way owner read fan-out across referrals, activity, and work items.
- Source-grounded stop/reopen/resume and reschedule paths.
- Same-version assessment save races where exactly one response must succeed and one must conflict.
- Equivalent supervisor decision races where exactly one durable decision may be created.
- Stale EHR handoff rejection followed by a visible downstream failure, retry, and successful send.
- Parallel browser traversal across all global and workspace surfaces, God Mode owner inspection, and terminal cohort/activity reconciliation.

Any unexpected server error, lost or duplicate referral, unauthorized disclosure, byte/digest mismatch, silent stale-write overwrite, or missing activity stream fails the run immediately. The attached certification summary contains only counts, policy/version identifiers, durations, and pass/fail evidence; it excludes names and source paths.

The files phase certifies identity, referral, file, access, read pressure, UI, and reconciliation. The full phase additionally requires all human-verified truth packs and certifies the assessment, decision, and EHR collision waves. Passing the files phase is never presented as a full-lifecycle certification.

## Chaos Extreme virtual-user lab

`--mode=chaos_extreme` activates `pipeline-chaos-extreme-v2`. It is a virtual-machine-style application simulator, not 100 operating-system VMs: each user has a unique principal, isolated API/browser session state, its own cookie-jar and cache identity, one to five tabs, device viewport, timezone and clock skew, network fault profile, retry budget, stale-view threshold, and deterministic 80-step behavior script. The run uses 100 unique principals with five administrators, ten assessment coordinators, seventy owner-scoped assessors, and fifteen read-only viewers.

For a 100-case corpus, the fixed seed compiles 8,000 per-user operations plus coordinated workload waves. The executable harness registers all accounts at one barrier, assigns each case to a mutation-capable user, drives 100-way API pressure, recreates sessions after planned disconnects, retries simulated lost responses, duplicates selected requests, probes owner and role boundaries, traverses every product surface through a bounded browser pool, and then reconciles durable state from fresh sessions.

The coordinated waves cover:

- same-key replay and same-person duplicate collisions;
- stale tabs, multiple tabs, refresh/navigation churn, response loss, timeouts, disconnects, and retry storms;
- same-section, disjoint-section, same-field, schedule, signature, decision, trash/restore, upload, worker, and EHR races;
- guessed workspace IDs, unrelated-assessor access, viewer mutation attempts, role/context switches, and God Mode entry/exit while other sessions remain active;
- database/read-pool saturation, real-file upload pressure, browser viewport variation, crash/restart recovery, and immutable final reconciliation.

The apparatus cannot target production: it accepts only materialized manifests beneath `.data/simulations/`, starts an isolated local application/data plane, and emits aggregate evidence without client names or original source paths.

Preflight and execute it with the same commands as other modes:

```bash
npm run simulation:historical:run -- \
  --dry-run \
  --manifest=.data/simulations/<simulation-id>/simulation.private.json \
  --phase=files \
  --mode=chaos_extreme

npm run simulation:historical:run -- \
  --execute \
  --confirm=RUN-ISOLATED-HISTORICAL-SIMULATION \
  --manifest=.data/simulations/<simulation-id>/simulation.private.json \
  --phase=files \
  --mode=chaos_extreme
```

When a virtual-user step fails, the error contains a redacted replay capsule with the seed, tick, virtual-user ID, step, action, target case ID, and failure class. Re-run only that step after the full setup using its selector:

```bash
npm run simulation:historical:run -- \
  --execute \
  --confirm=RUN-ISOLATED-HISTORICAL-SIMULATION \
  --manifest=.data/simulations/<simulation-id>/simulation.private.json \
  --phase=files \
  --mode=chaos_extreme \
  --replay=vu-042:18
```

Every successful execution also writes a PHI-free `certification-summary.json` into its private run directory. It preserves aggregate workflow, upload, surface, backpressure, authorization-rejection, disconnect, timeout, duplicate-delivery, and virtual-request evidence without client names or source paths.

Files mode deliberately leaves clinical values untouched. Full mode unlocks assessment, schedule, signature, recommendation, supervisor-decision, worker, and EHR race waves only after all 100 truth packs pass the existing human-provenance gate.

## Pass criteria

A run passes only when all of these remain true:

- Exactly one referral exists for every planned case despite duplicate retries.
- Each referral is visible to its assigned owner and inaccessible to unrelated reviewers.
- Every uploadable object is accepted with its original byte count and digest.
- Every non-uploadable object receives its planned response status.
- Every workflow mutation returns its expected versioned result.
- Signed assessments use only human-verified truth-pack values.
- Activity streams and final cohort reconciliation are complete.
- Every required surface renders without an application error or server error.

Run evidence is written only beneath `.data/simulations/runs/<run-id>/`.

## Contract check

```bash
npm run check:historical-simulation
npm run check:historical-chaos
npm run check:historical-chaos-extreme
```

These checks use synthetic fixtures only. They verify deterministic selection, proportional community coverage, material disposition, chronology, summary redaction, the human truth-pack gate, real-byte persistence for local supporting-file uploads, the 100-case policy, the 100-principal virtual-user topology, 8,000-step scheduler, collision cohorts, fault families, zero-tolerance stop rules, production lockout, and identifier-free certification evidence.
