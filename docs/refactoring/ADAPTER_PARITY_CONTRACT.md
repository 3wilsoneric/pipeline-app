# Local and PostgreSQL Adapter Parity Contract

## Purpose

Local JSON adapters support development and isolated browser tests. PostgreSQL is the production transactional store. Refactoring must prove intended domain parity without pretending the adapters have identical infrastructure semantics.

## Shared scenario contract

Run each applicable scenario through both adapters with the same fixed clock, actor, mutation ID, and synthetic input:

| Area | Required scenarios | Compare |
| --- | --- | --- |
| Create | valid create, duplicate mutation ID, invalid initial state | canonical record, version, audit action, idempotent replay |
| Update | disjoint section edit, stale same-section edit, owner change | returned record, changed fields, conflict classification, actor attribution |
| Workflow | allowed transition, skipped transition, terminal-state mutation | outcome, blockers, version, audit event |
| Lifecycle | trash, restore, signed immutability, addendum | state, recovery deadline, historical records, audit event |
| Query | sort, filter, date boundary, pagination | ordered stable identities and cursor behavior |
| Failure | malformed input, missing record, stale version, duplicate key | stable error category and recovery guidance |

Before implementing the table, classify every command as replay-idempotent, conflict-safe, or deliberately non-retryable. Returning a stale-version conflict without applying a duplicate is safe, but it is not the same observable contract as returning the original successful result for a repeated mutation identifier.

The scenario harness must declare how it controls or compares timestamps and generated identifiers. Prefer injected clocks and ID factories at a characterized seam. If an ambient source cannot be replaced until the first approved change, normalize only that declared nondeterminism and keep the semantic timestamps, ordering, version increments, and actor identity under assertion.

## PostgreSQL-only assertions

These must remain explicit and are not reduced to local behavior:

- Mutation, audit, idempotency, decision, and coupled work-item writes share the intended transaction.
- Compare-and-swap predicates reject stale versions at the database boundary.
- Locks and unique constraints produce one durable winner under contention.
- Statement timeout, query plan, keyset pagination, and pool behavior remain bounded.
- Outbox or queue repair state survives process loss.

## Comparison rules

- Compare canonical domain values, not storage-specific timestamps, UUID formatting, or row order without a declared sort.
- Normalize only known nondeterminism through injected clock and ID factories.
- Never weaken the production adapter to make a local fixture pass.
- Record intentional differences in the slice decision record.
- Resolve audit observability explicitly. The current local referral adapter does not expose a persisted audit stream equivalent to PostgreSQL `audit_events`; do not silently declare parity or weaken the PostgreSQL contract to hide that difference.
- Every defect discovered through parity becomes a permanent scenario.

## Exit evidence

- One named scenario table shared by both adapter suites.
- Aggregate pass/fail output without PHI or record contents.
- Disposable PostgreSQL 16 execution in CI.
- At least one stale-write, duplicate-mutation, transaction-rollback, and actor-attribution failure case.
- A command-by-command retry table stating whether duplicate execution returns the prior result, returns a conflict, or requires operator recovery.
