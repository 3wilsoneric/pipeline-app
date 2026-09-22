# Internal resident number visibility

Owner requested removal of resident number from the app's visible information. Git history traces the assessment field to the original August 12 build (5a7f788), not the recent chart-document changes.

- Omit the field from assessment records, client medical charts, profile sections, directory card details, and identity-review display. Search help now says client name.
- Preserve stored identifiers, extraction aliases, API contracts, resident matching, validation, and identity confirmation controls. No database or authorization change.
- Excel retains its mapped cell for exact backup round trips, but hides and locks the row and omits it from the visible answer reference. Changing the identity cell is rejected. All 162 fields still round-trip.
- Regenerated the canonical template. Its fingerprint changes with editability; existing workbook validation still rejects stale templates rather than silently remapping cells. Download a fresh working copy after this update.

## Evidence

Build, TypeScript, focused ESLint, and diff checks passed. Five focused Playwright tests passed in `test-results/resident-number-final`: practice chart at 390/1440 pixels; saved chart editing/reload with the stored identifier retained; standalone client chart; complete Excel round trip including long values; and malformed/changed-identity workbook rejection. Screenshots and the changed workbook sheet were visually inspected.

`scripts/chart-intake-contracts.mjs`, `scripts/assessment-workbook-contracts.mjs`, and `scripts/pipeline-question-assistant-contracts.mjs` passed. The workbook check covers 44 conditional branches and all 162 mapped fields.

The local preview on port 3385 was patched at the same narrow owners and verified read-only in a fresh browser context: no visible resident number, no internal training ID, and no browser errors. Its older schema has its own regenerated matching template; do not copy that template over the release candidate.

One initial browser assertion incorrectly assumed the sanitized client fixture already contained a resident number. The fixture now explicitly seeds one, and the assertion verifies its absence from presentation without weakening the check. Isolated contact-list endpoints return 503 because private recipient configuration is intentionally absent; these tests do not send email.
