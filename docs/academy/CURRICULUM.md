# Pipeline Enterprise Developer Curriculum

## Program shape

The program contains 10 tracks, 36 modules, 144 required activities, more than 100 guided hours, 10 golden journeys, 36 labs, and six competency gates. `lib/academy/academy-curriculum.ts` is the detailed executable syllabus; this document explains how to use it.

The learner starts with basic TypeScript syntax and general engineering concepts. The program ends when the learner can safely navigate, change, review, operate, recover, and teach the system.

## Tracks

| Track | Scope | Exit outcome |
| --- | --- | --- |
| Foundations | Repository map, TypeScript/runtime boundaries, Next.js/React execution, developer toolchain, database foundations | Explain where code runs, which facts are compile-time or runtime, and how to find an owner without guessing. |
| Admissions Product | Operating model, referral creation, pre-assessment, assessment/decision handoff | Explain the real email-to-EHR workflow and the human authority at every stage. |
| Frontend Systems | Shell/navigation, referral workspace, assessment/calendar/profile UI, resilience | Change operator UI without duplicating policy or hiding conflicts and failure. |
| API and Domain | Route contracts, validation/authorization, workflow state, read models/search | Trace request trust and keep domain decisions deterministic. |
| Data and Concurrency | Schema/migrations, stores/transactions, concurrency/idempotency, identity reconciliation, query/retention | Preserve relational, audit, identity, and version truth under scale and partial failure. |
| Documents and AI | Upload/storage, extraction worker, provenance/review, backlog/recovery | Treat raw packets as immutable evidence and extraction as reviewable, retry-safe candidates. |
| Clinical Assessment | Adapter profiles, schema ownership, lifecycle, medications/decision/EHR | Preserve clinical attribution, immutable signatures, correction history, and reviewed handoff. |
| Security and Privacy | Entra/session, authorization/PHI, threats/supply chain | Enforce least privilege and keep sensitive data out of client, telemetry, learning, and tooling surfaces. |
| Reliability and Assurance | Test power, observability, recovery, release | Detect realistic defects, make release decisions, and restore service with evidence. |
| Ownership | Vertical change capstone | Deliver, prove, operate, recover, and teach one bounded production-style change. |

## Required activity loop

Every module contains four activities:

1. **Learn:** build the concept and vocabulary from current source readings.
2. **Trace:** reconstruct execution order, state ownership, trust boundaries, and at least one failure path. Record a source-backed trace.
3. **Lab:** complete an applied scenario with explicit acceptance criteria. Record evidence using synthetic examples only.
4. **Verify:** answer the checkpoint from memory, understand the rejected choices, and revisit the source when the mental model was wrong.

Prerequisites gate completion, not preview. A learner may inspect a later module but cannot record it complete until its required foundations are complete.

## Suggested cadence

This is a multi-month program, not a two-week code tour. A sustainable weekly schedule is:

- Two 75-minute learning and trace sessions.
- One 90- to 150-minute lab session.
- One 30-minute recall, review, or teach-back session.
- One weekly repository-atlas drill using an unfamiliar file or operator behavior.

At four to six hours per week, the guided program takes roughly five to seven months. Existing knowledge and pairing can accelerate it, but written evidence and applied work should not be skipped.

## Competency gates

### Repository navigator

Find the UI, route, domain, persistence, migration, test, and runbook owner of an unfamiliar behavior without guessing.

### End-to-end tracer

Follow values, control, identity, versions, and evidence across browser, Next.js, PostgreSQL, Blob, workers, and external systems.

### Safe contributor

Make a bounded change that preserves validation, authorization, audit, compatibility, concurrency, PHI, and recovery guarantees.

### Enterprise reviewer

Detect duplicated policy, unsafe trust, silent merge, weak assertions, incompatible schema, and unowned failure paths.

### Production operator

Use PHI-safe signals to triage, contain, reconcile, restore, verify, and communicate a production failure.

### System owner and teacher

Design and defend a vertical slice, make the release decision, recover it, and teach another engineer how it works.

## Evaluation

Module completion is necessary but insufficient. A reviewer should sample learner evidence and ask for an unassisted teach-back. The learner should be able to:

1. Trace the normal path without notes.
2. Predict malformed, unauthorized, stale, duplicate, unavailable, and partial outcomes.
3. Identify the authoritative state and human decision owner.
4. Name the security, privacy, audit, concurrency, and recovery boundaries.
5. Identify which tests can detect the feared failure and which cannot.
6. Make or review a bounded change without bypassing domain owners.

The capstone must include intent and non-goals, current behavior characterization, a vertical ownership map, implementation, focused regression, compatibility and migration analysis, observability, release, rollback or forward-fix, and teach-back.

## Maintenance

When source changes, use the repository atlas and reviewed fingerprints to identify affected material. Update the curriculum only after verifying current behavior. Run `npm run academy:certify` before merging Academy changes and as part of the weekly engineering-quality cycle.
