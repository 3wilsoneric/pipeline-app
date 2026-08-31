# ALLO Canvas Content Import

Pipeline imports ALLO canvas text separately from attached files. Native text, tables, checklist labels, and subtasks do not need OCR. Embedded PDFs and images remain in the existing document extraction lane.

This path is designed for an authorized, one-time migration and controlled re-runs. It is read-only against ALLO, restartable, hash-addressed, and review-gated. It never updates an assessment directly.

## Data Boundary

- Treat every capture, manifest, browser profile, and storage-state file as PHI.
- Keep local artifacts outside the repository in an approved protected directory.
- Capture only canvases the migration operator is authorized to access.
- Never place browser cookies, storage state, canvas text, client names, or source URLs in command output or CI artifacts.
- Link content to Pipeline by exact `source_canvas_id`. Name-only matching is prohibited.

## Supported Sources

### Signed-In Chrome Extension (Recommended)

The read-only Chrome extension uses the same signed-in session and local-download model as the ALLO file exporter. It captures ALLO's native canvas read after one representative canvas is opened, replays only validated read methods across the verified canvas catalog, and downloads normalized text plus raw evidence locally.

Load `tools/allo-canvas-text-exporter` as an unpacked extension, then follow its three steps. Its primary output can be prepared directly:

```bash
npm run allo-content:prepare -- \
  --input=/private/ALLO-canvas-text-YYYY-MM-DD/canvas-content.jsonl \
  --output=/private/allo-canvas-content.json \
  --exceptions=/private/allo-canvas-content-exceptions.json \
  --link-index=/private/allo-canvas-content-record-links.ndjson \
  --workspace-records=/private/allo-workspace-import.json \
  --identity-crosswalk=/private/allo-canonical-identity-crosswalk.csv
```

Rendered-DOM exports are split into ordered line-level blocks before candidate
derivation. Records with no captured content are excluded from the import
manifest and written to the protected exceptions artifact for retry.

When both record-link inputs are supplied, the preparer first joins by exact
`source_canvas_id` to the existing ALLO workspace record. It may also read the
captured referral form's explicit `NAME` and `DOB` cells. It assigns a
`canonical_client_id` only when all available identity evidence resolves to one
exact normalized-name-plus-DOB crosswalk identity. Conflicting evidence is
ambiguous and records without exact evidence remain unmatched. The database
importer independently resolves the existing Pipeline `referral_id` by exact
ALLO canvas ID.

Keep `canvas-content-evidence.jsonl` until reconciliation succeeds. It contains the raw read responses but no credentials or request headers.

### Dedicated Browser Capture (Fallback)

The browser adapter opens each unique `canvas_id` from an existing ALLO inventory. It reads visible native DOM content, form values, tables, and checkbox state. It does not capture response headers, cookies, network payloads, or full HTML.

Use a dedicated Playwright storage-state file or persistent browser profile in a protected directory. The first command is always a no-write plan:

```bash
npm run allo-content:capture -- \
  --inventory=/private/allo-file-manifest.csv \
  --output=/private/allo-canvas-content.json \
  --profile-dir=/private/allo-browser-profile \
  --limit=5
```

Run a headed, authorized pilot and preserve checkpoints after every canvas:

```bash
npm run allo-content:capture -- \
  --inventory=/private/allo-file-manifest.csv \
  --output=/private/allo-canvas-content.json \
  --profile-dir=/private/allo-browser-profile \
  --headless=false \
  --login-wait-seconds=300 \
  --limit=5 \
  --confirm=CAPTURE-AUTHORIZED-ALLO-CANVAS-CONTENT
```

After validating the pilot, use `--resume=true` and increase the limit. A failed canvas increments only a count; no canvas identity or text is logged.

### ALLO Copy As Markdown Or Manual Native Export

Create a private CSV with these columns:

```text
canvas_id,canvas_name,project_id,project_name,canvas_url,content_path,capture_method,captured_at
```

`content_path` may reference Markdown, plain text, or JSON containing a `blocks` array. Relative paths are resolved from the CSV directory.

```bash
npm run allo-content:prepare -- \
  --input=/private/allo-content-index.csv \
  --output=/private/allo-canvas-content.json
```

## Immutable Blob Publication

The upload command writes one immutable JSON object per canvas revision and one immutable manifest. Existing objects must match content length and both source and payload digests.

```bash
npm run allo-content:upload -- \
  --manifest=/private/allo-canvas-content.json \
  --private-output=/private/allo-canvas-content-cloud.json \
  --dry-run

npm run allo-content:upload -- \
  --manifest=/private/allo-canvas-content.json \
  --private-output=/private/allo-canvas-content-cloud.json \
  --confirm=UPLOAD-ALLO-CANVAS-CONTENT
```

Required production configuration: `AZURE_STORAGE_ACCOUNT` and Azure credentials accepted by `DefaultAzureCredential`. `AZURE_STORAGE_CONTAINER_RAW` defaults to `raw`.

## Database Staging

Apply migration `0020_allo_canvas_content`, then plan the import:

```bash
npm run database:migrate

npm run allo-content:import -- \
  --manifest=/private/allo-canvas-content-cloud.json \
  --dry-run
```

The confirmed import creates immutable snapshots, ordered blocks, exact-ID links, and pending `assessment_notes` candidates. It does not create or update an assessment.

```bash
npm run allo-content:import -- \
  --manifest=/private/allo-canvas-content-cloud.json \
  --confirm=IMPORT-ALLO-CANVAS-CONTENT
```

For a local development rehearsal without Blob publication, add `--require-blob=false`. Do not use that exception for production migration evidence.

## Private Client Merge

Before the database is connected, the staged manifest can be combined with the
existing canonical client history. The output retains full source blocks and
provenance under each exactly matched client, while all derived notes remain
pending human review. Unmatched and ambiguous canvases are written to a
separate identity-review queue.

```bash
npm run allo-content:combine -- \
  --manifest=/private/allo-canvas-content.json \
  --history=/private/master-client-history.json \
  --identity-crosswalk=/private/allo-canonical-identity-crosswalk.csv \
  --output=/private/client-history-with-allo-notes.json \
  --unresolved=/private/canvas-identity-review-queue.json \
  --summary=/private/client-note-summary.csv
```

All three outputs are written with owner-only permissions. This staging step
does not update PostgreSQL, an assessment, or an EHR record.

## Review

Candidates begin as `pending`. Unlinked candidates cannot be accepted. Review uses optimistic concurrency and a server-side reviewer identity:

```bash
PIPELINE_IMPORT_REVIEWER_ID=<entra-principal-id> \
npm run allo-content:review -- \
  --candidate-id=<uuid> \
  --expected-version=1 \
  --action=accept \
  --confirm=REVIEW-ALLO-CANVAS-CONTENT
```

For an edit, place the reviewed note in an approved protected file and add `--value-file=/private/reviewed-note.txt`. Rejection can include a non-PHI `--reason-code`.

Acceptance still does not mutate an assessment. Applying accepted historical notes to an assessment is intentionally a separate future workflow requiring an explicit assessment target, permission checks, and an audit event.

## Reconciliation

```bash
npm run allo-content:reconcile -- \
  --manifest=/private/allo-canvas-content-cloud.json \
  --database
```

The report emits counts and statuses only. It never prints canvas names or note text.

## Deterministic Mapping

The normalizer maps content only when it follows recognized headings such as Summary, Interview, Pre-assessment, Assessment Notes, Medication, or Post-assessment. It preserves denials and uncertainty exactly. Medication narrative is retained inside the note; it is not converted into a medication list without human review. Unscoped text remains available as a source block but produces no field candidate.

Run the no-PHI contract suite with:

```bash
npm run check:allo-content
```
