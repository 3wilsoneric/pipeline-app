# Prospective Assessment Model

## Purpose

Pipeline's assessment currently defines 151 interview questions across 12
sections and stores 157 assessment fields, field-level provenance, immutable
versions, lifecycle timestamps, assessor recommendations, and supervisor
decisions. That is enough to build a prospective learning dataset without asking
assessors to enter the same information twice.

The first objective is not to predict who should be admitted. It is to learn:

1. which assessment facts are associated with recorded supervisor decisions;
2. which missing or ambiguous fields create requests for more information;
3. which care and support needs are associated with a completed placement; and
4. eventually, which supports are associated with stable placement at 30 and 90 days.

Association is not causation. A supervisor decision reflects capacity, policy,
community resources, referral mix, and documentation quality as well as the
client's presentation. Those influences must be measured rather than hidden in a
single score.

## Dataset Grain

Create one immutable research snapshot when an assessment is signed. The key is
`referral_id + assessment_id + assessment_version`. Retain `canonical_client_id`
only as the grouping key that prevents one person's episodes from crossing train
and validation sets.

The snapshot contains:

- the signed assessment values and assessment schema version;
- field provenance and extraction-review state;
- assignment, schedule, start, sign, recommendation, and decision timestamps;
- the supervisor decision as a later label, never as a predictor; and
- later placement outcomes as append-only events.

Do not rewrite the snapshot when a decision or later outcome arrives. Join the
later label by record ID and preserve the time at which it became known.

## Feature Policy

The versioned policy is in `prospective-model-contract.json`.

- Phase 1 uses structured yes/no, select, rating, count, and derived interval
  fields. These are interpretable and can be checked against the questionnaire.
- Free text is shadow-only. It can be evaluated later for incremental value, but
  it cannot be the only source for a clinical claim.
- Community, assessor, source, schedule method, note length, completion, and
  provenance are audit dimensions or negative controls, not clinical predictors.
- Names, contacts, raw dates of birth, record numbers, decision language, and
  post-decision workflow state are prohibited predictors.
- Missing, no, and unable-to-assess remain distinct values.

## Outcomes

Use separate models or reports for separate questions:

| Outcome | Use |
| --- | --- |
| Supervisor decision | Describe historical decision patterns only. |
| Needs more information | Improve assessment completeness and intake quality. |
| Decision lag | Improve workflow operations. |
| Accepted to admitted within 30 days | Measure conversion to actual placement. |
| Stable placement at 30/90 days | Preferred future measure of placement fit. |
| Higher-level-of-care transfer | Identify support mismatches and resource needs. |

The long-term assistance target should be support planning and evidence quality,
not a hidden admission eligibility score.

## Evaluation Sequence

1. Validate field completeness, provenance coverage, chronology, and outcome
   definitions.
2. Publish unadjusted field-level associations with confidence intervals and
   minimum-cell suppression. Correct exploratory p-values for false discovery;
   do not interpret them as causal effects.
3. Fit an interpretable regularized structured model and compare it with the
   process-only negative control.
4. Validate by future time, held-out person, held-out assessor, and held-out
   community. Random row splits are not acceptable.
5. Run silently for at least one full operating period. Operators do not see a
   recommendation during shadow evaluation.
6. If the evidence is stable, expose only bounded assistance: missing-evidence
   checks, similar support patterns, likely operational blockers, and source-linked
   explanations. Supervisors retain the decision.

Keep four model families separate: assessment rework, historical decision
patterns, accepted-to-admitted conversion, and 30/90-day placement stability.
They answer different questions and must never be collapsed into one eligibility
score.

## Rules, Qualifiers, And Priors

Use `evidence-rule-registry.json` as the draft rule and qualifier boundary. A
phrase never changes an admission result directly. It is normalized into a
source-linked claim with assertion, recency, frequency, severity, functional
impact, mitigation, trend, source, and certainty.

For example, `history of aggression` is incomplete evidence because recency,
frequency, severity, and mitigation are unknown. `One assault fourteen months
ago, no recurrence, responds to redirection` is a different claim. The rule layer
can request missing details or open a program-capability review, but no draft
rule can accept or decline a referral.

For Bayesian models, begin with skeptical priors centered at no effect. A
`Normal(0, 0.35)` prior on a structured log-odds coefficient places most prior
mass between odds ratios of roughly 0.5 and 2.0. Use tighter priors for
interactions, group correlated observations into a domain rather than multiplying
overlapping evidence, and elicit any directional prior from standardized
supervisor vignettes. Never update a production model continuously from operator
clicks; updates are versioned, batch evaluated, and approved.

## Required Export Shape

The `profile-prospective` command accepts NDJSON with one object per signed
assessment:

```json
{
  "referral_id": 123,
  "assessment_id": "assessment-123",
  "canonical_client_id": "client-456",
  "assessment_version": 2,
  "assessment_schema_version": "pipeline_assessment_tool_v1",
  "signed_at": "2026-09-05T18:00:00Z",
  "assessment_data": { "ambulatory": "yes" },
  "field_provenance": {},
  "audit": { "community": "San Pablo", "assessor_id": "entra-object-id" },
  "decision": {
    "outcome": "accepted",
    "decided_at": "2026-09-05T20:00:00Z",
    "reason_code": ""
  },
  "follow_up": []
}
```

Run:

```bash
./research/admission-inference/run.sh profile-prospective \
  --input /approved/phi/location/signed-assessments.ndjson \
  --output /approved/phi/location/prospective-profile
```

For PostgreSQL, `prospective-export.sql` is the read-only source query. Run it
with tuple-only, unaligned output so each result is one NDJSON line:

```bash
psql "$DATABASE_URL" -X -qAt \
  -f research/admission-inference/prospective-export.sql \
  > /approved/phi/location/signed-assessments.ndjson
```

The output contains a structured snapshot table, aggregate field coverage,
minimum-cell-suppressed univariate associations, and model-readiness gates. The
command does not train or serialize a decision model.

## Before User-Facing Assistance

- Standardize supervisor reason codes and allow secondary reasons.
- Record requests for more information as explicit events.
- Verify admission date and client identity before deriving placement conversion.
- Add EHR-sourced 30- and 90-day follow-up outcomes with source timestamps.
- Establish clinical, operations, privacy, and compliance owners for model changes.
- Define an immediate disable switch and audit every displayed suggestion.
- Prohibit autonomous accept, decline, ranking, or queue prioritization.
