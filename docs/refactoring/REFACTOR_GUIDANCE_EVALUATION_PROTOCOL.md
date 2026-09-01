# Pipeline Refactor Guidance Evaluation Protocol

Status: setup-only candidate. It evaluates the refactor process; it does not authorize implementation and does not certify application correctness.

## Purpose

Pipeline's refactor instructions, responsibility map, proof obligations, and automated gates are hypotheses about how to make refactoring safer. They become an adopted guidance baseline only after fresh agents apply them successfully to fixed first-attempt scenarios, matched comparisons show no safety-critical regression, private holdouts resist overfitting, and humans decide to keep the change.

This closes a different gap from architecture comprehension. A reviewer may be able to explain where code lives while still choosing an unsafe scope or moving the wrong boundary. Guidance evaluation asks whether a fresh agent actually:

- refuses work that lacks authority or evidence;
- selects the approved slice, responsibility, and proof obligation;
- proposes only the smallest allowed change;
- preserves transactions, audit, authorization, provenance, identity review, retries, migrations, and assertion power;
- cites executable evidence rather than treating prose or source-text presence as behavioral proof;
- recognizes when a request is a separate behavior change or is not a refactor at all.

## Three enforcement layers

Corrections land in the narrowest layer that can enforce them consistently:

1. **Guidance and judgment**: the playbook, control-plane narrative, convergence protocol, and agent instructions explain how to reason and when to stop.
2. **Constrained primitives and machine controls**: slice scope, allowed paths, canonical responsibilities, proof obligations, schemas, checksums, import rules, database constraints, and executable gates remove repeatable choices from the agent.
3. **Evaluation harness**: frozen public scenarios, private holdouts, first-attempt records, blind review, and correction recurrence show whether the first two layers change behavior.

A harness defect stays in the harness. A deterministic failure becomes a machine control when possible. A genuine application defect belongs to an explicitly approved code slice. An isolated model quirk does not automatically become repository guidance.

## Public scenario suite

`refactor-eval-scenarios.json` is the public calibration suite. Its prompts, synthetic inputs, expected mechanical fields, and human rubrics are frozen within `suiteVersion`. Changing any of them creates a new suite version; historical run records retain the previous version and scenario digest.

The suite deliberately includes:

- requests that must stop because setup, ownership, evidence, or approval is missing;
- unsafe proposals that flatten a specialized boundary;
- one bounded positive case so the process does not teach agents to refuse everything;
- a non-refactor control so the process does not over-trigger on ordinary product work;
- scenarios spanning every planned slice and the recurring anti-patterns in `refactor-anti-patterns.json`.

Expected answers are visible because this is a calibration suite, not a secret exam. Generalization is measured with the holdout set.

## Private holdout

The human custodian keeps holdout prompts, fixtures, and scoring keys outside the repository and outside implementation-agent context. Only IDs, kinds, and SHA-256 commitments appear in a committed manifest shaped like `refactor-holdout-manifest.example.json`.

The holdout contains at least three cases, including one case where refactor controls should not activate. Rotate affected cases after material leakage. Holdout content uses only synthetic or governed de-identified information; hashes do not make PHI safe to store elsewhere.

## First-attempt run

Each run is independent and retains the first valid response. Do not reroll, steer, repair, or let the agent see the implementation conversation. If the harness fails before producing a valid response, mark a harness failure and rerun under a new run ID; do not silently discard a substantive poor answer.

A run record shaped like `refactor-guidance-run.example.json` binds:

- scenario ID, suite version, and scenario digest;
- exact application base commit;
- exact guidance commit and SHA-256 for every loaded guidance file;
- model provider, pinned model version, and settings;
- fresh context ID, attempt number one, and `rerolled: false`;
- the immutable response artifact and its digest;
- mechanical score output and blind human criterion results;
- start and completion timestamps.

Use the response shape in `refactor-eval-response.example.json`. The mechanical scorer checks exact decisions, scope, cited paths, invariant tags, gates, blockers, and named anti-patterns. It never searches persuasive prose for magic strings and never claims to score the human rubric.

A failed mechanical or human criterion is a valid evaluation result, not an invalid run. Preserve it. The run validator rejects missing, mismatched, steered, rerolled, or unverifiable records; it does not reject an honestly recorded poor first attempt.

## Matched comparison

For each affected public scenario and holdout case, run at least three independent first attempts per guidance variant. A baseline/candidate pair uses the same:

- application base commit;
- frozen prompt and inputs;
- model version and settings;
- trial index and render/tool permissions where applicable.

Only the guidance bundle changes. Include at least one public non-refactor control. Randomize variant labels before review. At least two human reviewers score the frozen criteria without seeing variant identity.

The candidate can be kept only when:

- critical and high regressions are both zero;
- at least one targeted material improvement is observed;
- public controls do not show harmful over-triggering;
- holdout performance does not reveal overfitting or a safety regression;
- a named human decides `keep` and records limitations.

Otherwise the decision is `revise` or `revert`. Aggregate scores never override a single safety-critical regression.

## Correction recurrence

`refactor-correction-ledger.json` records corrections from evaluation runs, pull-request review, production incidents, and repeated human steering. Each observation cites its run, commit, model, reviewer, and evidence.

Two independent occurrences may promote a correction to human review. One critical miss triggers immediate blocking review but still cannot promote itself automatically. The human reviewer decides whether the accepted correction belongs in guidance, a machine control, the evaluation harness, an approved code slice, or nowhere.

After a correction lands, rerun affected scenarios and watch recurrence. If the same correction continues, the rule may be unclear, unloaded, unenforceable, aimed at the wrong layer, or overfit to the original example.

## Adoption and exact-commit binding

The global `evaluated_refactor_guidance_baseline` item in `evidence-matrix.json` remains unresolved until a real comparison record validates and a human keeps the candidate bundle. The adopted comparison record must be committed under `docs/refactoring/guidance-evaluations/` or referenced through another immutable evidence location accepted by the human owner.

Every started slice records the adopted comparison path, guidance commit, and scenario-suite version in its assurance record. `npm run check:refactor-guidance` validates setup structure and, once the evidence item is marked satisfied, validates the adoption record and active-slice binding.

The current files bootstrap the harness. They are agent-drafted and have not yet passed their own initial matched comparison, so they remain setup evidence rather than an adopted refactor baseline.

## Commands

```bash
# Validate the policy, public suite, anti-pattern catalog, ledger, templates, and lifecycle binding.
npm run check:refactor-guidance

# Mechanically score one public-scenario response. Human rubric scoring remains separate.
node scripts/refactor-guidance-eval.mjs --score-response=path/to/response.json

# Validate a fully recorded first-attempt run.
node scripts/refactor-guidance-eval.mjs --validate-run=path/to/run-record.json

# Validate a matched, blind, human-decided comparison and its referenced runs.
node scripts/refactor-guidance-eval.mjs --validate-comparison=path/to/comparison-record.json
```

## Claim limit

A kept bundle supports only the claim written in `refactor-guidance-evaluation-policy.json`: the recorded candidate guidance performed no worse on the declared critical criteria and materially better on at least one targeted criterion in that matched evaluation. It does not prove that future agents will always comply, that an approved refactor is correct, or that Pipeline is bug-free.
