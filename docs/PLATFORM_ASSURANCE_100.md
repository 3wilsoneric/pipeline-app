# Pipeline 100-Point Assurance

## Purpose

Pipeline handles behavioral-health referral packets, clinical assessment work,
admission decisions, and EHR handoff. A green build alone is not adequate. The
assurance system proves the product from operator action through application,
data, document, identity, recovery, and deployment boundaries.

The model contains 100 one-point controls in 10 domains. Ninety points are
provable without production infrastructure. Ten points deliberately require a
configured, isolated live environment. Missing credentials never count as a
pass.

## Score Meaning

| Score | Meaning |
| --- | --- |
| `100/100 control coverage` | All controls are mapped to an executable gate and checked-in evidence. This is a design-coverage score, not proof that the commands passed today. |
| `90/100 local certification` | Deterministic contracts, production build, artifact audit, core browser journeys, role-separated workflows, 100-user rehearsal, desktop, cross-browser, and visual gates passed in one run. |
| `100/100 live certification` | The local 90 passed and the configured Entra, PostgreSQL, real-packet, collaboration, load, performance, capacity, and restore rehearsals also passed. |

`npm run check:assurance` audits the registry. It must always report exactly 10
domains, 100 unique controls, 90 local points, 10 live points, valid gate names,
existing package scripts, and existing evidence files.

## Domains

| Domain | What It Protects |
| --- | --- |
| Admissions workflow | Referral, packet, extraction review, assessment, decision, EHR, month/community workspace. |
| Identity and authorization | Entra roles, assignment, worker boundary, viewer denial, same-origin mutation. |
| Data integrity and concurrency | Validation, idempotency, section versions, transactions, migrations, pagination. |
| Documents and extraction | Direct Blob upload, immutable raw files, manifests, OCR routing, review evidence, retry. |
| Assessment and clinical safety | Medication carry-forward, Zoom, required fields, signatures, addenda, recommendation separation. |
| Reporting and EHR interoperability | Accepted-only export, retry, outbox idempotency, report scope, client linkage. |
| Operator experience and accessibility | Keyboard, focus, mobile, empty/error states, visual and browser compatibility. |
| Performance and capacity | 100-user day, 100GB-class metadata, query plans, response bounds, live load budgets. |
| Reliability and recovery | Health, retry, chaos, dead letters, backup, rollback, retention, restore. |
| Release, observability, and compliance | PHI-safe telemetry, alerts, audit, supply chain, artifacts, Azure identity, CI selection. |

The canonical control list is `scripts/platform-assurance-registry.mjs`. Tests
can move while the workflow is still being finalized, but a control may not be
deleted silently. Replace it with equivalent or stronger evidence.

## Commands

| Command | When To Run | Result |
| --- | --- | --- |
| `npm run check:assurance` | Every change to tests, gates, or workflow contracts. | Fast registry integrity and 100-point coverage audit. |
| `npm run certify:assurance` | Weekly and before a release candidate. | Executes the complete local 90-point profile and writes PHI-free JSON evidence. |
| `npm run certify:assurance:live` | Staging release rehearsal after live configuration is ready. | Executes local and live controls; fails on any missing live environment variable. |
| `npm run test:e2e:operational` | Workflow development. | Role, lifecycle, concurrency, and golden-thread tests. |
| `npm run test:e2e:operational:high` | Product demo or operational release. | Adds the 100-user product and capacity rehearsal. |
| `npm run check:workflow-fuzz` | Every workflow or SLA change. | Replays 2,000 randomized histories against an independent transition oracle and controlled clock. |

Evidence is written to `outputs/platform-assurance` with mode `0600`. It stores
control IDs, gate names, status, duration, and missing configuration names only.
It must never store referral names, packet content, diagnoses, medications,
tokens, database URLs, or response bodies.

## Local Certification

The local profile executes gates in this order:

1. Deterministic platform contracts.
2. Production build.
3. Production artifact audit.
4. Core browser journeys.
5. Role-separated golden thread and 100-user operations suite.
6. Desktop readiness.
7. Firefox and WebKit smoke.
8. Visual regression.

The golden thread uses separate coordinator, assessor, supervisor, second
assessor, and viewer identities. It proves packet review, referral medication
carry-forward, Zoom scheduling, signed recommendation, supervisor acceptance,
move-in requirements, stale EHR conflict, failed handoff recovery, successful
retry, and viewer mutation denial.

## Live Certification

The strict live profile requires these inputs in a protected staging runner:

| Proof | Required Configuration |
| --- | --- |
| Entra role rehearsal | `PIPELINE_ACCESS_SMOKE_BASE_URL` and protected viewer, assessor, supervisor, and admin token files. |
| PostgreSQL transaction rehearsal | `PIPELINE_DATABASE_URL`. |
| Real packet extraction | `PIPELINE_SAMPLE_BASE_URL`, `PIPELINE_SAMPLE_PACKET_PATH`. Use only a de-identified approved packet. |
| Collaboration contention | `PIPELINE_COLLABORATION_BASE_URL`. |
| Authenticated API load | `PIPELINE_LOAD_BASE_URL`. |
| Browser performance | `PIPELINE_PERF_BASE_URL`, `PIPELINE_PERF_STORAGE_STATE`. |
| Capacity | `PIPELINE_CAPACITY_BASE_URL`. |
| Restore | `PIPELINE_TEST_DATABASE_URL`, `PIPELINE_RESTORE_BACKUP_PATH`. The target must be disposable. |

Remote load is opt-in in the runner. Never aim it at production without an
approved window and capacity owner. The packet rehearsal must use synthetic or
de-identified data. Token files and browser storage state must be short-lived,
permission-restricted, and deleted after the run.

## Release Rule

A failed gate blocks release. A missing live variable blocks 100/100 rather than
becoming a skip. A passing 90/100 is suitable for workflow development and local
release preparation; it is not a claim that Entra, Azure, Databricks, PostgreSQL,
or restore behavior was proven in the target environment.

Every escaped defect becomes a permanent control, replay fixture, browser case,
or live rehearsal. If the workflow changes, update the golden thread and registry
in the same pull request so the assurance model continues to describe the actual
product.

The next extraction-focused layer is defined in
`docs/EXTREME_TESTING_PROTOCOL.md`. It deliberately distinguishes active proof
from work that still requires an approved packet corpus, clinical thresholds,
or finalized workflow policy.
