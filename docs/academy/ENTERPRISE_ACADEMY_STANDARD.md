# Pipeline Developer Academy Standard

## Purpose

The Academy is the private, source-grounded ownership program for Pipeline. It is not product help, a generated code tour, or evidence that a learner is qualified merely because buttons were clicked. Its purpose is to make one developer capable of navigating, changing, reviewing, operating, recovering, and teaching the system safely.

## Authoritative Sources

The Academy has four distinct sources of truth:

1. `lib/academy/academy-curriculum.ts` owns tracks, modules, activities, prerequisites, labs, checkpoints, source readings, and competencies.
2. `lib/academy/academy-journeys.ts` owns the golden end-to-end execution paths and invariants.
3. `lib/academy/academy-atlas.generated.json` is a generated inventory that maps every maintained repository file to a learning owner.
4. `docs/academy/academy-registry.json` records review thresholds and approved source and atlas fingerprints. It must not duplicate curriculum prose.

The current application source remains authoritative over all teaching material. When the source and teaching disagree, the Academy is stale.

## Program Standard

The minimum enterprise program contains:

- 10 tracks spanning foundations, product, frontend, API/domain, data, documents/AI, clinical assessment, security, reliability, and ownership.
- 36 modules and at least 100 guided hours.
- Four activities per module: learn, source trace, applied lab, and knowledge check.
- Written evidence for every source trace and lab.
- At least 10 golden journeys across operator, clinical, data, release, and incident paths.
- 100 percent of maintained repository files assigned to at least one current module.
- An owner capstone that includes a bounded change, tests, security, observability, release, rollback, and teach-back.

## Evidence Rules

Academy evidence is private developer-learning material. It must never contain PHI, client identifiers, packet text, filenames containing client names, credentials, secrets, access tokens, production connection strings, or copied production records. Synthetic identifiers and redacted architectural examples are required.

Completion records exposure to material. Mastery requires all of the following:

- A correct source-backed mental model.
- Applied evidence that meets the activity acceptance criteria.
- Safe behavior under authorization, concurrency, failure, and recovery scenarios.
- Independent review where the competency calls for it.
- A teach-back that another engineer can follow.

## Maintenance Protocol

Run `npm run academy:atlas` after adding, moving, or deleting maintained files. Review the generated diff rather than accepting it blindly. Update module ownership rules when a file is misclassified.

Run `npm run academy:refresh` only after reviewing curriculum source changes and the regenerated atlas. This records new fingerprints; it does not prove the teaching content is correct.

Run `npm run academy:certify` before merging Academy changes and as part of the weekly engineering-quality cycle. Certification checks the atlas, source fingerprints, curriculum graph, journey references, progress contracts, owner boundary, and TypeScript.

Every production failure, confusing code review, unsafe change, or repeated developer question should result in one of the following:

- A clearer source invariant.
- A new or corrected golden-journey step.
- A permanent test.
- A stronger lab or checkpoint.
- A repository-atlas ownership correction.

## Review Boundaries

Automated checks prove structural currency, not pedagogical truth. A human review is still required for clinical meaning, security interpretation, operational judgment, and whether a learner can perform the work without assistance.

The Academy route and progress API are owner-only and return not-found to non-owners. Durable progress uses the versioned per-user workspace-state store. Browser storage is a local fallback, not an enterprise system of record.
