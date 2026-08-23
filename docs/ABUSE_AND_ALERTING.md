# Abuse Controls and Alerting

## Application overload boundary

Every logged API request passes through the server-only request governor.
Health is exempt; reads, mutations, uploads, and workers have independent
per-process concurrency budgets. Defaults are 100 reads, 40 mutations, four
uploads, and eight workers. Saturation returns `429`, `Retry-After: 1`, and a
private non-cacheable response. Slots are always released in `finally`.

Override only after a measured load test with:

```text
PIPELINE_MAX_CONCURRENT_READS
PIPELINE_MAX_CONCURRENT_MUTATIONS
PIPELINE_MAX_CONCURRENT_UPLOADS
PIPELINE_MAX_CONCURRENT_WORKERS
```

These limits protect one Next.js process. The trusted edge must additionally
enforce distributed budgets across all instances: 600 reads, 180 mutations,
30 uploads, and 120 worker requests per minute per authenticated principal or
worker identity. Use a shared store or gateway policy; do not rely on process
memory for distributed limits.

## Authorization boundary

`npm run check:route-policy` inventories every exported HTTP method. It fails
when a method lacks a canonical route template, when internal routes omit
worker authentication, when a mutation omits same-origin protection, or when a
viewer can reach record writes. `proxy.ts` is an optimistic redirect only;
route handlers remain the authorization boundary.

## Metrics and alerts

`infra/azure/operational-alerts.bicep` defines 13 scheduled-query rules for
save conflicts, referral queue age, extraction failure/depth/age,
authorization failure, p95 latency, overload rejection, clinical failure and
freshness, stale editing leases, storage failure, and retention failure. It
also declares native Azure Monitor capacity alerts for PostgreSQL connections,
PostgreSQL storage, and Blob used capacity. `infra/azure/runtime.bicep` adds
native Container Apps restart and resiliency-timeout alerts. The queries use
route templates, status, durations, bounded outcomes, and aggregate counts
only. Names, diagnoses, medications, query strings, resident/referral/document
IDs, tokens, secrets, and upstream bodies are forbidden.

Default planning thresholds are 60 PostgreSQL connections, 75 percent
PostgreSQL storage, 80 GiB Blob used capacity, more than two Container Apps
restarts in 15 minutes, and any Container Apps resiliency timeout. Treat these
as pilot baselines. Change them only from observed workload and recovery
evidence, not to silence an alert.

At deployment, pass approved action-group resource IDs and forward the
structured server logs into the declared Application Insights workspace. An
empty action-group list intentionally creates visible rules without delivery;
it is not production-complete. Test every notification path with synthetic
events and record the owner, response action, and escalation target. The
aggregate inventory returned by the worker-authenticated retention endpoint is
logical application storage; the native Blob `UsedCapacity` metric remains the
physical billing and capacity authority.

## Failure drills

Run `npm run check:chaos` for deterministic local recovery contracts. Before a
PHI pilot, repeat overload, database interruption, Blob unavailability,
extraction timeout/dead-letter, stale callback, and clinical timeout drills in
a disposable deployed environment. Never inject failures into live client
records.
