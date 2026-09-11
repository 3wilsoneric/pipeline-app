# Architecture Narrative: Referral-to-Decision Operating Spine

Author: Eric

Date: 2026-09-11

Status: approved

Starting commit: `e67db3fd5b470be4239ffbc216122203efbf3ff0`

Dedicated worktree: `/Users/eric/pipeline-refactor-referral-to-decision-spine`

Branch: `codex/refactor-referral-to-decision-spine`

## Scope

This slice makes the assessor's real path coherent from assignment through Intake, contact coordination, scheduling, day-of assessment, interrupted-work recovery, signed submission, supervisor revision, and decision. It adds a reusable contact directory and explicit referral-contact links; exposes client phone and email in Intake; makes assignment open Intake; makes scheduled events open Assessment; and retains recent locations for more than one workspace. Existing referral, assessment, workflow, authorization, audit, trash, extraction, and client-activation owners remain canonical.

The exact reviewed and changeable files are recorded in `docs/refactoring/referral-to-decision-operating-spine-file-audit.json`. Planned dependencies point inward from routes and UI to bounded contact, readiness, and continuity modules. No Entra change, outbound call/email/text action, provider integration, paid service, automatic identity merge, global contact page, or broad visual redesign is included.

## Current behavior

At the starting commit, an assignment activity opens the generic Workflow view, a Calendar appointment can reopen at Intake, phone and email exist on the referral but are not editable in the canvas, no reusable contact aggregate exists, scheduling does not verify a reachable coordination contact, and continuity remembers only one last workspace. Assessment editing itself already autosaves, queues recoverable offline changes, preserves the active section, signs immutably, and continues into the existing supervisor workflow.

## Boundaries

| Boundary | Input | Output | Validation |
| --- | --- | --- | --- |
| Contact directory | bounded contact fields and actor | versioned contact | route validation, role policy, optimistic version |
| Referral contact link | referral, contact, role, primary flag | explicit link | referral access, contact existence, one-primary invariant |
| Scheduling | assessment schedule command | server-confirmed schedule | existing lifecycle checks plus derived referral/contact readiness |
| Resume | user-scoped workspace location | recent workspace preference | bounded schema parser; never canonical workflow state |
| Navigation | assignment/calendar/resume event | workspace location | existing referral access at destination |

## Invariants

- Names are display and search data, never identity, merge, duplicate, or authorization keys.
- Unlinking a contact from a referral does not delete the reusable contact.
- Contact mutations and link mutations are actor-attributed, versioned, and audited; PostgreSQL state and audit commit together.
- Only the server accepts a schedule; unscheduled assessment drafts remain available for packet preparation.
- Browser continuity is user-scoped convenience state and cannot change referral, assessment, or workflow truth.
- Existing signed-assessment immutability, supervisor-decision authority, trash recovery, and explicit admission semantics do not change.

## Side effects and transactions

The additive migration creates contact and referral-contact tables plus indexes and an explicit rollback. PostgreSQL mutations use one transaction for domain state, store revision, and audit. The local adapter preserves the same domain outcomes using an atomic JSON store. No Blob, queue, mail, telephony, SMS, Entra, or third-party side effect is added.

## Failure and recovery

Validation and permission failures return without writes. Stale versions return conflict with current truth. Replayed mutation identifiers return the original result where the command contract supports replay. A second primary scheduling contact replaces the prior primary in the same transaction. Schema rollback drops only the new link and contact tables; application rollback is an exact commit revert. Existing referral phone/email remains intact if contact rollout is reverted.

## Authorization and PHI

Authenticated Pipeline users may read contacts only through existing Pipeline access. Contact creation and updates require an existing write role. Referral links additionally require resource-level mutable referral access. Contact values are PHI and must not enter application logs, metrics, exception text, or assurance artifacts. Audit metadata records field names and actors, not raw contact values.

## Evidence

The exact-start trace is `docs/refactoring/characterization/referral-to-decision-operating-spine-start-e67db3f.json`. Completion requires focused contact contracts, route policy, assessor workflow, browser journeys, PostgreSQL integration/concurrency/integrity, critical safety, performance, artifacts, recovery, and exact-commit TARS assurance. This narrative does not claim that the whole application is perfect or defect-free.

Approved by: Eric, 2026-09-11 (owner-authorized fast lane)
