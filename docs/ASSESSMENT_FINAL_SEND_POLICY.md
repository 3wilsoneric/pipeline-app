# Assessment editing and final sending

Owner request, September 17, 2026: use **Add note**, only after signing and sending
the Meet the Client referral packet. Until that final step, permit ordinary edits
and continue logging them.

## Behavior

- A signature alone does not freeze answers, imported evidence, review actions,
  or the existing field-blur saving/recovery path. Existing role, resource, identity,
  validation and concurrent-edit protections remain in place.
- `isAssessmentFinalized` owns the rule: both `signed_at` and
  `meet_client_sent_at` must exist. Only the server can record successful sending.
- Successful sending records the exact assessment version sent. Preparing an
  email, accepting admission, or a failed email attempt is not finalization.
- The final send serializes against assessment saves using the existing local
  mutation queue / PostgreSQL row lock. A change during packet preparation stops
  the stale send before the provider. Input is not disabled while preparing;
  concurrent saves during delivery wait for its outcome.
- Once sent, existing answers remain unchanged and **Add note** appends an
  attributed, dated, audited note. The internal addenda API/event names stay
  unchanged so old records and integrations are preserved.
- Explicit new assessment revisions start editable, without inheriting the
  previous revision's sent marker. Existing signed authorship and prior notes
  are not erased.

## Deployment and recovery

Apply additive migration `0038_assessment_packet_finalization` before the app.
It backfills only recorded successful Meet the Client deliveries, never infers a
send from a signature, and leaves other records editable. Rollback to the previous
app is compatible with the columns retained; the rollback file deliberately keeps
delivery evidence rather than dropping it.

Finality is saved separately from the email audit. If the initial finalization
commit fails after provider acceptance, the successful delivery audit transaction
also repairs the marker. Provider acceptance is never reported as a failed send
or automatically retried. An ambiguous provider outcome or a simultaneous loss of
both persistence attempts still needs operational reconciliation; this is not an
exactly-once-delivery claim.

## Focused evidence

- `scripts/assessment-final-send-fixtures.test.mjs`: real local-file and disposable
  PostgreSQL stores; edits/imports after signing with audit attribution, failed-send
  editability, stale preview rejection, concurrent send/save serialization, final
  answer preservation, note append/conflict behavior, revision isolation, restart
  persistence, and historical successful-send migration backfill.
- `scripts/meet-client-delivery-fixtures.test.mjs`: eight route/provider fixtures,
  including acceptance/audit failures, finalization failure, stale assessment,
  authorization and idempotent replay. No external email sent.
- `tests/e2e/assessment-final-send.spec.ts`: real browser edit/save/reload after
  signing, no early Add note, followed by a labeled presentation fixture for the
  sent/read-only/Add note state. Store finality is covered separately above.
- Production build/TypeScript, focused lint, and diff whitespace checks.

The existing `assessor-workflow-contracts.mjs` string assertion about the old
PacketCanvas steps/labels fails against the unchanged starting PacketCanvas
at `35ab159`; it is unrelated to this change. No PacketCanvas/CSS/navigation edits
are included here. Updated lifecycle expectations in the operational suites are
included, but those full suites were not rerun for this bounded change.
