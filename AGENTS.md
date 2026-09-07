<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Implementation economy

Understand the requested behavior and trace the real flow before proposing code. Then stop at the first option that fully satisfies the behavior, safety, and evidence requirements:

1. Make no code change when the capability already exists or the request does not require one.
2. Reuse the repository's canonical owner, helper, type, component, or established pattern.
3. Use the standard library or a native browser, framework, database, or platform capability.
4. Use an already-installed dependency when it is the smallest correct owner.
5. Only then add the minimum new implementation and focused executable evidence required by its risk.

Fix shared root causes at their narrowest canonical owner rather than patching each caller. Prefer safe deletion and consolidation over parallel implementations. Do not add speculative abstractions, dependencies, configuration, compatibility layers, or future-facing scaffolding. The smallest diff wins only after it preserves current behavior, trust-boundary validation, error handling, security, accessibility, data integrity, recovery, and the applicable proof obligations. Record any deliberate simplification with its known ceiling and a concrete trigger for revisiting it; never leave an anonymous "later" shortcut.

## Refactor safety

Pipeline refactoring is currently setup-only. Read `docs/REFACTORING_PLAYBOOK.md`, `docs/refactoring/CONTROL_PLANE_MAP.md`, and `docs/refactoring/REFACTOR_GUIDANCE_EVALUATION_PROTOCOL.md` before structural work.

- Do not begin a broad refactor from a general cleanup request.
- A slice may start only after its human owner approves an architecture narrative, resolves all applicable `before_start` evidence in `docs/refactoring/evidence-matrix.json`, and records explicit approval.
- Active implementation must use the dedicated worktree, branch, and starting commit recorded in the slice registry; never refactor directly on `main`.
- Every file in an active slice must appear in the approved file audit disposition; do not perform opportunistic cleanup outside that reviewed scope.
- Preserve product layout, click paths, workflow behavior, database semantics, audit events, extraction provenance, and PHI boundaries unless a separate behavior change is approved.
- Never rewrite applied migrations. Keep local and PostgreSQL adapters explicit and verify intended parity.
- The registry selects either the standard lane or `owner_fast_lane`. The standard lane requires independent validation of canonical responsibilities, comprehension probes, proof obligations, and guidance evaluation. In `owner_fast_lane`, the named owner may authorize machine-traced definitions and mark independent review, blind guidance comparison, and private holdouts advisory; record that authorization in `docs/refactoring/owner-fast-lane.json` and the exact-commit assurance record.
- The fast lane never waives machine gates, exact allowed paths, a clean dedicated worktree, the exact starting commit, behavior preservation, data integrity, rollback or recovery evidence, or the prohibition on unresolved critical/high findings. Any such failure blocks implementation, merge, and deployment.
- Treat changes to the refactor instructions and controls as hypotheses. Keep the guidance evaluation harness executable in both lanes; only the standard lane makes an adopted blind comparison a start gate.
- Recursive work proceeds one owner-approved responsibility and proof obligation at a time. Agents may challenge evidence but only the named owner can authorize the fast lane, accept bounded residual risk, or declare convergence.
- Never describe Pipeline or a refactor slice as bug-free, perfect, or formally verified. State only the bounded properties and exact candidate commit supported by recorded evidence.
- Run `npm run audit:repository`, `npm run check:refactor-guidance`, and `npm run check:refactor-setup` before implementation, `npm run codebase:baseline` before and after an approved slice, and `npm run certify:refactor` before completion.
