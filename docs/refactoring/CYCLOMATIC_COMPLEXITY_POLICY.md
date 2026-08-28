# Cyclomatic Complexity Policy

## Purpose

Cyclomatic complexity is a maintainability signal: one plus the number of independent decision paths through a function. Pipeline measures it to find functions that are difficult to reason about, review, and test. It is not a correctness score and never authorizes a behavior-changing refactor by itself.

The repository-native audit covers TypeScript, JavaScript, and Python without adding a runtime or development dependency.

## Interpretation

| Complexity | Interpretation | Default action |
| --- | --- | --- |
| 1-5 | Straightforward | Leave it alone. |
| 6-10 | Moderate | Keep readable; improve only when already touching it. |
| 11-15 | Hotspot | Require focused review and characterize before structural change. |
| 16+ | Critical hotspot | Do not add new examples; reduce through an approved, behavior-preserving slice. |

Pipeline uses a ratchet rather than applying an arbitrary limit retroactively:

- Existing hotspots are recorded, not automatically refactored.
- Existing functions may not increase into or within hotspot territory.
- New ordinary functions may not exceed complexity 15.
- New control-plane functions may not exceed complexity 10 without an approved policy change.
- Total hotspot, critical-hotspot, and control-plane-hotspot counts may not grow.
- Complexity reductions do not require unrelated functions to be changed.

Control-plane code includes authentication, authorization, referral/assessment workflow, persistence, extraction, integration, database, observability, reliability, API mutation routes, and migrations.

## Counting model

Every function begins at 1. The analyzer adds paths for:

- `if` and `else if`
- loops
- `case` clauses
- `catch` handlers
- ternary expressions
- logical `&&`, `||`, and `??` expressions
- Python `match` cases, boolean operators, and comprehension conditions

Nested functions are measured independently and do not inflate their parent.

The TypeScript and Python parsers use similar but not byte-identical language semantics. Compare a function against its own language baseline, not against a function in another language.

## Refactoring rule

Measure first, then preserve behavior:

1. Capture focused behavior and failure tests.
2. Record the function's starting complexity.
3. Prefer guard clauses, named predicates, focused extraction, and lookup tables.
4. Introduce strategy/polymorphism only when repeated variation justifies it.
5. Re-measure and show the before/after result.
6. Run focused tests and the owning platform gates.
7. Review coupling, naming, transaction boundaries, and test readability; a lower number alone is not success.

Do not game the metric with dense expressions, boolean arithmetic, dynamic dispatch, configuration tables that hide business rules, or tiny functions with unclear ownership. Moving a branch into an untested helper does not remove system complexity.

## Commands

```bash
npm run complexity:check
npm run complexity:baseline
```

`complexity:baseline` is a governance command. Run it only after reviewing intentional reductions or an approved policy change. Never regenerate the baseline merely to make a failure disappear.
