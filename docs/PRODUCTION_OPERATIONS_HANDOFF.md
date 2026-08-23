# Pipeline production operations handoff

This is the shortest path from repository-ready to production-proven. It does
not treat fixtures, local mock providers, or static infrastructure checks as
evidence that an external service is connected.

## Code-ready position

- Referral, assessment, document, clinical, user-state, and collaboration data
  use bounded server-only persistence contracts. Visible referral-chart fields
  share one exhaustive mapping for create, autosave, reload, conflict recovery,
  and extraction projection.
- PostgreSQL optimistic and per-section versions, three-second active-canvas
  refresh, 15-second presence heartbeats, 45-second lease expiry, remote-change
  notices, draft recovery, and ten-user contention tooling are present.
- Upload reservations, digest/idempotency checks, private Blob objects,
  processing leases, preview/evidence pagination, malware gates, retries,
  dead-letter states, correction history, retention, and authenticated preview
  routes are present. Runtime fails closed when production providers are absent.
- Aggregate-only storage inventory and PHI-safe operational metrics are wired.
  Thirteen log alerts and five native Azure metric alerts are declared, but no
  alert is proven delivered until an approved action group receives it.
- Pull requests use one contract/build/artifact lane. Browser, PostgreSQL,
  visual, cross-browser, contention, and CodeQL evidence run on main, schedule,
  or explicit dispatch to avoid spending GitHub minutes repeatedly.

## Local drill evidence from 22 August 2026

- A disposable PostgreSQL cluster applied migrations `0001` through `0012`,
  passed live smoke and transactional fixtures, completed a migration rollback
  drill, seeded production reference data without synthetic clients, produced a
  logical backup, and restored it with checksum and migration-history checks.
- The synthetic backlog rehearsal processed 20 packets and 12,000 pages with
  resumable claims, 20 modeled retries, no duplicate claims, and no dead
  letters. Modeled orchestration capacity was 120 pages/minute; this is not a
  measurement of the external OCR provider.
- A real four-page packet completed the local mock-provider path with extracted
  fields, page evidence, a correction audit record, and successful reopen.
  An exact repeated packet was rejected by hash. This proves Pipeline plumbing,
  not live Azure Document Intelligence accuracy or throughput.
- The sample named `Referral Packet - Mark P. Bergman.pdf` was found in
  Downloads because the older Desktop path no longer existed. It completed on
  the first isolated run; a second run correctly returned the duplicate-hash
  conflict.

## Go-live order

1. Freeze a reviewed clean revision and attach verified release evidence.
2. Run Azure what-if. Obtain explicit approval for cost, networking, retention,
   and recovery settings before applying infrastructure.
3. Verify private PostgreSQL and Blob connectivity from the managed runtime;
   apply the checksum-pinned migrations with the migrator identity.
4. Configure Entra delegated scope and app roles. Run
   `npm run check:access:live` with short-lived token files as documented in
   `docs/LIVE_ACCESS_REHEARSAL.md`.
5. Connect the Alamo clinical API and require `/api/clinical/health` to report a
   ready, current governed snapshot. Never enable a fixture in production.
6. Verify real malware scanning, Blob upload/preview, Azure extraction,
   evidence, correction, retry, deletion recovery, and at least one
   representative large packet.
7. Attach approved Azure Monitor action groups and trigger every rule with
   synthetic non-PHI events. Record owner and recovery action.
8. Run the production-shaped restore drill and record measured RPO/RTO. Approve
   retention policy and deletion recovery before enabling destructive jobs.
9. Run primary browser journeys and the ten-user PostgreSQL contention suite
   against the release candidate, then record explicit go/no-go.

## Live evidence still required

- Real viewer, assessor, supervisor, and admin Entra principals and role tests.
- Live action-group delivery for every alert family.
- Live Alamo freshness and census reconciliation.
- Live private Blob, malware, thumbnail, range-preview, and Azure OCR behavior,
  including representative large packets.
- Production-shaped backup/restore timing and approved RPO/RTO.
- Approved retention/WORM posture, edge-wide abuse limits, and network exposure.
- Measured PostgreSQL pool pressure and route/queue percentiles before changing
  replicas, indexes, PgBouncer, or storage tiers.

No Azure resource, paid service, deployment, data mutation, retention lock, or
production setting is created by the repository checks or the local drills.
