# Protected directory startup and morning prewarming

## Scope

Product performance fix; no chart/UI/workflow redesign or clinical writes.
Pipeline preloads the complete current Alamo census after authentication using
the visible directory's canonical bounded page walker and protected in-memory
GET cache. First rows remain progressive when a person opens Clients before
completion. Full entries expire after two minutes; real edits, account/God-mode
switches, cancellation, and explicit refresh invalidate or reject obsolete work.
Workspaces retain their existing protected first-page preload and server-side
pagination/filters. The remaining workspace charts and all files are not bulk
downloaded. This is deliberately bounded, not a second clinical database.

Pipeline's native server instrumentation also awaits a bounded service-authorized
source read before accepting requests. Missing/disconnected/delegated adapters
skip it; upstream failure is sanitized and does not disable unaffected workflows.

Each long-running Alamo Azure API replica prepares its canonical validated
snapshot, manifest, current-resident and client-directory projections at process
startup and 6 a.m. America/Los_Angeles (DST-aware). Native runtime timer, one
in-flight warmup, five-minute outage backoff; no new Azure scheduled job, resource,
scaling, Entra setting, source publisher, clinical write or user session.
`PIPELINE_CLINICAL_PREWARM_ENABLED=false` disables upstream prewarming.
Normal protected authorization, ETag validation, source freshness and not-found
checks still execute. Unchanged publications reuse validated source identity;
changed/missing/inaccessible publications are not concealed by the morning load.

## Baseline and measurement

Before: deployed Pipeline `c832c380863aab31d8ff3dc34f0c38bb107b1d23`
and Alamo v3 `sha256:50b195246c06c1783756ea62f5a11f5c3f101b5ba14478533b50dba8c248f5c2`.
Three isolated actual Chromium sessions, an existing authorized account, fresh
browser contexts, same 1440×900 viewport and one second of Home dwell:

- Full current census: 531 clients in three pages; **not ready before Clients
  opened in all three sessions**. Two additional reads occurred on opening it.
- Complete roster from initial navigation: 2,927 / 2,253 / 2,161 ms.
- First workspace row after click: 140 / 118 / 120 ms; no extra directory GET.
- First client card: 91 / 95 / 94 ms. This small visible-card timing did not mean
  the full directory was populated. Home: 1,221 / 588 / 493 ms.
- Zero API errors. No clinical writes, PHI logging, or operator browser use.

Run `npm run check:performance:directories -- --allow-remote` with an existing
short-lived diagnostic session on stdin. Only counts/timings leave the browser.
Native response clones inspect directory completion without additional GETs;
Chromium protocol response-body retrieval is unreliable for routed responses.
The diagnostic does not certify every device, region, role, replica under load,
or p95/p99 latency. Cold-start preparation shifts work before traffic; it is not
zero work or proof of literal instant access.

Focused executable checks cover complete preload, bounded/repeated pagination,
source changes/incomplete roster, context/TTL/refresh isolation, cancellation,
startup authority, outages, DST, morning once-per-day/no overlap and retry/backoff.
Canonical clinical/file/authorization/loading contracts remain unchanged.

## Deployment and rollback

Pipeline uses its normal immutable Azure revision and CI. Alamo uses the existing
four-source-owner overlay only, preserving all other deployed acquisition code
and its dependencies; its unfinished main checkout is untouched. Changes are
recorded on `codex/pipeline-clinical-performance` and must be integrated narrowly
before a future general upstream release. Rollback is Pipeline `c832c38` and the
exact prior Alamo v3 digest above; no database/schema recovery is necessary.
