# Referral Workflow Panel Components Architecture Narrative

Author: TARS machine trace, owner-authorized by Eric

Date: 2026-09-09

Status: approved

Starting commit: `01dd0fe8f781dd65d8128bb96afe379fa8608fcf`

Dedicated worktree: `/Users/eric/pipeline-refactor-referral-workflow-panel`

Branch: `codex/refactor-referral-workflow-panel`

## Scope

- Runtime scope: `components/pipeline/ReferralWorkflowPanel.tsx`.
- Planned structural additions: `ReferralWorkflowPanelPresentation.tsx` for the existing workflow rendering and `referral-workflow-panel-model.ts` for pure workflow presentation derivation.
- Explicit exclusions: no copy, DOM order, styling, click path, route, request body, authorization, finite-state rule, schema, migration, persistence, audit, extraction, identity-linking, or product-policy change.
- File audit: `docs/refactoring/referral-workflow-panel-components-file-audit.json`.
- Approved proof obligation: `referral_workflow_panel_preserves_decision_and_handoff_safety`.
- Assurance record: `docs/refactoring/referral-workflow-panel-components-assurance-record.json`.

## Current responsibility trace

`ReferralWorkflowPanel` is a client coordinator and the complete admission-workflow renderer. It loads the versioned workflow projection, preserves dirty recommendation and decision drafts across refresh, owns stable mutation identifiers for replay, handles optimistic conflicts, confirms terminal decisions and handoff outcomes, and submits work-item, recommendation, decision, transition, manual-intake, and EHR-handoff commands. The same module also derives readiness and renders stage progress, current-gate navigation, clinical recommendation, supervisor decision, requirements, EHR handoff, client activation, controls, notices, and detail dialogs.

The durable sources of truth remain the versioned referral and workflow stores behind the existing API routes. This component coordinates commands but does not own workflow policy, authorization, persistence, audit, or identity linkage. A successful mutation is reconciled through the returned referral and a fresh workflow load; a conflict adopts the server referral when supplied and reloads while retaining unsaved dirty drafts.

## Approved seam

The effectful coordinator stays in `ReferralWorkflowPanel.tsx`. The new modules are client-graph subordinate owners:

- `ReferralWorkflowPanelPresentation.tsx` renders the exact existing DOM, controls, disclosure state, activation panel, and detail dialog from values plus callbacks. It performs no request, persistence, authorization, timer, confirmation, retry, or canonical-state work.
- `referral-workflow-panel-model.ts` owns only pure types and deterministic readiness, grouping, label, validation, and error-payload derivation. It has no React, browser, network, storage, clock, or mutation dependency.

Both files remain beneath the existing `"use client"` import boundary. Function callbacks stay within one client module graph and do not cross a server/client serialization boundary.

## Invariants and failure behavior

- `ReferralWorkflowPanel` remains the only owner of workflow loading, mutation identifiers, optimistic versions, request bodies, confirmations, dirty-draft preservation, conflict reconciliation, and success/error state.
- Existing workflow-store and route owners remain the only policy, authorization, persistence, audit, replay, and transition owners.
- Presentation and model modules cannot issue, retry, confirm, suppress, or reinterpret a workflow command.
- Existing labels, roles, accessible names, disclosure defaults, activation condition, styling, breakpoints, and render order remain unchanged.
- Network failure retains the existing visible error; a 409 still adopts the returned referral when present and reloads; failed mutations retain their stable mutation identifier for safe replay.
- No dependency, schema, migration, stored-data transformation, route, provider, permission, or environment change is introduced.

## Exact-start evidence

At exact starting commit `01dd0fe8f781dd65d8128bb96afe379fa8608fcf`, the Chromium golden journey passed signed assessment, recommendation, requirement gating, accepted supervisor decision, move-in completion, admitted transition, EHR queue, explicit failure recording, retry, sent confirmation, and client-activation visibility. The repository baseline records `ReferralWorkflowPanel.tsx` at 837 lines, complexity 263, eight dependencies, branch depth four, and five 90-day churn commits.

## Rollback

Revert the bounded component extraction commit and refresh generated inventories. The slice has no migration, stored-data transformation, route, request-shape, deployment, or environment change, so rollback is a code revert to the exact starting commit.
