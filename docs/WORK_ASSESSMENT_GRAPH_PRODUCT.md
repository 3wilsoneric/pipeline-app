# Work Assessment Graph

## Product promise

The first killer application is a live map of how referral work actually moves: what is complete, what is blocked, what evidence supports each state, who owns the next action, and which past work pattern is most similar. It should reduce hunting, duplicate effort, and silent stalls without turning a statistical model into an admission decision-maker.

The embedded experience belongs inside the existing referral and assessment workspace. The default view answers three questions: **Where is this work now? What is blocking it? What should the operator inspect next?** Supervisors get the same model aggregated across their queue.

## Canonical graph

The graph is a projection of existing source-of-truth records, never a parallel workflow database.

- Nodes: referral, assessment, document, reviewed field, work item, staff role, workflow event, and community.
- Edges: owns, assigned to, supplied by, reviewed in, advanced by, blocked by, and derived from.
- Every derived node and edge carries source record, source event, observed time, transformation version, and freshness.
- Free-text notes, document bodies, direct identifiers, and clinical details are excluded from the retrieval index by default.
- Admission approval and denial remain explicit human actions in the existing decision workflow.

## Vector baseline

Start with a deterministic five-dimension work-state vector: intake completeness, document readiness, assessment progress, queue urgency, and collision pressure. This is explainable, cheap, reproducible, and sufficient to validate whether similar work states are useful before adding embeddings.

An embedding provider is justified only when a held-out evaluation proves that the deterministic baseline cannot retrieve the right prior work. Any later semantic index must use de-identified, minimum-necessary inputs and retain links back to evidence.

## Evaluation loop

Freeze representative scenarios for ready-for-decision, records-blocked, active-assessment, reassignment, conflicting edits, reopen-after-decision, and stale-upstream data. For each version:

1. Project the graph twice and require byte-for-byte determinism.
2. Assert provenance on every derived edge.
3. Score retrieval against held-out workflow archetypes.
4. Prove that no automatic admission decision is emitted.
5. Compare operator time, missed blockers, duplicate work, and false urgency against the current workspace.

The first implementation slice is a read-only projection and evaluation harness using synthetic fixtures. It changes no production UI, workflow, database, or vendor cost.
