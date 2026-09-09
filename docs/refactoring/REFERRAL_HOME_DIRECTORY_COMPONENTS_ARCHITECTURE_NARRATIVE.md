# Referral Home Directory Components Architecture Narrative

Author: TARS machine trace, owner-authorized by Eric

Date: 2026-09-09

Status: approved

Starting commit: `07fac35ffa0390734304d246d6b95b8dc225aa31`

Dedicated worktree: `/Users/eric/pipeline-refactor-referral-home-directory-components`

Branch: `codex/refactor-referral-home-directory-components`

## Scope

- Runtime scope: `components/pipeline/ReferralHome.tsx`.
- Planned structural additions: `ReferralHomeDirectory.tsx` for callback-driven rendering and `referral-home-directory-model.ts` for pure query and display derivation.
- Explicit exclusions: no copy, DOM order, styling, guide target, click path, route, request, authorization, workflow, schema, migration, persistence, audit, extraction, or product-policy change.
- File audit: `docs/refactoring/referral-home-directory-components-file-audit.json`.
- Approved proof obligation: `referral_home_directory_presentation_preserves_navigation_and_recovery`.
- Assurance record: `docs/refactoring/referral-home-directory-components-assurance-record.json`.

## Current responsibility trace

`ReferralHome` is a client coordinator and the complete directory renderer. It owns debounced search, referral and file queries, summary/facet snapshots, revision polling, request cancellation, last-good-snapshot recovery, separate referral and file cursors, identity-review loading and mutation, preview state, mobile browse state, filter state, and the persisted list/gallery preference. It also renders the search, filters, tabs, navigation, workspace and file results, paging, empty/error states, and mobile month browser inline.

The durable sources of truth remain the authenticated referral, file, profile-directory, and import-review APIs. Browser state is a view and recovery projection only. Revision polling refreshes the directory without clearing a successful snapshot when a later request fails.

## Approved seam

The effectful coordinator stays in `ReferralHome.tsx` and remains the only owner of requests, revision polling, cancellation, cursors, loading and error state, identity-review mutation, preview/review state, and local-storage persistence.

`ReferralHomeDirectory.tsx` renders the existing directory from immutable values and callbacks. It may retain the existing focus and Escape-key behavior for the mobile browse dialog, but cannot fetch, persist, authorize, or suppress request failures. `referral-home-directory-model.ts` owns only deterministic filter, query, month, count, and display derivation and imports no React, Next, request, storage, or server adapter.

Both UI modules are imported beneath the existing `"use client"` boundary, so callback props remain inside one client module graph rather than crossing a server/client serialization boundary.

## Invariants and failure behavior

- Search, filters, list/gallery selection, activity, files, identity review, preview, paging, retry, and mobile browse keep their exact labels, roles, DOM order, classes, and click paths.
- The coordinator remains the only request and durable mutation owner; extracted modules cannot duplicate canonical state or error handling.
- Abort cleanup, revision timer cleanup, focus refresh, debounce timing, cursor resets, and last-good-snapshot recovery remain unchanged.
- Existing source contracts and operator-guide targets follow the markup to its canonical renderer without weakening assertions.
- No route, request shape, dependency, role policy, workflow, schema, migration, stored data, audit, extraction, or environment change is permitted.

## Exact-start evidence

At exact starting commit `07fac35ffa0390734304d246d6b95b8dc225aa31`, 15 focused Chromium journeys passed. They cover the opening surface, gallery and activity, useful filters, failed-refresh snapshot preservation, all-file browsing, empty and failure recovery, and navigation/layout behavior at nine viewports from 320 through 1440 pixels. The structural baseline records `ReferralHome.tsx` at 1,308 lines, complexity 356, 15 direct dependencies, maximum branch depth six, eight repository cycles, 71 duplicate groups, and 56 control-plane duplicate groups.

## Rollback

Revert the bounded runtime extraction commit and refresh generated inventories. The slice has no migration, stored-data transformation, route, request-shape, deployment configuration, or environment change, so rollback is a code revert to the exact starting commit.
