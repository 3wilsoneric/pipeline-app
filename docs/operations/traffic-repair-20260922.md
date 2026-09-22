# September 22 traffic repair

Based on production `7148e8e`. No change to clinical answers, ownership, historical-chart authorization, extraction enablement, or service tiers.

## Diagnosis and changes

- Four upload reservations returned 422. On this deployed path, 422 comes from the historical-workspace mutation guard. The files panel only passed account-level read-only state, incorrectly offering upload on historical charts. It now uses the workspace's existing combined read-only state; the shared upload client also refuses historical uploads before reservation or transfer. Active referrals remain editable.
- Attachment-only uploads queued preview jobs, but the dispatcher deliberately selects extraction-enabled packets. The preview worker merely copies originals; it does not convert them. PDFs/browser-readable images/text now use the existing authenticated original viewer immediately. Other formats remain downloadable and honestly report preview unavailable. No extraction or conversion service was enabled.
- The existing dispatcher now retires redundant native-preview jobs transactionally with audit events. Running jobs, extraction jobs, uncompleted reservations, and unsafe scanning verdicts are preserved. No original files are removed.
- Azure signing-key refreshes are coalesced, and the existing minute dispatcher warms signing credentials without fetching documents. This removes redundant refresh calls and addresses the cold-credential path; it is not proof that every production preview is under one second.

## Production data repair

At 2026-09-22 13:48 UTC, verified existence and byte length of all 40 affected live originals, then ran the tested native-preview reconciler against the exact backed-up job/document versions. Result: 40 preview states ready; one queued job for an already-deleted document cancelled. All 41 changes have audit events. No remaining queued/running previews. One older referral-extraction dead letter remains; it was not blindly replayed or labelled successful.

Private before-state and receipt: `/private/tmp/pipeline-traffic-repair-evidence-20260922/` (not checked into Git). The application changes in this branch have **not been deployed**.

## Evidence and remaining limits

- 20 focused tests pass: real disposable PostgreSQL upload/replay/delete/restore, native queue reconciliation, unsafe/deleted/reserved/running-job protection, audit/idempotency, interrupted uploads, account-isolated signing and concurrent refresh.
- Two local Chromium checks pass: historical charts do not offer upload/workbook controls; active-referral upload/list-error recovery remains usable.
- TypeScript, affected server-file lint, and whitespace checks pass.
- A separate service-read spot check returned 200: client directory 388 ms, census 26 ms; token acquisition 329 ms. These are not end-to-end page timings. The prior 1.5-second directory outlier is **not yet explained or claimed fixed**. Investigate per-phase timings if it recurs; do not extend clinical-data staleness or cross-session caching merely to hide it.
- Existing non-native formats (e.g. TIFF/HEIC) need real conversion before inline preview can be promised. Revisit only if assessors need those formats in-browser; uploads and original downloads remain available.
