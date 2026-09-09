# Referral Canvas Components Architecture Narrative

Author: TARS machine trace, owner-authorized by Eric

Date: 2026-09-09

Status: approved

Starting commit: `eafa505265a02f6def87c7ea8dd036284ceafecd`

Dedicated worktree: `/Users/eric/pipeline-refactor-referral-canvas-components`

Branch: `codex/refactor-referral-canvas-components`

## Scope

- Runtime scope: `ReferralPacketCanvas.tsx`, `AssessmentWorkspace.tsx`, and `ClientProfileView.tsx`.
- Structural additions: one referral save-state owner, one assessment draft/conflict-state owner, and one client identity-review component.
- Entry points: referral intake, packet upload and review, assessment drafting, client profiles, and explicit resident-link review.
- Explicit exclusions: no visual redesign, copy change, click-path change, workflow reordering, route change, database change, persistence-policy change, role change, or extraction-policy change.
- File audit: `docs/refactoring/referral-canvas-file-audit.json`.
- Approved proof obligations: `canvas_no_silent_accepted_work_loss` and `identity_link_requires_explicit_safe_review`.
- Assurance record: `docs/refactoring/referral-canvas-assurance-record.json`.

## What the surfaces do

The referral canvas gathers and saves the referral profile, packet, supporting documents, owner, community, and workflow inputs. It keeps a server-confirmed referral alongside local dirty fields, queued uploads, recovery drafts, save snapshots, remote changes, and explicit conflicts. The assessment workspace performs the same separation for assessment sections, including offline queues and extraction provenance. The client profile presents governed resident data and requires an authorized reviewer to inspect evidence before confirming or rejecting a suggested Pipeline link.

## Inputs and outputs

| Boundary | Input | Output | Validation |
| --- | --- | --- | --- |
| Referral canvas | Local edits, packet files, section versions, recovery draft | Versioned referral commands and explicit save/conflict UI | File type/size, required fields, section versions, duplicate review, resource authorization |
| Assessment workspace | Section edits, schedule/sign commands, recovery state | Versioned assessment commands and save/conflict UI | Role/resource access, section versions, lifecycle rules, provenance review |
| Client identity review | Candidate, referral evidence, governed resident evidence, explicit action | Confirmed or rejected versioned resident-link command | Reviewer capability, DOB/identifier conflict rules, optimistic link version |

## State ownership

- Server records and their versions are the durable source of truth.
- The browser owns only the current local draft, pending save snapshot, queued uploads, and visible conflict/recovery state.
- Save-state helpers compare the exact values captured at dispatch with current values before clearing dirty keys; later local changes remain dirty.
- Assessment helpers own pure draft comparison, editable section projection, conflict parsing, and role-derived UI capability. Routes and stores still enforce authorization.
- Extracted suggestions remain evidence-backed candidates until the user reviews them; the UI never promotes model or worker output directly into canonical identity.

## Invariants

- No structural move changes layout, copy, focus order, keyboard behavior, navigation, autosave timing, upload behavior, or workflow order.
- A completed save clears only values that still match its captured snapshot; edits made while the request is in flight stay pending.
- Same-section remote changes remain explicit conflicts and never overwrite local work automatically.
- Refresh/remount recovery remains tab-scoped or authenticated-user-scoped according to the existing storage mode.
- Candidate creation does not join records. Confirmation remains a separate authorized, optimistic command after evidence review.
- Name equality is never a sufficient identity key, and DOB conflicts continue to block confirmation.
- Client components import no server-only store or adapter.

## Side effects and cleanup

- Referral and assessment components continue to own fetch lifecycles, abort controllers, timers, presence leases, uploads, and browser/server draft cleanup.
- Extracted modules contain either pure state decisions or the existing identity-review interactions; they do not add pollers, timers, persistence routes, retries, or storage locations.
- Aborted loads, best-effort recovery cleanup, and optional presence cleanup keep their existing failure visibility and canonical server-state guarantees.

## Failure and recovery

| Failure | Preserved behavior | Recovery |
| --- | --- | --- |
| Save response arrives after another local edit | Only matching captured dirty keys clear | Newer value remains dirty and autosaves or saves explicitly |
| Same-section server conflict | Local and latest values remain visible | User chooses the value intentionally and retries against the latest version |
| Refresh or remount with unfinished draft | Recoverable fields and base versions reload | User resumes or discards the draft explicitly |
| Offline assessment save | Mutation remains queued under the signed-in principal | Existing synchronization path retries when online |
| Stale identity review | Server returns conflict and the profile reloads | Reviewer reopens current evidence and acts on the new version |
| Unauthorized or evidence-conflicting identity command | No canonical link is created | Authorized reviewer resolves evidence before a new command |

## Authorization and PHI

- Browser capability checks only shape controls; authenticated routes and canonical resource-policy modules remain authoritative.
- Referral, assessment, document, and identity values are PHI-capable and remain in private no-store UI/API paths.
- Recovery state keeps the existing principal and storage scoping. This slice adds no telemetry or committed production data.
- Characterization artifacts contain test names, counts, commits, and synthetic outcomes only.

## Exact-start evidence

- Four Chromium journeys passed at the exact starting commit: two-session section conflicts and presence, refresh recovery plus autosave, conflicting governed identity evidence with no created link, and explicit human confirmation before joining records.
- Existing desktop recovery coverage verifies user-scoped draft versions, stale conflict responses, restore, and autosave behavior.
- Existing operational characterizations verify referral and assessment same-section conflicts, disjoint-section updates, and denied mutations without side effects.
- The deployed starting commit passed its complete CI and guarded Azure deployment before this worktree was created.

## Assurance boundary

- Mechanically checked: unchanged public routes, types, required tests, bundle boundary, repository inventory, and static complexity ceilings.
- Browser checked: workflow journeys, supported browsers, visual baselines, desktop behavior, autosave, remount, conflict, presence, and identity review.
- Performance checked: compiled McMaster navigation, interaction, Core Web Vital, transfer, and API budgets.
- Recovery checked: exact starting commit remains revertible and no schema or stored-data migration is introduced.
- This narrative supports only the recorded structural slice and exact candidate evidence; it does not claim universal defect absence.

Approved by: Eric, 2026-09-09T15:04:01Z
