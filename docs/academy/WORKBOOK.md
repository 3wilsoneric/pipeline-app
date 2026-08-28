# Pipeline Developer Workbook

## Rules

Use this workbook for your own explanations, diagrams, hypotheses, and test observations. Never place real names, dates of birth, referral notes, document filenames, credentials, access tokens, or production payloads here.

Answers should be written from memory first. Source verification comes second.

## Learning log

| Date | Module | What I can now explain | What is still unclear | Source I verified | Revisit date |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## System map

Without notes, draw and explain:

```text
Browser
  ->
  ->
  ->
  ->
```

Questions:

1. Where does user input first become untrusted data?
2. Where is the caller authenticated?
3. Where is resource authorization applied?
4. Where are workflow transitions owned?
5. Where do database transactions begin?
6. Which process reads document bytes for extraction?
7. Which identifiers are safe for logs and metrics?

## TypeScript checkpoint

Explain each concept using a current Pipeline example:

| Concept | Pipeline example | Why it matters |
| --- | --- | --- |
| Union type |  |  |
| Discriminated union |  |  |
| Type-only import |  |  |
| Generic function |  |  |
| Type narrowing |  |  |
| `unknown` at a boundary |  |  |
| Compile-time type versus runtime validator |  |  |
| Immutable/readonly value |  |  |

## Create-referral trace

Fill this in from memory:

| Step | Symbol | Runtime zone | Input trust | Output or side effect |
| --- | --- | --- | --- | --- |
| 1 | `ReferralPacketCanvas.saveDraft` |  |  |  |
| 2 | `buildReferralCanvasCreateInput` |  |  |  |
| 3 | `fetchPipelineJson` |  |  |  |
| 4 | `POST /api/referrals` |  |  |  |
| 5 | `validateReferralCreateInput` |  |  |  |
| 6 | `createReferral` |  |  |  |
| 7 | `createPostgresReferral` |  |  |  |
| 8 | `uploadReferralPacket` |  |  |  |
| 9 | `completeDurableUpload` |  |  |  |
| 10 | packet-link patch |  |  |  |

## Failure predictions

Before running tests, predict the exact result:

| Failure | Prediction | Source/test verification | Was I correct? |
| --- | --- | --- | --- |
| Duplicate mutation ID |  |  |  |
| Duplicate packet SHA-256 |  |  |  |
| Unauthorized role |  |  |  |
| Cross-origin mutation |  |  |  |
| Stale documents section |  |  |  |
| Blob succeeds but finalization fails |  |  |  |
| Database row exists but Blob is missing |  |  |  |

## Code-review practice

For each proposed pattern, classify it `P0`, `P1`, `P2`, `P3`, or acceptable and explain why:

```ts
const body = (await request.json()) as ReferralCreateInput;
await createReferral(body);
```

```ts
try {
  await uploadPacket(file);
} catch {
  return { status: "Uploaded" };
}
```

```ts
if (!user.roles.includes("admin")) hideDecisionButton();
```

```ts
await Promise.all(files.map(processFile));
```

```ts
const result = await patchReferral(id, patch, expectedVersion, actor, sectionVersions);
```

## Weekly teach-back

At the end of each week, record a ten-minute explanation covering:

1. One complete user journey.
2. One security boundary.
3. One concurrency mechanism.
4. One partial-failure recovery mechanism.
5. One test whose assertion power you can defend.
6. One current architectural hotspot and how you would characterize it before refactoring.

## Capstone rubric

| Area | Evidence |
| --- | --- |
| Written intent and non-goals |  |
| Current behavior trace |  |
| Authoritative state owner |  |
| Security and PHI analysis |  |
| Concurrency and idempotency analysis |  |
| Focused regression test |  |
| Failure and recovery behavior |  |
| Bounded file scope |  |
| Full certification result |  |
| Five-minute teach-back |  |
