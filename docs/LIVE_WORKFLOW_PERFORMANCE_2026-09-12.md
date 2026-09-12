# Live workflow performance: September 12, 2026

Bounded product performance fixes, not a layout redesign or a broad structural refactor. Baseline production revision: `c0755a43410aec149b42a479cf1d47fafa700f88`.

## Actual production baseline

Read-only protected requests used the existing owner's identity and real production data. No browser, simulated patients, new accounts, database mutations, or document downloads. Only route labels, status, elapsed time, and counts were printed. Requests originated in Azure and traversed the public application ingress; these measure real service/upstream latency, **not laptop rendering, ISP latency, or end-to-end click performance**.

| Read | Observed elapsed time |
| --- | --- |
| Current Clients, first page, first read | 5,105 ms in the initial probe; 1,208 ms in the next probe |
| Current Clients, repeated first-page reads | 761–848 ms initially; 1,908–2,104 ms in the next probe |
| First current client chart | 1,999 ms initially; 5,295 ms in the next probe |
| Repeated current client chart | 32–98 ms |
| Workspace directory, 50 records | 372–381 ms |
| Workspace canvas | 24–34 ms |
| Pipeline workspace chart | 53 ms |
| Calendar | 38 ms |
| Assessor owner list | 86 ms |
| Resume-work state | 14 ms |

Three direct, authorized Alamo roster reads took 604–711 ms. Existing service-token acquisition took 490 ms. These are small diagnostic samples, not statistical reliability certification. Invalid exploratory URLs were excluded, never counted as successful application reads.

## Changes

- Reuse validated current-roster pages for 60 seconds in the existing bounded, authority- and complete-session-scoped server memory cache. Concurrent reads share one upstream request. Explicit refresh, expiry, malformed-source rejection, token rotation, and God-mode isolation remain enforced. No HTTP, disk, CDN, or localStorage caching of clinical records.
- Private recovery-draft PUT/DELETE operations invalidate draft reads only. They no longer destroy warm referral directories and charts. Actual application data edits and session changes still invalidate all corresponding client-memory projections conservatively.
- Debounced hover/focus intent warms the selected workspace canvas, chart metadata, and imported source notes. At most two workspace warmups run simultaneously. Canvas reuse is limited to three seconds; mutation versions, server authorization, recovery reads, and remote-change checking are unchanged. No files are downloaded in bulk.
- Independent native chart/referral/document reads and imported source-profile reads run concurrently. Existing permission and document visibility filtering is retained.
- Reuse the assessor owner-list display for 30 seconds. Assignment mutations still validate the current member on the server.

## Morning preparation

Do not add a daily upload or paid cache service for these fixes. A static daily census upload would cease to be the current platform census. A cron task warming a different session's in-process cache would not warm an operator's protected cache reliably across replicas. Existing post-login first-page warming plus selected-workspace intent warming prepares the actual session without a scheduled job or new service.

For remaining delays, distinguish upstream time, application/DB time, network transfer, and browser rendering. Never use the old sanitized loopback McMaster scorecard as evidence that production clicks are instantaneous. Uploads already send bytes directly to private Blob storage; transfer and safety-processing time must not be disguised as an already-completed save.

## Focused evidence and production follow-up

`scripts/live-loading-contracts.mjs` exercises cache freshness, authorization/session isolation, concurrent-reader cancellation, draft-specific invalidation, bounded intent warming, and parallel chart-read visibility. Existing launch/chart-render and historical-source contracts preserve the actual chart, thumbnails, source attribution, and historical read-only semantics. Required release CI runs in the cloud; no local browser suite is launched.

Post-deployment aggregate timings will be recorded after the exact Azure revision is ready. This report does not certify every workflow permutation or promise universal instantaneous loading.

## Engineering references

[Azure's cache-aside guidance](https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside) supports bounded cache lifetimes and invalidation after writes; local caches are not automatically consistent across replicas. [web.dev's interaction guidance](https://web.dev/articles/optimize-inp) distinguishes main-thread responsiveness from network/server waits. Those principles guide this pass; McMaster-Carr's private implementation is not claimed as known.
