# Agent Architecture Direction

## Status

This document records a possible future architecture. It does not authorize an
implementation, change the material referral or assessment workflow, introduce
an agent runtime, or relax any existing human-review, authorization, provenance,
concurrency, audit, or clinical-signoff boundary.

Pipeline should remain deterministic before it is agentic. Agents may assist
with synthesis and ambiguity only after the canonical workflows and proof
obligations they depend on are stable.

## Product shape

Expose one user-facing **Pipeline Copilot** inside the existing referral and
client surfaces. Keep bounded specialists behind that single interface rather
than adding a separate agent product or asking operators to choose among agents.

The initial specialist set may include:

- a packet specialist that explains missing documents, conflicts, and
  low-confidence fields with source evidence;
- an assessment-preparation specialist that drafts interview preparation and
  unresolved questions without diagnosing, completing, or signing an
  assessment;
- an operations specialist that explains assignments, upcoming assessments,
  aging, blockers, and permitted next actions from deterministic projections;
- a later communications specialist that drafts, but cannot address or send,
  governed Meet the Client communication.

Do not begin with user-created freeform agents. A later supervisor-facing
configuration surface may expose approved recipes whose scope, schedule, and
presentation can be customized while their tools and permissions remain fixed
by the application.

## Proposed graph

```text
Referral or client workspace
            |
            v
Pipeline Copilot
            |
            v
Agent gateway
identity | referral scope | budgets | idempotency | audit
            |
            v
Deterministic splitter and risk router
            |
            +----------------+--------------------+
            |                |                    |
            v                v                    v
     Packet specialist  Assessment-prep     Operations specialist
            |            specialist               |
            +----------------+--------------------+
                             |
                             v
                  Deterministic merge and gate
                             |
                 +-----------+-----------+
                 |                       |
                 v                       v
          Read-only result         Proposed field diff
                                         |
                                         v
                                  Explicit human review
                                         |
                                         v
                         Existing route and domain service
                                         |
                                         v
                                 Canonical audit event
```

The manager retains the user interaction and calls specialists as bounded
capabilities. Specialists do not hand control or authority to one another.
Every specialist receives an isolated, referral-scoped input and returns a
strict structured result.

## Loops inside nodes, graph between nodes

Use a graph to define what work exists, which units depend on one another,
which units may run concurrently, and where a rejected unit returns. Use a
bounded correction loop only inside one node:

```text
produce -> check -> correct the failing unit -> check again
```

Before creating an agent node, define a check that can fail programmatically.
Examples include:

- every factual claim references an authorized evidence row;
- the result conforms to the expected schema;
- the output contains no unsupported clinical conclusion;
- every record belongs to the authenticated user's permitted referral scope;
- a proposed patch touches only the fields named in its approved scope;
- deterministic workflow blockers remain unchanged and pass independently.

The absence of an exception, a model's confidence statement, or a second model
agreeing with the first is not a sufficient check.

Return only the failing unit to its producer. A correction request must carry
the unit identity, deterministic verdict, failure reason, supporting evidence,
and exact correction scope. Cap correction attempts; after repeated failure,
stop the node and escalate because the splitter, task definition, evidence, or
policy may be wrong.

## Code nodes remain the default

Use ordinary code for work with one mechanically correct result, including:

- authentication, authorization, and referral scoping;
- workflow status, prerequisites, and transition blockers;
- filtering, ranking, grouping, merging, and deduplication;
- required-field and document-completeness calculations;
- schema validation and optimistic concurrency;
- audit event construction, retry budgets, and idempotency;
- email recipient and attachment policy;
- EHR readiness and export eligibility.

Use a model only when the operation genuinely requires interpretation,
comparison, synthesis, or explanation. The agent layer must call typed domain
tools wrapping existing services and must never access database tables,
storage, or external clinical systems directly.

## Capability and approval lanes

Risk and reversibility determine whether a lane can open. Model confidence may
inform review priority but never grants authority.

### Read lane

Authorized, referral-scoped retrieval and read-only synthesis may execute
without a separate approval. Returned facts must retain their evidence and
truth state.

### Propose lane

An agent may return a structured, field-level diff with evidence, uncertainty,
and a recovery path. Nothing is written until a human reviews the exact diff.
The existing route handler and domain service revalidate authorization,
versions, schema, workflow constraints, and audit data at commit time.

### Closed lane

Agents must not independently:

- sign or complete an assessment;
- record a final admission decision;
- merge client identities or confirm a resident link;
- delete or irreversibly transform a record;
- choose recipients or send external communication;
- submit an EHR handoff;
- waive a clinical or operational requirement;
- rewrite provenance, original packet evidence, or audit history.

These are accountable human actions regardless of confidence. If an agent may
eventually prepare one of them, it can only create an inert proposal that the
existing workflow displays and validates.

## Canonical result contract

Agent-facing tools should reuse `ReferralOperationEnvelope` from
`lib/reliability/referral-operating-model.ts`. It already carries the required
operational contract:

- truth state and bounded confidence;
- exact scope and row count;
- deterministic trace and evidence rows;
- missing data and next permitted action;
- safe recovery behavior;
- artifact metadata and presentation shape.

Do not create a second agent-specific representation of referral truth. Agent
run state should reference canonical record and evidence identifiers and avoid
copying clinical text into a long-lived memory store.

## Initial feature

Start with a read-only **Generate case brief** action in the existing referral
workspace. It returns:

1. a verified referral snapshot;
2. missing or conflicting information;
3. upcoming assessment and unresolved preparation items;
4. source-linked evidence;
5. the next action currently permitted by deterministic workflow policy.

Its internal loop checks evidence coverage, scope, schema, and unsupported
clinical conclusions. It corrects only the failing section and never writes to
the referral. This is the first useful evaluation target and does not change
the operator's material workflow.

## Learning is governed change

Maintain two distinct return paths:

- a short correction path fixes one rejected unit in the current run;
- a long learning path proposes a reusable constraint for future runs.

An accepted result must not automatically rewrite prompts, policies, routing,
or examples. Candidate constraints become active only after aggregation,
supervisor and domain-owner review, versioning, held-out evaluation, release
approval, and a defined rollback path. Preserve the exact prompt, model,
schema, tool, and policy versions used by each evaluated run.

## PHI, document, and observability boundaries

Treat all packet and clinical text as untrusted data. It cannot supply agent
instructions or workflow-control output. Pass only the needed OCR/layout chunks
or evidence rows, use allowlisted structured outputs between nodes, and never
send a complete packet when targeted evidence is sufficient.

Existing PHI-safe logging policy remains authoritative. Agent traces can
contain prompts, model output, tool arguments, and tool results, so no default
external tracing configuration may receive real client data until its storage,
retention, access, redaction, and contractual boundaries are explicitly
approved. Operational telemetry should prefer route templates, bounded outcome
codes, durations, counts, model and policy versions, and opaque run identifiers.

## Entry criteria and rollout

Do not implement the agent graph until its first use case has:

1. a named product and clinical owner;
2. an approved data-flow and PHI boundary;
3. typed tool contracts mapped to existing domain owners;
4. executable pass/fail checks and stopping rules for every node;
5. an approved representative corpus with source-level evidence;
6. hallucination, omission, authorization, prompt-injection, provenance,
   latency, cost, and failure-recovery evaluations;
7. encrypted recording/replay or an approved privacy-preserving substitute;
8. shadow-mode criteria, a one-community canary, rollback ownership, and an
   error budget.

Evaluate the whole path as well as the final answer: splitter decisions, tool
selection, evidence use, correction count, gate verdicts, approval changes,
latency, and recovery behavior. Human acceptance rate is not proof of factual
or clinical correctness.

## Sources and related Pipeline controls

- Hanako, “Loops and Graphs: how to stop babysitting agents and only approve the
  last step,” 23 August 2026:
  <https://x.com/hanakoxbt/status/2091515787366306154>
- OpenAI, “Orchestration and handoffs”:
  <https://developers.openai.com/api/docs/guides/agents/orchestration>
- OpenAI, “Guardrails and human review”:
  <https://developers.openai.com/api/docs/guides/agents/guardrails-approvals>
- `docs/REFERRAL_OPERATING_RELIABILITY_PLAN.md`
- `docs/REFERRAL_PACKET_EXTRACTION_BUILD_SPEC.md`
- `docs/EXTREME_TESTING_PROTOCOL.md`
- `docs/ABUSE_AND_ALERTING.md`
- `docs/ASSESSMENT_SUMMARY_AND_MEET_CLIENT.md`
