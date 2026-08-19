# Pipeline Workflow Build Queue

This is the resume point for the referral workflow work. The clinical Alamo
connection remains server-only. Its active roster is the admitted-client source
of truth and must be joined to Pipeline work through an explicit identity link.

Product north star: [`docs/PRODUCT_TENETS.md`](./PRODUCT_TENETS.md). It is the
reference for the four application tenants: complete data capture, actionable
assessor work, assessor performance visibility, and supervisor operational
understanding.

Engineering handoff: [`docs/ENGINEERING_DATA_ARCHITECTURE.md`](./ENGINEERING_DATA_ARCHITECTURE.md).

## Current State

- Admitted-client profiles come only from the governed Alamo roster and resident
  endpoints. Saved referral `clientId` values are local episode-grouping aids;
  they are not Alamo resident identifiers and must not be used as silent links.
- Referral records can be listed, retrieved by ID, and patched with optimistic
  version checking.
- Referral progress is derived from the saved referral, canonical assessment,
  admission decision, and versioned work items. The progress chart is not a
  second source of truth.
- The admitted-client directory and detail surface fail closed when Alamo is not
  connected. Referral creation does not create a client profile.
- Server-side stage transitions now reject invalid sequence moves and return
  named prerequisite blockers.
- Local referral persistence is development-only. The transactional PostgreSQL
  adapter is implemented; production still needs the Azure database
  configuration and durable object storage.
- Development defaults to the labeled mock adapter. Production has durable
  Azure Blob upload signing, Databricks dispatch/reconciliation, worker leases,
  bounded retries, dead letters, preview/evidence proxying, retention, and
  review audit persistence; it fails closed until credentials and resources
  are configured.
- The guarded transition endpoint preserves workflow rules without exposing a
  kanban board. Invalid sequences, stale versions, missing packet review,
  incomplete assessments, missing decisions, and open move-in blockers return
  explicit recovery text.
- A lightweight operations overview is available at `?screen=operations`.
  It shows the active queue, stale and due work, owner load, funnel position,
  data-quality gaps, and backend readiness without introducing another source
  of workflow truth.
- The supervisor-only exception endpoint and operations surface derive
  unresolved conditions from canonical referrals, requirements, extraction,
  identity links, and EHR handoff state. It is not a second queue store.
- New packet save now creates a referral record in the development store with
  searchable metadata: created date, community, workflow stage, owner,
  priority, and normalized tags. The referral list exposes search plus stage,
  owner, priority, tag, community, and month browse/filter paths.
- The packet canvas now ends with a Data review step that shows field and
  document completeness for the current client/referral and links missing data
  back to its capture step.
- The initial packet upload now exposes extracted values above the editable
  referral form. Pending machine output fills only blank fields; Confirm and
  Edit preserve review state and audit history through the field-review API.
- The canonical 52-field assessment contract, conservative legacy mapper,
  list preservation, provenance, unmapped-field bank, validation, and derived
  identity completeness now live in `lib/assessment/assessment-tool-schema.ts`.
- Initial referral extraction and later assessment extraction are now separate
  target registries. Alamo still needs to populate the nullable ElderMark
  `resident_number` contract field before automatic resident joining is safe.
- The first PostgreSQL migration, explicit resident-link candidate/review APIs,
  transactional resident-link adapter, and unified profile read model are now
  implemented. The client profile shows whether the identity is unlinked,
  awaiting review, or connected; it does not join by name.
- Transactional PostgreSQL referral and assessment adapters preserve versions,
  idempotency, audit events, field provenance, and unmapped imported values.
  The profile contains the first role-aware resident-link review UI.
- Admission decisions and follow-up work now have authenticated APIs,
  optimistic versions, PostgreSQL adapters, audit writes, and synchronized
  referral projections for compatibility. Packet document drops persist as
  evidence-bearing requirements instead of disappearing on refresh.
- Referral activity is read from `pipeline.audit_events` in PostgreSQL and from
  bounded assessment/decision events in local development. The data-review
  surface shows the latest events without duplicating workflow state.
- Server-side referral search, filters, facets, and bounded paging replace
  client-side scans. The kanban board is intentionally removed while the
  workflow transition API remains guarded and versioned.
- The referral directory now exposes deterministic work queues for the signed-in
  operator, unassigned records, packet review, assessment, and decision. Row
  progress and next action use batched canonical workflow context rather than a
  duplicated queue status.
- Packet review supports guarded bulk confirmation only for non-conflicting,
  nonempty values at 90% confidence or higher. Completion requires reviewed
  extraction, a real owner, and a community, then advances through the audited
  transition API into Assessment. Owner and community controls appear before
  the extraction list so routing does not require scrolling through the packet.
- The compact requirement editor exposes ownership, due date, next action,
  blocker, evidence, completion, waiver, and recovery from optimistic conflicts.
- Migration `0003_operational_hardening` adds durable document preview/scan,
  retention, extraction lease/retry, idempotency expiry, and request audit state.
- Migrations `0004_document_processing` and `0005_collaboration` add durable
  extraction/document processing and section-version/presence collaboration.
- Accepted records use a versioned EHR handoff command with queued, sent, and
  failed states. Accepted never silently means exported.
- Release CI now enforces migration checksums, generated property contracts,
  extraction quality, a resumable 12,000-page orchestration rehearsal,
  recovery safeguards, accessibility, and cross-browser smoke coverage.

## Completed In This Pass

- Added `GET /api/referrals/{referralId}`.
- Added `GET /api/referrals/{referralId}/progress`.
- Added `POST /api/referrals/{referralId}/transition`.
- Added `GET|PUT /api/referrals/{referralId}/decision`.
- Added referral work-item list and versioned update routes.
- Added the separate data-first client progress panel.
- Existing referral canvas loads the saved record and saves core editable
  fields through the versioned PATCH API.
- Added derived progress for referral information, initial packet, assessment,
  admission decision, and follow-up requirements.
- Added the first canonical transition guardrail for stage changes, including
  packet review, assessment completion, admission decision, decline reason, and
  move-in requirement checks.
- Profiles use `GET /api/clinical/clients` for the canonical directory and
  `GET /api/profiles/{canonicalClientId}` for detail. The unified route calls
  Alamo server-side, loads only one enhanced record, and exposes Pipeline work
  only through a confirmed resident link.
- Added paginated name/resident-number search across current and historical
  clients, the complete governed enrichment schema, joined resident profiles,
  episode history, explicit freshness, and baseline-field completeness.
- Added local referral creation from the packet canvas, with an explicit
  community selector and comma-separated tags that are persisted with the
  referral and used by list search and filters.
- Added `GET /api/operations/overview` and a small operations dashboard for
  action queue, four-assessor load, referral flow, data health, and system
  readiness. Local development explicitly labels synthetic records and the
  disconnected clinical roster.
- Added `GET /api/operations/supervisor-queue` with role-gated canonical exceptions.
- Added audited evidence/waiver/reassignment semantics and the versioned
  `/api/referrals/{referralId}/ehr-handoff` command workflow.

## Next Build Order

1. Provision the resources in `infra/azure`, apply migrations `0001` through
   `0005`, configure all PostgreSQL modes and secrets, and run live health checks.
2. Implement the Databricks notebook/job that consumes the documented worker
   contract and returns malware, preview, evidence, candidate, and field output.
3. Configure Entra user sign-in and the separate Alamo API application
   permission, then validate the explicit resident-link review queue with live
   governed roster data.
4. Run a representative packet pilot before the backlog wave; tune extraction
   rules without changing the API or canonical assessment schema.
5. Validate queue definitions, extraction thresholds, EHR handoff ownership,
   backup retention, and alert destinations with the pilot operators.

## Workflow Rules To Preserve

- Canonical workflow phases remain Pre, Assessment, and Post even though they
  are not rendered as board columns.
- Accepted and declined are outcomes, not parallel duplicate work queues.
- Requirements are independent tasks. A TB result or signed agreement can
  arrive later without creating a duplicate referral or corrupting the phase.
- Alamo owns current admitted-client identity and clinical fields. Pipeline does
  not directly edit or duplicate that governed record.
- Every packet, assessment, decision, extracted correction, and clinical join
  must remain traceable to its referral, `resident_link`, source system, and
  reviewer where applicable.
- Every blocker has an owner, due date, and next action.
- Progress is computed from field and requirement truth, not manually stored
  percentages.
- Missing, stale, conflicting, and unassigned data remain visible.

## Resume Command

Start with Azure provisioning, all six migrations, and the live adapter smoke
test. Then deploy the worker contract and run the packet pilot. Review each change against
[`docs/PRODUCT_TENETS.md`](./PRODUCT_TENETS.md).
