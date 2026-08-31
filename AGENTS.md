<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Refactor safety

Pipeline refactoring is currently setup-only. Read `docs/REFACTORING_PLAYBOOK.md` and `docs/refactoring/CONTROL_PLANE_MAP.md` before structural work.

- Do not begin a broad refactor from a general cleanup request.
- A slice may start only after its human owner completes an architecture narrative, resolves all `before_start` evidence in `docs/refactoring/evidence-matrix.json`, and records explicit approval.
- Active implementation must use the dedicated worktree, branch, and starting commit recorded in the slice registry; never refactor directly on `main`.
- Every file in an active slice must appear in the approved file audit disposition; do not perform opportunistic cleanup outside that reviewed scope.
- Preserve product layout, click paths, workflow behavior, database semantics, audit events, extraction provenance, and PHI boundaries unless a separate behavior change is approved.
- Never rewrite applied migrations. Keep local and PostgreSQL adapters explicit and verify intended parity.
- Before a slice starts, humans must validate its canonical responsibilities, comprehension probes, and proof obligations and create the exact-commit assurance record required by `docs/refactoring/HIGH_ASSURANCE_CONVERGENCE_PROTOCOL.md`.
- Recursive work proceeds one approved responsibility and proof obligation at a time. Agents may challenge evidence but may not approve their own assurance model, adversarial findings, residual risks, or convergence.
- Never describe Pipeline or a refactor slice as bug-free, perfect, or formally verified. State only the bounded properties and exact candidate commit supported by recorded evidence.
- Run `npm run audit:repository` and `npm run check:refactor-setup` before implementation, `npm run codebase:baseline` before and after an approved slice, and `npm run certify:refactor` before completion.
