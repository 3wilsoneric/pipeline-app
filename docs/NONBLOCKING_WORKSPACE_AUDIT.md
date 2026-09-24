# Non-blocking workspace audit

Status: proposal for owner approval. No behavior has changed yet. Audited against `main` at `35cd304c` (2026-09-24).

## Goal

Once someone is inside a referral, nothing stops them from moving, editing, or saving. Saves happen in the background, and a failed save is visible and retryable but never traps the person on a page. A control waits only where doing something twice would cause real harm: signing, sending, recording the final decision, and switching accounts.

Pipeline is already a single-page app. The blocking is deliberate "wait until saved" logic, not page loads.

## What already exists and helps

- **Intake.** Intake writes a protected local recovery copy (`saveLocalReferralRecovery`, `ReferralPacketCanvas.tsx:766`) and keeps a save queue (`intakeSaveQueueRef`).
- **Assessment.** The assessment's `saveBeforeExit` already accepts either the local recovery copy or the server save (`AssessmentWorkspace.tsx:1387`, `Promise.any`), and it has an offline mutation queue.
- **Autosave.** Autosave does not set the assessment's `isBusy`. Only explicit actions do: create, begin, review extracted field, sign, schedule, and add note.

## A. Moving between tabs waits on saves

Highest impact.

| # | Where | What happens now | Protects | Recommendation |
|---|---|---|---|---|
| A1 | `ReferralPacketCanvas.tsx` `navigatePage` → `await handoff.flush()` | If the handoff save fails, the tab silently does not change. No message appears. | Unsent handoff edits | **Remove the wait.** The handoff already owns its error and retry; switching tabs must not depend on it. |
| A2 | `navigatePage` → `await assessmentNavigationRef` → `saveForHeaderNavigation` (`AssessmentWorkspace.tsx:1441`) | Throws "Wait for the assessment action to finish before leaving." during any action, and "Your last changes could not be saved…" if both the local copy and the server save fail. The person stays put. | Unsaved answers; in-flight actions | **Change.** Leave immediately once answers are in the local copy (already the rule). Let an in-flight action finish in the background. If both saves fail, still leave, keep the draft in memory above the page, and show a persistent "Not saved yet. Retrying" banner with Retry. |
| A3 | `navigatePage` → `await preservePendingIntake()` + `await intakeSaveQueueRef.current` | A failed intake save keeps the person on Intake with an error. | Unsaved intake fields | **Change.** Same as A2. The local copy first, then navigate. The queue continues after the page changes. |
| A4 | `reviewChart` (`AssessmentWorkspace.tsx:1572`): Review assessment and Review unanswered items | Waits for `saveBeforeExit`. A failure keeps the person in the interview. | Unsaved answers | **Change**, as in A2. |

**Why they wait today.** Switching tabs unmounts the page, and its pending edits and save queue live inside it. The fix that makes the rest safe is to hold each referral's pending edits and save queue one level up, in the workspace shell, keyed by referral. Switching tabs then no longer cancels anything. This builds on the existing local recovery copy rather than adding a new store.

## B. Controls turned off while something unrelated is saving

| # | Where | What happens now | Recommendation |
|---|---|---|---|
| B1 | Decision panel: one shared `busy` (`ReferralWorkflowPanel.tsx:69`) | While any single change saves, every checklist dropdown, outcome card, stage select, and Done button is disabled (11 controls in `ReferralWorkflowPanelPresentation.tsx`). | **Change** to per-item busy. Only the item being saved waits; everything else stays usable. Keep the double-submit guard on Record decision. |
| B2 | Assessment: `isBusy \|\| isClosing` on about 14 controls (`AssessmentWorkspace.tsx:1871–2221`) | Previous section, Next section, Review assessment, Review unanswered items, Return to interview, Schedule interview, Add note, and Prepare assessment all freeze during create, begin, schedule, sign, or add note. | **Change.** Navigation controls (Previous/Next section, Review, Return to interview) are never disabled. Action buttons wait only for their own action. |
| B3 | Intake "Done" (`ReferralPacketCanvas.tsx:2721`) | Disabled while any intake save runs. | **Remove the wait.** Done navigates and the save continues (with A3). |
| B4 | Scheduling dialogs (`AssessmentSchedulingDialogs.tsx`) | "Back to assessment" and "Keep preparing" are disabled while busy. | **Change.** Closing a dialog is never disabled. Save stays disabled for invalid input. |

## C. Whole-page locks

| # | Where | What happens now | Recommendation |
|---|---|---|---|
| C1 | `ReferralPacketCanvas.tsx:2798` `inert={draftRecoveryLoading}` with "Restoring saved work..." | The whole workspace is frozen while local recovery is read. | **Keep, but bound it.** Merging a recovery copy into stale fields is how edits get lost, so the brief lock is correct. Add a time limit (for example 3 seconds). After it, show the page and restore in the background with a notice. |

## D. Account-switch guards

| # | Where | Message | Recommendation |
|---|---|---|---|
| D1 | `ReferralPacketCanvas.tsx:1963–1964` | "Wait for the email delivery result / workspace and files to finish saving before switching." | **Keep.** Identity and PHI boundary. Improve it later to "save, then switch" automatically instead of an error. Low priority. |
| D2 | `AssessmentWorkspace.tsx:1409` | "Wait for the assessment to finish saving before switching." | Keep. Same as D1. |
| D3 | `ReferralWorkflowPanel.tsx:115` | "Finish saving the decision changes before switching accounts." | Keep. Same as D1. |

## E. Browser "leave site?" warnings

Found in `ReferralPacketCanvas`, `ReferralWorkflowPanel`, `useHandoffRecipients`, `StaffProfileSettings`, and `CommunityContactLists`.

**Keep.** Closing the browser tab is different from moving inside the app. Fire the warning only when there is data that is neither server-saved nor in the local copy.

## F. Waits to keep (they prevent real harm)

- **Sign assessment** (validations, `isBusy`). Prevents double signing.
- **Send Meet the Client / email** (`sending`). Prevents duplicate emails.
- **Record decision** with no outcome chosen, and its in-flight guard. Prevents a double decision.
- **Retry** while a retry runs, and **Save** on invalid schedule input.
- **Remote-change conflict panel.** Shown inline and non-modal. The person picks which value to keep. Keep.

## Proposed order

1. **Quick wins, low risk.** B1 (per-item busy on Decision), B2 (never disable navigation controls in the assessment), B3, and B4. Each is local to one component and does not change how saving works.
2. **The core fix.** Lift each referral's pending edits and save queue into the workspace shell, then make A1–A4 navigate immediately. The local copy is written first, and a background retry runs with a persistent banner.
3. **Polish.** The C1 time limit, D1–D3 "save then switch", and E firing only for truly unsaved data.

## How each phase is proven

- **New e2e tests** using route interception (slow saves, 500 errors, offline). They click around, switch tabs, and navigate mid-save, then assert that the person is never blocked, nothing is lost after the save eventually succeeds, and a failure is visible with Retry.
- **Existing suites** run before and after, with no new failures: the save, recovery, concurrency, and acceptance-save-recovery suites, plus the assessment and intake suites.
- **Audit events and PHI boundaries** are unchanged. No schema or migration changes.
- **Rollout.** Each phase is its own PR. Nothing is deployed without the owner's go-ahead.
