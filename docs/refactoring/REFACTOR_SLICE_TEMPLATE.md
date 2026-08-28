# Refactor Slice: [Name]

Registry ID: [docs/refactoring/refactor-slices.json]

Owner: [human]

Backup owner: [human]

Status: proposed | characterized | approved | in_progress | soaking | complete

Evidence matrix entry: [docs/refactoring/evidence-matrix.json#item]

Performance profile: [docs/refactoring/performance-budgets.json#profile]

## Purpose

[One bounded structural outcome. No unrelated cleanup.]

## Non-goals

- No product redesign.
- No hidden behavior or schema change.
- [Slice-specific exclusions.]

## Current behavior to preserve

- [Observable behavior linked to a characterization test.]

## Intended structural change

- Files created/moved:
- Dependency direction before:
- Dependency direction after:
- Old path deletion criterion:
- Exact allowed change paths:

## Invariants and evidence

| Invariant | Characterization test | Focused gate | Result |
| --- | --- | --- | --- |
| | | | |

Before-start evidence status: [all satisfied or approved not_applicable]

## Risk review

- Authorization:
- Audit/idempotency:
- PHI/logging:
- PostgreSQL/Blob consistency:
- Concurrency:
- Extraction provenance:
- UI/accessibility/visual behavior:

## Baseline

- Before report:
- After report:
- Comparison command/output:
- Performance profile result:
- Structural budget result:

## Rollback

- Revert boundary:
- Data rollback required: yes/no
- Feature/shadow flag:
- Recovery verification:

## Human explain-back

[Owner-authored explanation without using the implementation agent’s summary.]

Approved to start by: [name/date]
