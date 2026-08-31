# Pipeline High-Assurance Convergence Protocol

Status: setup-only control. This protocol does not authorize a slice or certify that Pipeline is bug-free.

## Target claim

Pipeline may claim only that a named candidate commit satisfied the reviewed proof obligations, executable gates, adversarial reviews, and residual-risk controls recorded for that slice. It must never claim that the whole application is perfect, bug-free, safe for every environment, or formally verified unless each bounded property and the model-to-code relationship actually has that evidence.

The practical objective is:

> No unresolved critical or high-severity finding in the approved slice; mechanically enforced critical invariants; bounded uncertainty; independent challenge; and detection, containment, audit, recovery, and human control for what cannot be proven.

## Assurance classes

Use the strongest applicable class for each obligation. Do not substitute a weaker class merely because it is easier to automate.

1. **Mechanical invariant**: types, import boundaries, checksums, database constraints, schema validation, and immutable-artifact rules.
2. **Exhaustive finite behavior**: every state transition, role/resource decision, or finite retry-state combination in a declared model.
3. **Model checked**: safety and liveness properties explored over a bounded formal state model, with an executable conformance bridge back to implementation behavior.
4. **Property and stateful fuzz tested**: generated sequences test invariants, shrinking failures to a replayable seed.
5. **Mutation tested**: reviewed realistic defects must be killed by behavior assertions rather than source-shape checks.
6. **Integration and concurrency tested**: real PostgreSQL transactions, constraints, lock ordering, contention, rollback, Blob, queue, and browser behavior.
7. **Statistically evaluated with human control**: extraction quality and ambiguous identity decisions use a governed representative corpus, declared error bounds, abstention thresholds, provenance, and mandatory review.
8. **Operationally observed and recoverable**: health signals, stop conditions, rollback, restore, reconciliation, and aggregate PHI-safe evidence bound uncertainty after release.

Passing one class does not imply another. A model can be correct while its implementation diverges; a test suite can pass while its specification is wrong; a statistically strong extractor can still be wrong for an individual packet.

## Pipeline proof boundary

The machine-readable obligations in `proof-obligations.json` cover the application-specific critical kernel:

- referral optimistic concurrency, retry outcomes, and transaction-coupled audit;
- signed assessment immutability, append-only addenda, provenance, and workflow synchronization;
- authorized sequential workflow decisions and EHR handoff;
- immutable packet bytes, lease/retry behavior, provenance, and worker write boundaries;
- autosave/conflict recovery and explicit human-reviewed identity linking;
- preservation of behavior assertions and seeded-defect detection while tests are reorganized.

The obligation set is a draft until the human owner validates its meaning against code and operations. Missing obligations are a blocker, not evidence that the omitted risk is unimportant.

## Recursive iteration loop

Recursion operates on one responsibility, not on every line:

1. Select one approved proof obligation and one responsibility inside the active slice.
2. Record the current contract, callers, side effects, failures, and executable characterization.
3. Propose the smallest structural change. Multiple candidates are allowed for a pure, well-characterized seam; do not create competing live writers.
4. Run the focused obligation evidence, inspect the diff, and compare structural and performance baselines.
5. Have a context-separated critic try to demonstrate behavior loss, duplicate ownership, needless abstraction, or weakened evidence.
6. The human owner accepts, rejects, or reverts the iteration and records every tradeoff.
7. Continue only with the next approved responsibility. Do not expand scope because a nearby cleanup looks attractive.

An iteration is rejected when correctness evidence weakens, a critical invariant becomes less local or less enforceable, the change creates an unexplained abstraction, the changed files exceed the approved audit, or an adverse metric lacks an owner-approved reason.

## Comprehension benchmark

`architecture-comprehension-probes.json` tests whether a fresh reviewer can identify the correct owner, entry point, validation, authorization, persistence, audit/provenance effect, failure behavior, and executable gate without relying on the implementation agent's conversation.

Run it before implementation and again on the candidate commit. The reviewer must cite code and executed evidence. Merely copying `canonical-responsibilities.json` is not a passing explanation. A human evaluator records whether the answer is correct, incomplete, or reveals genuine architectural ambiguity.

## Adversarial review

At least two context-separated read-only passes inspect the same candidate commit. Their mandate is: assume the refactor made Pipeline worse and find evidence.

Each pass challenges:

- hidden behavior or click-path changes;
- authorization bypass or denied-command side effects;
- lost transaction/audit coupling or actor attribution;
- changed replay, conflict, ordering, or retry behavior;
- provenance loss or unsafe identity inference;
- local/PostgreSQL divergence and migration-history mutation;
- new ownership duplication, cycles, compatibility sediment, or unnecessary layers;
- tests weakened, rewritten to the implementation, or replaced by source-string checks;
- query, contention, capacity, browser, accessibility, and recovery regressions;
- PHI in logs, metrics, fixtures, prompts, artifacts, or review output.

Agent critics may find problems but do not approve their own work. Every finding receives evidence and a human disposition. Critical and high findings cannot be accepted as residual merely to finish a slice.

## Convergence and stop rule

A slice may converge only on one exact candidate commit when:

- all applicable proof obligations are verified and trace to implementation plus evidence;
- every required focused and full gate is attached to that commit;
- two consecutive context-separated adversarial passes produce no unresolved critical or high finding and no material simplification that preserves or improves all affected invariants;
- the post-change comprehension review is at least as accurate as the pre-change review;
- structural, performance, query, contention, browser, and extraction budgets pass or have an approved decision recorded before implementation;
- rollback and recovery are exercised at the appropriate boundary;
- all remaining medium/low uncertainties have an owner, detection signal, containment, recovery, and human acceptance;
- the old implementation is removed or has a dated, owned exit condition.

Additional passes stop when they yield only stylistic alternatives or would create churn without improving a proof obligation, responsibility boundary, test power, failure containment, or comprehension result. Convergence is a local fixed point under the reviewed evidence, not proof of whole-application correctness.

## Residual risk and production reality

For extraction, browser/platform behavior, external services, infrastructure, and human workflow, exhaustive correctness is not available. These paths require representative evaluation, safe defaults, abstention or explicit confirmation, observability, bounded retries, idempotent recovery where intended, reconciliation, and rollback.

No agent may mark a residual risk accepted. The named human owner records why it is tolerable, how it will be detected, what contains it, how to recover, and when it must be revisited.

## Evidence record

Each active slice references a real record shaped like `slice-assurance-record.example.json`. The record binds the architecture narrative, comprehension reviews, approved obligations, iterations, adversarial findings, gate results, baselines, recovery evidence, and residual-risk acceptance to exact commits.

`npm run check:refactor-assurance` validates structure and lifecycle requirements. It does not decide whether a human explanation is true.
