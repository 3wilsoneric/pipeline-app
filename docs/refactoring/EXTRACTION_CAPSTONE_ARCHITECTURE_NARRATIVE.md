# Extraction Capstone Architecture Narrative

Author: TARS machine trace, owner-authorized by Eric

Date: 2026-09-09

Status: setup complete; implementation blocked on governed packet evidence

Starting commit: `5e015d2bd979da98c26da7b858600a0bcba7403a`

Dedicated worktree: `/Users/eric/pipeline-refactor-extraction-capstone`

Branch: `codex/refactor-extraction-capstone`

## Scope

- Runtime scope: the durable upload/extraction boundary, extraction job state and report validation, the Databricks worker, and internal extraction routes recorded in `docs/refactoring/refactor-slices.json`.
- Entry points: packet upload reservation/completion, internal dispatch/reconcile/queue/report/dead-letter routes, packet status and fields, field review/retry, and worker callback.
- Explicit exclusions: no provider replacement, model/LLM addition, clinical inference, automatic acceptance, referral/assessment write from a worker, schema migration, applied-migration rewrite, visual redesign, or production configuration/cost activation.
- Canonical responsibility: `extraction_provenance_and_worker_state`.
- Approved proof obligations: `extraction_immutable_source_and_provenance` and `extraction_worker_lease_and_write_boundary`.
- Exact-start evidence: `docs/refactoring/characterization/extraction-capstone-start-5e015d2.json`.
- File audit: `docs/refactoring/extraction-capstone-file-audit.json`.
- Assurance record: `docs/refactoring/extraction-capstone-assurance-record.json`.

## What it does

Pipeline reserves immutable packet documents, verifies uploaded size and digest, quarantines the documents, creates bounded extraction and preview jobs, leases those jobs to the configured Databricks worker, and accepts only authenticated, bounded, current-attempt reports. A successful report re-verifies the durable source object before one PostgreSQL transaction records job completion, document safety/processing state, preview artifacts, extracted candidates, field provenance, and packet projection. Human review—not provider output—creates an accepted or corrected field value and its append-only review event.

The local mock/manual paths remain compatibility and development adapters selected by `extraction-service.ts`; this slice does not flatten them into the durable PostgreSQL/Blob/Databricks path or claim that their persistence semantics are identical.

## Inputs and outputs

| Boundary | Input | Output | Validation |
| --- | --- | --- | --- |
| Upload service | Authenticated actor, referral, source, file descriptors, byte size, digest | Opaque packet/document reservations and signed upload targets | Count, content type, per-file/aggregate size, digest, identifier, safe Blob path |
| Upload completion | Packet and exact reserved file-id set | Uploaded/quarantined document state and at most one active job per document/type | Exact set match, Blob existence and size, transaction and unique partial index |
| Dispatch/reconcile | Internal-worker request and bounded limit | Leased jobs, provider run identifiers, retries, or dead letters | Internal authentication, `skip locked`, attempt token, bounded lease/retry policy |
| Worker report | Job id, attempt count/token, status, digest, malware result, artifacts, fields/candidates | Heartbeat, retry/dead-letter, or transactionally persisted extraction result | JSON/body limits, UUID/range/duplicate/path checks, current attempt, durable source recheck |
| Human field review | Authorized actor, packet/field, expected version, accept/edit/reject | New field version and append-only review event | Resource authorization, action/value schema, optimistic version, transaction |

## Canonical records and ownership

- `documents` owns immutable source identity, opaque Blob location, byte size, SHA-256, malware state, processing state, preview metadata, and retention state.
- `packet_uploads` and `packet_upload_files` own the exact referral-scoped upload set and packet-level processing projection.
- `extraction_jobs` owns queued/running/succeeded/dead-letter state, attempt count/token, provider run, lease, backoff, and failure code.
- `referral_fields` owns the reviewable proposed/final value and its source document, page, evidence object, confidence, reviewer, status, and optimistic version.
- `extraction_candidates` retains competing provider candidates rather than erasing disagreement.
- `field_review_events` is the append-only human accept/edit/reject/retry history.
- The referral and assessment stores remain the only canonical writers for referral and clinical assessment state. The extraction worker cannot call them and its callback only reaches extraction-owned tables.

## Invariants

- Original packet bytes remain immutable and the recorded digest is verified at reservation, worker processing, and successful callback.
- A successful report without an explicit malware result and verified digest is rejected.
- Every persisted extracted value retains its source document and any available page, evidence location, confidence, candidate history, and later human review/correction history.
- Provider output remains proposed evidence. It cannot become accepted referral or assessment truth without an authorized field-level review and a separate owning-store mutation.
- Only the current `running` attempt with matching attempt count and unguessable token can heartbeat, fail, or succeed.
- At most one queued/running job exists for a document and job type; concurrent claimers use row locking with `skip locked`.
- Retry count, exponential backoff, lease duration, callback size, fields, candidates, artifacts, pages, and input bytes remain bounded.
- Infected or scan-failed documents never write extracted fields.
- No refactor changes schema, production provider configuration, storage retention, route behavior, or PHI/logging boundaries.

## Job, lease, retry, and collision contract

| Event | Guard | Winning effect | Losing/replay behavior |
| --- | --- | --- | --- |
| Upload completion | Exact reserved file set and verified Blob sizes | One transaction marks documents and packet, then queues jobs | Already completed upload returns the prior job/document projection |
| Job claim | Queued and due row, `for update skip locked` | One running attempt, count increment, token, owner, lease | Other dispatchers do not receive the row |
| Provider trigger failure | Current running attempt | Requeue with bounded backoff or dead-letter | Stale attempt update returns `stale` and applies no new disposition |
| Heartbeat | Matching running attempt count/token | Extends heartbeat/lease and records provider id | Expired/non-running attempt is rejected |
| Success callback | Matching running attempt plus source, digest, and malware verification | One transaction completes job and writes extraction-owned records | Replayed success returns succeeded; stale/different attempt is rejected |
| Dead-letter replay | Exact dead-letter job | Clears provider/attempt/lease failure state and requeues | Non-dead-letter identity returns not found |
| Field review | Expected field version and authorized actor | One field version plus one review event | Stale reviewer receives conflict and must inspect current evidence |

## Transaction and side-effect boundaries

- Signed upload URL creation and Blob property inspection occur outside PostgreSQL transactions; final database state is committed only after the durable object is observed.
- Upload completion locks the packet and creates/refreshes active jobs transactionally.
- Successful worker reports compare-and-swap the attempt, update document and packet projections, and persist preview/artifact/field/candidate rows in one PostgreSQL transaction.
- Human review updates the field, adds the review event, and closes packet/document review state in one transaction.
- Provider trigger and provider state polling are external effects. Failures are represented explicitly as retry/dead-letter state; they are never reported as successful extraction.
- Metrics contain bounded operation/result/job-type dimensions and no document contents, names, field values, tokens, or Blob URLs.

## PHI, trust, and provider boundary

- Packet bytes, OCR output, field candidates, and evidence images are PHI-capable and remain in private Blob/PostgreSQL boundaries.
- Browser and user routes authorize the actor and referral resource separately from the internal-worker credential.
- The Databricks worker receives a short-lived read-only user-delegation URL, verifies file signature and SHA-256, obtains a malware verdict, and posts to an HTTPS callback with bounded identifiers and report data.
- Document text is data, never instructions. The current worker is deterministic and has no LLM client.
- Committed characterization/evaluation artifacts contain only synthetic facts, counts, hashes, statuses, timings, and opaque fixture identifiers.

## Existing exact-start evidence

- `npm run check:extraction` passed 22 state, lease, stale-attempt, callback, duplicate, path, and active-job controls.
- `npm run check:extraction-worker` passed eight executable Python tests and 18 worker/deployment contract checks.
- `npm run check:storage-consistency` passed 13 durable upload failure/recovery scenarios.
- `npm run check:backlog-rehearsal` completed 20 synthetic 600-page packets (12,000 pages), observed bounded retries, no duplicate claims, and verified resume.
- `npm run check:extraction-quality` passed its one synthetic schema-v2 fixture and eight labeled fields. Its 95% exact-match lower bound is only `0.6756`, so it is a harness check—not adequate evidence of production accuracy.
- `npm run check:sample-packet` correctly refused to run without `PIPELINE_SAMPLE_PACKET_PATH`.
- `npm run check:extraction-corpus` correctly reported `blocked_human_labeling`: 25 deep packets and 175 total governed packets are required.

## Comprehension findings

- Attempt count is not sufficient authorization for a callback; the attempt token and current running status are both required.
- A provider run marked succeeded without a callback is treated as missing output and retried/dead-lettered. Provider status alone is not extraction success.
- Source immutability is checked against the reserved database digest and the currently stored Blob before extracted data is committed.
- The worker writes proposed fields/candidates only. Human review and the later referral/assessment save are distinct boundaries with distinct authorization and audit.
- The most risk-dense modules are `processing-worker.ts`, `document-processing.ts`, and the Python worker. Their current complexity is a refactor target, but corpus-backed value/provenance parity must exist before movement.

## Owner explain-back

Packets are immutable evidence. The worker may read and propose, but it does not decide clinical truth or write a referral or assessment. Every accepted value must be traceable back to the exact document evidence and accountable human action. Old workers lose, retries stay bounded, unsafe documents stop, and provider or storage failures remain visible and recoverable.

## Start condition and assurance boundary

- Governance and the dedicated worktree can be prepared now.
- Runtime implementation must remain stopped until a local sample packet is supplied and the external governed schema-v2 corpus meets the recorded label count, provenance, and diversity checks.
- Provider latency/cost evidence is required only before completion and must not activate a paid production path without separate authorization.
- This narrative does not claim universal extraction accuracy, absence of defects, or proof outside the declared worker state machine and governed corpus.

Owner-authorized by: Eric, 2026-09-09T04:58:05Z
