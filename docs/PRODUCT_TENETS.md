# Pipeline Product Tenets

This is the durable product reference for Pipeline. New workflow, data-model,
and interface decisions should be checked against these tenants before they
are added to the application.

## Product North Star

Pipeline is a referral and assessment operations system whose primary job is
to make data capture complete, assessor work actionable, assessor performance
understandable, and supervisory state visible at all times.

The application is intentionally small and operational. It is not a generic
document repository, a chat-first product, or a kanban board that merely moves
cards around.

## Four First-Class Tenants

### 1. Data capture and completion

Pipeline makes it obvious what information has been collected, what is still
missing, what came from a source document, and what needs human review.

- A canonical client profile owns identity and long-lived client data.
- A referral packet owns the intake episode and its source documents.
- Assessment answers, admission decisions, and follow-up requirements remain
  distinct records linked to the referral.
- Every important field has a visible state: present, missing, conflicting,
  stale, or awaiting review.
- Extracted values preserve source evidence and review status. Extraction never
  silently overwrites a human value.
- Progress is derived from field and requirement truth. Percentages are never
  hand-entered as a second source of truth.
- Each packet ends with a plain data review surface showing what is complete
  and what is not.

### 2. Assessor work execution

An assessor should be able to open the application and immediately know what
needs attention next.

- The worklist is organized around actionable referrals and requirements.
- Every blocker has an owner, due date, and next action whenever those values
  are known.
- Pre, Assessment, and Post are the primary workflow phases.
- Requirements such as a TB result or signed agreement are independent tasks;
  they can arrive later without creating a duplicate referral or corrupting the
  phase.
- Stage transitions are constrained by prerequisites and explain how to
  recover when a prerequisite is missing.
- Editing an existing referral is a normal workflow, with version checks and
  an audit event rather than a hidden overwrite.
- Search, community, month, stage, owner, priority, and tag paths must remain
  available as the record count grows.

### 3. Assessor performance overview

The system should help an assessor manage their work and help a lead understand
capacity without turning the product into a surveillance dashboard.

- Show assigned workload, due soon work, stale work, unassigned work, and
  blocked work.
- Show throughput and cycle-time measures only from durable events and clear
  definitions.
- Distinguish volume from completion quality. A high count is not success if
  required data is missing or decisions are delayed.
- Keep the view lightweight: a few useful signals, not a wall of charts.
- Make the underlying referrals and requirements one click away from every
  summary.

### 4. Supervisor operational understanding

A supervisor should be able to answer where referrals are, what is stuck, who
owns the work, and whether the data is trustworthy without opening every
client.

- Show active volume by phase, outcome, community, month, and owner.
- Surface aging, due dates, missing owners, missing packets, incomplete
  assessments, missing decisions, and unresolved requirements.
- Make queue health and data health visible separately.
- Identify stale, conflicting, or synthetic data instead of presenting it as
  live truth.
- Preserve a traceable path from an overview number to the client, referral,
  field, document, or audit event that supports it.
- Keep PHI out of logs and keep clinical integrations server-only.

## Required Operating Views

The same underlying records should support four focused views:

| View | Primary question | Required signals |
| --- | --- | --- |
| Client/referral | What is true and what is missing for this person? | identity, packet, assessment, decision, requirements, evidence, completeness |
| Assessor worklist | What do I need to do next? | owner, next action, due date, blocker, stage, priority |
| Assessor overview | How is assigned work moving? | active load, aging, throughput, cycle time, incomplete data |
| Supervisor overview | Where is the operation at risk? | volume, phase, owner load, stale work, blockers, data quality, outcomes |

These are views over shared records. They must not create parallel status,
profile, owner, due date, or completion stores.

## Data and Workflow Rules

- Client identity is canonical and stable across referral episodes.
- Every packet, assessment, decision, requirement, and clinical update is
  traceable to both `client_id` and its source referral or system.
- Accepted and declined are outcomes, not duplicate work queues.
- No-admission decisions require a reason.
- A late document is a requirement update, not a new referral.
- Missing, stale, conflicting, and unassigned data are visible states.
- Critical actions are reversible, confirmed, or represented in the audit log.
- Runtime clinical data is live-only or explicitly unavailable. Sanitized
  fixtures are test-only and never a fallback for production.
- Slow work such as extraction, exports, and reports is isolated from the main
  screen and has a visible status.

## Definition Of Done For New Features

A workflow feature is not complete until it answers:

1. What canonical record does this change?
2. Who owns the next action and where is the due date represented?
3. How does a user see missing, stale, conflicting, or unreviewed data?
4. What prerequisite prevents an invalid transition?
5. What audit event or recovery path exists for a critical action?
6. How does the change appear in the client, assessor, and supervisor views?
7. Can the behavior be tested as a user journey with realistic edge cases?
8. Does the change preserve server-only PHI and fail-closed live-data rules?

## Current Implementation Mapping

The current app already has useful foundations:

- Packet canvas data review shows field and document completeness.
- Derived progress exposes next action and blockers.
- The operations view exposes action queue, assessor load, funnel position, and
  data-quality gaps.
- Client profile routes establish the intended profile scope.
- Saved referral records can now build a canonical local profile read model;
  this remains development-only until an external transactional store is
  configured.
- Transition guardrails reject invalid moves with named prerequisites.

The current implementation includes durable PostgreSQL adapters, versioned
requirements and decisions, reviewed resident links, document processing,
audit events, section-scoped concurrency, and canonical supervisor exceptions.
Production readiness still depends on external Azure/Entra/Alamo/Databricks
configuration, a representative packet pilot, approved alert destinations,
and live validation of operational and extraction-quality thresholds.

## Priority When Tradeoffs Appear

1. Trustworthy data and clear provenance.
2. An assessor's next actionable task.
3. Supervisor visibility into risk and capacity.
4. Recoverability, auditability, and permissions.
5. Speed and visual polish.

When a proposed feature does not improve one of the first four priorities, it
should not add complexity to the core workflow.
