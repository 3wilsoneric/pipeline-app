# Pipeline regional recovery

Pipeline uses a cold regional-rebuild strategy for the current Alamo-only pilot. It avoids a continuously running duplicate application stack while making the data copies, infrastructure, decision points, and verification sequence explicit. It is not automatic failover.

## Current production fact pattern

The 2026-09-10 live audit found one West US 2 runtime, a zone-redundant Container Apps environment, zone-redundant application Blob storage, and a PostgreSQL 16 server with 14-day local backups, no database high availability, and geo-redundant backup disabled. Azure does not allow geo-backup redundancy to be enabled after a PostgreSQL Flexible Server is created. The current server therefore cannot use paired-region geo-restore. Recovery must use independently copied logical database backups until the database is replaced by an owner-approved production-HA server or cross-region replica.

## Bounded objectives

- Pilot operator objective: restore authenticated read/write service within eight hours of a declared regional disaster.
- Pilot data-loss ceiling: 24 hours for database and document copies once the daily cross-region copy jobs are active.
- No objective is certified until a timed drill restores both the database schema and document objects in the secondary region and the resulting application passes release smoke checks.

## Recovery kit

- `infra/azure/recovery-vault.bicep` creates private, Entra-only database, document, and evidence containers in a region different from the primary region. It grants the existing runtime identity write access without storage keys.
- `infra/azure/main.bicep` remains the canonical full-stack rebuild template.
- `infra/azure/runtime.bicep` can point its manual database-backup job at the recovery vault through `backupStorageAccountName` and `backupStorageContainer`; existing deployments retain their current target by default.
- `scripts/database-backup-to-azure-blob.mjs` creates checksum-verified, schema-scoped backups without sending database bytes through an operator workstation.
- `scripts/database-restore-verify.mjs` is the destructive-restore gate for a disposable target.
- `scripts/regional-recovery-readiness.mjs` distinguishes repository recovery-kit readiness from live cross-region certification.

## Activation prerequisites

1. Select and approve a secondary Azure region that satisfies service availability, data-residency, networking, and cost requirements. It must differ from the primary region.
2. Deploy `recovery-vault.bicep` to a dedicated recovery resource group and record its immutable deployment output.
3. Redeploy `runtime.bicep` with the recovery account and `database-recovery` container as the manual backup target.
4. Schedule and alert the backup job at least daily. Add a separately governed copy job for `raw`, `normalized`, `ocr`, `evidence`, and `artifacts`; database-only recovery is not sufficient.
5. Create one verified backup, one complete object copy, and an inventory manifest in `recovery-evidence` before claiming a cross-region recovery point.

These prerequisites create billable storage and job executions. They require an Azure what-if and explicit owner approval before deployment.

## Disaster sequence

1. Incident owner declares regional recovery, records the recovery point, and freezes application writes if the primary region is reachable.
2. Deploy `main.bicep` into a new secondary resource group with non-overlapping network ranges. Never redeploy over the damaged primary group.
3. Restore the selected logical database backup into the new private PostgreSQL server. Verify checksum, migration ledger, aggregate counts, and audit readability.
4. Restore every document container from the same recovery point and reconcile object count, byte count, and digest inventory.
5. Populate secondary Key Vault secrets out of band; never copy them into evidence or shell history.
6. Deploy the exact last-known-good image digest through `runtime.bicep`, run migrations only when the restored ledger requires them, and verify liveness, readiness, signed-in smoke, referral read/write, document preview, assessment save, activity history, and audit logging.
7. Change traffic only after the incident owner signs the reconciliation record. Keep the former endpoint isolated until the new runtime is stable.

## Drill and evidence

A quarterly drill must use synthetic data or an approved encrypted recovery copy, never production data on a developer machine. Evidence records the primary and recovery regions, image and migration digests, chosen recovery point, data-copy ages, restoration duration, aggregate reconciliation, smoke results, traffic-switch duration, cleanup, and the exact failures encountered. It contains no credentials, names, document content, or source paths.

Failback is another recovery event: copy forward from the active secondary, rebuild the primary, reconcile, smoke-test, then switch traffic. Never attempt bidirectional writes.
