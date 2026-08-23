# Pipeline production readiness

This page is the index for production readiness. Detailed procedures live in
the linked runbooks; do not duplicate them into ad hoc release notes.

## Sources of truth

| Concern | Source |
| --- | --- |
| Release order and rollback decision | `docs/RELEASE_OPERATIONS.md` |
| Operator go/no-go evidence | `docs/PRODUCTION_ACCEPTANCE_CHECKLIST.md` |
| Azure and application deployment | `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md` |
| PostgreSQL migration and roles | `docs/POSTGRES_DEPLOYMENT.md` |
| Backup, restore, and user-state cleanup | `docs/DATABASE_RECOVERY.md` |
| Desktop PWA/MSIX and Intune | `docs/DESKTOP_DISTRIBUTION.md` |
| Entra sign-in | `docs/ENTRA_AUTHENTICATION.md` |
| Live Entra role rehearsal | `docs/LIVE_ACCESS_REHEARSAL.md` |
| Alamo clinical feed | `docs/CLINICAL_DATA_INTEGRATION.md` |
| Packet ingestion and extraction | `docs/REFERRAL_PACKET_INGESTION_RUNBOOK.md` |
| Extraction worker recovery | `docs/DOCUMENT_PROCESSING_RUNBOOK.md` |
| Collaboration semantics | `docs/COLLABORATION_CONCURRENCY.md` |
| Supply chain and immutable release evidence | `docs/SUPPLY_CHAIN_AND_RELEASE_EVIDENCE.md` |
| Abuse controls and operational alerting | `docs/ABUSE_AND_ALERTING.md` |
| Code-ready versus live operator handoff | `docs/PRODUCTION_OPERATIONS_HANDOFF.md` |

## Automated evidence

- `npm run check:platform` runs contracts, security boundaries, migrations,
  failure recovery, retention, TypeScript, lint, a production build, and the
  browser artifact budget.
- `npm run check:hygiene` inventories every tracked file and rejects generated
  output, identical tracked files, merge-conflict markers, and duplicate ignore
  rules. Oversized source modules are reported as refactoring debt.
- `npm run test:e2e` covers the default web workflow and accessibility.
- `npm run test:e2e:desktop` covers installability, offline safety, cache
  lifecycle, kill switch, recents, and recovery-draft conflicts.
- `npm run test:e2e:cross-browser` covers Chromium, Firefox, and WebKit.
- `npm run test:e2e:visual` compares six reduced-motion desktop/mobile
  application surfaces to reviewed platform-neutral baselines.
- `npm run check:route-policy` audits every exported API method against the
  explicit public, user, or worker authorization policy.
- `npm run check:chaos` replays bounded overload, database, extraction,
  callback, clinical, Blob, upload, and last-good-snapshot failures.
- `npm run check:storage` validates aggregate-only document inventory and
  capacity signals; `npm run check:access` validates the PHI-safe live Entra
  rehearsal harness without requiring credentials.
- `npm run check:licenses` and `npm run check:supply-chain` enforce lockfile,
  license, immutable Action, Dependabot, dependency-review, and CodeQL policy.
- CI provisions disposable PostgreSQL 16, applies every migration, runs the
  live smoke, fixture rollback, PostgreSQL 16 planner assertions, migration
  rollback, production reference seed, 10-user contention, per-user workspace
  isolation, and 200-request load smoke. Path-aware classification skips the
  expensive browser or PostgreSQL lane when a change cannot affect it.
- `npm run check:metrics:fixtures` exercises 200 synthetic requests across ten
  users and proves emitted dimensions stay bounded and exclude record identity.
- `tests/e2e/responsive-accessibility.spec.ts` covers desktop/mobile overflow,
  keyboard modal recovery, final chart review, progress semantics, useful empty
  states, and retryable failure states under WCAG 2.1 AA checks.
- `npm run release:evidence -- --out-dir <directory>` creates a deterministic
  CycloneDX SBOM, source-bound release manifest, and checksum index without
  configuration values or application data. `npm run release:evidence:verify`
  validates the complete bundle.

## External boundary

The repository cannot prove production connectivity without externally managed
Azure, Entra, Alamo, Blob/extraction, DNS, and signing configuration. Runtime
readiness must remain false until those services pass their live health checks.
Never substitute fixtures or local stores for a missing production service.

## Repository capability checkpoint: 2026-08-22

| Stage | Status | Evidence or blocker |
| --- | --- | --- |
| Durable PostgreSQL persistence | Code complete | Migrations `0001` through `0012` are checksum-pinned and covered by fixture, backup, restore, and rollback tooling. Deployment readiness must verify the live migration set and PostgreSQL store modes. |
| Entra role and stable assessor ownership | Code complete | Access is assignment-scoped by immutable principal ID. Live role and group assignments are external identity configuration and must be acceptance-tested. |
| Durable packet upload and extraction | Code complete | Blob reservations, digest verification, upload completion, malware gates, deterministic extraction workers, evidence, retry, and dead-letter states are implemented. Live provider/storage validation remains a deployment gate. |
| Enhanced Alamo client and census integration | Code complete | Canonical client search, detail, episode history, census/roster, freshness, and role-aware Pipeline joins are contract-tested and fail closed. Live connectivity is reported only by health checks. |
| Application hardening | Green | Whole-repository hygiene, the fast platform gates, a clean production build, artifact budgets, an enforced performance scorecard, primary browser journeys, capacity contracts, and recovery drills pass as recorded in the spring-cleaning audit. |
| Release and go/no-go | Operator decision | Use the acceptance checklist and live health evidence. Repository checks never imply that externally managed Azure, Entra, Alamo, DNS, or alert delivery is connected. |

New-client creation and incremental Databricks updates remain prepared but
disabled pending explicit approval.
