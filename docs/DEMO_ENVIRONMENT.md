# Pipeline Demo Environment

## Purpose

The Demo Environment is the human rehearsal surface for Pipeline. It uses the real
referral, assessment, scheduling, autosave, recovery, permissions, and reporting code
with synthetic records. It is separate from the automated 100-user product demo, which
is a reliability test rather than an interactive training workspace.

The environment supports three jobs:

1. Present the product as one referral-to-decision operating workflow.
2. Give assessors and supervisors unrestricted practice within their assigned demo role.
3. Let product and engineering staff reproduce workflow defects without touching PHI.

## Non-Negotiable Boundary

Do not implement demo as a toggle over production data. Deploy the same application as
a separate environment with its own database and storage boundaries.

| Boundary | Demo requirement |
| --- | --- |
| Application | Separate Vercel project or deployment alias |
| Authentication | Entra JWT authentication; never deployed mock auth |
| Database | Separate PostgreSQL database or cluster/database with no production credentials |
| Blob storage | Separate synthetic-only container if upload testing is enabled |
| Extraction | Mock backend initially; dedicated Azure/Databricks resources only when testing integration |
| EHR | Disabled or wired to an explicit non-production sandbox |
| Data | Synthetic only; no copied production packets, names, identifiers, or notes |

The Demo Center fails closed for synthetic case creation unless both
`PIPELINE_DEMO_MODE=true` and `PIPELINE_DEMO_DATA_ISOLATED=true`. Local development is
treated as isolated only while it uses the local/disconnected stores. A local process with
PostgreSQL configured must explicitly set `PIPELINE_DEMO_DATA_ISOLATED=true`. Production
Pipeline should set neither variable and can expose only `NEXT_PUBLIC_PIPELINE_DEMO_URL`
to link users to the separate deployment.

## Environment Configuration

Demo deployment:

```env
PIPELINE_DEMO_MODE=true
PIPELINE_DEMO_DATA_ISOLATED=true
PIPELINE_DEMO_ENVIRONMENT_LABEL=Pipeline UAT
NEXT_PUBLIC_PIPELINE_DEMO_MODE=true

PIPELINE_AUTH_MODE=entra_jwt
NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED=true
PIPELINE_REFERRAL_STORE_MODE=postgres
PIPELINE_ASSESSMENT_STORE_MODE=postgres
PIPELINE_DATABASE_MODE=postgres
DATABASE_URL=<DEMO-ONLY-POSTGRES-URL>

PIPELINE_EXTRACTION_BACKEND=mock
PIPELINE_ALLOW_PRODUCTION_MOCK_EXTRACTION=true
```

Main production deployment:

```env
NEXT_PUBLIC_PIPELINE_DEMO_URL=https://pipeline-demo.example.org
PIPELINE_DEMO_MODE=false
PIPELINE_DEMO_DATA_ISOLATED=false
NEXT_PUBLIC_PIPELINE_DEMO_MODE=false
```

Use a dedicated Entra app registration or demo-only app-role assignment. Test users who
need the complete workflow should receive the demo `admin` or `assessment_coordinator`
role. Assessors should also test the narrower `reviewer` role, and executives should test
`viewer`. Training does not elevate roles.

## Product Surfaces

- `/training` contains a Demo tab and links to the configured environment.
- `/training/demo` is the Demo Center and is unavailable unless demo mode is enabled.
- Walkthrough teaches five assessment steps and opens the matching product screens.
- Practice Cases creates fresh synthetic referral and assessment records through the real APIs.
- `new-intake` opens an uncommitted referral draft.
- `assessment-preparation` creates an assigned, unscheduled assessment.
- `assessment-interview` creates, schedules, and starts a blank assessment.
- `assessment-complex` starts with conflicting synthetic source statements for language review.
- A persistent banner remains visible after leaving the Demo Center.

Fresh-copy reset is intentional: each attempt receives a new governed referral and audit
history. Existing copies remain useful for reload, recovery, concurrency, reassignment, and
supervisor review tests. Environment-wide destructive cleanup should be an operator-owned,
audited database procedure, not a browser button.

## Two-Week Readiness Plan

### Days 1-2: Environment

- Provision the dedicated deployment, PostgreSQL database, and optional Blob container.
- Apply all migrations and configure Entra roles.
- Verify the demo banner, Demo Center guard, health checks, and no production credentials.

### Days 3-5: Workflow Review

- Run all four synthetic scenarios with an intake coordinator and two assessors.
- Record every unclear label, duplicate action, missing stop condition, and dead end.
- Test schedule, Zoom, start, every questionnaire section, conditional fields, autosave,
  reload recovery, conflict handling, sign blockers, and supervisor access.
- Finalize the assessment workflow before expanding tutorial copy.

### Days 6-8: Supervisor and Permission Review

- Run the complex-history case with supervisors and calibrate field-level guidance.
- Rehearse admin, coordinator, assessor, and viewer access separately.
- Test simultaneous edits, reassignment, stale versions, abandoned drafts, and recovery.

### Days 9-10: Release Rehearsal

- Run `npm run demo:certify`, `npm run test:e2e:training`, and the platform readiness bundle.
- Run the 100-user automated product demo against an isolated test environment.
- Triage every browser error, failed request, overflow, inaccessible control, and ambiguous state.
- Freeze workflow changes except release-blocking fixes, repeat UAT, and capture sign-off.

## Release Evidence

The demo is ready when a new operator can complete intake through active assessment using
only the product and its guide; a supervisor can explain every stop condition; all roles
enforce their boundaries; reload and concurrency do not lose work; and no demo action can
reach production data, storage, extraction, or EHR services.
