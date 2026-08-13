# Pipeline Data Architecture Handoff

This document describes how Pipeline must load, store, edit, and propagate
referral data. It is the engineering companion to
[`docs/PRODUCT_TENETS.md`](./PRODUCT_TENETS.md).

## Current Working Path

```text
Browser screen
  -> authenticated Pipeline API route
  -> server-only store / Alamo adapter boundary
  -> canonical operational and clinical records
  -> reviewed resident link
  -> derived progress / unified profile read model
  -> packet, profile, search, operations views
```

Saved local referrals may carry a development `clientId` for grouping referral
episodes. Admitted-client profiles are never generated from referrals; they
come from the governed Alamo roster. The current local file is still
development-only.

## Non-Negotiable Invariants

- `referralId` identifies one intake episode. Alamo `resident_key` identifies an
  admitted resident, and a reviewed `resident_link` joins the two domains.
- A local `clientId` must never be treated as an Alamo identifier or used to
  silently merge people.
- Current clinical identity is not duplicated as an editable profile copy.
- Packet fields, assessments, decisions, requirements, and documents remain
  traceable to the referral and client.
- Progress and completeness are derived from stored truth, never manually
  stored as percentages.
- Writes happen through server API routes, not directly from browser code to a
  database or clinical system.
- Every write uses validation, version checking, and an idempotency key where
  retries can create duplicates.
- Every important write produces an audit event.
- The app returns an updated canonical record after a successful write so the
  current screen can update immediately.

## Production Storage Shape

Use Azure Blob for packet and artifact files, and use an Azure relational
database for operational data. The recommended record store is Azure Database
for PostgreSQL Flexible Server because the application needs transactions,
indexes, optimistic concurrency, and cursor queries. Blob storage is not a
substitute for the record store.

The minimum durable records are:

- `people`: minimal Pipeline identity used to group referral episodes before or
  outside admission. It is not a copy of the Alamo clinical profile.
- `resident_links`: reviewed links between Pipeline people/referrals and Alamo
  `resident_key` values, including status, method, reviewer, and timestamps.
- `referrals`: intake episode, stage, owner, dates, priority, and tags.
- `referral_fields`: captured values, source, confidence, review state, and
  evidence reference.
- `assessments`: pre-assessment, assessment answers, timing, and outcome.
- `work_items`: TB, agreement, medication, payer, missing-field, and other
  circle-back tasks with owner, due date, status, next action, and evidence.
- `documents`: object-storage references and processing status. Never raw file
  binaries in the database row.
- `audit_events`: who changed what, from which version to which version, and
  when.

Large packets and extracted artifacts belong in Azure Blob/object storage. The
database stores metadata, pointers, checksums, and processing state.

## Packet Extraction And Review

The production packet path is asynchronous and survives the browser closing:

1. Pipeline creates a packet record and signed Blob upload targets.
2. The browser uploads the original bytes directly to Blob and marks the upload
   complete without sending packet bytes through the application server.
3. The Azure/Databricks worker normalizes pages, extracts field candidates, and
   stores confidence, source page, evidence reference, and conflict state.
4. A durable completion callback or reconciliation job marks the packet
   `ready_for_review`; browser polling is only a display convenience.
5. The canvas displays proposed values above the editable form. Pending output
   may fill blank fields but never silently overwrites human-entered data.
6. Confirm, Edit, and Reject create audit events. Only reviewed final values can
   satisfy workflow gates or feed downstream exports.

The local mock exercises this interaction but does not inspect uploaded bytes.
Production must fail closed until Blob, the extraction worker, durable field
storage, and evidence authorization are connected.

## Fast Loading Design

- Render the application shell without waiting for clinical or extraction
  data.
- Load list projections, not full client profiles, in queue screens.
- Load profile sections in one authenticated overview request or parallel
  bounded requests.
- Use database indexes and cursor pagination for client, community, stage,
  owner, month, tag, and updated-time queries.
- Cache reference data and safe summary projections. Do not cache PHI across
  users or permissions.
- Return the mutation response immediately and invalidate the affected client,
  referral, search, and operations queries.
- Add cross-user refresh through short polling first; add server events when
  supervisors need sub-second awareness.

Initial performance targets:

| Path | Target |
| --- | --- |
| Shell visible | under 300 ms from a warm deployment |
| First useful referral list | under 1 second |
| Client profile overview | under 1 second for normal records |
| Successful save acknowledgement | under 500 ms excluding file processing |
| Other-user freshness | under 30 seconds initially |
| Packet extraction | asynchronous; never block the browser page |

Measure these with request IDs, server timings, browser navigation timings, and
PHI-safe logs rather than guessing from local development.

## What Is Built Now

- Versioned referral create/get/list/patch API.
- Development-only referral episode grouping.
- Governed Alamo roster directory and unified resident profile, with no
  referral-created profile fallback.
- First production PostgreSQL migration for people, referrals, fields,
  documents, extraction jobs, assessments, provenance, work items, decisions,
  resident links, audit events, and idempotency keys.
- Transactional PostgreSQL resident-link adapter with candidate review,
  optimistic concurrency, collision checks, audit events, and one-to-one
  confirmed-link constraints.
- Transactional PostgreSQL referral and assessment adapters with shared
  revisions, optimistic concurrency, idempotent creates/imports, audit events,
  assessment provenance, and an unmapped-value bank.
- Role-aware identity review in the admitted-client profile. Staff explicitly
  choose a referral; reviewers/admins confirm or reject the candidate.
- `GET /api/profiles/{residentKey}` joins governed Alamo data to Pipeline work
  only through a confirmed reviewed link. Unlinked records are never joined by
  name.
- Extracted packet values displayed above the referral form with explicit
  confirm/edit review actions.
- Derived data completeness and blocker state.
- Local idempotent creates and atomic file writes for one development process.
- Clinical API boundary remains server-only and separate.

## What Is Still Required For Production

1. Provision Azure Database for PostgreSQL and apply
   `database/migrations/0001_pipeline_core.sql`.
2. Implement PostgreSQL packet-field, work-item, decision, and document
   metadata adapters behind the existing server boundaries.
3. Add a supervisor identity-review queue for unresolved candidates and
   duplicate conflicts; profile-level review is already implemented.
4. Move document uploads to signed object-storage URLs and asynchronous jobs.
5. Keep workflow transitions server-driven, versioned, and auditable.
6. Add shared frontend query caching and cross-view invalidation.
7. Load-test list, profile, search, save, concurrent edit, and 600-page upload
   paths before live PHI use.

## Identity Boundary

Microsoft Entra ID owns Pipeline staff identity. It supplies the authenticated
operator object ID, email, display name, and role/group claims through a signed
JWT. Pipeline validates that JWT server-side and uses the identity for permissions,
ownership, audit events, and assessor/supervisor views.

Client profiles are not Entra accounts. Current admitted-client profiles remain
governed by Alamo and are read through the existing server-only clinical
adapter. Pipeline stores referral episodes, operational work, and reviewed
`resident_links`; it does not create or directly edit the Alamo clinical record.

For the first rollout, configure Entra app roles or groups that map to the
existing Pipeline roles: `admin`, `assessment_coordinator`, `reviewer`, and
`viewer`. Keep `PIPELINE_AUTH_MODE=entra_jwt` in production. Production also
requires the Entra tenant, audience, delegated scope, and a populated
`PIPELINE_ALLOWED_EMAILS` allowlist; all role mappings stay server-side. Legacy
EasyAuth headers are supported only behind an explicitly configured trusted
gateway.

## Your Required Actions

Do these outside the codebase:

1. Provision Azure Database for PostgreSQL Flexible Server, unless your Azure
   team has already standardized on another Azure relational service.
2. Provision Azure Blob containers for raw packets, normalized pages, OCR,
   evidence, and derived artifacts.
3. Create the Entra app roles/groups for the assessor, reviewer, coordinator,
   supervisor/admin, and viewer access model.
4. Put connection values in the deployment secret manager, never in chat or
   `NEXT_PUBLIC_*` variables. At minimum, Pipeline will need a server-only
   database URL/service credential and the object-storage configuration.
5. Confirm the assessor identities and role assignments through Entra. Do not
   create duplicate Pipeline login accounts.
6. Confirm required fields and the exact gates for Pre, Assessment, Post,
   Accepted, Declined, TB, agreement, and other follow-up requirements.
7. Provide the Azure subscription, region, resource-group name, and desired
   hostname; do not send secrets here.

Keep all store modes on `local_file` for local development only. Production
must set the referral, assessment, and resident-link modes to `postgres`; it
must remain blocked rather than falling back to fake or single-instance data.
