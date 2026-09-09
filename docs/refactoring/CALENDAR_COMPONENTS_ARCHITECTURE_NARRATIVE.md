# Calendar Components Architecture Narrative

Author: TARS machine trace, owner-authorized by Eric

Date: 2026-09-09

Status: approved

Starting commit: `67a6b067bc9d3000131a391d6920b03ee765ca0c`

Dedicated worktree: `/Users/eric/pipeline-refactor-calendar-components`

Branch: `codex/refactor-calendar-components`

## Scope

- Runtime scope: `components/pipeline/PipelineCalendar.tsx`.
- Planned structural additions: `PipelineCalendarPresentation.tsx` for callback-driven rendering and `pipeline-calendar-model.ts` for pure date, filter, conflict, position, and drawer derivation.
- Approved defect correction: retain the assessment resolved or created by the first schedule attempt so an explicit conflict override cannot create a second assessment.
- Explicit exclusions: no visual redesign, click-path reordering, API route, request shape, authorization, workflow, schema, migration, stored-data transformation, audit, extraction, provider, or environment change.
- File audit: `docs/refactoring/calendar-components-file-audit.json`.
- Proof obligation: `calendar_presentation_preserves_schedule_and_conflict_safety`.
- Assurance record: `docs/refactoring/calendar-components-assurance-record.json`.

## Current responsibility trace

`PipelineCalendar` is a client coordinator and the complete renderer. It owns range, view, filter, queue, overlay, schedule-draft, mutation, request, request-keyed cache, polling, focus/visibility refresh, scroll lock, and Escape behavior. It loads `/api/calendar/events`, filters assignment-only records from this surface, resolves or creates an assessment, schedules or reschedules with an optimistic version and mutation identifier, exposes an explicit server-authorized conflict override, and records cancellation or no-show after reloading the current assessment version.

The same file renders month, timed-week, supervisor team-week, agenda, queue, drawer, schedule dialog, notices, and responsive controls. It also owns Pacific-time conversion, range math, conflict detection, event positioning, and presentation models.

The durable sources of truth remain the authenticated Calendar, Referral, and Assessment APIs. Component cache and draft state are projections only. A successful cached snapshot remains visible when a later request for the same key fails.

## Approved seam

The effectful coordinator stays in `PipelineCalendar.tsx` and remains the only owner of requests, polling, focus/visibility refresh, request cache, overlay state, scroll lock, assessment resolution, schedule mutation, optimistic versions, mutation identifiers, and appointment-status mutation.

`PipelineCalendarPresentation.tsx` renders the existing header, views, queue, drawer, and schedule dialog from immutable values and callbacks. It cannot fetch, persist, authorize, create timers, or suppress failures. `pipeline-calendar-model.ts` owns deterministic derivation only and imports no React, Next, request, storage, or server adapter.

Both UI modules remain beneath the existing `"use client"` boundary. Callback props stay inside one client module graph and do not cross a server/client serialization boundary.

## Invariants and failure behavior

- Month, week, agenda, team and personal schedules, filters, queue paging/search, drawers, dialogs, labels, roles, DOM order, classes, guide targets, and responsive behavior remain unchanged.
- Refresh, abort, timer, focus, visibility, scroll-lock, and Escape cleanup remain owned by the coordinator.
- Pacific-time conversion, DST handling, schedule status, optimistic version, location, duration, method, conflict presentation, and explicit override remain stable.
- Conflict override reuses the exact assessment record from the first attempt; it does not repeat assessment lookup or creation.
- No route, request shape, role policy, workflow stage, schema, migration, stored-data transformation, audit, extraction, dependency, or environment change is permitted.

## Exact-start evidence and defect

At exact starting commit `67a6b067bc9d3000131a391d6920b03ee765ca0c`, the existing Calendar smoke journey passed, including assignment-history exclusion, assessor filtering, scheduling-queue entry, and the responsive agenda default. The new focused characterization passed views, filters, overlap display, request-key cache recovery, range navigation, overlay dismissal, body-scroll restoration, queue dismissal, and mobile overflow.

The schedule-conflict journey exposed a deterministic defect: when a ready referral had no assessment, the first attempt created one, the server returned an overridable schedule conflict, and clicking **Schedule anyway** repeated assessment lookup and creation. The slice corrects this by retaining the first resolved assessment for the retry. The structural baseline records `PipelineCalendar.tsx` at 964 lines, complexity 442, six direct dependencies, maximum branch depth four, eight repository cycles, 71 duplicate groups, and 56 control-plane duplicate groups.

## Rollback

Revert the bounded Calendar commits after exact start `67a6b067bc9d3000131a391d6920b03ee765ca0c` and refresh generated inventories. There is no migration, stored-data transformation, route, provider, permission, configuration, or environment rollback.
