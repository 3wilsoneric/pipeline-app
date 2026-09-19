# Azure readiness: priced candidate, not activated

Owner: Eric. Prepared 2026-09-19. Source baseline:
`ccd474433c05001ed621c30643bde3f1b3e8a201`.
Branch: `codex/azure-readiness-costed-20260919`.

**STOP: no approval of the price has been received. Do not merge the runtime
change, provision resources, send test notifications, run paid rehearsals, or
deploy this candidate until Eric approves the cost.** This work is isolated
from the app/product branches. No user workflow, database schema, permissions,
clinical data, extraction behavior, or application code was changed.

## Read-only production inventory

- Pipeline resource group: `rg-pipeline-prod`, West US 2.
- Container App `pipeline-prod-web`: Consumption, 1 vCPU / 2 GiB per replica,
  minimum 1 / maximum 3, HTTP scaling threshold 50 concurrent requests.
  Environment is zone redundant. Minimum replicas, not the zone flag alone,
  determine whether another app process is already running.
- PostgreSQL `pipeline-prod-pg-a6qdvl6ebenac`: General Purpose D2ds_v5,
  2 vCores / 8 GiB, 128 GB P10 / 500 IOPS; storage auto-grow enabled;
  HA disabled; primary zone 1; 14-day backups; geo-backup disabled.
- Storage `pipelineproda6qdvl6ebena`: Standard ZRS, private blobs,
  blob/container soft delete 14 days. Approximately 28.2 GB and 28,559 blob
  objects, not necessarily that many uploaded documents. No lifecycle policy.
- Thirteen scheduled query alerts and five metric alerts exist. Restart and
  timeout metric alerts have **no action group attached**. The other alerts
  point at an enabled group with two ARM-role receivers. That is configured
  routing, not evidence that any particular operator received a message.
- The `pipeline-foundation-state` output record omits action-group IDs.
  Routine deployments consume that missing value as `[]`, explaining why
  runtime alert destinations are lost. The local fix preserves the field
  through bootstrap -> state -> runtime deployment.

Hourly samples for the 24 hours ending 2026-09-19 18:52 UTC: database average
CPU 4.55%, maximum 35.56%; memory maximum 32.23%; storage 7.24%; active
connections maximum 24. App maximum CPU about 0.089 vCPU and working set
about 238 MiB. These are low-traffic observations, **not load certification**.

## Quote: incremental recurring cost

USD public pay-as-you-go retail, West US 2, 730 hours/month. Queried Azure
Retail Prices API on 2026-09-19. No tax, discounts, reserved pricing, credits,
or shared subscription free allowances deducted. This is **additional to
the existing bill**, not an estimate of the whole subscription.

| Change | Increment/month | Calculation |
| --- | ---: | --- |
| One additional always-running 1-vCPU / 2-GiB app replica | $31.54–$110.38 | All idle vs all active billing |
| D2ds_v5 PostgreSQL HA standby compute | $129.94 | $0.178/hour × 730 |
| Standby provisioned storage, 128 GB | $14.72 | $0.115/GB-month × 128 |
| Reconnect existing alert rules | $0 new rule charges | Reuse current rules; delivery and logs remain metered |
| **Core incremental total** | **$176.20–$255.04** | Before variable usage below |

An illustrative replica with 176 active hours/month and 554 idle hours costs
$50.54; combined with the standby that is $195.20/month. This is a scenario,
not a forecast. Azure's idle eligibility depends on CPU/network/request
activity; an always-warm replica is not necessarily idle-billed.

Recommend approving **about $260/month additional baseline budget**, plus a
**$50 one-off rehearsal allowance**. Neither is an Azure-enforced spending
cap. Request approval again before adding further capacity, new paid
services, or extending the rehearsal beyond that allowance. Cost alerts
notify; they do not safely shut down a data-entry application.

Variable charges excluded: traffic-driven use of the existing third replica,
requests ($0.40/million before shared grants), log ingestion/retention,
notification usage, backup storage beyond included allowance, Blob growth
and operations, network egress, and existing OCR/extraction processing.
No new alert rules or log retention increase are included in this candidate.
No new Redis, Front Door, read replica, Databricks workspace, region, or
larger database is proposed without measured need and a separate quote.

### Price evidence

API filter: `armRegionName eq 'westus2' and serviceName eq '<service>' and
priceType eq 'Consumption'`. Match exact product and meter, not a similarly
named MySQL/legacy server SKU. All listed meters were primary and USD.

| Meter ID | Product / meter | Unit price |
| --- | --- | ---: |
| 2711ef08-ef48-5416-9ef2-f1110cd09c79 | Container Apps / Standard vCPU Active Usage | $0.000034/second |
| 8fed0c99-e333-5840-b785-a25c32d8940e | Container Apps / Standard vCPU Idle Usage | $0.000004/second |
| 2dbd360e-f9d9-563d-8916-844b6b27a2d7 | Container Apps / Standard Memory Active Usage | $0.000004/GiB-second |
| 576eb6a3-4204-52cd-a016-1640251bdb77 | Container Apps / Standard Memory Idle Usage | $0.000004/GiB-second |
| 541cdf7c-414a-5bba-b00c-c9d11c3ce307 | PostgreSQL Flexible Server General Purpose Ddsv5 / Standard_D2ds_v5 | $0.178/hour per 2-vCore SKU |
| aa0fdd92-2d97-5f66-80fe-befa93c9b24c | PostgreSQL Flex Server Storage / Storage Data Stored | $0.115/GB-month |

The PostgreSQL SKU rate is not multiplied by two again. HA bills a matching
standby; it does not double read capacity. The existing `production_ha`
preset also doubles primary compute and storage and changes backup coverage.
Use the new `pilot_ha` option to describe this smaller proposal instead.
Keep the existing 14-day backup policy; this proposal is not regional DR.

Sources: [Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices),
[API endpoint](https://prices.azure.com/api/retail/prices),
[Container Apps billing](https://learn.microsoft.com/en-us/azure/container-apps/billing),
[PostgreSQL reliability and standby billing](https://learn.microsoft.com/en-us/azure/reliability/reliability-database-postgresql),
[Azure Monitor pricing](https://azure.microsoft.com/en-us/pricing/details/monitor/).

## Local changes prepared

1. Runtime production minimum replicas 1 -> 2; maximum stays 3, CPU/RAM and
   HTTP scale threshold unchanged. **Merging then deploying changes cost.**
2. `pilot_ha` database profile: D2ds_v5 / 128 GB with zone-redundant HA,
   no automatic compute/storage/geo-backup upgrade. Existing `pilot` and
   `production_ha` meanings remain unchanged.
3. Preserve action-group IDs in output-only foundation state and bootstrap.
4. Audit each expected alert's actual link to an enabled group with receivers,
   including runtime restart/timeout alerts. Unrelated receivers cannot make
   an unconnected alert pass. Report delivery as unverified until tested.
5. Focused synthetic tests for connected, unattached, disabled, empty,
   unknown and missing destinations/rules. These never contact Azure.

## Activation order after cost approval

1. Coordinate with the deployment task. Refresh the live SHA and infra state;
   preserve current feature flags, image, domains, jobs and secrets. Reconcile
   these narrow changes with the latest main rather than deploying this older
   application image. Confirm subscription/resource names before every write.
2. Confirm a named alert recipient. Preserve existing role recipients, add
   the approved direct destination if needed, and perform one PHI-free test
   notification after authorization. Recipient must acknowledge delivery.
3. Update only `pipeline-foundation-state` using its existing parameters and
   reviewed group IDs. Its compiled template has no deployed resources.
   Keep database level `pilot` until HA really becomes healthy. Review a
   what-if; **never rerun full foundation bootstrap on the existing server**.
   Reapply only the affected metric rules or routine runtime with preserved
   parameters. Read back nonempty actions and verify they survive a release.
4. Complete an isolated restore exercise. Restore the database to a separate
   private server, never over production; read-only integrity checks and no
   mail, extraction, retention, or application workers against restored PHI.
   Keep production security/PHI boundaries and do not copy records to the
   laptop. Verify representative document recovery separately; a DB restore
   does not restore Blob content. Delete only the explicitly created temporary
   resources after verification; retain a PHI-free result record.
5. Rehearse two app replicas and HA behavior on a synthetic, isolated target
   before enabling the second production replica. Check cross-replica
   sessions, cache invalidation, edit conflicts, upload idempotency, queue
   claims and jobs; process-local coordination is not distributed safety.
   Scope test telemetry to the test app so it cannot pollute production
   alerts; disable external mail/extraction calls on the synthetic target.
6. Enable HA in a low-activity window using the existing server's targeted
   update operation. Expected change: standby only, no credentials/network/
   SKU/storage changes. Confirm West US 2 capacity and a standby zone different
   from primary zone 1; do not silently accept same-zone fallback. Wait for
   HA `Healthy` and database `Ready`, then update state profile to `pilot_ha`.
   Provider operation to review, **not executed in this preparation**:

   ```bash
   az postgres flexible-server update \
     --subscription 84d40648-8488-4226-9e74-6b9458d0d73f \
     --resource-group rg-pipeline-prod \
     --name pipeline-prod-pg-a6qdvl6ebenac \
     --high-availability ZoneRedundant
   ```

7. Roll out the replica setting with the current approved image/configuration.
   Check two ready replicas and placement. Keep maximum 3 until measured
   demand justifies a new quote. Current web pool budget is at most 30
   connections (3 × 10); job/migration pools and reserve must be counted
   separately. Database connection limits are not a performance target.
8. Controlled synthetic production smoke: authenticate, read a chart, save
   and reread a field from another replica/session, upload once, open preview,
   verify audit, verify the operational alerts and current release. No
   disruptive failover or swarm against real assessors without a separate
   window. Do not claim the load or recovery checks ran in this preparation.

### Rehearsal budget and evidence

For a disposable target kept up at most 24 hours, two fully active app
replicas plus a D2ds_v5/128-GB HA pair cost about **$16.77 compute/disk** at
these rates. Allow **up to $50 total planning allowance** for logs, traffic,
storage operations, and a temporary restore. This is not an exact all-in
quote: runner sizing, private network access, and resource overlap must be
settled within the allowance before creation. Existing laptop browser
generation avoids paying for a load-testing service, but its CPU/RAM may
limit genuine simultaneous browsers. If more runners are needed, price them
first; never substitute 100 API calls and call them 100 computers.

Use the prior capacity preparation at commit
`7484d61ce7d063548bce646b38ca30b62e91101e` as the workload design, not as
completed evidence: 100 real browser users, synthetic data, shared-record
collisions, autosave-on-blur, uploads/retries, reload/reconnect, calendar and
read paths; 20-minute peak then 2-hour soak. The browser harness still needs
reconciliation with the current release. Independently reconcile all
acknowledged saves with PostgreSQL/audit/Blob state. Measure user interaction
latency, p95/p99 saves, errors, memory growth, event-loop delay, pool waits,
locks, I/O and queue age. Report failures and retries, not only averages.

Revisit database sizing/IOPS only if correlated slow queries, disk saturation
or sustained CPU/memory pressure remain after narrow query/payload fixes.
Revisit app maximum if the third replica is consistently occupied and saves
remain healthy. Neither 1,000 users nor zero slowdown is certified here.

## Rollback and remaining limits

- App scaling rollback: minimum 1 / maximum 3, using the same preserved
  runtime configuration. Returning only to an older image does not guarantee
  restoring the old scale settings. Do not revert other tasks' features.
- HA rollback: a separately reviewed disable-HA update, only while healthy;
  it removes standby protection, not application records. Never restore an
  old production database as a routine configuration rollback.
- Keep the notification fix even if capacity changes are reversed.
- HA is availability protection, not a speed upgrade. Synchronous replication
  can increase write latency and failover can interrupt connections for more
  than two minutes. Verify safe reconnect/idempotent retries before claiming
  resilience. [Microsoft limitations](https://learn.microsoft.com/en-us/azure/postgresql/high-availability/concepts-high-availability).
- Blob lifecycle deletion, backup-retention expansion, regional disaster
  recovery, new cache services and more expensive compute are not activated
  or bundled into this quote. Existing recoverability must be demonstrated,
  not inferred from enabled backup settings.

## Preparation evidence

- Seven alert-audit fixture tests passed; no real Azure command in those tests.
- Three changed Bicep templates compiled; output-only state creates no resources.
- Bootstrap shell syntax and whitespace checks passed.
- Thirteen local alert-contract checks passed. The corrected read-only audit
  of Azure intentionally failed strict readiness, identifying exactly the
  two unwired runtime rules above; production is not notification-ready yet.
- Live inventory and public price queries were read-only. No deployment,
  paid provisioning, failover, restore, notification, load test, or data
  mutation occurred. Production activation and behavior evidence remain pending.
