# Client File Import

Pipeline keeps file import separate from identity review. An export can be staged without uploading document bytes or attaching a file to a client.

## Export Columns

The CSV must include `client_name` and `file_path`. Supported optional columns are:

- `source_item_id`
- `source_canvas_id`
- `resident_number`
- `date_of_birth` as `YYYY-MM-DD`
- `community`
- `source_locator` or `canvas_url`

Each row represents one file. `file_path` must be an absolute or CSV-relative path available on the operator's machine.

## Safe Sequence

1. Create a private manifest. This reads and hashes files but does not contact Azure or Pipeline.

   `npm run client-files:manifest -- --input=/absolute/export.csv --output=/absolute/private-manifest.json --source-system=allo`

2. Validate the manifest and database access without changing data.

   `npm run client-files:stage -- --manifest=/absolute/private-manifest.json --dry-run`

   Create a read-only local reconciliation artifact before staging. The private report contains PHI and must remain in an approved protected location. The optional summary contains counts only and is safe for release evidence.

   `npm run client-files:reconcile -- --manifest=/absolute/private-manifest.json --private-output=/private/path/reconciliation-detail.json --summary-output=/private/path/reconciliation-summary.json`

3. After migration `0008_client_workspaces` is applied, stage metadata idempotently.

   `npm run client-files:stage -- --manifest=/absolute/private-manifest.json --confirm=STAGE-CLIENT-FILE-METADATA`

4. Review every unmatched item in Pipeline. Confirmation records either a Pipeline client identity or an Alamo canonical client identity. If the person has neither, create a historical client workspace from the reviewed item. No name-only match attaches a document automatically, and historical workspaces are never represented as current residents.

5. Preview the confirmed binary transfer. This reads the database and local files but does not contact Blob Storage.

   `npm run client-files:import -- --manifest=/absolute/private-manifest.json --dry-run`

6. Upload confirmed files only. This is the only step that writes blobs and durable document rows.

   `npm run client-files:import -- --manifest=/absolute/private-manifest.json --confirm=UPLOAD-CONFIRMED-CLIENT-FILES`

7. Reconcile imported metadata without writing to the database or storage.

   `npm run client-files:reconcile -- --manifest=/absolute/private-manifest.json --private-output=/private/path/reconciliation-detail.json --summary-output=/private/path/reconciliation-summary.json --database`

   When an approved operator explicitly needs object-level proof, add `--verify-blobs`. That option performs read-only Azure Blob property requests and is never run implicitly.

8. For a controlled pilot rollback, first generate a no-write plan from the exact private manifest.

   `npm run client-files:rollback -- --manifest=/absolute/private-manifest.json`

   Rollback is refused if an imported document is already used as reviewed field or requirement evidence. After an operator resolves those links, execution requires both an environment gate and an exact confirmation phrase:

   `PIPELINE_CLIENT_FILE_ROLLBACK_ENABLED=true npm run client-files:rollback -- --manifest=/absolute/private-manifest.json --execute --confirm=ROLLBACK-CONFIRMED-CLIENT-FILE-BATCH`

   The rollback first hides imported documents and cancels active preview work, then removes only Blob objects referenced by that reviewed batch, and finally restores imported review items to `confirmed`. It is retryable after an interrupted Blob deletion and reports counts only.

The source SHA-256, source item ID, deterministic blob key, and unique source identity make retries idempotent. A source file that changes after staging is rejected.

After import, historical/file-only clients appear in Profiles with their document inventory. If the person is admitted later, use the normal reviewed identity-link workflow to join the Pipeline workspace to the governed Alamo client. The join preserves the original files and referral history.

The manifest contains PHI and absolute local paths. Keep it outside the repository and delete it according to the approved retention procedure after import evidence is retained.

The detailed reconciliation report has the same handling requirement. It classifies each row as `present`, `metadata-only`, `file-only`, `unmatched`, `structured-not-imported`, `intentionally-excluded`, or `source-changed`. The summary report contains only aggregate counts, total bytes, and verification mode.
