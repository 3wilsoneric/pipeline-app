# Pipeline spring-cleaning audit

Date: 22 August 2026

## Scope and method

This audit covered every Git-tracked file plus the untracked build and data
footprint, package graph, Next.js boundaries, API routes, database migrations,
Azure infrastructure, GitHub Actions, runbooks, browser tests, load tools, and
the largest application modules. The repeatable `npm run check:hygiene` gate
now walks the complete tracked tree; focused static analysis, duplicate-code
analysis, contract suites, a clean production build, and browser/load checks
provide the behavioral evidence.

The review used current primary guidance from Next.js, Microsoft Azure, GitHub,
PostgreSQL, and OWASP. It deliberately does not reward abstraction for its own
sake: explicit authorization and PHI-safe logging at each public route remain
local and auditable even where a clone detector sees similar ceremony.

## Corrected in this pass

- Removed five unreachable source modules and their stale contract references.
- Centralized fuzzy matching, client-document identifier validation, clinical
  request setup, profile projection assembly, and packet-upload transport.
- Reduced the largest canvas component by moving upload I/O to a server-neutral
  boundary without changing its visible workflow.
- Corrected database readiness from a partial ten-migration check to the full
  checksum-pinned `0001` through `0012` migration set.
- Enabled CodeQL SARIF ingestion with the required least-privilege workflow
  permission; retained immutable action pins and downloadable evidence.
- Declared direct `server-only` and PostCSS dependencies instead of relying on
  transitive packages.
- Removed stale generated Next.js type paths, duplicate ignore rules, and added
  a safe local artifact cleaner.
- Aligned HNS storage documentation and readiness checks with Azure reality:
  Blob/container soft delete and additive object keys are supported; Blob
  versioning is not available with hierarchical namespace; container WORM needs
  an approved retention policy and a live drill.
- Updated stale runbook claims that said implemented document workers or newer
  migrations did not exist.
- Removed the unconsumed per-request start log; completion/failure logs and the
  two bounded metric records retain latency, status, and traffic evidence with
  25% fewer normal-request log records.

## Deeper verification pass

The second pass followed data ownership and mutation behavior through the
largest UI, route, store, worker, and reporting modules instead of splitting
files solely because of line count. It produced the following additional
corrections:

- Made every editable referral-chart field part of one exhaustive typed
  persistence contract. Create, autosave, conflict recovery, and extraction
  projection now use the same mapping; a field cannot be added to the visible
  chart without a TypeScript error until its persistence path is defined.
- Moved packet extraction overwrite/provenance policy and document-preview UI
  into focused modules. Manual or reviewed values remain authoritative unless
  the user explicitly requests an extraction override.
- Removed an assignment-patch leak that could persist an internal `ok` control
  property in referral JSON.
- Restored document evidence identifiers when hydrating workflow requirements,
  so an attached document remains attached after a database reload.
- Unified local and PostgreSQL assessment import/patch policy, including
  validation, provenance, section versions, and audit behavior.
- Replaced repeated cross-product searches while hydrating workflow and
  assessment relations with pre-indexed maps, and stopped internal sweep jobs
  from computing exact list totals they never display.
- Made local referral-to-assessment workflow coordination lazy, removing the
  eager store dependency. The permanent hygiene gate now parses the complete
  TypeScript/JavaScript module graph and rejects eager local runtime cycles.
- Replaced extraction callback row-at-a-time preview, artifact, field, and
  candidate writes with bounded set-based PostgreSQL writes. Duplicate field
  keys and preview page numbers are rejected before persistence.
- Changed operational-report capacity behavior from silent truncation to an
  explicit failure. A supervisor report can no longer appear complete after
  quietly dropping rows beyond its safety bound.
- Removed the final raw local-store exception message/path log. Runtime logs
  now retain bounded event labels without local paths, PHI, upstream bodies,
  tokens, or free-form exception text.
- Added permanent checks for unsafe type suppression, dynamic execution,
  browser-visible secret names, raw exception logging, and eager module cycles.
- Re-ran the production dependency advisory scan: 529 installed packages, 104
  production packages, and zero known advisories at every severity at audit
  time. License, integrity, pinned-action, route-policy, and security-boundary
  gates also pass.

Large modules remain where they are orchestration surfaces with coupled draft,
conflict, presence, and recovery state. The current warnings are explicit:
`ReferralPacketCanvas`, the primary browser journey suite, the referral and
assessment stores, `ClientProfileView`, `AssessmentWorkspace`, and
`ReferralHome`. Further extraction should be characterization-test-led and by
domain boundary; line-count-only splitting would increase indirection without
reducing risk.

## Final implementation pass

The final pass completed the locally actionable items from the first audit
without deploying or purchasing infrastructure:

- Extracted structured summary/interview parsing, serialization, and editing
  from `ReferralPacketCanvas`, with round-trip, legacy free-text, and partial
  heading characterization tests. The canvas keeps orchestration state while a
  focused component owns the narrative interaction.
- Added an aggregate-only PostgreSQL document inventory covering active/deleted
  documents, stale reservations, retention candidates, processing states, and
  logical source/preview/artifact bytes. It emits no filename, Blob key, person,
  or record identifier. Native Blob `UsedCapacity` remains the physical storage
  authority because logical categories can overlap.
- Extended PHI-safe alerting to 13 log alerts plus native PostgreSQL connection
  and storage, Blob capacity, and Container Apps restart/timeout metrics. Alert
  action-group resource IDs survive foundation-to-runtime deployment wiring.
- Split CI into an economical pull-request lane and main/manual release lanes.
  Pull requests run the complete non-browser contract gate, audit, one build,
  artifact audit, and release evidence; the expensive browser, visual,
  cross-browser, PostgreSQL contention, and CodeQL work is not duplicated on
  every pull request.
- Added a read-only live Entra rehearsal that consumes short-lived token files
  for viewer, assessor, supervisor, and administrator roles. Its output contains
  no token, principal, body, client, or record data.
- Rehearsed the 20-packet/12,000-page resumable backlog model. It completed with
  20 modeled retries, no duplicate claims, and no dead letters at a modeled 120
  pages/minute. This validates orchestration, not external OCR throughput.
- Applied all 12 migrations to a disposable PostgreSQL cluster, ran live smoke,
  transactional fixtures, migration rollback, production reference seeding,
  logical backup, and checksum/history-verified restore. No synthetic client
  data was inserted by the production seed.
- Exercised real local PDF bytes through upload, extraction-state, page-evidence,
  correction-history, reopen, and duplicate-hash behavior. The successful run
  used the local mock extraction provider and therefore does not certify Azure
  OCR accuracy, malware scanning, or provider latency.

## Verification evidence

- The complete fast platform gate passed all included suites, including API and
  security boundaries, migration and database contracts, extraction recovery,
  Azure readiness, ten-user scale, supply-chain policy, TypeScript, and ESLint.
- A clean Next.js 16 production build passed. The artifact audit found 24 static
  assets, 1.49 MiB total static output, a 405 KiB largest JavaScript asset, no
  source maps, and no server credential markers in browser output.
- The production-mode Playwright run passed all 49 enabled Chromium and mobile
  journeys. Eleven opt-in cases were skipped by configuration: four desktop
  installability cases, one operator-supplied external packet case, and six
  visual-baseline cases. Their dedicated release suites remain intact.
- The enforced performance scorecard captured 16 real interactions and passed
  every budget: 47.8 ms TTFB, 68 ms FCP, 132 ms LCP, 32 ms INP, zero CLS,
  559,527 transferred bytes, 97.8 ms slowest measured warm journey, and no API
  errors. These are local production-build measurements with sanitized
  fixtures, not claims about live Azure latency.
- McMaster static certification passed 37 of 37 requirements and all 22
  performance contracts. The dependency advisory scan found zero known
  advisories at audit time. `git diff --check` and the complete hygiene gate
  also passed.

## Boundary certification pass

The follow-up pass completed the remaining code-only items without changing
production data or Azure resources:

- Extracted admission/manual-intake/EHR/deletion editors and the final review
  surface from `ReferralPacketCanvas`. A pure review contract now owns missing
  value semantics, per-section counts, and the aggregate completion percentage.
- Gave referral and assessment persistence one shared, side-effect-free adapter
  selector while preserving separate local-file and PostgreSQL implementations.
  Behavior fixtures prove the inactive adapter is never invoked.
- Replaced worker callback and Blob-basename source checks with executable
  report-validation and opaque-path behavior. Duplicate fields/pages, invalid
  confidence, oversized collections, and unsafe names fail before persistence.
- Made expensive CI jobs path-aware. Documentation-only work starts neither
  integration lane; components start browser coverage; migrations start
  PostgreSQL; API, dependency, and CI-gate changes start both.
- Added PostgreSQL 16 planner assertions for active workspace, community,
  trash-retention, document, and assessment paging indexes. CI remains the
  PostgreSQL 16 authority. The local Mac has PostgreSQL 14, where all 12
  migrations, retention behavior, fixture rollback, and migration rollback
  passed in a disposable cluster.
- Added a validated low-cardinality metric event contract and a synthetic
  ten-user/200-request workload. Record identifiers, names, and error strings
  are removed before emission; only aggregate counts and latency are reported.
- Added accessible loading and alert semantics to Calendar and Trash, exposed
  review completion as a progress bar, corrected Review-page color contrast,
  and added deterministic useful-empty and retryable-error browser fixtures.

The final focused verification used one production artifact. The artifact
contained 24 static assets, 1.49 MiB total static output, a 406 KiB largest
JavaScript chunk, 416 KiB total gzipped browser code, no source maps, and no
server credential markers. The complete primary Chromium run passed 48 tests;
11 opt-in desktop/operator/visual cases remained skipped by configuration. The
focused accessibility matrix passed all six desktop/mobile journeys.

## Findings intentionally retained

- Route authorization, same-origin mutation checks, private-cache headers, and
  safe logging remain visible in each route. Hiding these behind a generic route
  wrapper would make policy review and AST enforcement less reliable.
- Local and PostgreSQL store adapters retain parallel behavior. They implement
  one contract for development tests and production persistence; merging them
  would couple unlike storage semantics.
- Source-reading contract checks remain where they protect critical route and
  deployment invariants. They should be replaced gradually with behavioral
  tests, not deleted in bulk.
- Dependency major upgrades were not mixed into a structural cleanup. Security
  audit is clean; framework, MSAL, lint, icon, and TypeScript upgrades should be
  isolated release trains with their own compatibility evidence.

## Current scale position

The repository has bounded paging/search, PostgreSQL optimistic and section
versions, idempotent mutations, three-second active-canvas change polling,
presence leases, background extraction states, authenticated document assets,
and a ten-user contention suite. Azure Container Apps currently permits one to
three replicas with 50 concurrent HTTP requests per replica. The application
fallback is five database connections per replica, while the current Azure
runtime template explicitly sets ten (the code bounds configuration between one
and twenty). That is a credible pilot shape for ten continuous users and
approximately 100 GB of documents, provided live telemetry confirms the
assumptions.

File count and bytes are not the primary risk. Unbounded list reads, thumbnail
fan-out, PDF transformation inside request paths, database connection pressure,
and retry storms are. Existing paging, response limits, worker leases, additive
Blob keys, and overload rejection address those risks; production dashboards
must prove they stay bounded.

## Remaining production decisions

### Before broader PHI rollout

1. Put the application behind an approved reverse proxy or Azure Front Door/WAF
   policy with request-body, slow-client, abuse, and cross-replica rate limits.
   The current in-process governor intentionally protects one replica only.
2. Move Blob access to approved private networking and firewall rules. Shared
   key and public anonymous access are already disabled, but network exposure is
   still an infrastructure decision.
3. Complete Entra group/app-role assignments and verify assessor, supervisor,
   viewer, and administrator journeys with real principals.
4. Run a disposable production-shaped PostgreSQL restore and migration rollback
   drill, then record RPO/RTO evidence.
5. Approve the document retention schedule. Either test container-level WORM or
   formally accept additive object keys plus soft-delete controls.
6. Exercise several representative 600-page packets through upload, malware
   gating, extraction, thumbnails, evidence review, correction history, retry,
   and deletion recovery.

### Remaining evidence-driven engineering

1. Continue splitting large modules only when a domain boundary and
   characterization test make the change safer. The next candidates are packet
   field review, assessment orchestration, document inventory, and the
   local/PostgreSQL store implementations.
2. Replace remaining source-text contracts gradually with route/adapter
   integration behavior while retaining the route-policy AST audit.
3. Use live Query Store/`pg_stat_statements`, Azure Monitor, and queue evidence
   before changing indexes, connection pooling, replicas, worker concurrency,
   or storage tiers.
4. Schedule patch/minor dependency maintenance monthly and major upgrades one
   at a time. Keep audit, license, integrity, CodeQL, and dependency review
   blocking.

### Trigger-based capacity changes

- Enable built-in Azure PostgreSQL PgBouncer when measured connection pressure,
  failover behavior, or pool wait latency justifies it.
- Increase Container Apps replicas only after database and worker capacity are
  measured together; more web replicas can worsen database contention.
- Add multi-region recovery only when approved RTO/RPO cannot be met by zonal
  PostgreSQL HA, backups, Blob redundancy, and redeployment automation.

No paid Azure service, network resource, retention lock, or production setting
was enabled by this code audit. Those changes require cost, retention, security,
and rollback approval.

## Primary references

- [Next.js production checklist](https://nextjs.org/docs/app/guides/production-checklist)
- [Next.js data security](https://nextjs.org/docs/app/guides/data-security)
- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [React component and hook purity](https://react.dev/reference/rules/components-and-hooks-must-be-pure)
- [Azure Container Apps health probes](https://learn.microsoft.com/en-us/azure/container-apps/health-probes)
- [Azure Container Apps scaling](https://learn.microsoft.com/en-us/azure/container-apps/scale-app)
- [Azure PostgreSQL built-in PgBouncer](https://learn.microsoft.com/en-us/azure/postgresql/connectivity/concepts-pgbouncer)
- [Azure PostgreSQL Well-Architected guidance](https://learn.microsoft.com/en-us/azure/well-architected/service-guides/postgresql)
- [Azure Blob protection options](https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-vs-versioning-options)
- [Azure immutable Blob storage](https://learn.microsoft.com/en-us/azure/storage/blobs/immutable-storage-overview)
- [Azure Blob lifecycle management](https://learn.microsoft.com/en-us/azure/storage/blobs/lifecycle-management-overview)
- [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use)
- [PostgreSQL monitoring](https://www.postgresql.org/docs/current/monitoring.html)
- [PostgreSQL index locking behavior](https://www.postgresql.org/docs/current/locking-indexes.html)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
