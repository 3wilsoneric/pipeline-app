# Lesson 01: Create a Referral

## Why this is first

Creating a referral crosses nearly every important boundary without requiring the entire assessment or extraction worker to be understood first. It includes client state, TypeScript modeling, runtime validation, authentication, authorization, idempotency, duplicate protection, transactions, audit history, direct Blob upload, asynchronous extraction, and optimistic concurrency.

The user outcome is simple: create one durable referral workspace and attach the initial source packet. The engineering problem is preventing that simple action from producing duplicate referrals, unauthorized assignments, missing history, overwritten edits, or a false claim that a packet was stored.

## Learning objectives

By the end of this lesson, you should be able to:

- Explain which parts execute in the browser and which execute on the server.
- Trace the initial save from `ReferralPacketCanvas` to PostgreSQL.
- Explain why `ReferralCreateInput` is not runtime validation.
- Distinguish authentication, role authorization, resource assignment policy, and same-origin protection.
- Explain the idempotency and duplicate-packet locks.
- Explain why database creation and Blob upload are separate recoverable operations.
- Predict the result of duplicate, stale, unauthorized, malformed, and partial-failure scenarios.

## Source anchors

Read these symbols in order:

1. `ReferralPacketCanvas` and its `saveDraft` function in `components/pipeline/ReferralPacketCanvas.tsx`.
2. `buildReferralCanvasCreateInput` in `lib/pipeline/referral-canvas-persistence.ts`.
3. `fetchPipelineJson` in `lib/auth/authenticated-fetch.ts`.
4. `POST` in `app/api/referrals/route.ts`.
5. `requirePipelineUser` in `lib/auth/pipeline-auth.ts`.
6. `requireSameOriginMutation` in `lib/auth/request-security.ts`.
7. `validateReferralCreateInput` in `lib/pipeline/referral-validation.ts`.
8. `assignedOwnerForCreate` in `lib/pipeline/referral-access.ts`.
9. `ReferralStore`, `createReferral`, and `createPostgresReferral` in `lib/pipeline/referral-store.ts`.
10. `uploadReferralPacket` in `lib/pipeline/referral-packet-upload.ts`.
11. `createDurableUploadTargets` and `completeDurableUpload` in `lib/extraction/document-processing.ts`.

Do not begin by reading the full 2,600-line canvas or store. Search for the named symbol, understand its contract, and expand only to the functions it calls.

## Step 1: the browser owns a draft, not truth

`ReferralPacketCanvas` is a client component. Its state includes editable fields, selected documents, dirty keys, the loaded referral version, section versions, recovery-draft state, remote changes, and save status.

React state is a local representation of the current screen. It is not durable and it is not authoritative. The component compensates for that with:

- A recovery draft.
- Explicit dirty-field tracking.
- A delayed autosave for existing referrals.
- Conflict handling for remote updates.
- A loaded server version and section-version map.

Before creating a referral, `saveDraft` requires an initial packet. This is a UI workflow requirement. The server still validates its own request because callers can bypass the UI.

### TypeScript concept: narrowing a union

The code derives a valid `PipelineCommunity` by checking whether the input is included in `pipelineCommunities`. Before that check, the value is merely a string. After the check and cast, later code treats it as the narrower union.

Ask whether the runtime check and the TypeScript assertion actually match. A cast alone would not make the value valid.

## Step 2: create input is deliberately constructed

The component does not spread all UI state into the API. It calls `buildReferralCanvasCreateInput`, which maps persisted fields into `ReferralCreateInput` and gives the new record its initial workflow values.

This is an anti-mass-assignment boundary. A future change should not replace it with something like:

```ts
body: JSON.stringify({ referral: formState })
```

That would make every new client-side field a potential server input, including fields the client must never own.

The request also includes a `client_mutation_id`. The mutation ID represents the user's logical create action, not a database row ID.

## Step 3: the HTTP client is a reliability boundary

`fetchPipelineJson` is the browser's shared transport. Study how it handles:

- Base paths.
- Authentication/session behavior.
- Bounded response sizes.
- Timeouts.
- Retry classification.
- Structured `PipelineApiError` values.

A shared transport prevents every component from inventing slightly different timeout, authentication, and error behavior.

## Step 4: the route establishes trust in layers

`POST /api/referrals` performs these checks in order:

1. `withApiLogging` establishes bounded, PHI-safe request telemetry.
2. `requirePipelineUser` authenticates the caller and restricts the route to `admin`, `assessment_coordinator`, or `reviewer`.
3. `requireSameOriginMutation` protects cookie-authenticated mutation requests from an untrusted browser origin.
4. `requireReferralStore` refuses the operation when durable production storage is not ready.
5. `readJsonBody` bounds and parses the payload.
6. The route rejects a body that is not an object.
7. `validateReferralCreateInput` validates the referral value.
8. Assignment policy resolves or rejects the requested owner.
9. The route materializes default admission requirements.
10. The route validates the mutation ID.
11. The route delegates persistence to `createReferral`.

These are different controls. Authentication does not prove assignment authority. TypeScript does not validate JSON. Same-origin protection does not replace authorization.

## Step 5: runtime validation protects server ownership

`validateReferralCreateInput` receives `unknown`. That is the correct type for untrusted JSON.

It explicitly rejects fields such as:

- `id`
- `version`
- `sectionVersions`
- `updatedBy`
- `ownerId`
- `manualIntakeAuthorization`
- `assessment`
- `admissionDecision`
- `ehrHandoff`

It also enforces length, enumeration, timestamp, nested requirement, and initial-stage rules.

### TypeScript concept: discriminated result union

The validator returns either:

```ts
{ ok: true; value: T }
```

or:

```ts
{ ok: false; message: string; status?: number }
```

Checking `result.ok` narrows the union. This makes failure handling explicit without throwing for ordinary validation failures.

### Important engineering question

The validator ends with a cast after performing checks. The cast is not proof. The preceding checks are the proof. Whenever `Referral` gains a field, ask whether create and patch validation intentionally accept, reject, default, or ignore it.

## Step 6: assignment policy is not a form concern

The route resolves assignment using the authenticated user, an optional selected workspace member, stable principal IDs, and assessor restrictions.

An assessor may assign a new referral only to themselves. An invalid or inactive selected owner produces a validation error. Human-readable owner names are not treated as sufficient stable identity when a known principal should exist.

This is resource policy at creation time. It belongs on the server even if the UI filters the assignee dropdown.

## Step 7: the store is an adapter boundary

`ReferralStore` defines operations without exposing whether persistence is local JSON or PostgreSQL. `getReferralStoreReadiness` permits local mode for development and isolated tests but requires PostgreSQL for production multi-instance safety.

The exported `createReferral` function delegates to the selected adapter. This keeps the route from importing a database client directly.

Adapter parity matters: local and PostgreSQL implementations should agree on externally observable behavior, but only PostgreSQL is safe for concurrent production instances.

## Step 8: PostgreSQL creation is transactional

`createPostgresReferral` calls `sql.begin`, so related database writes commit or roll back together.

### Idempotency lock

When a mutation ID exists, PostgreSQL takes a transaction-scoped advisory lock derived from `referral_create:<mutationId>`. It then checks `pipeline.idempotency_keys`.

If the same logical mutation already completed, the existing referral is returned. Concurrent retries cannot both pass the check before one records the key because the advisory lock serializes that mutation ID.

### Duplicate packet lock

When a document hash exists, a second advisory lock is derived from the packet SHA-256. The store checks for an existing referral with that hash and throws `DuplicateReferralPacketError` if found.

The database also has a unique packet-hash index. Application checks improve the error, while the database constraint protects against missed races.

### Durable writes

Inside the same transaction, the store:

- Upserts `pipeline.people` using the Pipeline external client ID.
- Inserts `pipeline.referrals` with assignment and workflow projection data.
- Synchronizes requirement work items.
- Writes a `referral_created` audit event.
- Records the mutation ID.
- Bumps the referral-store revision.

The route returns `201` only after the transaction succeeds.

## Step 9: Blob upload is a separate operation

After referral creation, the browser calls `uploadReferralPacket`:

1. Hash the file in the browser.
2. Reserve an upload packet and opaque target URLs.
3. Upload bytes directly to Azure Blob Storage in production.
4. Write the completion sentinel.
5. Ask Pipeline to finalize the reservation.
6. Read extraction status and any immediately available fields.
7. Patch the referral with packet metadata and extracted proposals using expected versions.

PostgreSQL and Blob Storage cannot share one normal transaction. The design therefore uses durable reservation, completion, idempotency, and reconciliation instead of pretending the two writes are atomic.

If referral creation succeeds and Blob upload fails, the referral shell can remain while the upload is retried or reconciled. That is a recoverable partial state, not permission to claim the packet was uploaded.

## Step 10: optimistic concurrency protects later writes

When linking packet information, the browser sends:

- `if_match`: the referral version.
- `if_match_sections`: the current section-version map.

`patchPostgresReferral` determines which sections the patch touches. A stale version in the same section returns a conflict. Disjoint section versions allow unrelated edits to proceed without silently overwriting one another.

The UI catches a `409`, retrieves the latest referral when available, and requires conflicting local fields to be resolved.

## Failure table

| Scenario | Expected control | Expected outcome |
| --- | --- | --- |
| Viewer calls create route | Role authorization | `403` response |
| Cross-site browser submits mutation | Same-origin check | Mutation rejected |
| Body contains `admissionDecision` | Runtime validation | `400` response |
| New referral starts at `Assessment` | Initial-stage validation | `400` response |
| Assessor assigns another assessor | Assignment policy | `403` response |
| Same mutation ID is retried | Advisory lock + idempotency table | Existing referral returned |
| Same packet hash is submitted twice | Packet lock + unique index | `409` duplicate response |
| Database is unavailable | Store readiness or database failure | No successful create response |
| Referral commits but Blob upload fails | Durable partial-state recovery | Referral remains; packet is not marked uploaded |
| Two users edit the documents section | Section-version check | One save wins; stale save receives conflict |
| Users edit identity and documents separately | Independent section versions | Both may succeed if their section versions are current |

## Checkpoints

Answer without looking at the lesson, then verify against source:

1. Why does `CreateReferralBody` not validate incoming JSON?
2. What is the difference between a mutation ID and a referral ID?
3. Why are there both application duplicate checks and database uniqueness?
4. Which writes are guaranteed atomic during PostgreSQL referral creation?
5. Why is the Blob upload not part of that transaction?
6. What proves that a referral is allowed to start in `New` but not `Assessment`?
7. Which layer prevents an assessor from assigning work to someone else?
8. What is the difference between referral version and section versions?
9. What state remains when the referral commits but upload fails?
10. Which test would you read first to prove duplicate or state-skip behavior?

## Guided exercise

Do this in a disposable learning worktree, never directly in the active product worktree.

1. Draw the create flow as ten boxes.
2. Label each box browser, route, domain, database, Blob, or worker.
3. Add the trust transition at each boundary.
4. Find the exact code that returns `409` for a duplicate packet.
5. Find the database index that provides the final duplicate defense.
6. Find the test that mutates workflow stage-skipping behavior and proves the suite catches it.
7. Write a new focused test for one malformed create input. Do not change runtime behavior.
8. Run the focused contract and explain why it would fail if validation were removed.

## Teach-back standard

Give a five-minute explanation with no notes covering:

- The normal create path.
- The four distinct trust controls in the route.
- The two advisory locks.
- The database/Blob consistency model.
- One race and one partial failure.

If any of those points requires reading the lesson verbatim, repeat the trace the next day.
