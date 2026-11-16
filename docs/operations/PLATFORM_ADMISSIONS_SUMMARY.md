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
  client name, column, status, next action, destination community, owner, days
  open, days since update, stale/unassigned/move-in-overdue flags, and a relative
  `pipeline_path` that opens it in Pipeline (max 300 rows, oldest first). Each
  row also carries one bounded `management_profile`: intake identity and
  placement facts, workflow readiness counts, a medication handoff, and—only
  after the assessment is signed—the same capped overview and support fields
  used to prepare Meet the Client.
  `metrics`, `upcoming_admissions`, and `history` (six-month counts and median
  days to decision) sit beside it. `metrics.active_referrals` excludes declined
  referrals while `board.total` and `metrics.on_board` continue to describe all
  cards still visible on the board. Contract 3.5 also publishes `briefing`: the
  Los Angeles reporting date, explicit completeness flags, the trailing 14 days
  of referrals with source and county, remaining assessments scheduled through
  Sunday, planned move-ins for the Monday-through-Sunday week, and 12 weekly
  received/accepted totals. Admitted-last-week, planned-this-week, and
  moving-through rows carry the recorded referral origin, county, assigned
  assessor, and most recent placement from a signed assessment (or null when
  absent). An accepted active workspace without a planned or actual admit date
  remains in moving-through even if it has left the board; cancelled placements
  and confirmed arrivals do not. A cancelled placement has the distinct status
  "Did not move in" and appears in the recent 30-day `did_not_move_in` outcome
  slice; it never counts as an admission or an active referral. Moving rows include a canonical work phase and
  planned date, if any, for the briefing's filtered drill-down. The canonical
  entered-date admission policy applies when the date arrives; subsequent census
  reconciliation confirms or corrects that date. Beyond those context fields, event rows
  retain client name, destination, status, date where relevant, and the bounded
  Pipeline path already authorized for the board. Arrays are capped and their coverage flag turns false instead
  of silently presenting a truncated result as complete. The card and
  management profile contain PHI
  and are therefore limited to the authenticated Platform integration. Raw
  referral notes, contact details, uploaded documents, extraction evidence,
  and unsigned assessment narrative remain outside this contract. Arrays and
  text lengths are capped before transmission.
- **History coverage:** `history.coverage_start_month` is the first month with a
  recorded referral, decision, or admission event. `history.monthly` begins at
  that month; earlier months are unavailable and are never emitted as zero
  activity. Once coverage begins, a zero remains a real zero for that tracked
  month.
- **Builder:** `lib/pipeline/platform-admissions-summary.ts` (pure);
  loader: `getPlatformAdmissionsSummary` in `lib/pipeline/operations-snapshot.ts`.
- **Assessment appointments:** the briefing reads the canonical assessment
  appointment timestamp and duration from `pipeline.assessments`, the same
  schedule source used by Pipeline Home. The clinical assessment date is never
  treated as an appointment.
- **Monday work:** `assessed_last_week` counts each native, launch-eligible
  workspace once at its first recorded interview completion or chart confirmation,
  including prior revisions and reopened charts. It uses assessment audit events,
  then stored completion/signature timestamps as fallback evidence; planned dates
  and last-edit dates are never evidence of completion. `accepted_last_week` uses
  current accepted decisions recorded in the prior week. These separate cohorts
  retain client, source, county, prior placement and assessor context, with explicit
  500-record coverage limits. Read all nondeleted workspace states so closing a
  workspace does not remove last week's work. Reconfirmations do not count again;
  decision corrections can change the accepted list. Weeks and timestamp events
  use Pacific calendar dates, including Sunday UTC crossover and DST.
- **Community movement:** Pipeline's read-only census adapter accepts Platform's
  optional `weekly_movement` projection. The briefing selects the exact prior
  Monday–Sunday period, never a nearby available week. Absent/incomplete movement
  is unavailable/partial rather than zero. This includes all community residents,
  whereas Pipeline client lists count workspaces. Current census keeps its own
  source date. The summary and Home entry are read-only and retain existing report
  access, including the authorized Eric-to-Andrew preview.
- **Statuses:** the board's own details, with three renamed for leadership
  (Accept -> "Accepted, requirements open", Email not sent -> "Meet the Client
  not sent", Denied -> "Declined").
- **Awaiting admission:** accepted, current workspace, no recorded arrival, and
  a planned date no more than 30 days past (older ones are treated as records
  that were never closed out, not pending arrivals).
- **Verification:** `node --test scripts/platform-admissions-summary.test.mjs`
  and `node scripts/api-route-policy-audit.mjs`.

## Turning it on

1. Generate one random value (for example `openssl rand -base64 48`) and store
   it in Pipeline's Key Vault as `pipeline-platform-summary-secret`.
2. Set the repository variable `PIPELINE_PLATFORM_SUMMARY_ENABLED=true` and run
   the Azure deploy workflow. `infra/azure/runtime.bicep` then maps the Key
   Vault secret to `PIPELINE_PLATFORM_SUMMARY_SECRET` on the web app. With the
   variable unset the endpoint stays off (503).
3. In Alamo Platform, set `PIPELINE_ADMISSIONS_SUMMARY_URL` to
   `https://<pipeline host>/api/integrations/platform/admissions-summary` and
   `PIPELINE_ADMISSIONS_SUMMARY_TOKEN` to the same value.

Rotate by updating both Key Vaults and restarting both apps.
