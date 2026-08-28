# Pipeline Extreme Testing Protocol

## Objective

Pipeline should be tested against stable clinical and operational invariants,
not only fixed screenshots or one expected extraction. This protocol extends
the 100-point assurance model without claiming evidence that does not yet exist.

## Current Position

| Capability | Current State | Release Meaning |
| --- | --- | --- |
| Stateful workflow fuzzing | Active in `scripts/workflow-stateful-fuzz.mjs`; 2,000 traces and 120,000 transition attempts per run. | Local gate. |
| Multi-patient identity defense | Active in the Databricks worker. Conflicting names or DOBs remain unresolved for human review. | Local gate plus live-packet confirmation. |
| Document prompt-injection boundary | Active for the current deterministic worker: document text can emit only allowlisted data fields and never workflow-control output. | Local gate. Re-test before adding any LLM. |
| Role, concurrency, idempotency, and EHR recovery | Active in the role-separated golden thread and 100-user operational suite. | Local and staging gates. |
| Failure and worker recovery | Deterministic retries, dead letters, stale callbacks, duplicate creates, and bounded overload are active. | Local; deployed worker interruption remains live. |
| Field provenance | Page and evidence image are retained. Bounding box and exact source phrase are not yet canonical fields. | Partial. Do not claim full provenance. |
| Metamorphic packet corpus | Not active because the approved labeled corpus and transformation outputs are not in this repository. | Required before extraction production sign-off. |
| Statistical accuracy and drift | Current scorer measures aggregate recall, exact match, page accuracy, edits, and confidence. It does not yet calculate stratified confidence intervals. | Required after the real corpus is approved. |
| Simulated quarter | The 100-user day and 100GB-class benchmark are active. A quarter-long arrival/no-show/assessor-behavior twin is not. | Add after final workflow/SLA policy. |
| Mutation score | No application-level mutation runner is active. | Required after core workflow interfaces stabilize. |
| Shadow and canary | Operational procedure only. | Required before broad cutover. |

## Extraction Corpus Contract

The approved corpus must be de-identified or governed as test PHI. Every field
label must contain:

- canonical value, including an explicit `null` when absent;
- source page;
- source phrase;
- bounding polygon or bounding box;
- document type and scan-quality stratum;
- clinical risk tier;
- reviewer identity and label version.

Never commit raw PHI, source phrases, images, or model payloads to the normal
repository. Store encrypted corpus material in a dedicated access-controlled
Blob container. Check in only synthetic fixtures, schemas, hashes, and aggregate
scores.

Each baseline packet should produce transformed twins for applicable cases:

1. 90-, 180-, and 270-degree rotation.
2. 150- and 300-DPI rerendering.
3. Fax/JPEG degradation.
4. Reordered pages.
5. Split packet parts and later recombination.
6. Duplicate page.
7. Irrelevant inserted page.
8. Randomized filename and neutral metadata.
9. Redaction blocks and handwritten contradiction overlays.
10. Embedded hostile instructions, hidden text, and fake system headers.

The baseline and transformed twin must preserve canonical values. Provenance may
move only according to the transformation's declared page map. Identity-field
flips, control-plane effects, silent patient selection, or automated approval
are zero-tolerance failures.

## Scoring

Report separately by field, clinical risk, document type, language, handwriting,
and scan quality. Do not average the adversarial corpus into the routine headline
score. It is a separate pass/fail gate.

The production corpus scorer must provide:

- precision, recall, exact match, and abstention rate;
- page, source-phrase, and bounding-box provenance accuracy;
- bootstrap confidence intervals using a fixed recorded seed;
- human correction and false-confidence rates;
- p50/p95 latency and per-page/packet cost;
- baseline-to-transform flip rate;
- model/provider/version dimensions without patient identifiers.

Initial thresholds are policy inputs, not engineering guesses. Name, DOB, source
record number, medication, legal status, and decision-support fields must have
separate clinically approved floors. Gate on both the point estimate and lower
confidence bound once corpus size supports it.

## Execution Layers

### Every Change

- schema and authorization contracts;
- stateful workflow fuzzing;
- deterministic worker and injection tests;
- idempotency, conflict, retry, and golden-thread tests;
- TypeScript, lint, build, artifact, browser, and visual gates.

### Nightly

- frozen OCR/model recording replay;
- transformed corpus scoring;
- seeded defect and mutation sampling;
- worker interruption at every durable stage boundary;
- simulated month or quarter after workflow policy stabilizes.

### Release Candidate

- strict `npm run certify:assurance:live`;
- real de-identified packet extraction;
- authenticated Entra role and collaboration rehearsal;
- database migration, backup, and disposable restore;
- deployed load, latency, queue-age, storage, and cost budgets.

### Cutover

Run Pipeline in shadow mode against the current process. Operators continue using
the current system while disagreements are reviewed daily and added to the corpus.
Then canary one community with an explicit rollback owner, error budget, and exit
criteria before expanding.

## Build Order

1. Obtain corpus governance approval and the first representative packet set.
2. Label values and full provenance with dual review for high-risk fields.
3. Build the reproducible transformation job and page-map manifest.
4. Upgrade the quality scorer with stratified bootstrap intervals and cost/latency.
5. Add encrypted recording/replay for Document Intelligence and any future LLM.
6. Add a seeded-defect/mutation score for workflow and extraction modules.
7. Finalize no-show, reassignment, SLA, holiday, and cancellation policies.
8. Build the simulated quarter from those approved policies.
9. Execute shadow mode and one-community canary.

The immediate dependency is not more test code. It is a representative,
approved corpus and finalized operating-policy decisions. Until those exist,
Pipeline must preserve human review and abstain on ambiguity.
