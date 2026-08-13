## Active References

The current product tenants are documented in
[`docs/PRODUCT_TENETS.md`](./PRODUCT_TENETS.md). The active referral workflow
resume plan is [`docs/WORKFLOW_BUILD_QUEUE.md`](./WORKFLOW_BUILD_QUEUE.md).
Use those documents for new work; the older entries below are retained as
historical backlog notes and may refer to components that have since moved or
been removed.

## Core Improvements (P0)
- Keep `npm run check:platform` green before handoff or deployment.
- Provision Azure resources, apply migrations `0001` through `0006`, and map
  Key Vault references without placing PHI or service credentials in public variables.
- Implement the Databricks processing job against the checked-in dispatch and
  callback contracts, then validate it with a representative packet pilot.
- Configure Entra user authentication and the separate Alamo clinical API
  client-credential permission.

## Features In Progress / Next Up (P1)
- Tune extraction mappings and confidence thresholds from the pilot without
  changing the canonical schema.
- Connect alert destinations and review retention/legal-hold policy.
- Validate the supervisor exception definitions and extraction-quality
  thresholds against the first live pilot; change definitions only through a
  reviewed product/operations decision.

## Completed Engineering Hardening

- Canonical supervisor exceptions, including resident-link candidates and collisions.
- Audited reassignment, requirement evidence, waiver, decline reason, and versioned EHR handoff state.
- Section-scoped concurrency, presence leases, remote-change recovery, and ten-user contention tests.
- File preview metadata, thumbnails, bounded range proxying, and large-document page pagination.
- Property/fuzz checks, extraction quality scoring, and resumable 20-by-600-page orchestration rehearsal.
- Append-only migration checksums, release manifests, CI, accessibility, broader browser coverage, and guarded backup/restore drills.

## Nice to Have (P2)
- Add saved supervisor views and operational exports after live data validates
  the queue definitions.
- Add user-delegation SAS signing so the app no longer needs a storage account key.
- Expand page-level workflow documentation after the pilot stabilizes labels.
