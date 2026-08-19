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
| Alamo clinical feed | `docs/CLINICAL_DATA_INTEGRATION.md` |
| Packet ingestion and extraction | `docs/REFERRAL_PACKET_INGESTION_RUNBOOK.md` |
| Extraction worker recovery | `docs/DOCUMENT_PROCESSING_RUNBOOK.md` |
| Collaboration semantics | `docs/COLLABORATION_CONCURRENCY.md` |
| Supply chain and immutable release evidence | `docs/SUPPLY_CHAIN_AND_RELEASE_EVIDENCE.md` |
| Abuse controls and operational alerting | `docs/ABUSE_AND_ALERTING.md` |

## Automated evidence

- `npm run check:platform` runs contracts, security boundaries, migrations,
  failure recovery, retention, TypeScript, lint, a production build, and the
  browser artifact budget.
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
- `npm run check:licenses` and `npm run check:supply-chain` enforce lockfile,
  license, immutable Action, Dependabot, dependency-review, and CodeQL policy.
- CI provisions disposable PostgreSQL 16, applies every migration, runs the
  live smoke, fixture rollback, migration rollback, production reference seed,
  10-user contention, per-user workspace isolation, and 200-request load smoke.
- `npm run release:evidence -- --out-dir <directory>` creates a deterministic
  CycloneDX SBOM, source-bound release manifest, and checksum index without
  configuration values or application data. `npm run release:evidence:verify`
  validates the complete bundle.

## External boundary

The repository cannot prove production connectivity without externally managed
Azure, Entra, Alamo, Blob/extraction, DNS, and signing configuration. Runtime
readiness must remain false until those services pass their live health checks.
Never substitute fixtures or local stores for a missing production service.

## Execution checkpoint: 2026-08-19

| Stage | Status | Evidence or blocker |
| --- | --- | --- |
| Baseline inventory and pre-change tests | Complete | Existing Azure resources, adapters, environment, and dirty worktree recorded without purchases. |
| Durable PostgreSQL persistence | Complete | Migrations `0001` through `0007` applied and verified; backup and rollback evidence retained. |
| Entra role and stable assessor ownership | Code complete | Assessor access is assignment-scoped by immutable principal ID; four assessor and one supervisor role assignments still require external Entra configuration. |
| Durable packet upload and extraction | Partially complete | Azure Blob upload is durable. Production extraction remains honestly `manual`; no approved Pipeline extraction worker exists to activate. |
| Enhanced Alamo client and census integration | Code complete, live configuration pending | Canonical client search, 141-field detail, current profile, episode history, census/roster, freshness, and role-aware Pipeline joins are implemented and contract-tested. |
| Pilot data | Pending | Requires approved referrals, four assessor identities, supervisor identity, and one approved packet. No synthetic production records were created. |
| Application hardening | Complete | `check:platform` passed all 31 gates; Playwright passed 41 tests with 7 intentionally skipped. Upload, OCR, duplicate, assessment recall, collaboration, failure, scale, security, type, lint, build, and artifact checks are green. |
| Release candidate and go/no-go | Pending | Do not deploy until live Alamo permission/configuration and the extraction decision are complete. |

The assessment form remains frozen. New-client creation and incremental
Databricks updates remain prepared but disabled pending explicit approval.
