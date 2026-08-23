# Production Hardening Audit

This is the current hardening boundary for Pipeline. It distinguishes controls
that can be enforced in the application now from controls that require Azure,
Entra, and the production data plane.

## Enforced Now

- All JSON request bodies are bounded before parsing.
- Upload descriptors enforce file type, per-file, per-request, and duplicate
  limits.
- Referral create and patch payloads validate enum values, string sizes,
  nested assessments, requirements, extracted fields, and protected fields.
- Referral writes use optimistic version checks and idempotent create keys.
- PostgreSQL referral, assessment, resident-link, decision, requirement,
  document-metadata, revision, and audit adapters are implemented.
- Referral search, filters, facets, and paging are bounded and run server-side.
- Requirement recovery is explicit: status, owner, due date, next action,
  blocker, waiver reason, evidence, and version are stored once and edited from
  the referral data-review surface.
- Database migrations run in order under an advisory lock and reject checksum
  drift. The live smoke test rolls all synthetic writes back.
- Document contracts include preview generation, page count, malware state,
  retention, soft deletion, extraction retry scheduling, and worker leases.
- Mutation routes reject cross-site `Origin`, `Referer`, and Fetch Metadata
  writes while allowing non-browser service calls that omit those headers.
- Responses are private and non-cacheable for identity, referral, profile,
  clinical, upload, and mutation paths.
- Proxy responses set baseline security headers and HSTS on HTTPS.
- API logs contain route templates, generated request IDs, status, duration,
  and safe error labels only. They do not log URLs, query strings, bodies,
  tokens, client names, resident IDs, or upstream response bodies.
- Every route handler is AST-audited against an explicit public, signed-in
  user, or worker policy. Mutation origin checks and viewer write exclusions
  fail the build when a route drifts from that policy.
- Each application process has separate read, mutation, upload, and worker
  concurrency budgets. Saturation returns a bounded `429` with `Retry-After`
  instead of accepting unbounded work.
- GitHub Actions are immutable-SHA pinned. CI runs audit, license, dependency,
  CodeQL, route-policy, deterministic SBOM, and release-evidence gates.
- Azure infrastructure includes PHI-safe scheduled-query alert templates for
  save conflicts, queue age, extraction failures, authorization failures, API
  latency, overload rejections, and clinical-upstream failures.
- Local stores are explicitly development-only. Production fails closed unless
  referral, assessment, and resident-link stores use PostgreSQL.
- Production header auth fails closed without the trusted EasyAuth principal or
  an allowlisted operator email. Entra role claims map only to known Pipeline
  roles; unknown claims do not grant access.

## Still Required Before PHI Production Use

1. Verify the deployed Azure PostgreSQL instance has all checksum-pinned
   migrations, every transactional store is in PostgreSQL mode, and the live
   smoke, fixture, backup/restore, and rollback drills pass against disposable
   targets.
2. Keep direct Entra JWT validation enabled at Pipeline. If Azure Front Door
   Premium/WAF is later approved as a separate cost and network decision, add
   it without enabling legacy trusted identity headers.
3. Configure Entra app roles or groups and map them to the existing Pipeline
   role set. Do not rely on a user-provided email header as identity.
4. Configure distributed rate limits at the trusted edge. The application
   already enforces per-instance concurrency limits; the edge must enforce the
   documented cross-instance request budgets before traffic reaches Next.js.
5. Validate the existing signed Azure Blob upload/download and extraction
   workers against the approved production storage account, malware scanner,
   representative 600-page packets, and evidence-page workflow. Runtime must
   remain fail-closed until those live checks pass.
6. Run the included load and failure checks against the deployed store for 10 concurrent
   users, thousands of referrals, large search result sets, concurrent edits,
   and 600-page packets.
7. Connect the existing alert rules to approved Azure Monitor action groups and
   forward the structured PHI-safe application logs into Application Insights.

## Deployment Gate

Run `npm run check:deployment` for a presence-only inventory, then the database,
security, clinical, platform, build, browser, and load gates. Pipeline is not
production-connected merely because variables exist. It is ready only when the
live database, Blob workers, trusted identity, and clinical API checks all pass.
