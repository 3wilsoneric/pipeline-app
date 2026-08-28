# Developer Change Dossier

Use this template for substantial changes that affect a registered Academy source anchor or introduce a new architectural concept.

## Change identity

- Change:
- Commit or branch:
- Human owner:
- Reviewer:
- Academy modules affected:

## User outcome

Describe the user or operator problem in one paragraph.

## Invariants

- Invariant preserved:
- New invariant introduced:
- Behavior explicitly unchanged:
- Non-goals:

## Execution trace

Describe the path through browser, route, domain, persistence, worker, and external effects. Name symbols rather than relying only on filenames.

## Concepts taught

- Language/framework concept:
- Architecture concept:
- Reliability concept:
- Security or PHI concept:
- Database or integration concept:

## Design decision

- Chosen design:
- Alternatives considered:
- Why the alternatives were rejected:
- Debt or limitation intentionally retained:

## Failure behavior

| Failure | Expected behavior | Recovery | Evidence |
| --- | --- | --- | --- |
|  |  |  |  |

## Concurrency and idempotency

- Concurrency owner:
- Version/lock/idempotency mechanism:
- Retry classification:
- Duplicate protection:

## Data and privacy

- Authoritative records changed:
- Provenance changed:
- PHI classification:
- Logging/metrics impact:
- Retention impact:

## Verification

- Focused tests:
- Negative authorization tests:
- Database/migration evidence:
- Browser evidence:
- Performance evidence:
- Full certification:

## Academy maintenance

- Lesson prose updated:
- Exercises updated:
- Source anchors updated:
- Source fingerprint reviewed and updated:
- Learner teach-back completed:

## Teach-back prompt

Explain this change in five minutes without reading the implementation. Include why it is safe, how it fails, and how an operator recovers.
