# Uploaded documents and 24-hour file undo

Held feature candidate after `f418360`; no production deployment or maintenance reopening is authorized by this work.

## User behavior

- Intake and workspace Files show saved documents with preview/open controls. The existing full file viewer is reused. A green uploaded check represents a completed upload, not completion of safety scanning or extraction. Reservations are excluded from file listings.
- X opens a named-file confirmation. Cancel changes nothing. Confirmation removes the attachment from active lists and protected file endpoints immediately. Chart answers are not erased. Linked checklist items become needed.
- Upload, deletion and restoration are recorded with actor, timestamp and filename in the existing workspace activity log. Upload/retry and repeated delete/restore requests do not multiply those events. This is a mutation log; it does not add a separate activity event for every thumbnail read.
- A deleted file has a Restore file action in Change history for exactly 24 hours. The server enforces the deadline and deletion generation, plus current workspace ownership. A newer attachment/checklist edit is not overwritten. Ordinary field edits, signatures and admission decisions are **not** made reversible by this feature.
- Selecting a deleted file again starts a new, retry-stable upload generation. It does not silently restore a deleted file, reuse a purged blob, or duplicate a new upload on retries.

## Persistence and recovery

Production uses additive migration `0037_document_undo` on `pipeline.documents`. Soft deletion and checklist/referral updates plus audit insertion share one transaction. The existing scheduled `/api/internal/retention?execute=true` operation purges expired deleted-file originals, previews and artifacts and clears their temporary checklist recovery payload. Failed storage deletion remains eligible for retry. Active extraction work delays physical purging until it is no longer writing artifacts. The 24-hour restore deadline does not extend during that delay. Audit rows and the document tombstone remain.

The daily cadence means physical deletion occurs on the next successful scheduled cleanup after expiration, not necessarily at minute 1,440. Existing Azure backup/soft-delete retention can also retain provider-managed copies; this feature does not change that policy.

The local development adapter persists upload metadata and deletion/undo with the referral store and serves each document's verified original bytes through the same protected routes. The cloud purge job is PostgreSQL/Azure-only; local fixture originals remain in the isolated content-addressed test store and are removed by fixture teardown, not by a new unattended local-directory deletion job.

Apply the migration before releasing this application candidate. It is additive: rollback must not remove its columns or audit records. If the release is rolled back while deletions are being investigated, keep retention in dry-run until recovery is resolved; redeploy the fixed file-restore path rather than restoring whole referral snapshots.

## Focused evidence

Final isolated candidate checks: production desktop-enabled build, scoped ESLint, whitespace check, unchanged complexity ratchet, 8 Node/PostgreSQL checks, and all 6 document-controls plus field-blur/upload Chromium journeys passed. Production migrations and Azure deletion were not executed. The isolated browser fixture deliberately has no external census connection.

- `scripts/document-controls.test.mjs`: pure undo boundaries and real disposable PostgreSQL, all additive migrations, concurrent upload audit/delete requests, checklist detach/restore, authorization, stale undo, expiration, dry-run and failed-storage retry. Azure removal is stubbed; no production/cloud writes.
- `tests/e2e/operational/document-controls.spec.ts`: actual isolated browser file upload, preview iframe, original byte download, cross-owner denial, cancel/delete/restore and visible activity, chart preservation, intentional re-upload and deduplication.
- Existing field-blur/upload browser and node regressions remain in scope. One reason-save assertion now polls its own server value rather than treating an earlier choice-save response as completion of the next queued field save. The request-observing field-blur/upload contexts block service workers so Playwright owns intercepted requests and response bodies, and wait for form readiness; the document-controls browser journey retains normal service-worker behavior.

Deliberate ceiling: imported placeholder records with no actual stored document ID are view-only, not deletable through this endpoint. General field-change undo needs per-field before-values, version checks and a separate decision/signature policy; do not implement whole-record rollback from this file feature.
