# Operational Testing Strategy

## Purpose

Pipeline is an admissions operations system for behavioral health referrals. The
test system must prove that a small team can safely move work from inbound
referral through packet upload, extraction review, assessment, decision, and EHR
handoff while the backend handles large document volumes outside of Next.js.

The rule is simple: tests should mimic the real admissions floor. If an
assessment coordinator, assessor, reviewer, supervisor, or read-only user can do
something important in production, we need a repeatable test that proves the
path works or fails safely.

## Primary Users To Mimic

| Persona | Role | What The Tests Must Prove |
| --- | --- | --- |
| Admissions coordinator | `assessment_coordinator` | Can create referrals, route packets, schedule assessments, record decisions, and recover blocked work. |
| Assigned assessor | `reviewer` | Can work assigned assessments, save drafts, confirm extracted fields, and make recommendations without supervisor-only powers. |
| Community reviewer | `reviewer` | Can review community-specific referrals and documents without crossing referral ownership boundaries. |
| Supervisor/admin | `admin` | Can override, decide, trash/restore, inspect queues, and see operational health. |
| Viewer | `viewer` | Can read approved surfaces but cannot mutate referrals, packets, assessments, decisions, or EHR handoffs. |
| Extraction worker | internal worker | Can pull queued packet work and write state transitions without browser-user authentication. |
| Unauthorized user | none | Cannot read or write PHI-bearing routes. |

## Critical Journeys

| Journey | Happy Path | Failure Path |
| --- | --- | --- |
| Inbound referral intake | Create referral shell, assign community/month, attach packet, preserve source metadata. | Missing required identity or duplicate candidate blocks clean creation. |
| Packet upload | Signed upload URL is issued, file lands in blob storage, upload completion creates processing state. | Unsupported file, duplicate file id, oversized request, or stale packet id returns a bounded error. |
| Extraction review | Extracted fields show confidence, source page, missing values, and accept/edit/retry actions. | Low confidence, invalid JSON, page order issues, and worker failure land in review or dead-letter state. |
| Assessment | Assigned assessor schedules, starts, saves, completes, signs, and adds append-only addenda. | Unassigned work, stale versions, unsigned completion, and signed edits are blocked with recovery copy. |
| Decision | Supervisor records accepted, declined, waitlisted, or needs-more-info decision. | Accepted decision without required recommendation or override is blocked. |
| EHR handoff | Accepted referral enters export queue with structured fields and attached packet references. | Export errors remain queued with retry metadata and do not mark EHR writeback complete. |
| Community/month navigation | Recent work, current month, prior months, and community folders show the same source records. | Empty, slow, or failing lists keep filters usable and show retry states. |
| Concurrent editing | Separate sections merge, same-section edits produce one winner and expected conflicts. | Stale writes return `409`; no dirty local field is overwritten silently. |

## Test Layers

| Layer | Tooling | Required Coverage |
| --- | --- | --- |
| Static policy | `scripts/api-route-policy-audit.mjs`, ESLint, TypeScript | Route logging, auth, role boundaries, same-origin mutations, no viewer writes, no internal/browser auth mixing. |
| Domain contracts | Replay scripts in `scripts/*contracts.mjs` | Workflow state, assessment lifecycle, extraction state machine, retention, storage, security, release compatibility. |
| API fixtures | `scripts/api-behavior-fixtures.mjs` | Request validation, idempotency, status codes, body limits, safe errors, health readiness. |
| Browser operator QA | Playwright | Referral creation, packet modal, filters, assessment shell, dashboard, file preview/download, empty/failure states. |
| Account mimic QA | Playwright contexts and API requests with role-specific principals | Admin, assessment coordinator, reviewer, viewer, unauthorized, and worker permission boundaries. |
| Collaboration/concurrency | `scripts/collaboration-load-smoke.mjs` plus Playwright multi-context specs | Presence leases, section versions, same-section conflicts, per-user drafts, recents isolation. |
| HTTP load smoke | `scripts/http-load-smoke.mjs` | Core read endpoints under concurrent users with status and p95 bounds. |
| Complete performance certification | `scripts/complete-performance-certification.mjs` | Compiled production browser metrics, navigation, guides, menus, filters, exports, API load/capacity, 20-account contention, scale, and soak evidence in one PHI-free report. |
| Bounded soak | `scripts/http-soak-smoke.mjs` | Sustained multi-account reads, p95/p99, status classes, latency drift, throughput, generator event-loop delay, and bounded memory use for runs from 5 seconds through 48 hours. |
| Data scale | `scripts/synthetic-scale-benchmark.mjs`, query plan audits, storage readiness | 100GB-class corpus metadata, keyset pagination, bounded response sizes, no raw binary through Next.js. |
| Extraction quality | Golden de-identified packet fixtures and worker contracts | Page manifest, OCR routing, schema validation, confidence thresholds, human review queue, dead-letter recovery. |
| Recovery and chaos | Failure/recovery scripts and drills | Duplicate ingest, worker retries, dead letters, backup/restore, stale drafts, packet reprocessing from immutable raw files. |
| Visual/accessibility | Playwright, axe, snapshots | Desktop/mobile layout, no horizontal overflow, keyboard path, modal focus, stable visual baselines. |
| Live/staging rehearsal | Entra live access, live database smoke, load checks with explicit remote flag | Production-like identity, database, Azure storage, Databricks, and alerts without using real uncontrolled PHI. |

## Account Mimic Design

All non-live tests should use synthetic accounts with deterministic headers or
mock sessions. The goal is to verify application behavior, not Entra itself.

| Synthetic Account | Role Claims | Test Use |
| --- | --- | --- |
| `ops-admin@pipeline.local` | `Pipeline.Admin` | Final decisions, supervisor queue, override, trash/restore. |
| `admissions@pipeline.local` | `Pipeline.AssessmentCoordinator` | New referral, packet upload, scheduling, decision prep. |
| `assessor-a@pipeline.local` | `Pipeline.Reviewer` | Assigned assessment, extraction review, recommendation. |
| `assessor-b@pipeline.local` | `Pipeline.Reviewer` | Concurrency conflict and reassignment tests. |
| `viewer@pipeline.local` | `Pipeline.Viewer` | Read-only route access and mutation denial. |
| `outsider@example.invalid` | none | 401/403 denial checks. |
| `pipeline-worker` | internal worker secret | Extraction queue, dispatch, reconcile, dead-letter routes. |

## Playwright Build-Out

Create a reusable auth fixture for Playwright:

| Helper | Behavior |
| --- | --- |
| `asRole("admin")` | Creates an API request context or page context with admin principal headers/session. |
| `asRole("assessment_coordinator")` | Creates coordinator identity and isolates browser storage. |
| `asRole("reviewer", { assignedTo })` | Creates an assigned assessor context. |
| `asRole("viewer")` | Verifies read-only UI and API behavior. |
| `asUnauthorized()` | Verifies denial and no data leakage. |

Playwright suites to build next:

| Suite | What It Should Cover |
| --- | --- |
| `role-access.spec.ts` | Viewer cannot mutate, reviewer cannot decide, coordinator can schedule, admin can override. |
| `referral-lifecycle.spec.ts` | Create referral, upload packet, review extraction, start assessment, recommend, decide, EHR queue. |
| `packet-processing.spec.ts` | Large descriptors, duplicate upload completion, polling status, dead-letter presentation. |
| `concurrent-canvas.spec.ts` | Two assessors editing different sections merge; same field conflict is visible and recoverable. |
| `ehr-handoff.spec.ts` | Accepted-only export, retry state, no declined referral export. |
| `navigation-scale.spec.ts` | Month/community folders, recent work, filtered worklist, paginated all-referrals page. |

## Concurrency Targets

| Target | Baseline | Release Gate |
| --- | --- | --- |
| Browser/API identities editing same referral | 2 users | 20 users, one winner for same-section contention. |
| General API reads | 10 concurrent | 50 concurrent local, remote only with explicit flag. |
| Packet status polling | 10 concurrent packets | 50 polling clients with no stuck processing state. |
| Referral creation | 5 concurrent users | Idempotent `client_mutation_id`; no duplicates from retry. |
| Draft saves | 10 concurrent same user | One winner, expected `409` conflicts, no cross-user draft leakage. |

## Data Volume Strategy

Do not load 100GB into CI. Test the metadata and orchestration shape instead.

| Data Surface | Test Method |
| --- | --- |
| Raw PDFs/images | Blob-path manifests, file hashes, size metadata, immutable path conventions. |
| Normalized pages | Synthetic page manifests with page count, sequence, route target, and failure states. |
| OCR artifacts | Golden de-identified JSON fixtures and schema validation. |
| Delta records | Query plan audits, pagination contracts, evidence row count limits. |
| Backlog import | Batch manifest rehearsal with chunking, resume markers, dedupe, dead-letter queue. |
| Weekly incrementals | Small live-like upload run with status polling and review queue creation. |

## Certification Tiers

| Tier | Command | Use |
| --- | --- | --- |
| Quick | `npm run certify:operations:quick` | Run before most commits. Static, deterministic, no browser. |
| Operator | `npm run certify:operations:operator` | Run before UI/workflow handoff. Builds and runs Playwright operator suites. |
| Release | `npm run certify:operations` | Main local release gate. Includes quick, build, browser QA, artifacts, and supply chain. |
| High Assurance | `npm run certify:operations:high` | 10x-importance gate. Adds high-traffic scaffolds, scale, query, storage, recovery, chaos, alerts, metrics, security, deployment, and supply-chain checks. |
| Complete Performance | `npm run certify:performance` | Builds once, runs the McMaster browser scorecard, 50-way API capacity, 20-account contention, synthetic scale, and a 30-second local soak; writes aggregate evidence under `outputs/performance-certification`. |
| Capacity | `npm run certify:operations:capacity` | Capacity-only gate. Static 10x capacity model plus optional HTTP capacity smoke when a base URL is explicitly configured. |
| Load | `npm run certify:operations:load` | Run against a local or explicitly approved staging URL. Exercises HTTP and collaboration concurrency. |
| Live | `npm run certify:operations:live` | Staging/production rehearsal only. Requires real env and explicit flags. |
| 100-User Product Demo | `npm run demo:100` | Rehearses one synthetic admissions day with 5 operations leads, 20 coordinators, 60 assessors, and 15 read-only viewers across intake, assignment, packet review, active assessments, reports, personal queues, and real UI surfaces. |
| 100-Point Local Assurance | `npm run certify:assurance` | Runs the complete deterministic and browser profile. A pass proves 90 local points and identifies the 10 remaining live proofs. |
| 100-Point Live Assurance | `npm run certify:assurance:live` | Strict staging certification. Missing live configuration is a failure, never a silent skip. |

## Scaffold Map

| File | Purpose |
| --- | --- |
| `scripts/operational-certification.mjs` | Composes quick, operator, release, load, and live certification tiers and writes PHI-free JSON evidence when run. |
| `playwright.operational.config.ts` | Runs only the operational Playwright suites with header-auth role mimics and isolated local stores. |
| `tests/e2e/support/pipeline-actors.ts` | Defines synthetic admin, coordinator, assessor, viewer, outsider, and worker identities. |
| `tests/e2e/support/operational-api.ts` | Shared helpers for creating synthetic referrals and parsing workflow API responses. |
| `tests/e2e/operational/role-access.spec.ts` | Verifies role boundaries and internal-worker separation. |
| `tests/e2e/operational/referral-lifecycle.scaffold.spec.ts` | Verifies the current referral-to-packet-to-extraction orchestration seam. |
| `tests/e2e/operational/concurrent-referral-edits.scaffold.spec.ts` | Verifies disjoint edit merging and same-section conflict protection. |
| `tests/e2e/operational/golden-thread.spec.ts` | Uses separate coordinator, assessor, supervisor, second-assessor, and viewer accounts to prove referral intake through accepted EHR handoff and retry. |
| `tests/e2e/support/product-demo-scenario.ts` | Versioned, PHI-free product scenario with exact persona, community, month, stage, priority, packet, medication, and assessment distributions. |
| `tests/e2e/operational/high-traffic-capacity.scaffold.spec.ts` | Opt-in product and capacity rehearsal for generated account cohorts, role-aware work, exact operational reconciliation, UI surface smoke, bounded responses, retry idempotency, and assessor isolation. |
| `scripts/operational-capacity-model.mjs` | Static 10x capacity model that audits repo guardrails without sending traffic. |
| `scripts/http-capacity-smoke.mjs` | Remote-gated capacity smoke for high-concurrency read traffic against local or explicitly approved staging targets. |
| `scripts/http-soak-smoke.mjs` | Bounded 5-second-to-48-hour soak with fixed-size histograms, phase drift checks, throughput, status, response-size, event-loop, and memory evidence. |
| `scripts/complete-performance-certification.mjs` | One-command local performance certification and explicit PostgreSQL, clinical-backed, and live-packet evidence gates. |
| `scripts/platform-assurance-registry.mjs` | Defines 100 one-point controls across 10 product and platform domains. |
| `scripts/platform-assurance-certification.mjs` | Executes local 90-point or strict live 100-point profiles and writes PHI-free evidence. |

The files under `tests/e2e/operational` are intentionally isolated from the
default Playwright suite while the final workflow is still moving. Run them only
through `npm run test:e2e:operational` or a certification tier that includes it.

## 10x High-Assurance Profile

| Dimension | Target |
| --- | --- |
| Named users | 250 synthetic or live-role-mapped users. |
| Concurrent browser users | 100. |
| Concurrent referral editors | 50. |
| Concurrent API reads | 250. |
| Concurrent mutations | 100. |
| Packet status polling | 10,000 polls/minute. |
| Referral reads | 6,000 reads/minute. |
| Weekly incremental pages | 5,000 pages/week. |
| Backlog storage rehearsal | 1,000GB metadata/storage model. |
| Next.js binary handling | 0 raw packet bytes through standard API routes. |
| List response cap | 750KB per high-traffic route response. |

The high-assurance profile deliberately separates static capacity evidence from
live load. Static checks can run on any branch. Live capacity checks require
`PIPELINE_CAPACITY_BASE_URL`, and remote targets require the explicit remote flag
in the certification runner.

## Complete Performance Profile

`npm run certify:performance` runs against isolated synthetic stores and the
compiled standalone application. Its default local profile exercises 20 account
identities, 50 concurrent API readers, 2,000 capacity requests, all scored UI
journeys, and a 30-second soak. Override `PIPELINE_SOAK_SECONDS` for a longer run;
the runner enforces a maximum of 172,800 seconds (48 hours) and retains only
bounded histograms and aggregate status classes.

The local profile does not impersonate infrastructure it cannot reach. These
additional measurements are reported as explicit skipped evidence unless their
configuration is present:

| Evidence | Configuration |
| --- | --- |
| PostgreSQL read/write capacity | `PIPELINE_TEST_DATABASE_URL` |
| Clinical-backed HTTP capacity | `PIPELINE_PERFORMANCE_CLINICAL_BASE_URL` |
| Live packet extraction | `PIPELINE_LIVE_CERTIFICATION=true` and `PIPELINE_SAMPLE_PACKET_PATH` |

Use `node scripts/complete-performance-certification.mjs --strict-external` when
all three external measurements are mandatory. Remote checks retain their own
explicit opt-in and safety guards.

## Pass/Fail Contract

Every certification result should report:

| Field | Meaning |
| --- | --- |
| `ok` | Overall pass/fail. |
| `tier` | Certification tier. |
| `duration_ms` | Total runtime. |
| `results[]` | One entry per check with name, command, status, duration, and skipped reason. |
| `skipped[]` | Env-gated checks that were intentionally not run. |
| `failed[]` | Checks that failed and must block release. |

## What To Build Next

1. Add packet-processing browser fixtures for low-confidence extraction, failed worker, dead-letter, and retry presentation.
2. Add staging-safe browser concurrency with non-interactive Entra test accounts and an explicit remote opt-in.
3. Add visual and accessibility baselines for the product-demo data set after the workflow layout stabilizes.
4. Attach assurance artifacts to release evidence with a defined retention and approval owner.
5. Add a sandbox EHR adapter rehearsal when the destination contract and credentials are available.
