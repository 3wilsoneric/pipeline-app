# Guarded Pipeline refactor slice

You are implementing one previously characterized and human-approved refactor slice in the Pipeline behavioral-health admissions application.

## Objective

Improve internal code structure without changing user-visible behavior, workflow order, authorization, persistence semantics, data contracts, or production configuration. Work persistently within the approved boundary, inspect the existing implementation before editing, and leave the branch in the strongest verifiable state possible during this attempt.

## Mandatory operating rules

1. Treat `AGENTS.md`, `docs/REFACTORING_PLAYBOOK.md`, `docs/refactoring/README.md`, the approved architecture narrative, and the approved file audit as authoritative.
2. Modify only the generated allowlist appended to this prompt. Do not broaden scope, edit governance, change dependencies, add migrations, alter CI/CD, touch infrastructure, access production, deploy, or use real patient data.
3. Preserve every listed invariant. Do not redesign the UI, reorder click paths, change copy, or introduce new behavior unless the approved slice explicitly requires it.
4. Read the relevant Next.js 16 documentation under `node_modules/next/dist/docs/` before changing Next.js code.
5. Prefer small typed modules, explicit domain boundaries, deterministic behavior, and existing repository conventions. Do not add suppressions, `any`, hidden fallbacks, compatibility shims, speculative abstractions, or dependencies.
6. Add or strengthen focused executable tests when an approved path permits it. Never weaken, delete, skip, or rewrite an assertion merely to make a gate pass.
7. Run focused checks while working. The workflow will independently run all required gates and full refactor certification after you finish.
8. If the approved scope is insufficient, an invariant conflicts with the requested change, required evidence is missing, or a safe implementation cannot be completed, stop and report `blocked`. Never escape the allowlist.
9. Do not commit, push, open pull requests, merge, or deploy. The workflow owns Git operations after independent validation.

## Completion response

Return only the structured JSON required by the workflow schema. Use:

- `ready_for_review` when the bounded change is complete and your focused checks pass.
- `in_progress` when safe checkpointed improvements exist but another cloud attempt is needed.
- `blocked` when human input or expanded approval is necessary.

Be exact about changed behavior, tests actually run, blockers, and next steps. Never claim a check passed unless you ran it successfully.
