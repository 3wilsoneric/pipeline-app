# Assessment Workspace Components Architecture Narrative

Author: TARS machine trace, owner-authorized by Eric

Date: 2026-09-09

Status: approved

Starting commit: `927b953b23557b14b8ca74c11a241a41bbe9a473`

Dedicated worktree: `/Users/eric/pipeline-refactor-assessment-workspace-components`

Branch: `codex/refactor-assessment-workspace-components`

## Scope

- Runtime scope: `components/pipeline/AssessmentWorkspace.tsx`.
- Planned structural additions: `AssessmentInterviewFields.tsx` for questionnaire rendering and `AssessmentSchedulingDialogs.tsx` for schedule/start dialog rendering.
- Explicit exclusions: no copy, DOM order, styling, guide target, click path, route, request, authorization, workflow, schema, migration, persistence, audit, extraction, or product-policy change.
- File audit: `docs/refactoring/assessment-workspace-components-file-audit.json`.
- Approved proof obligation: `assessment_workspace_presentation_preserves_draft_safety`.
- Assurance record: `docs/refactoring/assessment-workspace-components-assurance-record.json`.

## Current responsibility trace

`AssessmentWorkspace` is a client coordinator and full-screen interview renderer. It loads the current actor and assessment history, owns the selected server record, keeps a local draft and per-section dirty state, serializes saves, persists recovery drafts, queues encrypted offline mutations, polls newer versions, manages presence leases, reconciles remote conflicts, and submits schedule, start, extraction-review, sign, and addendum commands. It also renders every field control and both scheduling dialogs inline.

The durable source of truth remains the versioned assessment API and its assessment-store owner. Local refs and state retain the last confirmed record, current draft, comparison base, dirty sections, pending queue, visible conflicts, and recovery versions. Section versions decide concurrent-write safety; the browser never becomes a canonical writer.

## Approved seam

The effectful coordinator stays in `AssessmentWorkspace.tsx`. The two new modules are client-graph presentation owners:

- `AssessmentInterviewFields.tsx` renders the existing field controls, extraction provenance prompt, writing guidance, and practice review from immutable values plus callbacks. It performs no fetch, persistence, timer, browser-storage, presence, authorization, or workflow transition.
- `AssessmentSchedulingDialogs.tsx` renders the existing schedule and begin dialogs from values plus callbacks. It performs no date validation or mutation; the coordinator retains both.

Because both files are imported by the existing `"use client"` boundary, they remain in the client module graph without creating new server entry points. Function-valued callbacks do not cross a server/client serialization boundary.

## Invariants and failure behavior

- The coordinator remains the only owner of network requests, optimistic versions, save serialization, offline queues, recovery storage, timers, presence cleanup, conflict reconciliation, and lifecycle commands.
- Extracted controls cannot persist, authorize, retry, or suppress errors; they report input and actions through callbacks.
- Existing labels, roles, accessible names, field identifiers, guide targets, styles, responsive breakpoints, and render order remain byte-for-byte equivalent where moved.
- Save errors, schedule validation failures, stale conflicts, offline queues, and signed-state restrictions remain handled by the coordinator and existing stores.
- No new dependency is introduced. Presentation depends on assessment types and existing schema/guidance helpers; the coordinator depends on presentation, never the reverse.

## Exact-start evidence

At the exact starting commit, the focused Chromium lifecycle journey passed scheduling, beginning, question navigation, answer guidance, autosave, close/resume, completion, signing, workflow continuation, durable recall, and signed-write rejection. The desktop journey passed encrypted offline assessment edits and synchronization after reconnect. The full pre-change structural baseline records `AssessmentWorkspace.tsx` at 1,951 lines, complexity 607, 15 dependencies, and branch depth eight.

## Rollback

Revert the bounded runtime extraction commit and refresh generated inventories. The slice has no migration, stored-data transformation, route, request-shape, deployment, or environment change, so rollback is a code revert to the exact starting commit.
