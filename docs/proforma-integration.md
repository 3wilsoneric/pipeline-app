# Pipeline, ProForma and Ally

Pipeline owns operational records and authorization. ProForma owns human guidance
and reviewed publications. Ally consumes both through explicit contracts; it does
not gain access from a role name or an entry in the catalog.

## Definitions

`node scripts/export-proforma-catalog.mjs --ref <commit> --output content/proforma/pipeline-catalog.v1.json`

The exporter reads a committed tree, not working files or databases. It exports
all canonical assessment fields and interview questions (options, requiredness,
conditional visibility and retained legacy answers), exported source types, API
handlers, file hashes and inferred domain groupings. It stages only the six pure
definition modules needed to evaluate the canonical form. ProForma imports the
JSON artifact from a pinned commit and never imports Pipeline runtime code.

The catalog describes implementation. It is not approved clinical policy, a live
schema observation, a deployed feature list, or a permission/capability grant.
Path-based domain groupings are inferred and require review. Migration files are
indexed as provenance; their statements are not represented as an observed live
database schema. Route re-exports are an explicit coverage exclusion.

## Current case context

`GET /api/assessments/{assessmentId}?representation=context`

This representation uses the existing assessment GET's sign-in, store readiness
and referral access checks. Ordinary GET responses remain unchanged. The response
is `pipeline.assessment-context` version 1, private/no-store, with:

- The exact current assessment, including extraction provenance, unmapped fields,
  schedule, signatures, revisions, addenda and retained audit events.
- Every defined field and its exact answer, question definition, current
  applicability, requiredness, source pointer and record version.
- A hash of the current question definitions. This does not establish which
  historical questionnaire version was used when an old answer was recorded.
- Links to the owning APIs for workflow requirements/decisions/reviews, activity,
  other assessments, packet evidence, contacts and notes. Every follow-up read
  must independently authorize the caller. Those links do not preload data.
- Explicit partial-history coverage. Audit events naming changed fields do not
  prove prior values, question-asked time, field authorship or receipt acceptance.

Hidden retained answers remain evidence; visibility is not an instruction to
delete them. Null, absent, empty, zero, unknown and unable-to-assess remain
distinct. Pending extraction remains pending. A record update timestamp never
becomes a fabricated per-field timestamp. Responses over 1 MiB fail with 413
instead of silently dropping evidence. Consumers can use the ordinary source API.

Ally should request this representation through the user's existing authorized
Pipeline transport, preserve its source/version references, and resolve published
ProForma guidance separately at the applicable version. This change adds no
service credentials, agent activation, new grants, outbound communication or
clinical inference. Cross-case analysis/training is not authorized by a case read.

## Refresh and verification

After a source change, regenerate the artifact from the new committed source,
review the diff, commit it and refresh ProForma's pinned import. ProForma's graph
and maintenance loop compare linked definitions; source changes propose review
and never silently rewrite approved guidance. No scheduled importer is enabled.

Run `node --test scripts/assessment-context.test.mjs scripts/export-proforma-catalog.test.mjs`,
TypeScript, lint and the normal build. Fixtures are fictional and no operational
assessment is read. Live deployment and delegated Ally activation remain separate.
