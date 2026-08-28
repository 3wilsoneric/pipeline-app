# Shadow Comparison Contract

## When required

Use shadow comparison when replacing extraction, identity matching, workflow projection, or another deterministic read/decision path. It is not required for a purely mechanical in-place split with identical imports and characterization evidence.

## Safety boundary

- The authoritative implementation alone may write canonical state.
- The shadow implementation receives a de-identified or governed copy of the same bounded input.
- Shadow execution must not send notifications, create work items, mutate audits, advance workflow, or publish EHR state.
- Comparison records use opaque run IDs and aggregate dimensions only.
- Raw values, names, DOBs, document text, IDs, prompts, and model responses do not enter ordinary logs.

## Comparison envelope

Each comparator returns:

- implementation and schema versions;
- agreement state: equal, explainable difference, unsafe difference, or comparator failure;
- field/path categories that differed, never their PHI values;
- side-effect plan categories;
- latency and cost counters;
- evidence/provenance completeness flags;
- deterministic replay identifier stored only in the governed evidence system.

## Domain-specific zero-tolerance differences

- Different person or resident identity selection.
- Different workflow transition, terminal decision, authorization result, or EHR action.
- Missing audit/idempotency behavior.
- Lost source page, bounding box, source document, or reviewer correction.
- Automatic value where the authoritative path abstains because of ambiguity.

## Rollout

1. Offline fixture replay.
2. Governed shadow run with no shadow writes.
3. Daily disagreement review and corpus addition.
4. One-community canary with rollback owner and error budget.
5. Progressive expansion only after the agreed soak threshold.
6. Delete the old path after acceptance; do not keep a permanent dual system.
