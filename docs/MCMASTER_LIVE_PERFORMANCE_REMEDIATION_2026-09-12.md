# Live workflow performance remediation

September 12, 2026. Release branch: `codex/live-performance-remediation`.
Scope: the measured slow owners, not a chart redesign or a broad refactor.

## What changed

- Alamo date formatting now reuses bounded native formatters instead of creating
  them hundreds of times for every roster, chart and file authorization lookup.
- Canonical facility aliases are indexed once, preserving first-match ordering.
- Only the current validated published snapshot and client-manifest identity
  may reuse the resident projection. Authorization, freshness, filtering and
  unknown-client checks still execute for every request.
- Snapshot TTL refresh checks Azure publication ETags. An unchanged publication
  no longer downloads, inflates, parses and projects the same data repeatedly.
  Changed, missing, invalid and inaccessible publications still fail or reload
  through the existing validation boundary. First-ever process reads remain cold.
- Intake and assessment autosave debounce is 400 ms. Dirty-field/version checks,
  recovery drafts, failed-save recovery, in-flight edit handling and explicit
  save/submit flushing are unchanged. “Saved” still requires server acknowledgment.
- Trash loads immediately on entry; only typed search is coalesced. Aborted old
  queries cannot overwrite current results or their loading/error state.
- Profile intent warming reuses the canonical timer, waits 120 ms, cancels on
  pointer leave/blur, and permits one in-flight profile read. File bytes are not
  prefetched. Canceling a binary read now reaches its upstream request, while
  canceling one JSON reader never cancels a shared protected cache fill.
- The canonical scorecard waits for actual chart identity and decoded images,
  and requires valid complete PDF bytes from Chromium after the actual file click.
  A wrapper, popup, response header or synthetic JSON pretending to be a file
  is not success. Native PDF viewer rendering is a separate unmeasured boundary.

## Before and after evidence

Original actual-browser audit candidate: Pipeline `f8d33db93ef7b479dc4da0bcfdfa466ae6cac2bc`.
The upstream-only recheck still used deployed Pipeline `ed7c1bfbdd4004b69076dcceb3fd8fd62f536812`.
Original Alamo image digest: `sha256:f834b7ffb2ba1aac325f8bbf8651d3f3d501434a47ccb946b8f9ed4c97c2845b`.
Alamo v2 recheck digest: `sha256:c635a193bebcc7adee2b2e272837f59ac646492e73d29870c7e1825468c88b63`.
These are small observed samples, not reliable production p95/p99 estimates.

| Completion boundary | Before | After | Environment |
| --- | ---: | ---: | --- |
| Unvisited chart: actual identity painted | 2,349–8,378 ms, plus timeouts | 227–327 ms, four charts | Actual signed-in production browser, v2 upstream |
| Source PDF click plus complete browser read | Two ~10 s JSON/503 failures | 331 ms, 523,834 valid PDF bytes | Actual signed-in production browser, v2 upstream |
| Complete source gallery decoded | Thumbnail 503s near 10 s | 781 ms, 13 decoded thumbnails, no API errors | Actual signed-in production browser, v2 upstream |
| Repeated roster projection | 936 ms | 9 ms | Exact deployed upstream, fixed clock, full response hash unchanged |
| Sample chart projection | 1,571 ms | 5–6 ms | Exact deployed upstream, fixed clock, full response hash unchanged |
| Intake edit → acknowledgment and Saved UI | ~1,549 ms | 448 ms | Isolated actual browser, local file persistence |
| Assessment edit → acknowledgment and Saved UI | ~1,247 ms | 447 ms | Isolated actual browser, local file persistence |
| Open trash ledger → actual row visible | ~330 ms | 96 ms | Isolated actual browser, local file persistence |

## Machine and recovery evidence

Focused executable evidence covers date-output parity including time zones and
DST, published projection/manifest replacement and mutable-fixture isolation,
actual Azure reader ETag replacement/deletion/storage failure/invalid payload,
protected binary cancellation/type/size/header guards and shared JSON isolation.
Intake retry with edits arriving in flight, create/edit/trash/restore, and
assessment schedule/start/edit/read-back all passed in the isolated browser.
The stricter complete local scorecard passed all 16 certification checks: chart
133 ms, decoded thumbnail 67 ms, complete synthetic PDF 117 ms, zero API errors.
Those synthetic/local results are explicitly not live clinical or cloud-write proof.

Alamo is released as a four-owner overlay on the exact prior acquisition image,
preserving its other deployed code and dependencies. Roll back by selecting the
original immutable image. Pipeline uses its normal immutable Azure release;
the previous `ed7c1bfbdd4004b6` revision remains the pre-change rollback boundary.
No migrations, clinical writes, ownership rules, chart layout, Entra settings,
paid services, extra replicas or new scheduled jobs were introduced.

## Remaining exposure: not “everything instant”

The v2 first Clients read still reached 3,916 ms when the five-minute snapshot
cache expired. ETag revalidation directly addresses that repeated-read owner;
it does not certify a never-warmed/new process. Fresh-browser Home was 755–1,368
ms. The 13-thumbnail gallery at 781 ms exceeded its 500 ms goal. Some warm
returns were 116–117 ms against a 100 ms goal. These remain explicit performance
misses, not hidden by the fast warm-chart sample or the local scorecard.

Cloud PostgreSQL edit acknowledgment and populated calendar/report permutations,
all role/account switches, large/interrupted real uploads, native PDF rendering,
later tutorial assets, slow devices, regional networks, 100-user load and long
sessions remain unmeasured by this small remediation recheck. The separate chaos
apparatus was not started. No application-wide perfection claim is supported.

Use `check:performance:live-reads -- --allow-remote` with an existing short-lived
session supplied only over stdin for the small clinical-read-only production
recheck. It operates a separate headless Chromium and outputs timings/counts,
never patient names, record/document identifiers, response bodies or tokens.
`--enforce` rejects missing samples, API errors and budget misses.
