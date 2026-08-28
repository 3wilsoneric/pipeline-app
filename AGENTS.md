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
- Run `npm run audit:repository` and `npm run check:refactor-setup` before implementation, `npm run codebase:baseline` before and after an approved slice, and `npm run certify:refactor` before completion.
