## Goal
- Keep docs truthful to the current app
- Current product focus: durable referral workflow, Alamo active-census joining,
  reviewable packet extraction, decision-tree guardrails, and production-safe
  persistence

Production engineering status, exact external configuration, deployment order,
and changed-file inventory are in
[`docs/ENGINEERING_COMPLETION_REPORT.md`](./ENGINEERING_COMPLETION_REPORT.md).

## Product Reference
- [`docs/PRODUCT_TENETS.md`](./PRODUCT_TENETS.md) is the durable product
  reference for data capture, assessor work, assessor performance overview, and
  supervisor operational understanding.
- [`docs/ENGINEERING_DATA_ARCHITECTURE.md`](./ENGINEERING_DATA_ARCHITECTURE.md)
  is the handoff for canonical storage, fast reads, cross-view updates, and
  the external setup still required.
- All new workflow, data, and UI work should preserve one source of truth for
  client identity, referral state, ownership, due dates, requirements, and
  derived completeness.

## Resume Point
- Read `docs/WORKFLOW_BUILD_QUEUE.md` before continuing referral workflow work.
- Admitted-client profiles come only from the governed Alamo roster and resident
  endpoints. Creating a referral never creates an admitted-client profile.
- Referral ingestion is independent of the census. A worker-authenticated daily
  reconciliation reads one fresh Alamo roster snapshot and creates reviewable
  resident-link candidates for Pipeline clients. It does not overwrite referral
  routing fields. Confirmed links drive the live Alamo-plus-Pipeline profile join.
- Local demo mode currently has a validated one-time Alamo census export with
  532 residents across five communities, governed through 7 August 2026. The
  private snapshot is stored only under ignored `.data/`, does not refresh
  automatically, and is rejected in production. It is not the production Alamo
  API connection.
- The durable `resident_links` boundary, candidate/review API, PostgreSQL
  adapter, and unified profile read model are implemented. A confirmed link
  joins an Alamo `resident_key` to Pipeline referrals, documents, assessments,
  requirements, and completion state. Name similarity never creates a link.
- The referral canvas now shows extracted packet values directly above the form.
  Pending extraction fills only blank fields; confirmed or corrected values can
  replace them. Confirm and Edit actions use the authenticated packet-field
  review endpoint and preserve the extraction audit event.
- Local extraction remains mock-only and is visibly labeled as development data.
  Production mode now has durable upload reservations, SHA-256/size checks,
  opaque Azure Blob signing, Databricks dispatch, worker leases, callbacks,
  reconciliation, bounded retries, dead letters, retention cleanup, durable
  candidates/review audit, and authenticated preview/evidence proxy APIs.
  It remains disconnected until Azure, Databricks, PostgreSQL, worker secrets,
  networking, Key Vault references, and Azure runtime configuration are provisioned.
- Production relational migrations are in `database/migrations/0001_pipeline_core.sql`,
  `0002_workflow_engine.sql`, `0003_operational_hardening.sql`,
  `0004_document_processing.sql`, and `0005_collaboration.sql`. Transactional PostgreSQL
  referral, assessment, provenance, resident-link, decision, and work-item
  behavior is implemented. Stage changes use the guarded transition route.
  Durable document metadata, preview/scan states, Blob evidence references,
  upload sessions, processing jobs, and review history are implemented.
- Active referral canvases poll a PHI-safe change sequence every three seconds.
  Section-scoped versions allow non-overlapping saves to merge while stale
  same-section saves fail closed. Editing presence uses 15-second heartbeats
  and 45-second leases; presence is advisory and never bypasses version checks.
- Every visible referral-info value now persists. Existing records use
  section autosave, tab-scoped draft recovery, refresh warnings, remote-change
  comparison, and field-level extraction version checks. The full operating
  contract and test commands are in `docs/PRODUCTION_DATA_OPERATIONS.md`.
- File metadata and page thumbnails use authenticated, bounded APIs with
  keyset-style page continuation. Large originals are refused in favor of page
  previews. Ten-user collaboration, disposable PostgreSQL fixtures,
  transactional rollback drills, reference-only production seeding, guarded
  pilot reset, and the five operational metrics have executable checks.
- The assessment tool now has a canonical 52-field schema, a replaceable
  server-only store, authenticated history/create/update/import APIs, optimistic
  version checks, field provenance, an unmapped-value bank, a reviewable canvas,
  and joined profile summaries. Local JSON persistence is development-only.
  Production still needs Azure PostgreSQL configuration, the Azure workbook
  worker, and governed `resident_number` / `resident_key` link review. See
  `docs/ASSESSMENT_TOOL_DATA_MODEL.md`.
- A lightweight operations view is now available at `?screen=operations`.
  It derives the requirement queue, assessor load, referral flow, data quality, and
  system readiness from the existing referral/progress truth. It is intentionally
  small and local-first; it does not claim that the clinical roster is live.
- The operations view now includes a reviewer/admin supervisor exception queue
  derived from canonical work and resident-link records. Requirement evidence,
  waivers, reassignment, decline reasons, and EHR handoff transitions have
  distinct audit semantics; EHR handoff is explicitly queued, sent, or failed.
- Release and recovery gates now include append-only migration checksums,
  release manifests, 21,000 generated property cases, extraction quality
  scoring, a resumable 12,000-page orchestration rehearsal, guarded database
  backup/restore commands, Axe coverage, and Firefox/WebKit smoke tests.
- The profile UI calls `GET /api/profiles/{residentKey}`. The server starts from
  explicit Alamo resident scope and adds Pipeline work only after a reviewed
  link. Alamo clinical access remains server-only. Governed DOB is displayed
  when the approved contract supplies it.
- The profile supports explicit referral selection and role-aware candidate
  confirmation/rejection. It never proposes or confirms a name-only join.
- Referral browsing now uses stable keyset paging, server-side search, filters,
  and canonical facets. The kanban board is intentionally removed. Guarded
  workflow transitions remain available through the work surface.
- The referral directory is now an exception-driven worklist with deterministic
  `My work`, `Unassigned`, `Packet review`, `Assessment`, and `Decision` views.
  These views query canonical owner, stage, packet, assessment, and decision
  state; they do not persist a second queue or accept drag-and-drop stage moves.
- Packet review supports an explicit, reversible confirmation step for
  non-conflicting values at 90% confidence or higher. Lower-confidence,
  missing, and conflicted values remain individual review work. Owner and
  community routing use the canonical referral fields directly below the
  initial packet, before the extraction list.
- Completing packet review requires a real owner, community, and fully reviewed
  extraction. It records reviewed document state and advances through the
  existing versioned transition API into Assessment. Partial extracted names
  cannot replace a complete client name.

## Scope
- App Router shell
- Pipeline workflow pages
- Referral packet canvas and extraction review flow
- Mock extraction APIs
- Entra/header auth seam
- Azure Blob + Databricks integration contracts
- Server-only Alamo clinical API adapter, schemas, readiness, and Entra service authorization
- Referral operating reliability plan
- Lightweight operations observability view
- Deterministic replay/readiness checks
- Doc sync for AI-assisted work

## Files
- `components/pipeline/PipelineAppShell.tsx`
- `components/pipeline/ReferralPacketCanvas.tsx`
- `components/pipeline/PacketExtractionReview.tsx`
- `components/pipeline/ClientProfileDirectory.tsx`
- `components/pipeline/ClientProfileView.tsx`
- `app/api/*`
- `lib/auth/*`
- `lib/extraction/*`
- `lib/assessment/*`
- `lib/clinical/*`
- `lib/reliability/*`
- `scripts/*`
- `docs/*`
