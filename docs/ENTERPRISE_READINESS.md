# Enterprise readiness

Pipeline's currently supported production boundary is one company per deployment. Role, assignment, optimistic-concurrency, audit, and recovery controls operate inside that boundary. A shared database serving unrelated companies is not approved until tenant identity is a first-class key at every storage and authorization boundary.

## Required gates

| Capability | Current gate | Meaning |
| --- | --- | --- |
| Production endurance | `npm run check:soak` with `PIPELINE_SOAK_PROFILE=public` | Exercises production liveness without credentials or mutations. Run authenticated missions only against an isolated environment. |
| Company isolation | `npm run check:tenant-isolation` | Certifies the current single-company deployment boundary and reports every missing shared-multitenancy control. Strict mode must pass before a shared deployment is offered. |
| 1,000-user collision behavior | `npm run check:collaboration-load` with 1,000 users and PostgreSQL required | Uses 1,000 distinct principals, bounded request concurrency, overload backoff, presence, polling, disjoint saves, same-section collisions, recents, and drafts. |
| Backup and restore | `npm run database:backup` followed by `npm run database:restore:verify` against a disposable database | Verifies checksums, migration history, and aggregate restored row counts without logging record data. |
| Regional recovery | `npm run check:regional-recovery` | Certifies zone resilience and backup/restore controls. Strict mode remains red until a separately funded secondary region and traffic failover exist. |
| CI runtime currency | Pinned current action SHAs | Avoids deprecated JavaScript action runtimes without accepting mutable tags. |

## Honest boundaries

- One deployment may serve one company today. Separate companies require separate deployments.
- A thousand logical users can be simulated, but production sizing is certified only by a PostgreSQL-backed load run against the intended replica and database profile.
- Zone-redundant storage and a restorable backup are not regional failover.
- Alert rules without a reviewed action group are visible controls, not notification delivery.
- None of these gates claims that defects are impossible. They make failures observable, bounded, recoverable, and reproducible.
