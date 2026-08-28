# Refactor Compatibility Matrix

Status: requirements defined; N/N-1 deployment evidence remains incomplete until exercised against a disposable PostgreSQL environment.

| Producer/consumer pair | Required compatibility | Current evidence | Remaining proof |
| --- | --- | --- | --- |
| New app / current schema | Reads and writes without migration assumptions outside the declared release order | `check:release`, migration checksums, integration fixtures | Run approved slice against a cloned current schema |
| Current app / additive next schema | Continues operating during rolling deployment | Append-only migrations and compatibility policy | Execute the previous built artifact against the migrated disposable database |
| New app / previous schema | May fail readiness before migration; must never partially write | Deployment readiness and migration ordering | Explicit pre-migration startup/rejection test |
| Local adapter / PostgreSQL adapter | Same intended domain outcomes | Existing API and workflow fixtures | Shared parity scenario suite |
| Existing stored JSON / new normalizers | Historical records remain readable without invented defaults | Normalization and API fixtures | Golden historical fixture set per store slice |
| Existing assessment history / new assessment code | Signatures, provenance, and addenda remain immutable and readable | Assessment lifecycle contracts | Frozen historical assessment fixtures |
| Existing worker callback / new app | Versioned callback validates or fails safely | Worker report validation and stale-callback tests | Frozen prior callback payload replay |
| New worker callback / current app | Not sent until current app supports its version | Bundle and callback contracts | Version negotiation or staged deployment proof |
| Existing browser session/draft / new UI | Draft is restored or explicitly rejected without silent loss | Desktop and draft contracts | Browser upgrade/reload characterization |
| Blob source/derivatives / new extraction | Source remains immutable; derivatives remain traceable | Storage consistency replay | Golden provenance and manifest replay |

## Required deployment rehearsal

1. Build and retain the previous application artifact.
2. Restore a sanitized production-shaped database into a disposable target.
3. Run the previous artifact before and after the additive migration.
4. Run the new artifact before migration and verify fail-closed readiness where required.
5. Run the new artifact after migration and execute golden referral, assessment, extraction, and handoff journeys.
6. Perform the declared rollback or forward-fix rehearsal.
7. Compare aggregate counts, migration history, audit integrity, and PHI-safe logs.

No refactor may claim zero-downtime compatibility from static SQL inspection alone.
