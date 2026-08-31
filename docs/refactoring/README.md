# Refactoring Workspace

Current mode: `setup_only`
Started slices: `0`

This directory prepares a controlled refactor program. It does not authorize implementation work and it is not evidence that a refactor has started.

## Single source of truth

Use these four lifecycle files together:

1. `refactor-slices.json` defines scope, order, ownership, status, invariants, and focused gates.
2. `evidence-matrix.json` records what is proven, partial, missing, blocked, conditional, or not applicable at each lifecycle phase.
3. `performance-budgets.json` defines structural, API, database, queue, and UI regression limits by slice type.
4. `code-quality-policy.json` defines repository, dependency, TypeScript, suppression, and worktree rules.

Do not create a second backlog in prose. The other files here explain how to satisfy these controls.

The machine-checked assurance model is split by purpose:

- `canonical-responsibilities.json` records candidate ownership without forcing one representation across every boundary.
- `architecture-comprehension-probes.json` defines fresh-context questions that expose ambiguous ownership.
- `proof-obligations.json` defines bounded critical properties and their required assurance methods.
- `high-assurance-policy.json` defines the permitted claim, recursive stop rule, adversarial review, and residual-risk limits.

These files contain setup candidates, not human-approved truth. Their relevant entries must be validated before a slice starts, and the result is recorded in a slice-specific assurance record.

## Current readiness

All six slices are intentionally `not_started`. No slice is start-ready yet:

| Slice | Before-start gap |
| --- | --- |
| Referral store | Owner, narrative, approval, frozen behavior, retry contract, local/PostgreSQL parity |
| Assessment store | Owner, narrative, approval, frozen lifecycle/workflow-sync behavior, local/PostgreSQL parity |
| Workflow and handoff | Owner, narrative, approval, database-effect goldens, runtime role matrix, retry contract |
| Extraction | Owner, narrative, approval, packet-level goldens, governed labeled corpus |
| Referral canvas | Owner, narrative, approval, autosave/conflict recovery and identity-link characterization |
| Test structure | Owner, narrative, approval, assertion inventory and independent human review |

Every slice also inherits the global before-start gaps: Node 22 type alignment, a green or explicitly dispositioned complexity ratchet, a risk-ranked exact-start baseline, independent protected review, commit-attached required checks, owner-validated assurance definitions, and a recorded dedicated `codex/refactor-*` worktree. The current file/dependency inventory is generated evidence, not a hand-maintained list.

The checker derives the authoritative state from the JSON files. Update this summary only when the registry or matrix changes.

## Operating documents

- `../REFACTORING_PLAYBOOK.md`: end-to-end protocol and definition of done.
- `CONTROL_PLANE_MAP.md`: sensitive ownership boundaries.
- `ADAPTER_PARITY_CONTRACT.md`: shared local/PostgreSQL behavior without flattening database guarantees.
- `AUTHORIZATION_CHARACTERIZATION_PLAN.md`: runtime allow/deny and no-side-effect proof.
- `COMPATIBILITY_MATRIX.md`: N/N-1 application, schema, callback, and draft compatibility.
- `SHADOW_COMPARISON_CONTRACT.md`: no-write comparison for high-risk replacement paths.
- `OWNERSHIP_AND_BRANCH_PROTECTION.md`: real owner and repository protection requirements.
- `CODE_QUALITY_POLICY.md`: file, module, type, dependency, error, and worktree standards.
- `WORKTREE_RUNBOOK.md`: current worktree disposition and safe start/retirement commands.
- `CLOUD_REFACTOR_RUNBOOK.md`: guarded GitHub/Codex continuation while a developer computer is offline.
- `ENGINEERING_RESEARCH_BASIS.md`: authoritative external rationale behind the local controls; it is not a second backlog.
- `HIGH_ASSURANCE_CONVERGENCE_PROTOCOL.md`: bounded proof classes, recursive iteration, adversarial review, convergence, and residual-risk rules.

## Templates

- `ARCHITECTURE_NARRATIVE_TEMPLATE.md`: owner-authored understanding before approval.
- `DECISION_RECORD_TEMPLATE.md`: in-place versus strangler decision.
- `REFACTOR_SLICE_TEMPLATE.md`: bounded implementation and evidence record.
- `characterization-manifest.example.json`: reproducible, PHI-safe fixture manifest.
- `file-audit-disposition.example.json`: owner-reviewed disposition for every file in an approved slice.
- `slice-assurance-record.example.json`: exact-commit comprehension, proof, iteration, adversarial, recovery, and residual-risk evidence.

## Commands

```bash
# Registry, ownership, evidence, and budget readiness. Safe during setup.
npm run check:refactor-setup

# Evidence details only.
npm run check:refactor-evidence

# Canonical ownership, comprehension, proof-obligation, and convergence readiness.
npm run check:refactor-assurance

# Live file, dependency, TypeScript, and worktree quality state.
npm run check:code-quality

# Per-function complexity ratchet. Must be green or explicitly dispositioned before a slice starts.
npm run complexity:check

# Regenerate the hash-backed every-file and package-lock inventory.
npm run audit:repository

# Refresh the structural report without changing application code.
npm run codebase:baseline

# Full local certification for an approved implementation slice.
npm run certify:refactor

# Validate the cloud controller without invoking Codex.
npm run check:refactor-agent
```

## Starting one slice later

1. Select one slice from `refactor-slices.json`; do not invent a parallel scope.
2. Create a clean dedicated `codex/refactor-*` worktree from the exact reviewed starting commit.
3. Assign a real human owner and backup.
4. Complete and approve the architecture narrative and any decision record.
5. Resolve every global and slice `before_start` evidence item to `satisfied` or approved `not_applicable`.
6. Human-validate the relevant canonical responsibilities, comprehension probes, and proof obligations; complete the pre-change comprehension review and create the slice assurance record.
7. Complete the file audit disposition and record `owner`, `architectureNarrative`, `fileAuditDisposition`, `assuranceRecord`, `allowedChangePaths`, `approvedBy`, `approvedAt`, `worktreePath`, `branch`, and `startingCommit` in the registry.
8. Change registry mode to `active` and only that slice to `in_progress`.
9. Run `npm run audit:repository` and `npm run check:refactor-setup`; both must pass before implementation files move.

`not_applicable` is not an escape hatch. It requires `approvedBy`, `approvedAt`, and an explanation in the evidence item.

## Comparing a later baseline

```bash
npm run codebase:baseline
npm run codebase:baseline:compare -- \
  --before=docs/reliability/refactor-baseline-2026-08-27-setup.json \
  --after=outputs/refactor-baseline/refactor-baseline-YYYY-MM-DD.json
```

Use `--fail-on-regression` for implementation slices. If an approved architectural change must exceed a budget, update the budget and decision record before merging rather than waiving a failed result after the fact.

No number of recursive passes authorizes a `bug-free` or `perfect` claim. Completion means the exact candidate commit satisfies its bounded obligations, has no unresolved critical/high finding, and contains explicit controls for remaining uncertainty.
