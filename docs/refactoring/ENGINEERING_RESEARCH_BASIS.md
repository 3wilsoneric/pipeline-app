# Refactor Engineering Research Basis

Status: supporting rationale only. The registry and evidence matrix remain the machine-checked authority for scope and readiness.

## Why the program uses bounded seams

Martin Fowler's [Branch by Abstraction](https://martinfowler.com/bliki/BranchByAbstraction.html) and [Parallel Change](https://martinfowler.com/bliki/ParallelChange.html) describe gradual replacement through a stable boundary while the system remains releasable. Pipeline applies that idea narrowly: introduce a seam only after current behavior is characterized, keep one authoritative writer, compare replacement paths without double-writing, and remove the old path after acceptance.

This does not make every refactor a strangler migration. A characterized in-place extraction is preferable when no second implementation or rollout boundary is needed.

## Why authorization evidence is executable

The [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) recommends least privilege, deny by default, validation on every request, and unit/integration tests for access-control rules. Pipeline therefore requires executed allow and deny cases plus proof that a denied command created no database, Blob, queue, audit, metric-with-identity, or handoff side effect. Static wrapper-presence checks remain architecture rules, not behavioral proof.

## Why PostgreSQL keeps explicit semantics

PostgreSQL's documentation on [application-level consistency](https://www.postgresql.org/docs/16/applevel-consistency.html), [explicit locking](https://www.postgresql.org/docs/16/explicit-locking.html), and [constraints](https://www.postgresql.org/docs/16/ddl-constraints.html) makes clear that integrity depends on transaction isolation, lock order, retry behavior, and database constraints—not just equivalent return objects. Shared local/PostgreSQL scenarios compare intended domain outcomes, while PostgreSQL-only tests retain transaction, compare-and-swap, constraint, rollback, plan, and contention assertions.

Every mutation is classified before refactoring as one of:

- replay-idempotent: the same mutation identity returns the already-applied result;
- conflict-safe: an optimistic duplicate cannot apply twice but returns a conflict rather than the original result;
- deliberately non-retryable: the caller must obtain new state or explicit operator action.

Those categories are not interchangeable.

## Why audit and provenance are product behavior

The [HHS HIPAA Security Rule summary](https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html) identifies access control, audit controls, authentication, and integrity protection for ePHI. [NIST SP 800-66 Rev. 2](https://csrc.nist.gov/pubs/sp/800/66/r2/final) maps those requirements to cybersecurity controls. Pipeline therefore treats actor attribution, before/after versions, immutable source evidence, extraction provenance, reviewer corrections, and transaction-coupled audit writes as behavior to preserve—not logging details that may drift during cleanup.

## Why test power is measured

Google's published discussion of [mutation testing](https://testing.googleblog.com/2020/08/) explains why coverage alone does not show that assertions detect realistic faults. Pipeline uses a small certified set of seeded critical defects and requires a 100 percent kill rate for that reviewed set. New mutants are selected from actual slice risks rather than generated indiscriminately.

## Why rollout and review are enforced

Microsoft's [safe deployment guidance](https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/safe-deployments) recommends small quality-gated changes, progressive exposure, health models, stop conditions, and recovery. GitHub's documentation on [code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) and [required status checks](https://docs.github.com/en/pull-requests/reference/status-checks) explains how review routing and commit-attached checks become merge controls.

For Pipeline, that means an exact reviewed starting commit, an isolated worktree, independent human review, required checks attached to the candidate commit, explicit rollback ownership, and canary/shadow rollout only when the approved design introduces a replacement path.

## Why recursive review cannot certify a bug-free application

[NIST SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final) frames secure development as practices that reduce vulnerabilities, mitigate undetected defects, and prevent recurrence rather than as a claim that testing eliminates all defects. The [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/) similarly supplies testable security requirements and levels of confidence, not proof of every possible application behavior.

Pipeline therefore decomposes assurance by property. Types, dependency rules, checksums, and database constraints can be mechanical. A finite workflow or authorization matrix can be exhaustive within an owner-approved model. Leslie Lamport's treatment of [safety, liveness, and fairness](https://lamport.azurewebsites.net/tla/safety-liveness.pdf) motivates model checking for the small workflow and retry kernel, but the model still needs an executable conformance bridge to production code and human validation that it represents intended operations.

Extraction quality, browsers, infrastructure, external services, and human workflows remain statistical or environment-dependent. The [CISA secure-by-design guidance](https://www.cisa.gov/sites/default/files/2023-10/Shifting-the-Balance-of-Cybersecurity-Risk-Principles-and-Approaches-for-Secure-by-Design-Software.pdf) emphasizes ownership of customer security outcomes, transparency, and safe defaults. Pipeline applies that through abstention and explicit review, immutable evidence, detection, containment, rollback, and residual-risk ownership rather than a whole-application `bug-free` label.

Repeated passes stop at a reviewed local fixed point: another independent evidence-driven pass finds no material improvement without an offsetting regression. That is a bounded convergence claim for one candidate commit, not mathematical perfection.

## Repository-specific consequence

Research informs the controls; it does not authorize a slice. Human owners still decide intended workflow semantics, retry contracts, identity rules, clinical handoff behavior, corpus governance, and whether an observed oddity is compatibility behavior or a defect.
