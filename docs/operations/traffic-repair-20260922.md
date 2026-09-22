# September 22 traffic repair

Based on production `7148e8e`. No change to clinical answers, ownership, historical-chart authorization, extraction enablement, or service tiers.

## Diagnosis and changes

- Four upload reservations returned 422. On this deployed path, 422 comes from the historical-workspace mutation guard. The files panel only passed account-level read-only state, incorrectly offering upload on historical charts. It now uses the workspace's existing combined read-only state; the shared upload client also refuses historical uploads before reservation or transfer. Active referrals remain editable.
- Attachment-only uploads queued preview jobs, but the dispatcher deliberately selects extraction-enabled packets. The preview worker merely copies originals; it does not convert them. PDFs/browser-readable images/text now use the existing authenticated original viewer immediately. Other formats remain downloadable and honestly report preview unavailable. No extraction or conversion service was enabled.
- The existing dispatcher now retires redundant native-preview jobs transactionally with audit events. Running jobs, extraction jobs, uncompleted reservations, and unsafe scanning verdicts are preserved. No original files are removed.
- Azure signing-key refreshes are coalesced, and the existing minute dispatcher warms signing credentials without fetching documents. This removes redundant refresh calls and addresses the cold-credential path; it is not proof that every production preview is under one second.
- The directory summary query joined 200 requested clients against 13,832 documents before checking either identity: 2,766,400 discarded combinations. Separate canonical/person identity joins with UNION use existing indexes, preserve duplicate elimination and the same access predicates, and require no schema, data or cache changes.

## Production data repair

At 2026-09-22 13:48 UTC, verified existence and byte length of all 40 affected live originals, then ran the tested native-preview reconciler against the exact backed-up job/document versions. Result: 40 preview states ready; one queued job for an already-deleted document cancelled. All 41 changes have audit events. No remaining queued/running previews. One older referral-extraction dead letter remains; it was not blindly replayed or labelled successful.

Private before-state and receipt: `/private/tmp/pipeline-traffic-repair-evidence-20260922/` (not checked into Git). The application changes in this branch have **not been deployed**.

## Evidence and remaining limits

- 20 focused tests pass: real disposable PostgreSQL upload/replay/delete/restore, native queue reconciliation, unsafe/deleted/reserved/running-job protection, audit/idempotency, interrupted uploads, account-isolated signing and concurrent refresh.
- Two local Chromium checks pass: historical charts do not offer upload/workbook controls; active-referral upload/list-error recovery remains usable.
- TypeScript, affected server-file lint, and whitespace checks pass.
- The directory query has a real PostgreSQL fixture covering canonical/person identity overlap, confirmed resident-number aliases, candidate/deleted/unmatched exclusions, missing clients, empty input and restricted access. It passes, as do TypeScript and affected-file lint.
- Read-only production measurements of the actual directory-summary owner (200 clients) improved from 133–177 ms to 10–17 ms; EXPLAIN ANALYZE improved from 257.763 ms to 0.877 ms. These are database-step measurements, not full page loads. The last-day directory median was 28 ms and p95 634 ms (111 requests; two above one second). Upstream authentication/network cold starts still vary; this fixes proven wasted query work, not every possible cold-start delay.
- Both >2-second home requests in the last-day sample came from the older 1ca4c9e revision; no such home outlier appeared on current 7148e8e. No speculative home-page rewrite was added.
- Existing non-native formats (e.g. TIFF/HEIC) need real conversion before inline preview can be promised. Revisit only if assessors need those formats in-browser; uploads and original downloads remain available.
