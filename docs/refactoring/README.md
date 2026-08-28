# Refactoring Workspace

Current mode: `setup_only`
Started slices: `0`

This directory prepares a controlled refactor program. It does not authorize implementation work and it is not evidence that a refactor has started.

## Single source of truth

Use these four machine-checked files together:

1. `refactor-slices.json` defines scope, order, ownership, status, invariants, and focused gates.
2. `evidence-matrix.json` records what is proven, partial, missing, blocked, conditional, or not applicable at each lifecycle phase.
3. `performance-budgets.json` defines structural, API, database, queue, and UI regression limits by slice type.
4. `code-quality-policy.json` defines repository, dependency, TypeScript, suppression, and worktree rules.

Do not create a second backlog in prose. The other files here explain how to satisfy these controls.

## Current readiness

All six slices are intentionally `not_started`. No slice is start-ready yet:

| Slice | Before-start gap |
| --- | --- |
| Referral store | Owner, narrative, approval, frozen behavior, local/PostgreSQL parity |
| Assessment store | Owner, narrative, approval, frozen behavior, local/PostgreSQL parity |
| Workflow and handoff | Owner, narrative, approval, database-effect goldens, runtime role matrix |
| Extraction | Owner, narrative, approval, packet-level goldens, governed labeled corpus |
| Referral canvas | Owner, narrative, approval, autosave/conflict recovery characterization |
| Test structure | Owner, narrative, approval, independent human assertion review |

Every slice also inherits the global before-start gap: Node 22 type alignment and a recorded dedicated `codex/refactor-*` worktree. The current file/dependency inventory is generated evidence, not a hand-maintained list.

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

## Templates

- `ARCHITECTURE_NARRATIVE_TEMPLATE.md`: owner-authored understanding before approval.
- `DECISION_RECORD_TEMPLATE.md`: in-place versus strangler decision.
- `REFACTOR_SLICE_TEMPLATE.md`: bounded implementation and evidence record.
- `characterization-manifest.example.json`: reproducible, PHI-safe fixture manifest.
- `file-audit-disposition.example.json`: owner-reviewed disposition for every file in an approved slice.

## Commands

```bash
# Registry, ownership, evidence, and budget readiness. Safe during setup.
npm run check:refactor-setup

# Evidence details only.
npm run check:refactor-evidence

# Live file, dependency, TypeScript, and worktree quality state.
npm run check:code-quality

# Regenerate the hash-backed every-file and package-lock inventory.
npm run audit:repository

# Refresh the structural report without changing application code.
npm run codebase:baseline

# Full local certification for an approved implementation slice.
npm run certify:refactor
```

## Starting one slice later

1. Select one slice from `refactor-slices.json`; do not invent a parallel scope.
2. Create a clean dedicated `codex/refactor-*` worktree from the reviewed starting commit.
3. Assign a real human owner and backup.
4. Complete and approve the architecture narrative and any decision record.
5. Resolve every global and slice `before_start` evidence item to `satisfied` or approved `not_applicable`.
6. Complete the file audit disposition and record `owner`, `architectureNarrative`, `fileAuditDisposition`, `allowedChangePaths`, `approvedBy`, `approvedAt`, `worktreePath`, `branch`, and `startingCommit` in the registry.
7. Change registry mode to `active` and only that slice to `in_progress`.
8. Run `npm run audit:repository` and `npm run check:refactor-setup`; both must pass before implementation files move.

`not_applicable` is not an escape hatch. It requires `approvedBy`, `approvedAt`, and an explanation in the evidence item.

## Comparing a later baseline

```bash
npm run codebase:baseline
npm run codebase:baseline:compare -- \
  --before=docs/reliability/refactor-baseline-2026-08-27-setup.json \
  --after=outputs/refactor-baseline/refactor-baseline-YYYY-MM-DD.json
```

Use `--fail-on-regression` for implementation slices. If an approved architectural change must exceed a budget, update the budget and decision record before merging rather than waiving a failed result after the fact.
