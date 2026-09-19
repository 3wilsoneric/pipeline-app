# Pipeline reliability execution

Owner authorization: Eric, 2026-09-19, “do it all … context of our app, no drift.”
Application baseline: `ccd474433c05001ed621c30643bde3f1b3e8a201`.
Isolated branch starts at `c0afc67e1e170abf20f42d57e0ff3d962a1c2fc3`.

## Invariants revisited for every change

- This is an assessor's working record, not a demonstration. Keep the current
  chart, assessment, decision, navigation, ownership and reports boundaries.
- Saving happens on a changed field's blur; ongoing typing stays local. Do not
  introduce missing-data prerequisites or global editing locks.
- No silent overwrite of another person's answer, false “Saved”, duplicate
  upload, lost audit/provenance, or mistaken actual admission.
- Signing, admission decisions and confirmed packet sending remain separate.
  Application email remains disabled in rehearsals.
- No production load, injected outage, personal browser automation or real
  client information in fixtures. Preserve other tasks' work.
- Additional baseline spending remains within the approved estimate; disposable
  rehearsal resources stay within the $50 allowance and are removed afterward.

## Evidence ledger (not a completion claim)

1. Shared-record intake save collision: reproduced with two real browser
   sessions, two app processes and synthetic PostgreSQL. Phone/email changes
   collide because they share section versions. Narrow field-aware retry and
   dirty-field-only provenance merge in progress. Same-field protection remains.
2. Save acknowledgements, interrupted sessions and attachment idempotency:
   existing protections and focused fault tests to verify.
3. Assessor workflow, phone/tablet, assignments and incomplete input:
   actual-browser verification pending. No layout work authorized by this pass.
4. Isolated process/database/dependency failures: pending.
5. Browser 10/25/50/100-user ramp, 20-minute peak, two-hour soak: pending;
   the operator's 16 GiB laptop must not run the 100-user workload.
6. Recovery: production PostgreSQL point-in-time restore already verified in a
   private temporary server (39 migration checksums, zero invalid constraints),
   then removed. Full document/application recovery and rollback with new writes
   remain unproved. Azure test-alert email received by Eric; actual failure
   detection needs separate evidence.

Production remains one warm app replica/max three until shared-save evidence
clears the extra-replica hold. Same-zone database HA is healthy, not protection
from a whole-zone outage. Never label these bounded checks “bulletproof”.
