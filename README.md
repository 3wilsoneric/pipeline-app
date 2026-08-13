# Pipeline

Pipeline is a referral and assessment operations application for admissions teams. It captures referral packets, reviews extracted data with page evidence, manages assessments and admission decisions, tracks late requirements, joins admitted clients to the governed Alamo roster through reviewed identity links, and derives assessor/supervisor queues from canonical records.

## Local development

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Local mode uses clearly labeled development adapters. It is not suitable for multiple instances or production data.

## Production boundaries

- Application hosting and scheduled work: Azure Container Apps and Container
  Apps Jobs, deployed as immutable images from private ACR through GitHub OIDC.
- Transactional state: Azure Database for PostgreSQL.
- Original documents and derivatives: private Azure Blob containers.
- Asynchronous packet processing: Databricks worker contract.
- Current admitted-client/clinical context: server-only Alamo clinical API.
- User identity: Microsoft Entra delegated sign-in.
- Alamo service access: separate server-only Entra client credential.

Pipeline never connects directly to ElderMark and never exposes database, Blob, Databricks, Alamo service, or client-secret credentials to browser code.

## Verification

```bash
npm run check:platform
npm run check:desktop
npm run check:route-policy
npm run check:supply-chain
PORT=3187 npm run test:e2e
npm run test:e2e:desktop
npm run test:e2e:cross-browser
npm run test:e2e:visual
```

`check:platform` runs release compatibility, generated properties, extraction quality, the 12,000-page orchestration rehearsal, recovery safeguards, contract replays, TypeScript, lint, and a production build.

## Documentation

- [Exact Azure production setup](docs/AZURE_PRODUCTION_SETUP.md)
- [Production readiness index](docs/PRODUCTION_READINESS.md)
- [Production acceptance checklist](docs/PRODUCTION_ACCEPTANCE_CHECKLIST.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Current task and external dependencies](docs/CURRENT_TASK.md)
- [Production deployment](docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md)
- [Production data operations](docs/PRODUCTION_DATA_OPERATIONS.md)
- [Database recovery](docs/DATABASE_RECOVERY.md)
- [Release operations](docs/RELEASE_OPERATIONS.md)
- [Supply chain and release evidence](docs/SUPPLY_CHAIN_AND_RELEASE_EVIDENCE.md)
- [Abuse controls and alerting](docs/ABUSE_AND_ALERTING.md)
- [Clinical integration](docs/CLINICAL_DATA_INTEGRATION.md)
- [Desktop/PWA and MSIX distribution](docs/DESKTOP_DISTRIBUTION.md)
