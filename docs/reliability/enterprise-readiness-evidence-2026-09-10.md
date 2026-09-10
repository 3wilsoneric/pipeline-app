# Enterprise Readiness Evidence — 2026-09-10

## Result

The current single-company Pipeline deployment remained live during a five-minute public production soak. The isolated PostgreSQL workflow preserved identity separation and deterministic optimistic concurrency for 1,000 synthetic accounts. A schema-only backup was restored into a separate disposable database after correcting the restore verifier's fresh-database initialization.

## Executed evidence

| Exercise | Result |
| --- | --- |
| Production public soak | 300 seconds, 272 requests, 0 errors, 105.21 ms mean, p95 at or below 750 ms, p99 at or below 1,500 ms, no final-phase regression. |
| PostgreSQL multi-user collision | 1,000 distinct referrals and presence leases; 2,000 change polls; exactly 1 accepted and 999 rejected stale writes for both referral sections and same-user drafts. |
| Per-user workspace state | 1,000 isolated recents and 1,000 isolated drafts created, read, contended, and cleaned up. |
| Collision latency | Referral creation p95 752.8 ms; all other measured p95 values at or below 163.5 ms. |
| Backup/restore | SHA-256 manifest verified; 32 migrations matched; the synthetic referral survived restoration into a distinct disposable database. |
| Alert inventory | Repository defines 13 query and 3 capacity alerts. Production currently has 7 matching query alerts; the six newer queries and three foundation capacity alerts are not deployed. |
| Company isolation | Current one-company-per-deployment model passed. Shared-database multitenancy did not pass because company keys and database-enforced company boundaries do not exist yet. |
| Regional recovery | Zone-resilient storage and backup/restore controls passed. Cross-region runtime, database target, and traffic failover do not exist yet. |
| Work Assessment Graph | Deterministic synthetic graph projection passed provenance, bounded-vector, no-free-text, no-auto-decision, and three held-out workflow-retrieval checks. |

## Release boundary

This evidence supports the existing application and a single-company deployment. It does not certify shared-database multitenancy, cross-region failover, or end-to-end notification delivery. Those strict gates remain intentionally red rather than being represented as complete.

No production records were read by the load, graph, or restore fixtures. The production soak exercised only the public liveness endpoint and performed no mutation.
