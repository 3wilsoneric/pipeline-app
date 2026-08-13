# Document processing operations

## Normal flow

1. Pipeline reserves opaque Blob paths and durable document metadata.
2. The browser uploads directly to Blob using a short-lived write URL.
3. Completion verifies every reserved blob and byte count, quarantines the
   documents, and queues extraction plus preview jobs.
4. Dispatch claims jobs with `FOR UPDATE SKIP LOCKED`, sets a lease, and starts
   Databricks. Reconciliation updates long-running provider state.
5. The worker callback records scan state, previews, page evidence, extracted
   candidates, and provenance. Fields remain pending until a user accepts,
   corrects, or rejects them.
6. Bounded failures back off. Exhausted or non-retryable failures enter
   `dead_letter` and fail visibly on the packet.

## Triage

- Queue age: `GET /api/internal/extraction/queue` with the worker bearer secret.
- File metadata/pages: `GET /api/files/{documentId}?after_page=0&limit=24`.
- One thumbnail/page: `GET /api/files/{documentId}/preview?page=1`.
- Dispatch: `POST /api/internal/extraction/dispatch`.
- Reconcile: `POST /api/internal/extraction/reconcile`.
- Replay one dead letter: `POST /api/internal/extraction/dead-letter` with
  `{ "extraction_job_id": "<uuid>" }` after fixing its root cause.
- Retention preview: `GET /api/internal/retention`.
- Retention execute: `GET /api/internal/retention?execute=true`.

Never paste packet names, resident identifiers, diagnoses, medications, access
tokens, SAS URLs, response bodies, or Blob paths into tickets or logs. Use the
request ID, extraction job ID, error code, queue state, and timestamps.

Every callback to `POST /api/internal/extraction/report` must return the
`extraction_job_id`, `attempt_count`, and opaque `attempt_token` received in
Databricks job parameters.
Pipeline rejects late output from an expired attempt. A successful provider run
without its authenticated callback is retried and eventually dead-lettered; it
is never silently marked complete.

The callback must also list every normalized page, OCR object, extraction
output, preview, and evidence object in `artifacts`. Pipeline stores those
opaque locations in `pipeline.document_artifacts`; retention then deletes the
raw blob and every registered derivative before soft-deleting the document.

## Failure rules

- `uploaded_blob_missing` or `uploaded_blob_size_mismatch`: ask the user to
  retry the upload; do not dispatch.
- `malware_detected`: keep the document unavailable and follow the security
  incident procedure. Never offer a preview or download.
- `databricks_request_failed`: inspect provider availability and retry count.
- `worker_output_missing`: the provider run ended without a valid callback or
  usable extraction output. Fix callback/job configuration before replay.
- Dead-letter growth or oldest queued age above 10 minutes is an operational
  alert, not a normal backlog.
- A document over the configured preview byte cap must be inspected through
  its paginated page previews; do not raise the cap merely to make a large
  original render in-browser.
