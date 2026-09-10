# Extraction Capstone Architecture Narrative

Author: TARS machine trace, owner-authorized by Eric

Date: 2026-09-10

Status: approved and in progress

Starting commit: `5f540edb0ddad56b4dbae6a4e49c6983170db838`

Dedicated worktree: `/Users/eric/pipeline-refactor-extraction-capstone-v2`

Branch: `codex/refactor-extraction-capstone-v2`

## Purpose and boundary

Complete the deterministic extraction control plane without changing the field-recognition algorithm, external provider, production backend mode, or clinical decision behavior. The slice fixes stale-attempt races, makes callback provenance mapping independently testable, and carries normalized evidence bounding boxes from Document Intelligence through validated callback data, PostgreSQL, and the read contract. No paid provider call or live PHI corpus is used, and no claim about production extraction accuracy is made.

## Canonical flow

1. An authenticated upload reserves immutable document identity, byte size, SHA-256, and opaque Blob location.
2. Completion rechecks the exact reserved file set and stored object, then transactionally queues bounded extraction/preview jobs.
3. Dispatch claims due jobs with `for update skip locked`, increments the attempt, and creates an unguessable attempt token.
4. Provider attachment, reconciliation, heartbeat, failure disposition, and success completion are compare-and-swap writes fenced by job id, running status, attempt count, and attempt token; provider-specific updates also match the provider run id.
5. A success callback rechecks current Blob existence, size, digest, and malware status before one transaction persists job, document, preview, artifact, proposed field, candidate, and packet state.
6. Human field review owns acceptance/correction and append-only audit. The worker never writes canonical referral, assessment, admission, or decision state.

## Provenance contract

For each proposed field and candidate, Pipeline retains the source document, page, normalized bounding box when Document Intelligence supplied a valid polygon, confidence, and evidence artifact. Human accept/edit/reject/retry actions retain field version, actor, prior/next status, prior/next value, and time. Missing or malformed bounding geometry is rejected at the callback boundary when present; absence remains explicit for source formats that cannot supply geometry.

## Collision and recovery contract

- An old dispatcher cannot attach its provider run to a reclaimed attempt.
- An old reconciler cannot extend or fail a newer attempt.
- A heartbeat returns success only when its exact attempt row was updated.
- Success completion remains idempotent for the already-succeeded exact attempt and rejects every other non-running or stale attempt.
- Retry and dead-letter transitions remain bounded; dead-letter replay is one exact operator action.
- The schema change is additive and nullable. Rollback is the bounded application revert; the added nullable columns may safely remain during rollback and are removed only in a separately rehearsed schema rollback if required.

## Preserved behavior

No UI layout, click path, role assignment, Entra setting, referral workflow, assessment workflow, admission decision, storage retention rule, provider configuration, or production-data transformation changes. Existing reports without bounding boxes remain valid. Existing stored fields remain readable. All new geometry is optional and normalized.

## Evidence boundary

The candidate must pass extraction state replay, executable Python worker tests, callback/provenance goldens, sample-packet smoke, storage consistency, backlog rehearsal, synthetic quality harness, critical safety and mutation gates, PostgreSQL integration, recovery, and TARS certification. The governed real-packet corpus and provider latency/cost study remain mandatory before any later recognition-quality or provider-cutover claim.

Approved by Eric on 2026-09-10 through the owner fast lane with the directive: “do extraction and then we'll do the next six”.
