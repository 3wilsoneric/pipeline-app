# Pipeline Database Recovery

## Scope

Pipeline transactional state lives in the `pipeline` PostgreSQL schema. Azure Blob originals and preview artifacts use separate retention and recovery controls. A database backup never substitutes for Blob retention, and Blob recovery never substitutes for a database backup.

## Recovery owner

The designated Pipeline production operator owns backup completion, encrypted retention, quarterly restore evidence, and disposal of restore-drill databases. Application users do not receive backup files or database credentials.

## Backup cadence

- Use Azure PostgreSQL point-in-time restore as the primary managed recovery control.
- Create an encrypted logical `pipeline` schema backup before every production migration and at least daily during the pilot.
- Retain daily backups for 35 days and migration-event backups for 90 days, subject to the approved clinical-data retention policy.
- Store backup files and manifests in an encrypted recovery account with separate operator access and deletion protection.

```bash
npm run database:backup -- --out /secure/recovery/pipeline-YYYYMMDD.dump
```

The command prints only output paths, byte size, and migration count. It does not print the database URL, credentials, record values, or PHI.

For a VNet-private production database, run the Azure variant from the existing
migrator job. It acquires the migration lock, creates the same schema-only custom
dump, and uploads the dump plus checksum manifest to a private Blob container
using managed identity. Backup bytes never pass through an operator workstation.

```bash
PIPELINE_BACKUP_STORAGE_ACCOUNT='<approved-account>' \
PIPELINE_BACKUP_CONTAINER='<approved-private-container>' \
PIPELINE_BACKUP_REASON='pre-migration' \
npm run database:backup:azure
```

The runtime image includes the PostgreSQL client needed for this operation. The
managed identity needs `Storage Blob Data Contributor` only on the approved
backup scope; storage account keys and connection strings are not supported.

## Restore drill

Restore only into a disposable database whose name contains `test`, `drill`, `disposable`, or `ci`. The command replaces the `pipeline` schema in that database.

```bash
PIPELINE_ALLOW_RESTORE_DRILL=true \
PIPELINE_TEST_DATABASE_URL='postgresql://...' \
npm run database:restore:verify -- \
  --backup /secure/recovery/pipeline-YYYYMMDD.dump \
  --confirm-disposable
```

The drill verifies the backup checksum, migration history, and aggregate table readability. Destroy the disposable database after the operator records the result.

## Release gate

1. Confirm the most recent managed backup and point-in-time restore window.
2. Create a pre-migration logical backup and retain its manifest.
3. Run migration plan and release checks.
4. Apply migrations.
5. Run health, database-live, and signed-in smoke checks.
6. If validation fails, stop traffic, follow the migration rollback plan, and restore only after the incident owner approves the recovery point.

## User workspace-state cleanup

Recents expire after 180 days and recovery drafts after 30 days. The protected
retention job removes expired records in bounded batches. When an account must
be removed sooner, configure the principal through the environment so it does
not appear in shell history, dry-run first, and then use the two-part execution
guard:

```bash
PIPELINE_WORKSPACE_PURGE_PRINCIPAL_ID='configured-out-of-band' \
npm run database:user-state:purge

PIPELINE_WORKSPACE_PURGE_PRINCIPAL_ID='configured-out-of-band' \
PIPELINE_ALLOW_USER_STATE_PURGE=true \
npm run database:user-state:purge -- --execute --confirm=PURGE_USER_WORKSPACE_STATE
```

The tool prints counts only. It never prints the principal, recent destinations,
or draft payloads. This procedure removes personal workspace convenience state;
it does not delete referral, assessment, audit, clinical, or document records.
