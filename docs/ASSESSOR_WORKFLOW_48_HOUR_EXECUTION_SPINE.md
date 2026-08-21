# Pipeline Assessor Workflow: 48-Hour Execution Spine

## Mission

In two engineering days, make Pipeline a dependable working system for four assessors who may collaborate on the same referral over roughly one week.

The release path must support:

1. Create a referral workspace.
2. Attach an initial packet or explicitly document a manual-intake exception.
3. Review extracted data or enter it manually.
4. Complete the structured assessment across multiple sessions.
5. Receive and classify late documents without disrupting completed work.
6. Record the admission decision and reason when declined.
7. Track post-decision requirements until the referral is ready to close or hand off.
8. Preserve ownership, history, drafts, and concurrent edits throughout.

This is the spine for implementation decisions. When work resumes, start at the first unchecked checkpoint. Do not redesign surrounding navigation or add adjacent product scope while a checkpoint in this document remains incomplete.

## Release Contract

The 48-hour release is successful only when all of the following are true:

- A real referral can be created without synthetic runtime data.
- Every visible editable field in the referral and assessment is persisted.
- Refreshing, closing, or navigating away does not silently discard work.
- Two users can work on the same referral without silent last-write-wins overwrites.
- The current owner, stage, next action, due date, and blockers each have one canonical source.
- Assessment completion advances the workflow into review instead of ending at a dead end.
- A declined decision requires a reason and moves the referral to `Declined`.
- An accepted decision remains visibly pending while required admission items are incomplete.
- Final acceptance is blocked until required items are complete or explicitly waived.
- Every transition, correction, waiver, reassignment, and conflict resolution is audited.
- The worklist tells each assessor what needs action without becoming a second workflow engine.
- The deployed build passes the focused release tests and one complete real-packet walkthrough.

## Architecture Boundaries

### Data ownership

- **Alamo owns:** current census, resident identity, governed clinical context, medications, and current-stay information.
- **Pipeline owns:** referral episodes, workspaces, uploaded documents, extraction proposals, assessments, requirements, decisions, assignments, due dates, workflow transitions, drafts, and audit history.
- **Identity joins are explicit:** use the governed resident key or a reviewed identity link. Never join records automatically by name alone.
- **Pipeline does not call ElderMark directly:** clinical information continues through the Alamo server-only API boundary.

### Source-of-truth rules

- One referral row owns the current lifecycle stage, owner, due date, priority, and next-action state.
- One canonical assessment record owns the 52 assessment fields and their completion state.
- Requirement records own document and post-decision completion states.
- Uploaded-file records own file metadata and storage references.
- Audit events describe changes; they do not become a competing state store.
- Worklist and completion summaries are derived projections, never independently editable copies.

### Security and cost boundaries

- No PHI, tokens, secrets, resident IDs, diagnoses, medication data, query strings, or upstream response bodies in logs.
- No clinical credentials in browser bundles or `NEXT_PUBLIC_*` variables.
- Runtime fails closed when live data is unavailable; sanitized fixtures remain test-only.
- Do not activate paid Azure services, automated malware scanning, or extraction infrastructure without explicit approval.
- Do not bypass the existing private Blob access boundary with public containers or long-lived public URLs.

## Canonical Lifecycle

Keep the existing persisted stages. Do not add a second set of statuses for cards, queues, or assessment subtasks.

| Persisted stage | Meaning | Required next action |
| --- | --- | --- |
| `New` | Workspace exists; intake has not been established | Add initial packet or record manual-intake exception |
| `Packet Needed` | Required intake material is missing | Upload, classify, or waive with reason |
| `Packet Review` | Packet or manual intake exists and extracted/manual data needs review | Resolve fields and complete intake review |
| `Assessment` | Structured assessment is underway | Complete assessment sections and resolve validation |
| `Community Review` | Assessment is complete; decision or admission requirements remain | Record decision or clear accepted requirements |
| `Accepted / Admitted` | Accepted and all blocking requirements are complete or waived | Close or hand off |
| `Declined` | Declined with a recorded reason | Close or hand off |

Derived substates may make the stage more useful without multiplying persisted statuses:

- `Assessment: 7 of 11 sections complete`
- `Community Review: decision needed`
- `Accepted; requirements pending`
- `Accepted; ready to finalize`
- `Blocked: TB result missing`
- `Waiting on external document`

### Transition rules

1. Creating a workspace starts at `New` or `Packet Needed`, depending on whether an initial source was attached.
2. Reviewing the intake moves the referral to `Assessment`.
3. Completing the canonical assessment moves the referral to `Community Review` in the same transaction.
4. Recording `No` requires a decline reason and moves immediately to `Declined`.
5. Recording `Yes` keeps the referral in `Community Review` while blocking requirements remain.
6. `Finalize acceptance` moves to `Accepted / Admitted` only when all blocking requirements are complete or explicitly waived.
7. Reopening a completed stage requires a reason and creates an audit event.

## Execution Order

Work proceeds in this order because each step removes a more fundamental workflow risk for the next one.

### Checkpoint 0: Freeze the baseline

**Objective:** Establish a reproducible starting point and protect unrelated worktree changes.

**Actions**

- Record the current branch, commit, dirty files, database migration level, and deployment revision.
- Select one provided referral packet as the canonical walkthrough fixture without moving PHI into source control.
- Record the two pilot users used for concurrency testing.
- Capture the current stage, assessment, requirements, and audit behavior before modifying it.
- Confirm no fake referrals or fake clients are served at runtime.

**Acceptance**

- Baseline commands and results are recorded in the implementation log.
- The real-packet test can be repeated locally without committing the source PDF.
- No unrelated file is reverted, rewritten, staged, or committed.

**Focused verification**

- Repository status only.
- Existing targeted referral and assessment tests only if a baseline failure needs to be distinguished from a regression.

### Checkpoint 1: Complete the decision clickpath

**Objective:** Remove the workflow dead end after assessment completion.

**Actions**

- Make assessment completion a transactional command that validates required fields, marks the assessment complete, bumps referral change sequence, and transitions to `Community Review`.
- Add a clear decision control to the workspace after assessment completion.
- Require a reason for `No`; save the decision and transition to `Declined` atomically.
- For `Yes`, show the incomplete admission requirements and derived `Accepted; requirements pending` state.
- Add an explicit `Finalize acceptance` action that is server-blocked until requirements are complete or waived.
- Return structured blockers with recovery text instead of generic errors.
- Make commands idempotent so retrying after a timeout cannot duplicate transitions or audit events.

**Likely files**

- `components/pipeline/ReferralPacketCanvas.tsx`
- `components/pipeline/ReferralRequirementsEditor.tsx`
- `lib/pipeline/referral-workflow.ts`
- `lib/pipeline/workflow-store.ts`
- Referral workflow API routes
- Targeted workflow tests

**Acceptance**

- The UI visibly continues from assessment to decision to closure.
- Invalid transitions fail on the server even if the UI is bypassed.
- Decision, transition, requirements, and audit updates are consistent after retries.
- A declined referral cannot exist without a reason.
- An accepted referral cannot finalize with an unresolved blocking requirement.

**Focused verification**

- Workflow transition unit tests.
- PostgreSQL transaction/integration tests for success, blocker, retry, and rollback paths.
- One browser journey from assessment completion through both decision branches.

### Checkpoint 2: Make assessment work durable and collaborative

**Objective:** Give the assessment the same recovery and concurrency guarantees as the referral workspace.

**Data model**

- Add assessment section versions rather than relying on one assessment-wide version.
- Reuse `user_workspace_state` for per-user assessment recovery drafts where practical.
- Use section identifiers such as `assessment:identity`, `assessment:clinical`, and `assessment:risk` for presence leases.
- Ensure every successful assessment mutation increments the referral change sequence so all open workspaces refresh.

**Mutation contract**

- Patch one assessment section at a time.
- Include `if_match_section` with every section mutation.
- Include an idempotency key for retried saves.
- Return the saved section, new version, referral change sequence, and conflict details.
- Reject stale same-field writes with a structured `409` response.

**Client behavior**

- Autosave dirty sections after 1 to 1.5 seconds of inactivity.
- Save a local/server recovery draft immediately when fields change.
- Show `Saving`, `Saved`, `Offline draft`, `Conflict`, or `Save failed` near the section being edited.
- Poll the lightweight change endpoint every three seconds while the assessment is active.
- Send presence heartbeats every 15 seconds; leases expire after 45 seconds.
- Merge remote changes automatically when they affect clean fields.
- Show a remote-change banner when the same section changed.
- For same-field conflicts, present `Keep mine` and `Use latest` with both values and authors/times when available.
- Warn before leaving only when local changes are neither saved nor recoverably drafted.

**Likely files**

- `components/pipeline/AssessmentWorkspace.tsx`
- `lib/assessment/assessment-store.ts`
- `lib/assessment/assessment-records.ts`
- Assessment mutation, change-sequence, draft, and presence API routes
- A new additive PostgreSQL migration
- Two-session Playwright coverage

**Acceptance**

- Every visible assessment field survives refresh and a new browser session.
- Two users editing different sections see each other's changes within approximately three seconds.
- Two users editing the same field never silently overwrite one another.
- An expired presence lease does not leave a user permanently marked as editing.
- Assessment completion uses the canonical assessment, not legacy duplicate fields.

**Focused verification**

- Assessment persistence and validation tests.
- PostgreSQL expected-version and idempotency tests.
- Two authenticated browser contexts for different-section and same-field edits.
- Draft recovery after forced refresh and interrupted network.

### Checkpoint 3: Correct progress, queues, and completion summaries

**Objective:** Make operational guidance accurately reflect canonical stored data.

**Actions**

- Remove referral completion calculations that read legacy assessment summaries when the canonical assessment is available.
- Build one server-side progress projection from referral, canonical assessment, requirements, decision, and files.
- Derive `next_action`, blocker, overdue state, and completion counts from that projection.
- Keep `My queue` narrow: active referrals assigned to the signed-in user that require a current action.
- Define team queues from the same projection, including unassigned, overdue, packet needed, assessment due, decision needed, accepted requirements pending, and conflicted saves.
- Ensure manual entry counts as data completion without pretending an extraction occurred.
- Ensure late documents can satisfy requirements without resetting unrelated assessment progress.

**Likely files**

- `lib/pipeline/referral-progress.ts`
- Worklist/query modules
- Home/workspace completion components
- Progress and queue tests

**Acceptance**

- The same referral shows the same stage, blocker, owner, and next action on every page.
- A completed canonical assessment cannot appear incomplete because of stale legacy fields.
- Unassigned work is visible and cannot masquerade as someone's queue.
- Queue counts match the underlying referral list for each filter.

**Focused verification**

- Projection unit tests across representative lifecycle states.
- Query tests for owner, overdue, blocker, and accepted-pending queues.
- One browser check comparing worklist and workspace status.

### Checkpoint 4: Replace free-text ownership

**Objective:** Make assignment reliable for four assessors without introducing a Microsoft Graph dependency during the two-day push.

**Actions**

- Add a `workspace_members` directory keyed by immutable Entra/Pipeline user ID.
- Upsert authenticated users with current display name and email snapshot.
- Seed approved pilot users from configuration or a controlled production seed command.
- Replace owner free text with a searchable member selector.
- Store immutable owner ID plus display snapshot on the referral.
- Require a handoff note when reassigning active work.
- Audit old owner, new owner, actor, reason, and timestamp.
- Preserve historical display names even if an Entra profile changes later.

**Acceptance**

- New active work must have a valid owner or appear explicitly as `Unassigned`.
- Queues use owner ID, not display-name string matching.
- Reassignment immediately updates the old and new owners' queues.
- Reviewers continue to see only referrals permitted by their role and assignment.

**Focused verification**

- Membership and access-control tests.
- Reassignment transaction and audit tests.
- Two-user browser check for queue handoff.

### Checkpoint 5: Support honest manual intake

**Objective:** Let assessors work without automated extraction or an available source packet while preserving data provenance.

**Actions**

- Model initial packet status as a requirement rather than inferring it from arbitrary field completion.
- Offer `Upload source packet` and `Continue with manual intake` as explicit paths.
- Manual intake requires a reason and records actor/timestamp.
- Distinguish field provenance: extracted, manually entered, corrected from extraction, imported, or Alamo-governed.
- Do not create a fake uploaded-file record for manual intake.
- Allow a later source packet to be attached and reviewed without replacing previously confirmed manual values.

**Acceptance**

- A referral can advance through a documented manual workflow.
- The record never claims a packet was uploaded when none exists.
- Later extracted suggestions do not silently overwrite reviewed manual values.
- Reviewers can see how each important value entered the record.

**Focused verification**

- Manual-intake workflow tests.
- Late-packet merge tests.
- Audit and provenance assertions.

### Checkpoint 6: Reconcile historical coverage

**Objective:** Prove what prior data is present without attempting an unsafe two-day bulk migration.

**Actions**

- Inventory source canvases/clients/files/structured assessments available for migration.
- Compare source counts, bytes, and hashes with Pipeline metadata and Blob objects.
- Classify each source record as present, metadata-only, file-only, unmatched, structured-not-imported, or intentionally excluded.
- Produce a PHI-safe summary report and a protected detailed reconciliation artifact.
- Require explicit identity review for ambiguous matches; never attach by name alone.
- Use the existing import and rollback tooling documented in `docs/CLIENT_FILE_IMPORT.md`.

**Acceptance**

- We can state exactly which historical records are available for the demo and which are not.
- Every imported file has a valid storage object, hash, metadata row, and authorized preview path.
- The import can be rerun idempotently and rolled back by batch.
- No source file is deleted or mutated.

**Focused verification**

- Dry-run reconciliation.
- One small controlled import batch.
- Hash comparison, preview authorization, rollback drill, and rerun.

### Checkpoint 7: Validate the real weekly assessor journey

**Objective:** Prove the product with a realistic referral rather than isolated controls.

**Scenario**

1. Assessor A creates the referral and becomes owner.
2. Assessor A uploads the face sheet and reviews extracted or manual identity data.
3. Assessor A completes several assessment sections and leaves.
4. Assessor B opens the same referral, sees presence and saved progress, and edits another section.
5. Both assessors edit the same test field and resolve the conflict explicitly.
6. A late TB result or agreement is uploaded and classified against its requirement.
7. The assessment is completed and advances to `Community Review`.
8. A supervisor records `Yes`; the workspace shows outstanding requirements.
9. The last blocker is completed or waived with a reason.
10. The supervisor finalizes acceptance and verifies the complete audit trail.
11. Repeat the decision tail with `No` and confirm the decline reason is required.

**Acceptance**

- No step needs direct database intervention.
- No visible field loses data after refresh or user handoff.
- No user sees a silent overwrite.
- Every action appears in the right queue and audit history.
- Every uploaded file opens through an authorized application endpoint.
- The full path is understandable without developer explanation.

## Two-Day Schedule

The schedule is ordered by release risk, not visual prominence.

### Day 1: Workflow and collaboration

| Timebox | Work | Exit condition |
| --- | --- | --- |
| 1 hour | Checkpoint 0 baseline | Reproducible state and fixture selected |
| 4 hours | Checkpoint 1 decision clickpath | Assessment-to-decision path works transactionally |
| 7 hours | Checkpoint 2 assessment durability | Autosave, drafts, versions, polling, presence, conflict UX work |
| 2 hours | Focused integration and two-user tests | Collaboration cases pass without silent overwrite |

**Day 1 stop condition:** Do not begin styling or migration work while the assessment still loses edits, conflicts silently, or ends without a decision path.

### Day 2: Operational truth and release evidence

| Timebox | Work | Exit condition |
| --- | --- | --- |
| 3 hours | Checkpoint 3 progress and queues | Canonical assessment drives accurate next actions |
| 2 hours | Checkpoint 4 controlled ownership | Four pilot users can be assigned reliably |
| 2 hours | Checkpoint 5 manual intake | Manual and late-packet paths are honest and auditable |
| 2 hours | Checkpoint 6 reconciliation | Historical coverage is measured and reported |
| 3 hours | Checkpoint 7 real journey | Full workflow passes with two users and one real packet |
| 2 hours | Release verification and deployment | Production smoke, rollback point, and evidence recorded |

If time compresses, defer historical import execution and cosmetic refinement. Do not defer persistence, conflict protection, workflow completion, access control, or audit correctness.

## Verification Triage

Run checks proportional to the risk of each change. Do not run the complete suite after every small edit.

| Change type | Required checks |
| --- | --- |
| Copy, spacing, or isolated component style | Targeted lint/type check for affected area; visual browser check |
| Pure domain calculation | Targeted unit tests and type check |
| API mutation or persistence | Targeted unit, contract, and PostgreSQL integration tests |
| Workflow transition | Transition matrix tests plus one focused browser journey |
| Collaboration/presence/versioning | PostgreSQL concurrency tests plus two-session Playwright |
| Authentication/access | Role/access tests plus authenticated smoke |
| File import/preview | Hash, metadata, authorization, range/pagination, and rollback tests |
| Integrated release candidate | Build, selected E2E, clinical/platform checks, production-like smoke |
| Final release only | Full CI, full E2E, McMaster benchmark, migration and rollback evidence |

### Release test matrix

- `401`: unauthenticated clinical and protected Pipeline routes.
- `403`: authenticated user lacking referral/file permission.
- `404`: missing referral, resident, assessment, or file.
- `409`: stale section version and invalid workflow precondition.
- `413` or equivalent: file/response exceeds configured size.
- `502`: invalid upstream response.
- `503`: unavailable live source with no synthetic fallback.
- Stale Alamo data is clearly labeled.
- Pagination is stable and bounded for large lists and documents.
- Authorized file preview supports large documents without loading every page at once.
- Save, conflict, extraction-failure, stale-lease, queue-age, and response-latency metrics contain no PHI.

## Deployment and Rollback

### Before deployment

- Confirm additive migrations are forward-compatible with the currently deployed code.
- Back up the production database or verify the provider's point-in-time recovery state.
- Run migrations against an isolated PostgreSQL fixture first.
- Run the selected real workflow without committing PHI artifacts.
- Confirm all required Entra, database, Blob, and Alamo API variables are present without printing values.
- Record the current healthy production revision.

### Deployment order

1. Apply additive database migrations.
2. Deploy server code that can read old and new records.
3. Deploy client behavior using the new mutation contracts.
4. Run authenticated health and workflow smoke tests.
5. Enable pilot use for the four assessors.
6. Monitor save conflicts, failed saves, stale leases, queue age, response latency, and extraction/manual-review failures.

### Rollback rule

- Roll application code back to the recorded healthy revision if authentication, loading, access, or core saves fail.
- Do not destructively roll back an additive migration after new-version writes have occurred.
- Keep new columns/tables dormant if the application is rolled back.
- Use batch IDs to reverse pilot imports without deleting unrelated files or records.

## Operational Measures

The pilot dashboard should stay small and actionable. Record counts and latency without PHI.

- Referral saves attempted, succeeded, failed, and conflicted.
- Assessment section saves attempted, succeeded, failed, and conflicted.
- Median and p95 save latency.
- Active and expired editing leases.
- Draft recoveries offered and accepted.
- Extraction attempts, failures, and fields requiring correction.
- Queue age by derived next-action category.
- Unassigned active referrals.
- Overdue referrals.
- Time from referral creation to packet review, assessment completion, decision, and finalization.
- File preview failures and response-size rejections.

## Explicit Non-Goals

The following work is deferred until the assessor path meets the release contract:

- Global navigation or visual redesign.
- Desktop packaging and update distribution.
- Advanced analytics or executive dashboards.
- A generic workflow-builder framework.
- A new kanban implementation or drag-based stage changes.
- Direct ElderMark access from Pipeline.
- Full historical migration without reconciliation evidence.
- Automated production extraction that depends on an unapproved paid service.
- EHR writeback presented as complete before the receiving system confirms it.
- New duplicate status, owner, due-date, or assessment stores.
- Synthetic production data or silent fallback behavior.

## Stop Rules

Stop and correct course immediately when any of these occur:

- A proposed change creates a second source of truth.
- A field is visible and editable but not persisted.
- A transition can succeed in the client while failing on the server.
- A stale write can overwrite another user's work without a conflict.
- A workflow state is inferred from display text or card position.
- A name-only identity match would attach clinical data or files.
- A runtime path requires fake live data.
- A log statement could include PHI or credentials.
- A paid Azure feature would be enabled without explicit approval.
- A broad refactor cannot be tied directly to a release-contract item.
- A full test suite is being run for a change that targeted checks can validate.

## Definition of Done

All boxes must be checked before declaring the two-day workflow complete.

### Workflow

- [x] Referral creation produces one durable workspace.
- [x] Packet and manual-intake paths are both supported and clearly distinguished.
- [x] Intake review advances to assessment.
- [x] Assessment completion advances to community review.
- [x] Decline requires a reason and closes correctly.
- [x] Acceptance remains pending until requirements are clear.
- [x] Final acceptance is server-constrained and audited.

### Persistence and collaboration

- [x] Every visible editable referral field is stored.
- [x] Every visible editable assessment field is stored.
- [x] Referral and assessment drafts recover after refresh/interruption.
- [x] Section autosave has clear status and actionable failure messages.
- [x] Presence leases refresh and expire correctly.
- [x] Remote clean-field changes merge.
- [x] Same-field changes require explicit resolution.
- [x] Two simultaneous authenticated sessions pass the workflow test.

### Operational truth

- [x] Owner uses an immutable user ID.
- [x] Due date, stage, blocker, and next action have one source each.
- [x] My Queue and team queues derive from canonical progress.
- [x] Canonical assessment drives completion everywhere.
- [x] Reassignments, waivers, corrections, and transitions are audited.

### Files and historical evidence

- [x] Required-document checklist and uploaded files are linked.
- [x] Preview and thumbnail routes enforce authorization.
- [x] Large documents paginate without loading all pages at once.
- [x] Historical source-vs-Pipeline reconciliation report exists.
- [x] Database migrations, integration fixtures, and transactional rollback are evidenced on disposable PostgreSQL.
- [ ] A controlled Blob-backed pilot import and batch rollback are evidenced in the deployment environment.

### Release

- [x] Targeted tests pass at every checkpoint.
- [x] Final build and selected E2E pass.
- [x] Full release checks pass once.
- [x] McMaster performance remains within the agreed tolerance.
- [ ] Authenticated production smoke passes.
- [x] Rollback revision and procedure are recorded.
- [x] No fake runtime data, direct ElderMark call, public Blob shortcut, or PHI logging exists.

## Implementation Evidence: 21 August 2026

- Baseline revision: `2808a87ad456c4a31d628af7112daac2dabd8a7e`; unrelated worktree changes were preserved.
- Production build, TypeScript, ESLint, artifact audit, route policy, security boundary, API contracts, recovery, release compatibility, operational metrics, failure recovery, extraction state machine, and platform-fast checks passed.
- The complete Playwright suite passed with 45 tests and 7 intentional feature-gated skips. It covers the real workflow surfaces, mobile geometry, two-session collaboration, draft recovery, accepted and declined decisions, file failure boundaries, queues, search, reconciliation, and response security.
- The three-run McMaster certification passed every enforced check. Worst observed values were 75.3 ms TTFB, 124 ms FCP, 472 ms LCP, 40 ms INP, 0 CLS, 100.8 ms warm navigation, 115.7 ms localized interaction, 1 ms ordinary API p95, and 2.9 ms heavy API p95.
- The 10-user collaboration rehearsal passed 20 change polls, 10 distinct leases and releases, two disjoint saves, and a one-winner/nine-conflict same-section save.
- The PostgreSQL-backed 10-user rehearsal additionally passed per-user recent and recovery-draft isolation, draft contention, cleanup, and database contention. Its worst p95 was 17.6 ms.
- The synthetic scale rehearsal passed at 1,300 profiles, 50 active referrals, four assessors, 12,000 documents, and 46.9 GB of document content.
- An operator-supplied 86-page packet completed ingestion, evidence rendering, field review, correction history, and reopen verification without committing the packet to source control.
- The historical reconciliation dry run verified five local source files byte-for-byte and hash-for-hash and wrote its detailed evidence outside source control with owner-only permissions.
- A disposable loopback-only PostgreSQL 14 cluster accepted all nine migrations, passed the synthetic workflow transaction, rejected duplicate packet hashes, rolled fixture data back, and passed the full five-migration transactional rollback/restoration drill.
- The rollback drill exposed and corrected a nested transaction boundary in the `0009` rollback; a static contract now prevents rollback scripts from owning the caller's transaction.
- Historical binary import now uses non-overwriting conditional Blob creation, verifies an existing deterministic object before reuse, converges concurrent document inserts, and treats reviewed exclusions as resolved batch items. A new dry-run-first batch rollback soft-deletes documents, cancels active processing, refuses files already used as evidence, removes only batch-owned Blob targets, and restores review state after successful deletion. Its disposable PostgreSQL rehearsal proved a no-write plan and evidence-link refusal without contacting Azure Blob Storage.
- Read-only Azure inspection confirmed the existing production revision is running, all required configuration names are present through values or secret references, the runtime managed identity has `Storage Blob Data Contributor`, and both `/api/health/live` and `/api/health` return `200`. PostgreSQL, Entra, Alamo clinical API, referral, assessment, resident-link, and per-user workspace-state checks are ready.
- A browser-authenticated production baseline smoke completed the real Microsoft account flow, loaded the signed-in home and queue, opened referral workspaces without an error notice, loaded 100 governed directory rows, and opened a client profile with 11 rendered sections and no error notice. No record values were emitted into the evidence.
- The current Azure revision predates this uncommitted release candidate. A controlled Blob-backed pilot import and an authenticated smoke after deployment therefore remain release gates rather than claimed passes.

## Resume Protocol

Whenever implementation resumes:

1. Read this document and the current implementation log.
2. Check the first incomplete checkpoint and its acceptance criteria.
3. Inspect only the files and contracts relevant to that checkpoint.
4. Make the smallest coherent vertical change that advances its acceptance criteria.
5. Run the focused checks listed for that change type.
6. Update the checkpoint evidence before starting adjacent work.
7. Do not move to the next checkpoint while the current one has a correctness failure.

**First implementation action:** freeze the baseline, then close the assessment-to-decision workflow gap before making further layout or navigation changes.
