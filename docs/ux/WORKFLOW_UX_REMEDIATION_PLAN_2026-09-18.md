# Pipeline workflow UX remediation plan

Status: proposal only. No application implementation, clinical-data cleanup, or deployment is authorized by this document.

## Basis and intended outcome

Based on the live UX audit of Chart, referral editing, Assessment, scheduling, Decision, Files, Activity, Home, Calendar, and Clients. The audit included desktop interaction, keyboard progression, pointer states, and 390×844 and 834×1112 viewport checks. Its deployed-code reference was `bf9b65e2940f693cba48d49599bdeaa06ad20e6d`; recheck the actual release before implementation because other tasks are active.

Outcome: assessors can find work, understand it, enter information, interrupt themselves, resume precisely, and complete the existing assessment and decision workflow without having to decipher internal software states.

Preserve the folder/cabinet/chart identity. This is a bounded product usability improvement, not a broad refactor or a replacement design system.

## Non-negotiable preservation rules

- Preserve clinical fields, source records, file previews, attachment behavior, ownership, permissions, audit trails, and the established signing/sending rules.
- Do not introduce completeness gates that prevent entering or saving information. Unknown information stays unknown, never silently converted into a negative clinical finding.
- Keep field-blur saving and existing safe navigation/save-queue behavior. Navigation memory must not replace draft recovery, acknowledge unsaved data as saved, or discard pending edits.
- Do not rewrite real names, reassign records, merge referrals, delete assessment events, or change admission/stay history as part of visual cleanup.
- Preserve historical chart-only workspaces; do not turn them into new three-stage intake workflows.
- Retain current cache, prefetch, and recovery mechanisms. No new subscriptions, external services, packages, whole-app rewrite, or database migration is planned.
- No signing, sending, uploading, deleting, or clinical test edits in production. Exercise mutations with synthetic records in the existing local/test setup.
- Start any implementation from the then-current integration base in an isolated worktree; do not mix in unrelated dirty files from the main working directory.

## Batch 1 — Navigation continuity and trustworthy information

### 1. Remember the exact working location

Evidence: Assessment section 2 → Activity → Assessment returned to section 1. Client cabinet → List → chart → Back to profiles returned to the cabinet selector.

Changes:

- Carry assessment section and question/field identity through Chart, Files, Activity, scheduling, and normal return navigation, even when no answer has changed.
- Preserve client cabinet, query, filters, sort, folder/list mode, loaded-list position, and scroll anchor when opening a chart. Return to that originating list, not the cabinet selector.
- Give direct chart links a safe fallback when there is no originating list. An explicit “All cabinets” action remains separate from contextual Back.
- Resolve assessment entry in this order: explicit requested field/section; valid saved position for this user and assessment; existing default entry behavior. A “next unanswered item” suggestion must not override a deliberate return location.
- Scope saved navigation state to the current signed-in/effective user and record. Clear it at the existing identity/logout boundary; do not leak another user's position through impersonation or account switching.
- Reuse existing route/session/recovery owners. Keep clinical answers and free-text searches out of new URL parameters or unprotected persistent storage. Use existing protected recovery for draft content, not a new cache.
- Restore position across reload/reopening through the established supported persistence mechanism. If an old target no longer exists, land in a valid section and retain access to the draft.

Starting code owners: `AssessmentWorkspace.tsx`, its existing focus/recovery helpers, `ReferralPacketCanvas.tsx`, `ClientProfileDirectory.tsx`, `ClientProfileView.tsx`, and `lib/pipeline/client-navigation.ts`.

Known narrow cause: the audited directory's profile-opening callback explicitly calls `setOpenCabinet(null)`. Assessment also initializes section state from an explicit target or `identity`; this must be reconciled with existing focus/recovery behavior, not patched with a competing navigation store.

Acceptance:

- Section 7 → Files → Activity → Assessment returns to section 7 and the same question/scroll anchor.
- A filtered, scrolled client List → chart → Back returns to the same cabinet, query, list mode, and client row; browser Back/Forward behaves consistently.
- Reload, a direct link, a removed target, and switching between two referrals do not resurrect the wrong location or draft.
- A focused edited field followed by navigation is retained through the existing save/recovery path; slow or failed saving never silently loses it.

### 2. Resolve misleading identities, roles, counts, and history labels

Evidence: two rows displayed “Pending Review” as a name; the assessment showed Eric Wilson while referral information showed Unassigned; two activity entries both read “Assessment created”; stay counts and completion counts described different things without explaining them.

Changes:

- Trace where a name-like placeholder came from before classifying it. For confirmed system placeholders or genuinely absent identity, show “Unnamed referral · #2718” (using the actual ID) and available source/date context. Never replace arbitrary real name strings or rewrite the source record automatically.
- Separate workspace owner(s), assigned assessor, and assessment author wherever those concepts differ. Prefer canonical role values; do not guess assignment from the person currently signed in.
- Use explicit progress labels: “Intake details,” “Assessment answers,” and “Admission documents.” Remove an unexplained combined percentage from primary navigation where it adds no useful decision. Count only what the metric actually claims to count; placeholders/defaults must not masquerade as completed clinical information.
- Reconcile the current-stay summary and history source. If the data represent one current stay and no previous stays, label them that way. If sources disagree or history failed to load, explain that state instead of asserting zero.
- Trace the two creation events to their source action/entity/correlation. Label separate actions accurately; group duplicate-looking presentation only when the correlation is proven. Keep the underlying audit evidence intact.
- Show clinical dates in the existing human-readable local format. Put technical IDs, raw timestamps, and provenance details in a disclosure while preserving access and source accuracy.

Starting owners: `referral-clinical-identity.ts`, `referral-owner-identity.ts`, `referral-progress.ts`, `client-profile-presentation.ts`, `ReferralActivityPanel.tsx`, `referral-activity.ts`, and the shared chart presentation.

Acceptance: same-name referrals remain distinguishable; owner/assessor/author differences are clear; unknown history is not reported as zero; all displayed counts agree with their stated denominator; audit rows remain traceable to original events.

Any true source-data defect discovered here becomes a separately reviewed repair list, not an opportunistic mass cleanup.

## Batch 2 — A clear Chart → Assessment → Decision workflow

### 3. Give each existing stage one clear job

- Chart: understand the referral, correct facts, find contacts and documents, and schedule/open the assessment.
- Assessment: conduct or continue the interview, review answers, record the assessor's recommendation, and sign using the existing rules.
- Decision: see the recommendation and relevant context, record the authorized decision, and understand the existing Meet the Client packet/handoff state.

Do not add a new stage, invent automatic workflow transitions, change decision authority, or make signing/send behavior implicit.

### 4. Make Chart useful before admission

- Keep the existing chart component, folder header, thumbnails, previews, and field vocabulary.
- Emphasize identity, referral facts, available clinical information, contacts, and documents for a new referral.
- Make admission and stay details secondary/collapsible when not yet applicable; keep them prominent for a current client. Do not infer clinical or admission status from an empty field or a date alone.
- Consolidate duplicated referral/assessment display only where the fields are truly the same canonical value. Preserve visibly distinct values when their meaning or provenance differs.
- Replace the blanket amber unanswered warning with a neutral, actionable “Review unanswered assessment items” entry. Keep genuine clinical risks and save failures conspicuous.
- Present signing in an explicit assessment-review context. It remains available under existing policy without becoming the main action whenever somebody simply opens Chart.

Starting owners: `TransferredWorkspaceChart.tsx` (the existing WorkspaceClientChart import), `ClientMedicalChart.tsx`, `ClientProfileView.tsx`, `AssessmentWorkspace.tsx`, and existing chart presentation helpers.

Acceptance: an empty referral is clearly a referral rather than an apparently deficient admitted-client chart; an admitted or historical client keeps the full appropriate chart; missing allergy/medication information never reads as “none”; every existing fact and file remains reachable.

### 5. Clarify assessment review and Decision

- Keep Next/Previous and section navigation dominant during interviewing. Put placement recommendation in the deliberate review area rather than competing with every question.
- Show a concise review summary before signing, with direct links back to editable sections and clear text about what signing does and does not finalize under the current policy.
- Put the existing recommendation next to the final decision, clearly attributed and dated. Show prior recorded decision and packet state when present.
- Move manual intake authorization and internal stage-management controls into a clearly labeled secondary administrative area. Keep them available to existing authorized users; do not change permissions.
- Replace internal transition wording with task-oriented language wherever its exact operation supports it. Do not relabel a status change as a send or approval it does not actually perform.
- Give each current task one visually dominant action. A decision with insufficient selection gets an adjacent explanation, not just a mysteriously dim button.

Starting owners: `ReferralWorkflowPanel.tsx`, `ReferralWorkflowPanelPresentation.tsx`, `referral-workflow-panel-model.ts`, and `AssessmentWorkspace.tsx`.

Acceptance: a new assessor can distinguish saved, interview complete, signed, decision recorded, and packet sent; all existing transitions still perform exactly their established operation; draft input remains available regardless of unanswered items; no action sends or signs as a side effect of navigation.

## Batch 3 — Editing, layout, and interaction polish

### 6. Make editing discoverable and predictable

- Use an always-visible, restrained “Edit” or pencil-with-label affordance for editable chart sections/values, with equally clear hover and keyboard-focus states.
- Keep the existing canonical editors. Inline edits stay inline where supported; fields requiring the intake editor say where they are going and open focused on that field.
- After Done, return to the originating chart position. Escape cancels only an uncommitted edit where that is the current contract; it must never pretend to undo an already autosaved change.
- Distinguish “Saving…,” “Saved,” and “Saved on this device / waiting to sync” using existing real save state. Do not reset or hide a failed save merely because the user closes a panel.

Starting owners: existing chart edit callbacks, `ReferralPacketCanvas.tsx`, `AssessmentWorkingSection.tsx`, and shared save-status presentation.

Acceptance: mouse, keyboard, and touch users can identify the same editable fields; the requested field receives appropriate focus; blank/no-change visits do not create data mutations; edits save through the existing blur queue and remain recoverable on failure.

### 7. Correct space allocation without replacing the design

- Desktop assessment: reduce the empty reference column; make it compact, expandable, and useful to the current section. Give interview responses the main working area.
- Tablet: avoid an oversized reference column and a wrapping footer that consume the question area. Prefer a compact reference summary when width is constrained.
- Decision: use a readable working width with useful assessment/decision context, not a tiny floating form or fields stretched edge to edge.
- Reduce repeated section headers, nested borders, and excess vertical gaps. Keep field labels adjacent to their inputs and clinical groups intact.
- Preserve the intentionally stacked client folders and the fast List alternative. Correct positioning/focus behavior without redesigning the approved folder interaction.

Starting owners: `AssessmentWorkingSection.module.css`, `AssessmentWorkingSection.tsx`, existing chart styles, and decision presentation.

Acceptance: at the same viewport more useful information is visible without reducing input readability or hit areas; footer and header do not cover the active field; long names, long answers, empty reference sections, and full reference sections all fit.

### 8. Apply one restrained control and feedback standard

- Important controls: 44–48px targets; preserve the working mobile 50px question navigation. Do not enlarge every secondary control indiscriminately.
- Working text: approximately 16–17px; secondary information approximately 14px. Remove essential save instructions and workflow distinctions from 10–11px text.
- Retain muted folder/tab colors and white chart surfaces. Use the existing strong green for the primary action, amber for meaningful attention, and red for destructive/error states. Never encode meaning in color alone.
- Standardize hover, pressed, loading, disabled, and focus treatments using existing styles/components. Hover does not change layout or reveal the only available instruction.
- Keep transitions short and interruptible; respect reduced-motion preferences. No decorative animation, confetti, artificial delays, new motion library, or vibration requirement.
- Move the destructive workspace action into a secondary menu if it can be done without making it inaccessible; keep its existing confirmation/recovery behavior.

Acceptance: target measurements and contrast meet the applicable standard; visible focus does not disappear beneath sticky elements; primary actions are obvious without relying solely on color; disabled/pending states accurately describe the operation; reduced motion and touch do not lose functionality.

## Batch 4 — Calendar, Home, mobile, and integrated verification

### 9. Make scheduling and personal/team scope obvious

- Surface “Schedule assessment” with the referral's contact/coordination information and assessment entry, reusing the existing dialog rather than creating another scheduler.
- Replace ambiguous overlapping personal/team controls with an explicit Mine/Team choice, preserving current scope and default behavior. Assessor filtering remains clear within Team; viewing Team must not change ownership or authorization.
- Explain empty filtered results and offer a direct way to view the team or clear the relevant filter. Distinguish no matching work from loading or failed requests.
- Keep Home, work-list, and Calendar next-action language consistent with the actual lifecycle. A resume action lands at the remembered work; a deliberate next-missing-item action lands at the indicated field.
- Keep contact actions informational as currently requested; do not add automatic calling, email sending, or invitations.

Starting owners: `PipelineCalendar.tsx`, `PipelineCalendarPresentation.tsx`, `pipeline-calendar-model.ts`, `CalendarWorkDetails.tsx`, `ReferralContactsCard.tsx`, `AssessmentSchedulingDialogs.tsx`, and existing Home/worklist action mapping.

Overlap: another task has active edits to the Calendar components and `CalendarWork.module.css`. Coordinate the semantic changes with that task before implementation; do not overwrite its layout pass or create a competing calendar redesign.

Acceptance: Mine/Team and assessor filters give predictable results; empty states explain the active scope; scheduling from Chart and Assessment opens the same dialog; cancel makes no booking; saved schedules appear in the existing calendar and still open the correct workspace.

### 10. Preserve the strong phone experience and repair keyboard continuity

- Keep the phone's one-question flow, large controls, Current info panel, and direct section chooser. Do not force the desktop layout onto phones or add a new mandatory question-by-question workflow on desktop.
- On desktop section change, move focus to the new section heading; keyboard progression then enters that section's questions. Announce the changed section without stealing focus on ordinary autosave.
- On mobile, preserve the question and focus when opening/closing Current info, Files, and scheduling. Do not automatically pop the software keyboard when a heading can receive focus instead.
- Keep input visible above the software keyboard and sticky footer. Validate portrait/landscape, iPad, increased text/zoom, long labels, date controls, and safe-area spacing.
- Keep top-level navigation discoverable with a labeled menu/appropriate icon; preserve focus mode instead of permanently reinstalling a large header.

Acceptance: keyboard-only users can complete navigation without cycling through the whole app after Next; dialogs return focus to their opener; phone/tablet view has no unintended horizontal scroll; real device keyboard checks supplement viewport screenshots before claiming device readiness.

## Focused verification and release approach

Use four implementation batches, not a separate approval/test marathon for each button.

1. Extend the existing relevant tests per batch: chart-intake continuity, chart field editing, client chart transition, calendar workflow, and responsive navigation. Add focused cases for the observed failures rather than a new harness.
2. For visual changes, compare before/after at desktop, tablet, and phone sizes with empty, partial, and populated synthetic records. Check hover/focus/reduced motion without mutating production records.
3. For navigation/editing changes, exercise dirty-field navigation, a slow response, a failed save, recovery, reload, two records, and identity switching using existing test fixtures. Validate no lost/double writes; this is not a rerun of the full chaos program.
4. After the integrated candidate, run applicable required machine gates once and a focused assessor journey: find assignment → review chart/contact → schedule → return → enter partial assessment → leave/resume → review/sign → authorized decision → existing packet/handoff flow. Include a populated admitted-client chart and a historical chart-only workspace.
5. Keep independently reversible batch commits and a known release baseline. No schema rollback should be necessary for the planned UX work. If a real backend integrity defect is found, isolate it and reassess its tests/rollback needs rather than burying it in CSS work.
6. Implementation and deployment need a subsequent request. Once authorized, use the existing deployment coordinator and current integrated base; do not deploy this older audit commit or unrelated local changes.

Completion means each acceptance case above has recorded evidence for the final candidate, not a claim that the app is perfect or that viewport testing certifies every device.

## Research behind the design choices

- [NHS buttons](https://service-manual.nhs.uk/design-system/components/buttons): a clear primary action and consistent actionable controls.
- [NHS typography](https://service-manual.nhs.uk/design-system/styles/typography): readable working text with smaller text used sparingly; Pipeline retains its own visual identity and density.
- [GOV.UK check answers](https://design-system.service.gov.uk/patterns/check-answers/): deliberate review and explicit change links while retaining entered information.
- [Nielsen Norman Group usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/): visible system status, recognition over recall, and consistency.
- [WCAG 2.2 target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): AA minimum is 24×24 CSS pixels with exceptions; the 44–48px plan is a stronger usability target, not a claim about the AA threshold.
- [WCAG contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html): measure contrast and ensure sticky content does not conceal keyboard focus.
