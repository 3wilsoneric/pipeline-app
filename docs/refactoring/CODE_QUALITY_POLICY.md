# Code-Level Quality Policy

## Standard

Refactoring is not permission to churn files. Every approved slice must improve dependency direction or comprehension while preserving behavior, tests, operations, and rollback. A smaller file count, lower line count, or newer package version is not independently a quality improvement.

## Repository and worktrees

- Run implementation slices in one dedicated `codex/refactor-*` worktree, never directly on `main`.
- Record the worktree path, branch, and starting commit in the active registry slice before editing implementation code.
- Only one slice may be `in_progress`. Other worktrees may exist, but their unique commits need an explicit merge, archive, or delete decision.
- Do not mix product behavior, dependency upgrades, generated snapshots, schema changes, and structural moves in one refactor commit.
- The active registry slice lists every allowed changed file. Directory entries end in `/`; all other entries are exact paths. Any out-of-scope change fails readiness.
- Generated output, local databases, PHI, credentials, build artifacts, and test reports remain untracked.

## Files and modules

- Every file in scope gets an owner-authored purpose, callers, outputs, side effects, failure behavior, and invariants.
- Every static prompt in the generated inventory receives a confirmed, expected, false-positive, or deferred disposition with evidence; generic bulk dismissal is prohibited.
- Every move or split preserves public exports until all callers migrate; compatibility shims have a deletion condition.
- New modules must have one reason to change and an explicit dependency direction.
- No new runtime or type-only dependency cycles, control-plane duplication, source-string behavior tests, or unexplained dead exports.
- Large files are reduced through characterized vertical seams, never arbitrary line-count splitting.

## Complexity

- `npm run complexity:check` is the per-function TypeScript, JavaScript, and Python complexity gate.
- Existing hotspots are governed by a checked-in ratchet; the baseline records debt but does not approve it.
- A refactor slice that changes a hotspot records the starting and ending complexity, focused behavior evidence, and any remaining coupling or readability risk.
- The baseline is regenerated only after an intentional reduction or approved policy change, never to absorb a regression.
- A lower score is not sufficient evidence of improvement. Public behavior, authorization, transactions, audit events, error semantics, and PHI boundaries must remain intact.

See `docs/refactoring/CYCLOMATIC_COMPLEXITY_POLICY.md` for thresholds, control-plane treatment, and counting semantics.

## Types and errors

- `strict` and `noEmit` remain enabled.
- No `@ts-ignore`, `@ts-nocheck`, or explicit `any` enters application or test code.
- `@ts-expect-error` is allowed only for a deliberate negative type test with a nearby explanation.
- ESLint disables are exact-rule, one-line, justified, and listed in `code-quality-policy.json`.
- External input is parsed and validated at the boundary. Internal types are not used as evidence that network, database, file, or model output is valid.
- Errors retain a typed internal cause while public responses and logs remain bounded and PHI-safe.

## Dependencies

- `package-lock.json` is authoritative and CI uses `npm ci`.
- Every direct dependency must be imported, invoked by a package script/configuration, or documented as framework-discovered.
- Production dependencies require a concrete runtime purpose. Test/build-only packages remain dev dependencies.
- Registry source and integrity are mandatory. Git, file, tarball, or arbitrary URL dependencies require a reviewed decision record.
- Security patches are isolated and expedited. Major upgrades are isolated changes with migration notes, focused tests, bundle/performance comparison, and rollback.
- Do not bulk-update because `npm outdated` reports a newer major.
- Refactor-only changes may not increase the current direct dependency count, locked package locations, multi-version package count, or install-hook allowlist without a reviewed decision record.

## Required evidence

```bash
npm run audit:repository
npm run check:code-quality
npm run complexity:check
npm run check:refactor-setup
npm run certify:refactor
```

The full repository audit hashes and inventories every current non-ignored file and every locked dependency. `check:code-quality` verifies that inventory against the live worktree and fails if an active refactor lacks its dedicated-worktree metadata or carries unresolved code-quality blockers.
