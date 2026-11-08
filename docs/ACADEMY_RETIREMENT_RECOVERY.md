# Academy retirement and client-data recovery

The owner requested removal of Academy/tutorials with all client data preserved.
This change starts from deployed commit `d7bb9e97079c2845631a128989e1ed424bb88708`.
It removes learning routes, progress APIs and their exclusive content. It does not
drop tables, purge progress, rewrite migrations, delete uploaded documents or
change client records. Historical migrations 0018/0019 remain intact.

The old September checkout is not a release candidate. The recorded production baseline has 47 applied
migrations; that checkout's proposed 0035/0036 collide with existing production
migrations. Production already has Physical Health presence in 0043. Reconcile
earlier defect reports against the deployed source before carrying any repair
forward. Never deploy the entire older checkout to recover a removed feature.

## Verified repaired application recovery

The baseline configuration is revision
`pipeline-prod-web--d7bb9e9707-r42336901890-1` in `rg-pipeline-prod`, recorded
healthy on November 7, 2026, at 21:54 UTC. Its original image predates the retry
and import fixes and is **not** an approved fallback for this repaired release.

The production PostgreSQL recovery image is:

```
pipelineprodacra6qdvl6ebenac.azurecr.io/pipeline-app@sha256:b5e5252d57c2327b69b9a185d5b3cc30115bd42364d43bd1a0a7271434d23ce9
```

ACR build `cce2` completed on November 8, 2026. It uses the archived repaired
checkpoint `16a51d6a34dc1331191be342dba15ab2873912fbca2ec2d1940124e78c26ae45`
plus the concurrent Trash-access retry fix. The actual Linux image applied all
48 migrations to disposable PostgreSQL and passed 43 API scenarios covering
concurrent referral/workflow retries, assessment command binding, delegated
principals and imported-file identity. All records were synthetic.

The local recovery bundle is
`/Users/eric/pipeline-app/output/whole-app-repair-2026-11-07/rollback/`.
It includes the original source archive, the additional route patch, the build
Dockerfile and a complete file/hash manifest. The build context manifest hash is
`b7153f6f9be67230430527306315b536e0a0d5158198c08d2eeeb1da53611062`.

`rollback-app.sh` defaults to a dry run. Execution requires the reviewed current
revision. It checks PostgreSQL configuration in both revisions, single-revision
traffic mode, image availability and the current revision again immediately
before copying the baseline configuration with the repaired image. It never
invokes database migration, restore, Blob deletion or data purge.

```bash
bash /Users/eric/pipeline-app/output/whole-app-repair-2026-11-07/rollback/rollback-app.sh
```

Eight command-guard scenarios passed with a stubbed Azure CLI, including a
concurrent deployment, wrong storage mode, missing image and the exact-image
copy request. The real script dry run also passed. Production traffic has not
been switched by this recovery verification.

For an incident, use the execution command printed by the dry run after reviewing
the current revision. Verify readiness, login, existing client/assessment reads,
document preview and a controlled save afterward. Keep the referenced Azure
revision and image available. The recovery image is approved for PostgreSQL only:
it retains the production integrity repairs but predates the final local draft
file repair and browser navigation/status refinements. Do not use it to downgrade
a local-file deployment. Rebuild this fallback before any later incompatible
schema or authorization change. Application rollback does not remove migration
0048 or revert records accepted since deployment.

## Backup and restore evidence

The existing managed-identity Azure backup job completed successfully:

- Execution: `pipeline-prod-database-backup-e4z3vbj`, 21:54:07–21:54:57 UTC.
- Account: `pipelineproda6qdvl6ebena`; private container: `artifacts`.
- Object: `database-recovery/pre-migration/20261107t215431z/pipeline.dump`.
- Manifest: the same object name plus `.manifest.json`.
- Size: 157,933,729 bytes; 47 applied migrations.
- SHA-256: `c1ebbcbcce33f911fe9c739fbf63aa809ceac0bbae65b77173fdaaf51b0fe041`.

The backup job verified uploaded length and checksum metadata and kept database
bytes inside Azure. The operator's direct Blob read was denied; no additional
permissions were granted and no client backup was downloaded to this computer.

Current production PostgreSQL point-in-time retention is 14 days, with earliest
restore time reported as October 25, 2026, 03:10:21 UTC. Geo-redundant backup is
disabled. Blob and container soft delete are enabled for 14 days; Blob versioning
and point-in-time restore are not enabled. Soft delete does not prove that an
arbitrary overwritten object can be recovered.

The current 47-migration source was independently tested using synthetic data:
backup → restore into a different disposable database → compare all 48 tables by
exact row-content hashes. All tables matched, including client/referral,
assessment, document metadata, contact/link, audit, draft and retained learning
progress rows. The source database was unchanged. Both disposable databases were
removed. This proves the synthetic logical restore path; it is not a restore of
the production dump or a managed Azure PITR drill.

## Data recovery is separate from app rollback

Prefer application rollback with the repaired image for this release. Restoring an old
database over the current one can discard legitimate work accepted after the
backup. If data recovery becomes necessary, freeze writes, retain the current
state, restore to a separate server/database, reconcile accepted writes and Blob
references, and validate before any connection/traffic switch. Azure PostgreSQL
[PITR creates a new server](https://learn.microsoft.com/en-us/azure/postgresql/backup-restore/how-to-restore-custom-restore-point).
Follow [Database Recovery](DATABASE_RECOVERY.md) and [Release Operations](RELEASE_OPERATIONS.md).

There is no zero-data-loss guarantee. The pre-release recovery verification did
not deploy the app, restore production, reverse schema, mutate client records or
purge documents. Release execution and its new backup are recorded separately.

## Imported-file identity repair and recovery

Review and finalization now lock the same import item before changing its identity
or creating a document/job. An imported status, document pointer, or existing active
artifact blocks review, including legacy artifacts whose item pointer was never
committed. Stale finalization leaves database records unchanged. Reusing an existing
artifact requires matching person/referral/canonical identity, checksum, byte size
and Blob location. A conflict preserves the existing records for reconciliation;
it does not relink, purge or infer a new owner.

This repair adds no migration and changes no existing client records. Quiesce old
importer processes before activating the repaired web app and importer together;
an older importer does not participate in the locking protocol. A release fallback
must retain these guards. Returning to the original production image would restore
the unsafe review/finalization paths and is not an approved repaired-release fallback.

The finalizer checks after immutable Blob upload verification. A stale review can
therefore leave an unreferenced upload available for a later verified retry. This
narrow repair deliberately does not delete that Blob or automatically repair old
identity conflicts. Use protected reconciliation when a conflict is reported;
reassignment requires an explicit atomic document/item/provenance workflow. The
separate destructive client-import rollback tool is not the application rollback
procedure and must not be used to roll back this repair. Live Blob/worker delivery
and import-batch rollback concurrency remain separate verification obligations.

## Local referral/assessment transaction recovery

The development/single-instance local adapters now commit related referral and
assessment changes through one private recovery journal. PostgreSQL continues to
use its existing database transactions. The two JSON store formats remain version
1. The journal is beside the configured referral file, named
`<referral-store-path>.transaction.json`; it can contain client data and has mode
0600, as do both committed store files.

Before the journal is published, a failed operation restores both in-memory
snapshots and writes neither store. After publication, the journal contains the
committed intent for both files. The next local read or write finishes recovery
before exposing cached records. Recovery accepts only the recorded before/after
checksums and the configured store paths. Invalid journals or unexpected later
file contents block access without overwriting records. Keep every file intact
for controlled reconciliation; deleting the journal to force startup can strand
an accepted save.

For a local backup or restore, stop the single app process and preserve both store
files and any journal together, with their private permissions and configured
paths. Start the repaired candidate, verify the recovered records/audits, and
confirm the journal cleared. Do this before any local application downgrade:
older code cannot recover this journal. The guard covers process interruption and
tested filesystem failures; it is not multi-process coordination or a guarantee
against failed storage hardware. Production still requires PostgreSQL.

The repair does not invent recovery intent for partial saves made by older code
without a journal. If a pre-upgrade local store shows mismatched client names,
assignments or workflow, retain both originals and compare record/audit history
under protected reconciliation before an explicit correction. Replaying an old
creation must never overwrite a newer workflow decision. No bulk local-data or
production-data rewrite is part of this change.

## Subsequent contact retry repair

The schema-neutral retirement checkpoint is preserved separately in the recovery
bundle's `schema-neutral-candidate/` directory. Its tracked patch and untracked
source archive have SHA-256 checksums. Later application repairs must not be
mistaken for that original checkpoint.

The current contact repair adds migration `0048_mutation_replay_binding`. It adds
one nullable hash column to the existing retry ledger; all 47 previously applied
migration files retain their exact bytes. Client records and documents are not
removed. Legacy receipts remain present and cannot silently acknowledge a
different command. The new rollback SQL deliberately retains both the column
and its migration record. Application rollback does not require schema reversal.

Both local and PostgreSQL checks cover all five contact operations through
concurrent identical requests, changed commands/principals, restart, stale
versions, duplicate links, unlink retries and legacy receipts. PostgreSQL import
checks preserve existing records, atomic audit writes and CSV replay behavior.
The new 48-migration synthetic backup/restore again matches all 48 tables exactly,
including both bound and legacy retry receipts. Running the migration rollback
guard leaves the source table hashes unchanged. The disposable databases were
removed; no production restore was performed.

The original production image predates this repair. It remains the recorded
retirement baseline, not an approved rollback target for a future release that
depends on command binding. Before such a release, prepare and verify a recovery
image retaining the data-integrity fixes. Restoring the original image would
restore its retry behavior even though the database column remains intact.

## Assessment save and retry protection

The subsequent assessment repair uses the same additive retry column. Creation,
answer/lifecycle changes, imports, revisions and addenda bind a retry to its
operation, target, principal and original command. Exact retries preserve the
saved record; changed commands and legacy unbound receipts fail closed. A new
request cannot restart a completed assessment, while a previously committed
start request remains safely replayable after completion.

The local-file adapter now rejects unreadable, malformed or unsupported files
instead of treating them as empty. A failed write or rename restores the
uncommitted memory state and retry receipts, so a later retry cannot falsely
acknowledge unsaved content. A failure after the assessment reached disk leaves
that committed record intact. This is not a cross-file transaction: assessment
and referral projection/name recovery still require their separate failure-path
verification. PostgreSQL retains its existing transaction boundaries.

The recovery bundle retains a separate assessment candidate patch/source archive;
it does not replace the earlier schema-neutral retirement checkpoint. These
repairs and their synthetic checks do not restore, delete or rewrite production
client records, uploaded documents or the 47 historical migration files.

## Referral creation and draft recovery protection

Referral creation now stores a command fingerprint in the same additive retry
column. Both adapters bind the authenticated/effective principal and original
command. Chart-to-intake retries bind the user's selection, independent of the
chart's later values or server timestamps. A legacy receipt or a changed command
receives a conflict rather than creating a second client or acknowledging a
request that was never saved.

The editor keeps its original creation command in the existing draft recovery
storage. Later edits become versioned updates. A private, principal-bound draft
association lets two tabs find the same created referral; disjoint edits merge,
conflicting edits require the existing explicit choice, and resolution completes
the normal saved-workspace handoff. A deleted referral is not revived by a create
retry. Normal recoverable-trash restore remains available.

Local referral loading now fails closed on unreadable or invalid referral/audit
files. Pre-commit write failures restore the memory state and retry receipts;
errors after atomic replacement preserve the committed record. Referral and
assessment writes share a reentrant in-process queue because they call each
other. This prevents opposite lock ordering; it does not provide a multi-file
transaction or coordination between separate local server processes. Production
PostgreSQL keeps its existing transactions. Outstanding local projection and
cross-file failure recovery remains part of the whole-app repair plan.

These changes use the existing 0048 migration and do not change client tables,
rewrite historical migrations, delete documents, or touch production records.
The source recovery bundle keeps this referral candidate separately from earlier
checkpoints. Its application fallback must retain the integrity safeguards above;
the original production image remains a historical baseline, not a newly approved
release rollback target.

## Account-bound tab drafts and load failures

Normal web tab recovery now uses the confirmed account ID as part of its storage
key. Switching accounts cannot display or erase the preceding account's pending
intake. The same scoped reader handles migration from the default draft to a
dedicated draft URL. Existing server and encrypted-device recovery remain owned
by their authenticated principal.

Older tab copies have no recorded authenticated owner. Their bytes are retained,
but they are not automatically assigned to the current account. A failed,
unavailable or invalid recovery read is reported; an available account-bound
copy remains usable. Failed canonical referral loading exposes the existing
error and Retry control while the saved workspace stays noneditable.

Known limit: an unbound legacy tab copy needs verified-owner recovery. There is
no trustworthy owner field in that old format, so guessing from the current
login could disclose another person's unfinished work. Preserve the original
tab/storage; if a real affected copy is reported, establish its owner before
building or using a targeted recovery procedure. Do not clear browser storage
or automatically adopt that copy. Synthetic tests verify the legacy bytes remain
unchanged and that a valid scoped draft survives migration and reload.

These repairs add no database migration, purge or production write. The source
rollback archive for this follow-up is separate from the preceding referral
candidate. Its rollback image must retain account isolation as well as the
previous retry and durable-write safeguards.

## Resident-link retry and local-write protection

Resident-link creation now uses the existing command fingerprint column and
binds both authenticated and effective accounts. The duplicate-candidate path
also records its receipt. PostgreSQL serializes lookup and commit for each retry
key; local storage retains the same binding through restart. Changed commands,
legacy unbound receipts and receipts with missing links fail closed. Returned
links are checked against their own referral access, including duplicate results.

The local adapter rejects unreadable or malformed saved files without filtering
away stored links or receipts. Failed writes restore the prior memory state,
including audit events, versions and retry receipts. The temporary file receives
private permissions before atomic replacement; no fallible work follows that
commit point. This remains a single-process local adapter, not a multi-instance
database. No migration was added or rewritten for this repair.


## Referral and workflow retry protection

Referral edits, trash/restore, manual intake, admission flow, transitions,
recommendations, decisions and reopening, review corrections, work items,
placement cancellation, historical admission confirmation and ElderMark entry
tracking now bind each retry key to its original command, target, versions and
both initiating/effective accounts. Server-generated timestamps and refreshed
workflow records are excluded from the authenticated original command. Existing
shared-workspace access remains unchanged. Exact retries report the current
record without repeating a write; a newer decision, restored referral or other
later edit is never rolled back by an older retry.

Both adapters commit the receipt with the record and audit. PostgreSQL retains
its key lock through commit. Local creation and patch fingerprints use separate
namespaces. Legacy receipts without a binding return a reconciliation conflict;
do not delete them or infer their original command from the current record.
Reload and compare the saved record before submitting a new intentional command.
A missing target fails closed. This repair reuses additive migration 0048; it
adds no migration, purge or bulk data rewrite.

Local legacy-review corrections now create the assessment revision and update
the review within the shared referral/assessment recovery transaction. Preserve
the original signed assessment and its successor together. The earlier local
journal backup/downgrade instructions apply. A deployable fallback must retain
these protections; the recorded pre-repair production image is not an approved
fallback for a release containing them.


## Local recovery drafts

Local workspace-state reads and writes now share a serialized operation. Failed
replacement restores the previous cached records and versions; a later account's
save cannot persist an earlier failed draft. Invalid, unsupported or duplicate
saved records block access without filtering records or replacing the file.
Temporary files receive private permissions before atomic replacement. This is
the existing single-process development/test adapter; production uses PostgreSQL.
No draft schema, applied migration, progress row or production data is removed.
Preserve the original file if validation fails and reconcile it explicitly.


## Release browser and retry corrections

The release checks exposed a delete retry arriving between its receipt lookup
and access check. The route now revalidates the bound receipt after that access
failure; it does not repeat deletion or bypass authorization. Three controlled
route scenarios cover the exact race, a missing receipt and inaccessible records.
The real recovery-image concurrency suite also exercises the repaired route.

Preparation's first section now keeps the existing interview entry controls in
view. A later workspace selection supersedes an earlier navigation waiting for
save, preserving the current assessment and its prepared answers.
The encrypted offline editor restores its existing pending-sync message after
reload. The 12-section offline test verifies answers through a second offline
reload and subsequent canonical synchronization.

Clinical browser tests use real synthetic API records instead of retired tutorial
editors. They verify the current continuous desktop interview, phone paging,
recorded answers, canonical saves, scheduling, keyboard/touch access and contrasts.
Retired routes still exercise the existing access proxy: unauthenticated users
are sent to sign-in, Note Lab-only users remain in their permitted app, and
otherwise authorized users receive a retirement 404. Test assertions retain
these distinct authorization outcomes.
