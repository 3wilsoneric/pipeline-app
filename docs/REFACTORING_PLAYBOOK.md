# Pipeline Refactoring Playbook

## Purpose

This is the repository-specific companion to the AI-generated-code refactoring syllabus. The goal is to reduce structural risk without redesigning the product, changing the admissions workflow, weakening auditability, or rewriting working code merely to make it look cleaner.

Pipeline is not a normal CRUD application. A safe refactor must preserve referral and assessment state, field provenance, packet bytes, authorization, audit history, human approval, optimistic concurrency, and the admitted-client handoff. A green typecheck is not enough.

## Non-negotiable constraints

- No visual redesign or click-path reorganization during structural refactors. UI changes require separate acceptance criteria and visual review.
- No behavior changes hidden inside a move, rename, split, or deduplication pull request.
- Historical SQL migrations are append-only and checksum-pinned. Never edit an applied migration to support a refactor.
- Production transactional state remains PostgreSQL-backed. Local JSON adapters remain development and isolated-test adapters only.
- Original packet bytes remain immutable. Extraction improvements create new derivatives and provenance; they never overwrite source evidence.
- Real PHI never enters Git, screenshots, test output, snapshots, prompts, or baseline artifacts. Use synthetic or governed de-identified fixtures.
- Next.js framework changes begin by reading the relevant local documentation under `node_modules/next/dist/docs/`.
- Control-plane logic has one owner. Authorization, state transitions, audit writes, retention, identity matching, idempotency, and EHR handoff may not be duplicated.

## What the syllabus misses for this repository

### Test power, not test volume

Pipeline has broad assurance tooling, but some checks inspect source text with `source.includes(...)`. Those checks are useful for architecture-presence rules, such as requiring an authentication wrapper, but they do not prove runtime behavior. During refactoring:

- Keep source-string checks only for static architecture constraints.
- Protect state, authorization, retries, audit events, and error mapping with executable tests.
- Seed realistic defects periodically and require the safety suite to kill them.
- Treat a test that cannot fail under a plausible defect as documentation, not assurance.

### Adapter parity

The local JSON and PostgreSQL implementations must express the same domain behavior even though only PostgreSQL is production-capable. Every extracted repository interface needs a parity suite covering:

- Create, read, update, trash, restore, and terminal-state behavior.
- Optimistic version and section-version conflicts.
- Idempotency keys and retry results.
- Audit events and actor attribution.
- Ordering, filtering, date boundaries, and pagination.
- Failure behavior, not only successful return values.

Do not force transactional PostgreSQL behavior into a least-common-denominator interface. Keep transactions, locks, outbox writes, and compare-and-swap operations explicit in the PostgreSQL adapter.

### Provenance is part of extraction output

Extraction characterization must compare more than field values. Freeze and diff:

- Canonical value and all candidates.
- Confidence and threshold decision.
- Source document, page, and bounding box.
- OCR/model route and model version.
- Review status, correction history, and reviewer attribution.
- Database effects, emitted job events, retry/dead-letter state, and stale-callback rejection.

### Human approval is a subsystem

Refactoring cannot reduce the reviewer to a boolean. Preserve assignment, queue position, evidence visibility, conflict presentation, reviewer action, timestamps, and audit events. Later quality measurement should include seeded known-bad extractions and reviewer catch rate using governed, non-PHI test packets.

### Observability contracts must remain stable and PHI-safe

Before moving route or worker code, snapshot metric names, status classes, bounded dimensions, and alert semantics. Do not add referral IDs, names, document IDs, query strings, extracted values, or upstream response bodies to logs to make a refactor easier to debug.

## Baseline command

Run:

```bash
npm run codebase:baseline
```

The command writes JSON and Markdown under `outputs/refactor-baseline/` and measures:

- Source size.
- AST complexity proxy.
- 90-day Git churn.
- Cross-file normalized duplication.
- Local import cycles, including type-only dependency cycles.
- Conservative dead-export candidates.
- Static source-string contract count.
- Overlap across independent hotspot rankings.

For a committed milestone snapshot:

```bash
npm run codebase:baseline -- --out-dir=docs/reliability --label=YYYY-MM-DD
```

The numbers rank investigation order; they are not defect counts. Do not delete a dead-export candidate or consolidate a duplicate until its dynamic/framework use and behavior are understood.

The broad baseline's AST proxy ranks files. The separate per-function ratchet is the enforcement layer:

```bash
npm run complexity:check
```

Its reviewed baseline is `docs/reliability/cyclomatic-complexity-baseline.json`. Existing hotspots are debt, not permission to add more. Regenerate it with `npm run complexity:baseline` only after reviewing an intentional reduction or approving a documented policy change. Every hotspot refactor records a before/after table and focused behavior evidence as defined in `docs/refactoring/CYCLOMATIC_COMPLEXITY_POLICY.md`.

The setup-complete comparison point is `docs/reliability/refactor-baseline-2026-08-27-setup.json`. Compare a later report with:

```bash
npm run codebase:baseline:compare -- \
  --before=docs/reliability/refactor-baseline-2026-08-27-setup.json \
  --after=outputs/refactor-baseline/refactor-baseline-YYYY-MM-DD.json
```

Before and after a bounded refactor, run the combined local certification:

```bash
npm run certify:refactor
```

This regenerates the baseline, runs the fast platform gate and seeded-defect effectiveness suite, and builds the production artifact. Storage and UI changes still require their focused PostgreSQL or Playwright gates described below.

## Preparation and implementation sequence

The planned slices and their current `not_started` state live in `docs/refactoring/refactor-slices.json`. Scope and order come from that registry, evidence state comes from `docs/refactoring/evidence-matrix.json`, and regression limits come from `docs/refactoring/performance-budgets.json`. Run `npm run check:refactor-setup` to validate all three before implementation.

### 1. Freeze the operating baseline

Run the refactor baseline, `npm run complexity:check`, `npm run check:platform:fast`, `npm run certify:test-effectiveness`, and `npm run build`. Record current browser screenshots and performance budgets for any UI module in scope. A failing baseline is either repaired first or documented as a known pre-existing failure.

### 2. Write the human architecture narrative

The owner reads the highest-overlap files and writes, without copying an agent summary:

- Purpose, inputs, outputs, and callers.
- Invariants and prohibited states.
- Side effects, transactions, queues, and external systems.
- Failure and recovery behavior.
- The executable test that proved the explanation.
- Any difference between expected and observed behavior.

This cannot be delegated. It is the comprehension-debt checkpoint.

### 3. Replace weak safety nets before moving code

For the selected slice, add characterization tests against current behavior. Prefer pure domain fixtures plus PostgreSQL integration tests. Keep known-wrong behavior pinned until a separate, explicitly reviewed behavior change fixes it.

Resolve every `before_start` item in the evidence matrix to `satisfied` or approved `not_applicable`. A prose claim, static source-string assertion, or existing broad suite is not automatically equivalent to the focused evidence named in the matrix.

### 4. Create seams around effects

Extract narrow adapters for the clock, model/OCR calls, Blob operations, database repositories, and event dispatch. Keep pure policy functions independent of Next.js, environment variables, SQL clients, Blob clients, and model SDKs.

### 5. Split one vertical slice

Move one responsibility at a time, rerun its focused tests, then run the full fast gate. Avoid a repository-wide folder reorganization. Refactors should remain reviewable and reversible.

### 6. Compare both implementations where risk is high

For extraction, matching, and workflow projections, support shadow comparison behind a disabled-by-default flag. Compare de-identified outputs and side effects. Never double-write live workflow state merely to compare implementations.

### 7. Delete the old path

After parity, soak, rollback proof, and owner approval, remove the superseded path. A permanent legacy toggle creates two systems to understand and is not a completed refactor.

## Registry order

| Priority | Registry slice | Intended boundary | Required before start |
| --- | --- | --- | --- |
| 1 | `referral-store-boundaries` | Referral policy, normalization, and explicit local/PostgreSQL adapters | Frozen behavior and shared adapter-parity scenarios |
| 2 | `assessment-store-boundaries` | Assessment policy, provenance, history, and explicit adapters | Frozen lifecycle behavior and shared adapter-parity scenarios |
| 3 | `workflow-and-handoff-owner` | One owner for transitions, decisions, projections, and EHR handoff | Database-effect goldens and executable role/resource matrix |
| 4 | `extraction-capstone` | Immutable ingest through provenance-preserving review output | Packet-level goldens and governed labeled corpus |
| 5 | `referral-canvas-components` | Structural UI split behind an unchanged shell and workflow | Autosave, remount, conflict, upload, and review characterization |
| 6 | `test-suite-structure` | Test organization without reducing assertion power | Independent human assertion review |

This table is explanatory only. If it differs from `refactor-slices.json`, the registry wins and this table must be corrected. Do not start by splitting React files merely because they are long. The first implementation extraction should be a pure policy or mapper with strong characterization, not a PostgreSQL transaction body.

## Evidence lifecycle

- `before_start`: ownership and characterization needed before implementation files move.
- `before_complete`: focused correctness, compatibility, performance, mutation, database, and browser evidence needed before the slice can soak or complete.
- `before_cutover`: shadow/canary or replacement-path proof needed only when the approved design introduces a second implementation.
- `conditional`: unresolved design-dependent evidence, not a passing state.
- `not_applicable`: requires a human approver, timestamp, and written reason.

Setup mode permits gaps as warnings because no refactor is underway. Once a slice advances, the same unresolved controls become hard failures.

Global evidence applies to every slice. In particular, implementation begins only from a current hash-backed file/dependency inventory, an aligned Node runtime/type surface, and a dedicated recorded refactor worktree. See `docs/refactoring/CODE_QUALITY_POLICY.md`.

## Control-plane fitness functions

Introduce these incrementally after the architecture narrative confirms the intended boundaries:

1. Browser-capable modules cannot import server credentials, PostgreSQL, Blob, Databricks, or clinical adapters.
2. Domain policy cannot import Next.js route APIs or infrastructure clients.
3. Workflow transitions and terminal decision writes have one canonical owner.
4. Audit-required mutations cannot complete without their audit event in the same transaction.
5. PHI-shaped values cannot reach logs, metrics, thrown public errors, or release artifacts.
6. Databricks extraction workers cannot write canonical referral or assessment tables directly.
7. Historical migration contents and checksums cannot change.
8. Local and PostgreSQL adapters pass the same domain contract suite where semantics are intended to match.

Add a rule only when its ownership and exceptions are clear. A large speculative rule set becomes another unreviewed system.

## Pull request protocol

Every structural change should state:

- Behavior explicitly preserved.
- Behavior intentionally changed, if any, in a separate section.
- Control-plane invariants touched.
- Characterization and focused tests run.
- Local/PostgreSQL parity evidence when a store changes.
- Migration impact and checksum status.
- PHI/logging review result.
- Performance, concurrency, and visual comparison when applicable.
- Rollback method.
- Human explain-back for authorization, workflow, audit, PHI, retention, extraction provenance, matching, or handoff code.
- Evidence matrix item updates and the selected performance budget profile.

Prefer a small sequence of complete vertical changes over one large mechanical rewrite. If a change cannot be explained and reviewed in one sitting, split it.

## Definition of done for a refactor slice

A slice is complete only when:

- Current behavior is characterized and intended changes are explicit.
- Changed complexity hotspots have reviewed before/after evidence and do not worsen the repository ratchet.
- Control-plane invariants have executable tests.
- The focused suite and `npm run check:platform:fast` pass.
- `npm run certify:test-effectiveness` still kills the seeded critical defects.
- PostgreSQL integration, migration, rollback, and query-plan checks pass when storage code changes.
- Browser, accessibility, and visual checks pass when UI code changes.
- Performance and contention do not regress outside the recorded budget.
- Logs, metrics, errors, fixtures, and artifacts remain PHI-safe.
- The old implementation is removed or has a dated, owned strangler exit criterion.
- The baseline is rerun and the before/after result is reviewed rather than assumed to improve.

## What remains human work

- Write the architecture narrative in the owner’s own words.
- Label and govern the extraction corpus.
- Decide which observed oddities are bugs versus compatibility behavior.
- Review control-plane diffs line by line.
- Approve match/merge rules, terminal workflow semantics, retention, and clinical handoff behavior.
- Certify the production restore and live infrastructure paths with real credentials and operator evidence.

Automation can make these decisions visible and repeatable. It cannot legitimately make them on behalf of the clinical and operational owners.
