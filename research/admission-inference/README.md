# Pipeline Admission Inference Research Harness

This package evaluates whether pre-decision assessment evidence contains a
reproducible signal associated with the recorded admission outcome. It is a
research and quality-improvement tool. It is not an admission decision system,
and its output must not be used to accept, deny, rank, or prioritize a person.

The harness intentionally lives outside the application runtime. It does not
export a Next.js API, write to Pipeline records, or alter the referral workflow.

## Safety boundaries

- The unit of analysis is one referral episode.
- Every validation split is grouped by person identity.
- Only pre-decision text is eligible as a predictor.
- Known decision-language leakage stops the run.
- A second deterministic pass masks common identifiers and source-title name tokens.
- Community and time are evaluation dimensions, not clinical predictors.
- Selection-quality and denial-reason fields are never model inputs.
- Training requires human verification fields unless the operator explicitly
  marks the run `--exploratory-unverified`.
- Saved text models contain a vocabulary derived from sensitive notes. Treat
  every output directory as PHI and keep it in approved local storage.

## Setup

```bash
cd /Users/eric/pipeline-app
./research/admission-inference/run.sh setup
```

## Validate a cohort

```bash
./research/admission-inference/run.sh validate \
  --input /Users/eric/Desktop/Pipeline-admission-inference-cohort-best-100x100-2026-09-05/best-100-admitted-100-denied.csv
```

Validation never prints note text or names. It reports only aggregate counts and
the cohort fingerprint.

## Prepare the verification worksheet

```bash
./research/admission-inference/run.sh prepare-review \
  --input /path/to/best-100-admitted-100-denied.csv \
  --output /approved/local/location/admission-review.csv
```

The worksheet contains sensitive source text and identifiers. Keep it in approved
storage. In addition to the five training-gate fields below, it captures a
disposition category, contributing factors, an exact supporting evidence span,
review uncertainty, and reviewer notes. The allowed taxonomy is defined in
`annotation-schema.json`.

## Expand the referral pool

Build a complete, provenance-preserving inventory from a canvas capture and retain
the existing reviewed candidate set as the seed:

```bash
./research/admission-inference/run.sh expand-pool \
  --source-root /path/to/ALLO-canvas-text-capture \
  --seed-cohort /path/to/current-candidate-cohort.csv \
  --output /approved/local/location/expanded-referral-pool
```

This writes the full captured inventory, all explicit outcome labels, a Tier A
model-candidate subset, and a human-review queue. `unlabeled` never means denied,
and no newly discovered record becomes training data merely because it has an
explicit source status. Every candidate still requires outcome, identity,
pre-decision, leakage, and duplicate review.

## Run an exploratory baseline

The current candidate cohort has not completed source-outcome and pre-decision
review. Any run on it must say so explicitly:

```bash
./research/admission-inference/run.sh train \
  --input /Users/eric/Desktop/Pipeline-admission-inference-cohort-best-100x100-2026-09-05/best-100-admitted-100-denied.csv \
  --exploratory-unverified
```

Outputs are written beneath `/Users/eric/pipeline-app/outputs/admission-inference/`
and are ignored by Git. Each run contains aggregate metrics, privacy-reduced
out-of-fold predictions, validation results, a model card, and research-only
serialized estimators.

## Human-reviewed input

For a non-exploratory research run, add these columns to the cohort and complete
them for every row:

| Column | Required value |
| --- | --- |
| `annotation_status` | `verified` |
| `outcome_verified` | `true` |
| `pre_decision_verified` | `true` |
| `leakage_reviewed` | `true` |
| `reviewer_id` | non-empty reviewer identifier |

This gate proves review occurred; it does not prove the labels are correct. A
second reviewer should independently check the rows marked
`secondary_review_required` before interpreting performance.

## Produced evaluations

- Clinical signal baseline: deterministic clinical-domain indicators plus a
  regularized logistic regression.
- Text baseline: word and character TF-IDF plus an elastic-net linear logistic classifier.
- Combined baseline: text plus deterministic clinical-domain indicators.
- Process negative control: note length, community, and source period only. A
  strong result here indicates workflow or dataset confounding.
- Nested grouped cross-validation with fold-local probability calibration.
- Grouped bootstrap confidence intervals.
- Calibration, discrimination, classification, and abstention metrics.
- Community subgroup checks, leave-one-community-out checks, and a temporal
  holdout when the data supports them.

The next safe step after human review is prospective shadow evaluation. Pipeline
operators make decisions normally; the harness records evidence coverage and
calibration without exposing a recommendation to the operator.

## Profile prospective assessments

The forward-looking assessment contract is documented in
`PROSPECTIVE_MODEL_PLAN.md` and enforced by
`prospective-model-contract.json`. A signed-assessment NDJSON export can be
checked without training a model:

```bash
./research/admission-inference/run.sh profile-prospective \
  --input /approved/phi/location/signed-assessments.ndjson \
  --output /approved/phi/location/prospective-profile
```

This creates privacy-reduced structured snapshots, field missingness, and
minimum-cell-suppressed univariate associations. It excludes direct identifiers,
raw narrative, recommendations, and decisions from the predictor matrix. Record
linkage IDs remain present, so the output still belongs in approved PHI storage.
