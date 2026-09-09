# Referral Canvas Workflow Audit — Agent Prework

Author: TARS (agent-generated supporting evidence)

Status: observed technical prework; not an owner architecture narrative, start approval, file disposition, assurance decision, or completed refactor

Observed commit: `5e015d2bd979da98c26da7b858600a0bcba7403a`

Observed worktree: `/Users/eric/pipeline-refactor-referral-canvas`

Observed branch: `codex/refactor-referral-canvas`

No application code, persistence behavior, route behavior, layout, copy, or click path was changed while producing this audit.

## Outcome

The three canvas surfaces already contain substantial safety machinery: section-scoped optimistic concurrency, serialized autosave, explicit field-conflict choices, browser/server recovery drafts, encrypted offline assessment working sets, presence leases, versioned identity review, stable referral mutation identifiers, and auditable server commands. The next safe move is not a cosmetic component split.

Four behavior defects or high-confidence failure modes should be corrected before structural movement, and two recovery contracts need stronger executable evidence:

1. The resident-link API does not enforce the referral-versus-resident date-of-birth conflict at candidate creation or confirmation.
2. An extraction field review and the resulting referral projection are two separately durable mutations, so the review may commit while the projection fails.
3. The final identity-confirmation control omits the evidence the reviewer needs and does not reconcile a stale candidate after a `409`.
4. Custom modal dialogs declare modal semantics without implementing the required focus lifecycle.
5. Assessment edits made inside the 250/350 ms local-persistence windows have no component-unmount flush; routine close currently keeps the component mounted, so this is an unproved lifecycle boundary rather than a reproduced common-path loss.
6. Assessment command retry identifiers are regenerated for a new invocation, leaving an ambiguous-response retry dependent on optimistic conflict handling rather than stable replay.

## Scope traced

- `components/pipeline/ReferralPacketCanvas.tsx`
- `components/pipeline/AssessmentWorkspace.tsx`
- `components/pipeline/ClientProfileView.tsx`
- Direct route, store, identity, extraction, activity, recovery-draft, offline-queue, and browser-test dependencies needed to trace actual effects and recovery behavior.
- Existing focused browser and critical-safety tests listed in the machine observation record.

The route and store modules below are observed prerequisite boundaries, not proposed opportunistic additions to the `referral-canvas-components` structural scope.

## Workflow 1: referral packet intake and collaborative editing

### Observed path

1. The canvas loads an existing referral or initializes a new workspace with the current user as its default owner.
2. Field edits are tracked as dirty keys with their base values and base referral version.
3. A 350 ms recovery path persists either a server-scoped draft or a tab-scoped `sessionStorage` draft. The canvas also persists on the dirty-state effect cleanup.
4. The server autosave builds a patch from a snapshot, supplies record and section expectations, and reuses a stable mutation identifier for the same logical referral patch.
5. Remote polling merges non-conflicting values and presents explicit “keep mine” or “use latest” choices for collisions.
6. Packet and supporting-document upload/linking happen after workspace persistence, with visible failure messages and retryable local state.
7. Extraction review first writes the packet field decision, then fetches current packet fields, then separately patches the referral projection.

### Properties already present

- A remote save cannot silently clear local fields changed after the request snapshot.
- Same-section conflicts produce a latest-record reconciliation path; disjoint section edits can coexist.
- Draft state includes the base version, base values, dirty keys, form values, tags, requirements, document metadata, and pending initial packet name/category.
- Presence and revision polling clean up their timers/listeners and issue presence cleanup.
- Duplicate-person review is explicit and referral create retries reuse their mutation identifier.
- The existing activity display reuses `ReferralActivityPanel`; a new history implementation is not warranted.

### Confirmed split-commit failure mode: extraction review projection

`reviewExtractedField` posts the evidence decision at `ReferralPacketCanvas.tsx:1453-1464` and marks it saved at line 1465. Only afterward does it patch the referral at lines 1526-1539. A network failure, authorization change, validation error, or section conflict during the second command leaves the packet field durably reviewed while the referral projection remains old. The catch path distinguishes a conflict before the field review from one after it, but it does not roll back, repair, or enqueue reconciliation for the already-saved field review.

Bulk acceptance repeats this two-command boundary one field at a time. The referral patch has a stable mutation identifier; the field-review request has no equivalent client mutation identifier in this UI call. A retry may therefore create a second field-review version/audit transition before projection converges.

Required bounded repair:

- Define one server-owned command or durable reconciliation contract that couples a review decision to the canonical projection.
- If true transaction coupling is unavailable across owners, persist an explicit “projection pending/failed” state and make retry idempotent.
- Characterize injected failure after the review commit, stale referral projection, retry, audit cardinality, and final provenance.
- Do not hide provenance by copying only the final value into the referral.

## Workflow 2: assessment scheduling, interview, autosave, and signing

### Observed path

1. Assessment creation, scheduling, starting, section editing, extraction-answer review, signing, and recall each use explicit server commands and version expectations.
2. Section saves are serialized through `saveQueueRef`. A response rebases only values unchanged since that request was sent; newer local input remains dirty.
3. Offline failures enqueue the exact serialized request body in encrypted browser storage and retain the last confirmed server record as the conflict base.
4. Recovery state is written to the server after 350 ms and to the encrypted offline working set after 250 ms.
5. Remote versions are polled and three-way merged; field conflicts remain visible until explicitly resolved.
6. The assessment overlay remains mounted when the user returns to the workspace, so the ordinary close button does not itself discard the in-memory draft.

### Recovery evidence gap

Unlike the referral canvas, the assessment component’s lifecycle cleanup only removes the `beforeunload` listener. It does not synchronously capture the current draft or explicitly flush its queued section saves on component unmount. Changes made less than 250/350 ms before a parent navigation or remount can therefore leave before the storage timers fire. The current browser suite proves refresh recovery after persisted state and proves the full schedule-to-recall happy path, but does not force unmount during those pending windows.

`beforeunload` is a warning, not a durable recovery mechanism. Browser guidance notes that it is not reliably fired, especially on mobile, and recommends `visibilitychange` for saving state. This does not prove data loss in Pipeline; it establishes why the missing remount/unmount test is necessary.

Required characterization before moving hooks or state:

- Edit and immediately unmount/remount before both persistence timers fire.
- Navigate while a server section save is in flight and while an offline queue write is pending.
- Background/foreground the page and verify a recoverable working set.
- Reopen with a newer remote section version and prove explicit conflict recovery.
- Verify recovery records are principal-scoped, expire as intended, and contain no authentication tokens.

### Ambiguous-response retry gap

Each new save/start/schedule/sign/review invocation calls `mutationId(...)` again. The exact body is stable once placed in the offline queue, but an online request that commits and loses its response is retried by the operator as a new logical mutation. Section/version checks usually turn that into a conflict rather than a duplicate effect, but the UI lacks a stable replay promise for the original command. This is lower risk than the extraction split commit and should be corrected or explicitly documented per command before code movement.

## Workflow 3: client profile and resident identity review

### Observed path

1. Suggested matches show the Pipeline client name, community, workspace id, and match reasons.
2. Candidate creation uses a confirmation prompt, a stable per-referral mutation identifier, the explicit referral id, the explicit governed resident key, resident number, community, method, and confidence.
3. Candidate confirmation/rejection is a second explicit action guarded by role authorization, same-origin validation, referral resource access, and optimistic version matching.
4. Rejection requires a note in the UI and validation boundary.
5. Both local and PostgreSQL stores prevent one person or resident from acquiring colliding confirmed links and write review audit events with the state transition.

### Critical invariant gap: DOB conflict is not enforced at the HTTP/store boundary

The pure master-matching policy correctly blocks a resident-number match with a different DOB, and the critical-safety suite proves that policy. The resident-link mutation boundary does not use that result:

- Candidate creation verifies referral ownership, Pipeline client id, governed community, and any supplied resident number.
- It overwrites client-supplied display name and DOB with referral values.
- It does not compare the referral DOB with the governed resident DOB returned by the clinical record.
- Confirmation verifies authorization, version, candidate status, and link collisions, but does not re-read or revalidate the identity evidence.

An authorized direct API caller can therefore create and confirm a candidate for an accessible referral and a governed resident whose DOB conflicts, provided the resident key/community/number identify that resident. Normal UI suggestions reduce exposure but are not a server invariant. This violates the recorded proof obligation that identifier and DOB conflicts block linking.

Required bounded repair:

- Reject a candidate when both canonical DOB values are present and differ.
- Bind the compared evidence to the candidate or revalidate it at confirmation so a changed source cannot bypass the rule.
- Preserve explicit manual review for non-conflicting candidates; do not auto-link by name.
- Add route-level local and PostgreSQL tests for mismatched DOB, wrong resource, stale candidate, rejected candidate, retry, no audit/write on denial, and source change between candidate and confirm.

### Reviewer evidence and stale-state defects

The suggestion screen contains names and reasons, but after candidate creation the confirmation UI renders only “Possible referral match” and the creating actor. It omits both identities, DOB/resident-number comparison, community, match method, confidence, and reasons. The most consequential click therefore has less evidence than the earlier proposal step.

On a stale `409`, `reviewCandidate` shows the generic API error but does not replace the candidate with the returned current link or offer a focused reload action. The reviewer remains on stale controls until the surrounding profile is refreshed.

Required bounded repair:

- Carry a minimal, server-derived evidence snapshot into the final review surface.
- Clearly mark matches, missing values, and blockers without exposing unnecessary identifiers.
- On `409`, hydrate the latest candidate state and disable obsolete actions.
- Keep confirmation and rejection separate, explicit, and audited.

## Cross-cutting accessibility defect: modal focus lifecycle

Assessment, scheduling, beginning-assessment, and evidence dialogs use `role="dialog"`/`aria-modal="true"`, but the traced implementations do not move focus into the dialog, contain `Tab`/`Shift+Tab`, or restore focus to the invoker. Escape handling exists for some surfaces, and outside-click handling exists for the evidence dialog, but those do not complete modal keyboard behavior.

The WAI-ARIA dialog pattern requires focus to enter a modal dialog, remain contained while open, and normally return to the invoking control when closed. The smallest repair is one canonical dialog/focus owner reused by these surfaces, followed by keyboard tests. Do not create a second visual design system or redesign the overlays.

References used to define the browser behavior baseline:

- W3C WAI-ARIA Authoring Practices, Modal Dialog Pattern: <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>
- W3C Technique H102, HTML `dialog`: <https://www.w3.org/WAI/WCAG22/Techniques/html/H102>
- MDN, `beforeunload` reliability: <https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event>

## Prioritized correction order

| Order | Item | Classification | Why first |
| --- | --- | --- | --- |
| 1 | Enforce and revalidate identity DOB/identifier conflicts at the server boundary | Confirmed safety defect | Prevents an incorrect cross-system identity join even when the UI is bypassed or evidence changes. |
| 2 | Make extraction review-to-referral projection one recoverable/idempotent contract | Confirmed split-commit failure mode | Prevents reviewed evidence and canonical workspace data from silently disagreeing. |
| 3 | Restore evidence at final identity review and reconcile stale candidates | Confirmed decision-usability/recovery defect | The final human gate must show the facts it asks the reviewer to attest. |
| 4 | Add assessment immediate-unmount/in-flight/visibility characterization and then close any demonstrated gap | Evidence gap with plausible loss window | State must be proven before moving autosave or recovery hooks. |
| 5 | Centralize modal focus lifecycle without visual redesign | Confirmed accessibility defect | Current modal semantics are incomplete for keyboard and assistive-technology users. |
| 6 | Stabilize or document assessment retry identifiers by command | Recovery-contract gap | Removes ambiguity after a commit whose response is lost. |

Items 1-3 are behavior-hardening prerequisites and should be authorized as bounded product corrections rather than smuggled into a file-size refactor. Item 4 begins with tests. Item 5 should use one existing or minimally extracted owner. Structural splitting follows only after those contracts are executable.

## Smallest proposed structural sequence after correction

1. Point browser type-only imports directly at the existing stable type owners while retaining server-store re-exports for compatibility.
2. Extract pure, render-only sections whose props are serializable snapshots and explicit command callbacks; do not move autosave, polling, queue, or conflict ownership in that step.
3. Move one state machine at a time only after its remount, retry, conflict, cleanup, and denial evidence is green.
4. Keep `ReferralActivityPanel` canonical and reuse it rather than creating canvas-specific history code.
5. Re-run the same first-attempt browser scenarios after each move; a line-count reduction is not evidence of preserved behavior.

## Current evidence

At the observed commit:

- Three focused Chromium scenarios passed: two-session section conflict/presence, tab-scoped referral-draft recovery/autosave, and explicit human identity review.
- The full assessment schedule, begin, complete, sign, and recall scenario passed.
- All 32 critical-safety contracts passed, including the pure master-matching DOB-conflict contract.
- Refactor guidance and setup checks passed with expected warnings that this future slice remains unowned, unapproved, and incomplete.

This evidence does not cover the six gaps above and does not certify the application or this future refactor slice.

## TARS disposition

`referral-canvas-components` remains `not_started`. Do not activate it from this audit alone. The next owner-authorized work should be the bounded identity-integrity correction and its denial/no-side-effect tests, followed by extraction projection recovery. Only then should the owner approve a component-splitting iteration against an exact start commit.
