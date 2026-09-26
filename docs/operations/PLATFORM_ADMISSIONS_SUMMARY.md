# Platform Admissions Summary

Alamo Platform shows leadership an admissions dashboard. Pipeline supplies the
referral side of it through one server-to-server endpoint:

`GET /api/integrations/platform/admissions-summary`

- **Authentication:** `Authorization: Bearer $PIPELINE_PLATFORM_SUMMARY_SECRET`,
  checked in `proxy.ts` and again in the route. It is separate from the worker
  secret, so Platform cannot call `/api/internal/*`. When the secret is unset
  the endpoint returns 503.
- **Content:** a live snapshot of the referral board. `board.columns` gives
  each column (Referral received, In progress, Decision) with a count per
  status; `board.cards` gives one row per referral on the board with its
  column, status, next action, destination community, owner, days open, days
  since update, stale/unassigned/move-in-overdue flags, and a relative
  `pipeline_path` that opens it in Pipeline (max 300 rows, oldest first).
  `metrics`, `upcoming_admissions`, and `history` (six-month counts and median
  days to decision) sit beside it. Never client names, DOB, contact details,
  referral sources, notes, or documents.
- **Builder:** `lib/pipeline/platform-admissions-summary.ts` (pure);
  loader: `getPlatformAdmissionsSummary` in `lib/pipeline/operations-snapshot.ts`.
- **Statuses:** the board's own details, with three renamed for leadership
  (Accept -> "Accepted, requirements open", Email not sent -> "Meet the Client
  not sent", Denied -> "Declined").
- **Awaiting admission:** accepted, current workspace, no recorded arrival, and
  a planned date no more than 30 days past (older ones are treated as records
  that were never closed out, not pending arrivals).
- **Verification:** `node --test scripts/platform-admissions-summary.test.mjs`
  and `node scripts/api-route-policy-audit.mjs`.

Platform configuration: set `PIPELINE_ADMISSIONS_SUMMARY_URL` to this
endpoint's full URL and `PIPELINE_ADMISSIONS_SUMMARY_TOKEN` to the same secret.
