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
