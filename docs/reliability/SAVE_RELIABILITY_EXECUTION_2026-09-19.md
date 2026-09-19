# Pipeline reliability execution

Owner authorization: Eric, 2026-09-19, “do it all … context of our app, no drift.”
Production application baseline: `ccd474433c05001ed621c30643bde3f1b3e8a201`.
Isolated branch starts at `c0afc67e1e170abf20f42d57e0ff3d962a1c2fc3`.
Runtime candidate: `1bae62b1d0a81a0a92d9f07a2e7a3afc9ffe6211`.
Harness/fixture candidate: `1bd61d64de8d508b48a35003030cf32215f1d591`.
Readiness-check alignment: `78d6f790c5fb3b571b9554fce3f20e016e03f6b1` (test-only).
This ledger does not claim production deployment or universal reliability.

## Invariants revisited for every change

- Preserve chart, assessment, decision, navigation, ownership, and reports boundaries.
- Save changed fields on blur; ongoing typing stays local. No missing-data prerequisites or global editing locks.
- No silent overwrite, false Saved state, duplicate upload, lost audit/provenance, or mistaken admission.
- Signing, admission decisions, and confirmed packet sending remain separate. Rehearsal email is disabled.
- Synthetic fixtures only: no production load/outage, personal browser, or clinical feed. Preserve other tasks' work.
- Temporary Azure resources stay within the approved $50 allowance and are deleted after evidence collection.

## Narrow runtime changes

1. Intake and assessment saves rebase known version conflicts only when the
   changed fields are unchanged remotely or already equal the intended answer.
   Bounded retries preserve same-field and lifecycle conflict protection.
2. Intake source evidence merges only changed keys. Assessment writes carry
   captured dirty fields, not another field's ongoing typing.
3. Unresolved same-field conflicts retain their comparison baseline through
   another field's save, remote polling, encrypted persistence, and reopening.
4. Late recovery and principal initialization cannot replace newly entered
   assessment answers. Delayed-recovery browser proof failed on the old runtime
   and passed on the fix. Recovered conflicts are deduplicated by field.
5. Only explicit canonical pre-handler 429 capacity rejections automatically
   retry writes: recognized capacity header, identical body/mutation ID, maximum
   three attempts. Generic 429 and ambiguous failures do not gain blind replay.
6. A confirmed-absent referral recovery draft no longer triggers redundant
   DELETEs. The check runs inside the existing save queue; unknown versions and
   nonzero versions still use server compare-and-swap. Failed deletion retains
   local recovery, and a queued draft save is awaited before deciding to skip.

No migration, permission, dependency, or layout changes. Persistent capacity
rejection remains visible/recoverable; revisit measured capacity and polling
instead of silently raising retry limits or removing the governor.

## Focused evidence

- Six intake, seven assessment, three pre-handler retry, five recovery-cleanup,
  and eight scheduling cases: **29 passed**. TypeScript and scoped ESLint passed.
- Existing API behavior fixtures: **116 passed**. Chart/intake contracts passed
  after correcting a stale test authentication stub to the existing all-staff
  policy; unauthenticated/unknown role/access/origin denial checks remain.
- Existing instant-navigation and intake-recovery contracts: **passed**.
- Scheduling fixture expectations were stale relative to existing all-staff
  access. Test-only alignment with the canonical policy: **8 passed**, including
  restricted scope, authentication, referral access, stale input, and origin checks.
- Latest split boundary run: **15 passed in 47 seconds**, production build
  `f4096c7` (runtime equals `1bae62b`), test harness `5b3d27b`. Earlier intermittent
  no-PATCH test failures came from programmatic fill/focus under the existing
  inert recovery overlay. The tests now wait for an interactive workspace and
  click the phone date input as a person would; save/audit assertions were not
  weakened. Earlier failed runs are retained separately.
- Cases cover same/disjoint-field edits, recovery races, lost replies, partial
  unscheduled phone answers reopened on tablet, authorization expiry retaining
  input, real Blob upload with lost completion reply (one transfer/file and
  byte-identical download), and actual disposable PostgreSQL stop/restart.
- Desktop/tablet/phone journeys passed: assessment signing, decision, placement
  date, unsent handoff preview. Long answer data was seeded via API; not every
  questionnaire answer was typed manually. No email was sent.
- Assignment journey passed: Home assignment → partial assessment → scheduling
  → Calendar → Home continuation → reload, with one unsigned saved assessment.
- Real PostgreSQL fixtures: 12 checks, 24 actors/48 jobs passed transaction
  rollback, primary-contact race, optimistic winner, committed retry, outbox,
  unique work claims, lock timeout, and deadlock recovery.
- Failure/recovery readiness script: 13 checks passed after updating its stale
  write-attempt expectation to the bounded pre-handler 429 behavior. The three
  executable retry cases also passed; runtime behavior was not changed.

## Load and recovery

See [browser evidence](BROWSER_CAPACITY_REHEARSAL_2026-09-19.md). Normal 50-user
in-app work passed; the 50-user full-reload storm did not. The Premium-disk
100-user short run passed, but the 20-minute peak failed on direct test
cross-process read connection resets; the two-hour soak was automatically
skipped. Sustained 100-user capacity and long-duration memory stability remain
unqualified. Peak navigation and save latency worsened over time; do not call
the performance requirement satisfied because acknowledged data was intact.

Two-process 100-user runs failed capacity qualification. Independent post-hoc
SQL reconciliation of those runs and the split 50-user reload failure matched
all 12,694 acknowledged values/audit entries. This does not turn failed capacity
runs into passes or prove that unacknowledged attempts committed.
Final post-hoc reconciliation additionally matched 10,430 acknowledged writes
from the failed three-process ramps and all 28,829 from the failed peak. The
transport failure's precise cause remains unresolved. No blind load rerun,
governor relaxation, production resize, or new runtime change followed it.

- Production PostgreSQL PITR to a private temporary server verified 39 migration
  checksums and zero invalid constraints; restore server/probe removed.
- Synthetic database dump restored to a new database with matching counts.
  Four document references matched Blob bytes/SHA-256; one synthetic blob was
  deleted and recovered from its Azure version without changing document identity.
- Actual previous production source `ccd4744` read new candidate writes, made an
  edit, survived forced process restart, and the candidate read that edit. SQL and
  exactly-once audit checks passed; no database rollback was used.
- Eric received Azure's test email. Read-only audit found 13 query and five metric
  alerts enabled/routed. Actual outage-to-email signal delivery remains unproved.

## Operational hold and limits

Runtime deployment and the second warm replica remain held for the deployment
owner. Deploy separately verified UI-only release
`991c9a279e848e49578131504d16c49d5bb92ba0` live at 23:26 UTC, min one/max three
replicas; that release contains none of this candidate's runtime or Excel work.
Use that baseline for eventual integration, not the older rehearsal baseline.
Keep the existing delayed-recovery typing/import regression assertions unchanged;
Excel-imported fields must enter the touched-field set and `workbook_restore`
metadata must survive rebuilt retries. Preserve selected-assessment identity
guards and field-level conflict behavior. The clean candidate handback does not
authorize representing the failed capacity test as passed.
Same-zone PostgreSQL HA is healthy, not whole-zone disaster protection.

No claim covers 100 laptops/ISPs/regions, real Entra expiration, Databricks,
Container Apps autoscaling/failover, native Safari/PWA lifecycle, physical mobile
keyboards, or 1,000 users. All five remote evidence archives and the final
synthetic database dump are preserved locally with verified hashes. Temporary
resource-group deletion was verified at `2026-09-19T23:33:38Z` (group absent).
The local synthetic database was stopped without deleting its files. Estimated
temporary test cost is $8–10, not a finalized bill; the billing query was
rate-limited. Final source handback retains the explicit deployment/capacity hold.
