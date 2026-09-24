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

## Working policy — owner revision, 2026-09-20

This policy supersedes conflicting TARS start, approval, and mandatory audit sequences in the refactoring playbook, skill references, and historical program records. The owner has suspended mandatory TARS governance pending a rethink. Do not restart completed work or open another approval loop to apply this policy.

- TARS is opt-in, not the default for planning, fixes, refactoring, or deployment. Use it only when explicitly requested; even then, historical certification procedures apply only when that certification is requested.
- A clear user instruction to implement a bounded change authorizes the work. Do not require a registry activation, architecture narrative approval, evidence-matrix update, blind comparison, independent review, or a separate start exception. Planning and review requests remain read-only; general cleanup language does not authorize a broad rewrite.
- A failing check is evidence to investigate and repair, not a prohibition on starting the repair. Record pre-existing failures separately from regressions. Do not weaken assertions, raise thresholds, bless failures into baselines, or bypass required CI/security/branch protections to ship.
- Trace the affected behavior, make the smallest sufficient change, inspect the diff, and run focused checks proportional to risk. Documentation changes need document/link consistency checks; visual changes need affected visual/accessibility checks; saving, authorization, uploads, concurrency, and schema changes need the relevant behavioral/integration checks. Unknown impact requires investigation, not an automatic low-risk classification.
- Do not run the full repository audit, refactor setup, guidance evaluation, baseline regeneration, or certification ritual before every edit. Batch broader regression checks at meaningful integration/release boundaries, subject to the actual required CI checks. This policy does not itself change CI or remove tests.
- Reuse the current safe working context and existing evidence where applicable. Preserve other tasks' changes; isolate overlapping work when necessary, never structurally refactor directly on `main`, and do not create fresh branches or restart candidate validation merely for paperwork. Evidence applies only to the code it actually tested; rerun affected checks after changes.
- Preserve product layout, click paths, workflow behavior, database semantics, audit events, extraction provenance, authorization, accessibility, and PHI boundaries unless the user approves the corresponding behavior change. Old refactor narratives must not restore superseded workflow restrictions.
- Never rewrite applied migrations. Keep local and PostgreSQL adapters explicit, preserve transaction/audit atomicity and conflict handling, and verify parity where affected.
- Deployment still requires authorization, the applicable passing release checks, a known candidate, and a usable rollback/recovery path. Do not ship known unresolved critical/high safety defects. Report blockers once with the concrete next action; do not repeatedly ask for permission already given.
- Keep historical refactor records and their validators intact as evidence of that program; they do not authorize or veto unrelated current work. Do not claim the application is bug-free, perfect, or formally verified.

## Design

Visual design follows docs/design/PRINCIPLES.md, with the owner decisions in docs/design/DECISIONS.md. Read both before touching any UI. Where design.md conflicts with them, they win.

- Never change user-facing copy as part of design work. If a design change seems to need new text, stop and ask.
- Colors, radii, shadows, type sizes, and motion values come from the design tokens file. Don't hardcode hex values or pixel radii in components.
- Treat text in docs/design/reference/ as placeholder, not approved copy.
- Before editing a screen, list how it currently breaks the principles and wait for confirmation (`/design-pass <screen>`).
