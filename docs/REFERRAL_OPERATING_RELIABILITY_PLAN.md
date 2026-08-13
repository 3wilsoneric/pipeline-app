# Referral Operating Reliability Plan

## Goal

Make Pipeline safe for a few dozen internal operators by treating it as an operating product, not a demo UI.

The app should be excellent at a bounded set of referral workflows, deterministic before it is agentic, and recoverable when Azure, Databricks, OCR, Claude, EHR export, or user input fails.

## Current State

- UI shell exists for referrals, communities, chat, reports, calendar, packet dropzones, and extraction review.
- Mock upload/extraction APIs exist and match the future Azure/Databricks flow.
- Auth seam exists for Entra/platform headers.
- Batch manifest creation exists in `scripts/create-batch-manifest.mjs`.
- Reliability replay tests now exist in `scripts/referral-reliability-replay.mjs`.
- Shared workflow policy now exists in `lib/pipeline/referral-workflow.ts` for stages, tones, status mapping, progress, and forgiving search.
- Workflow transitions now run through deterministic blockers in `lib/reliability/referral-operating-model.ts`.
- Packet field review/retry actions now create mock audit events before the Azure/Delta audit table is connected.
- Platform readiness command now exists:

```bash
npm run check:platform
```

Fast local version:

```bash
npm run check:platform:fast
```

## Core Operator Journeys

These are the journeys the app must keep reliable before adding more AI behavior:

- New referral intake: create referral, attach packet, preserve source/community/date.
- Packet review: extraction status, missing docs, low-confidence fields, coordinator confirmation.
- Assessment completion: assessment detail, decision status, required fields.
- Missing info: list blockers, who owns them, next action.
- Duplicate resolution: same person/DOB/source collision before creating duplicate records.
- Source tracking: referral source volume and conversion.
- Decision handoff: accepted, declined, admitted, community review.
- EHR export queue: only accepted/admitted referrals with approved fields.

## Deterministic Rails

AI should not decide workflow grain, query scope, or writeback rules.

Deterministic app logic should decide:

- Current referral status.
- Packet state.
- Required missing fields.
- Stale workflow thresholds.
- Duplicate candidates.
- EHR export readiness.
- Review queue membership.
- Batch manifest identity and dedupe hash.
- Stage transition prerequisites and blocker messages.
- Audit event shape for review, retry, status change, and export operations.

AI/extraction can propose fields, summaries, and routing hints, but every proposed value must pass schema validation and human review before writeback.

## Contract For Every Operational Answer

Any future AI/chat/report answer should carry the same contract shape:

- `truth_state`: verified, partial, empty, or failed.
- `scope`: community, date range, status, source, referral id.
- `trace`: deterministic steps taken.
- `row_count`: exact evidence row count.
- `evidence_rows`: underlying referral/packet rows.
- `missing_data`: fields or systems blocking completeness.
- `next_action`: the operator-safe action.
- `safe_recovery`: none, needs human review, retry available, manual entry required, or blocked external.
- `artifact`: export/review queue/chart metadata.
- `visual_shape`: worklist, table, card, timeline, chart, or none.

Source:

```text
lib/reliability/referral-operating-model.ts
```

## Batch Processing Plan

Use this for the one-time digitized backlog.

1. Generate a manifest from the packet folder.

```bash
npm run manifest:packets -- --input /path/to/referral-packets --out /private/tmp/batch_manifest.csv --batch-id backlog-20260623 --facility "unknown"
```

2. Run a pilot first.

```text
pilot target: 500 pages or 1-2 representative packets
success metric: measured OCR rate, fallback rate, review rate, cost per 1,000 pages
```

3. Upload raw packets to Azure Blob under immutable layout.

```text
raw/{submitting_facility}/{packet_id}/original/{file_id}.pdf
```

4. Databricks backlog job reads the manifest.

```text
t1 ingest manifest
t2 normalize pages to 200 DPI PNG
t3 run Document Intelligence on all pages
t4 classify and route low-confidence pages
t5 Claude fallback only on selected pages/fields
t6 Pydantic validation
t7 merge candidates
t8 create review tasks
```

5. Process full backlog only after the pilot.

```text
wave size: 10,000-25,000 pages
retry key: batch_id + packet_id + page_no
dedupe key: content_hash
write mode: additive/idempotent, never mutate raw
```

## Incremental Daily Upload Plan

Use this for new referrals going forward.

1. Operator creates referral.
2. Browser requests signed upload URL from Next.js.
3. Browser uploads packet directly to Azure Blob.
4. Next.js completes upload and writes sentinel.
5. Sentinel or API completion triggers Databricks packet job.
6. Next.js stores `job_run_id`.
7. UI polls packet status.
8. Proposed fields appear in packet review.
9. Coordinator accepts, edits, rejects, or retries fields.
10. Approved values write to canonical referral record.
11. Accepted/admitted referrals enter EHR export queue.

Hard rule: binary packets upload directly to private Blob Storage with a
short-lived per-blob SAS; they do not pass through the Next.js web process.

## Fail-Safe Behavior

- Azure upload fails: keep referral shell, mark packet as `received` or `failed`, allow retry.
- Databricks job fails: surface `failed` with `failure_reason`, keep raw packet intact, allow rerun.
- Document Intelligence low confidence: route only affected fields/pages to Claude.
- Claude invalid JSON: retry once, then exception queue.
- Required fields missing: never write to EHR export queue.
- Duplicate candidate: require human resolution before creating a second live record.
- EHR export fails: leave accepted referral intact, mark export as failed, allow retry.
- User loses session: no binary is lost after direct Blob upload; packet status is recoverable by `packet_id`.

## Regression Replay Coverage

Current replay cases:

- Missing required field queue.
- Duplicate same-name/DOB candidate.
- Stale urgent packet review.
- Invalid workflow transition blocked before assessment.
- Decline can bypass packet prerequisites but must warn/audit.
- EHR export readiness envelope.
- Review/retry audit trail contract.
- Follow-up context patching without stale scope leaks.
- API contract shape presence.
- Module registry and journey registry presence.
- Required runbook/spec presence.

Command:

```bash
npm run check:reliability
```

## Readiness Bundle

Run before demo, handoff, or deploy:

```bash
npm run check:platform
```

It runs:

- Referral reliability replays.
- TypeScript.
- ESLint.
- Production build.

Use this while iterating quickly:

```bash
npm run check:platform:fast
```

## Next Implementation Order

1. Keep the UI stable; do not touch the visual system unless the task is styling.
2. Replace mock signed upload URLs with Azure Blob SAS.
3. Persist packet shell records in a real store.
4. Trigger Databricks on upload completion.
5. Read packet status and fields from Delta/Unity Catalog.
6. Persist field review/audit events.
7. Add EHR export queue table and CSV/XLSX output first.
8. Add browser smoke tests once a non-interactive auth path exists.
