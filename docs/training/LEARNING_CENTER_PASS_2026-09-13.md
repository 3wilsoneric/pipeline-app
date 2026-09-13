# Learning Center and tutorial pass — September 13, 2026

Base: production `e369151ab77119c4da88492028014526744785d6`.
Scope: operator Learning Center, nine-screen orientation, eight guided tutorials, two synthetic intake screenshots. No clinical workflow, authorization, storage, or deployment configuration changes.

## Corrections grounded in the current application

- **Start and return:** Home exposes My work / Team work, assignments, and conditional Continue working. Workspaces is permission-scoped and sorted by recent updates. The opening now explains these entry points instead of an abstract product overview. Sources: PipelineWelcome, ContinueWorkPanel, ReferralHome and referral-home-directory-model.
- **Clients versus transferred workspaces:** Clients comes from the current Alamo resident directory. Transferred Allo workspaces are chart-only and do not imply a new assessment or current residency. The presentation and find-referral tutorial now distinguish these cases. Sources: ClientProfileDirectory, profiles/directory route, ReferralPacketCanvas.
- **Current intake:** Refreshed the two intake images using the local synthetic practice route, never production records. Fixed the tutorial's stale `Routing and assignment` match to the rendered `Referral details` section. No field or layout changed.
- **Scheduling:** Names Pacific Time and the method-specific address, phone, or Zoom field. Distinguishes saving a schedule from sending an invitation. Source: AssessmentSchedulingDialogs and the assessment schedule route.
- **Assessment:** Explains the guided interview versus the full 12-section view, saved drafts versus signing and submittal, and acceptance versus admission. Preserves the existing Language Lab demonstration and screenshot enlargement controls.
- **Visible tooltip instructions:** Save, sign, create, scheduling, and export checkpoints retain concise, specific instructions instead of being replaced by generic text. Does not authorize or automate any consequential action.
- **Reports:** Selecting the dropdown must actually change its value before advancing. Filters are not applied automatically; the tutorial now points at Apply before reviewing results. Explains grouped Summary versus client rows and the manual CSV boundary. The only report-component change is a guide-target attribute on its existing Apply button.
- **Different chart states:** The find-referral verification step targets the workspace, not an Intake section missing from transferred charts. Assessment-derived chart review explicitly requires the appropriate completed assessment.

## Focused evidence

- Production build with TypeScript passed: `npm run build -- --webpack` (local worktree reuses installed dependencies).
- 14 focused Chromium browser checks passed in 17.3 seconds against the production build: entry, chapters, real tooltip controls, intake upload / assignment / creation checkpoint, scheduling, all 12 assessment sections, Language Lab, report selection / Apply / CSV, desktop and mobile layouts.
- Screenshot capture rerun passed after waiting for ready state and disabling capture-time animations. Synthetic intake screenshots are 1920 × 1080; all nine presentation slides checked for horizontal overflow at 1280 × 720 and 390 × 844.
- Training route contracts and demo-isolation contracts passed; training fingerprints refreshed. Focused ESLint, diff whitespace checks, and existing complexity ceilings passed.
- Artifact directories: `.data/learning-center-pass-final`, `.data/learning-center-captures-final`. These are local evidence, not live client records.

## Preservation and handoff

Screenshots, full-size viewer, full-screen presentation, tooltip navigation, practice isolation, and role filtering remain in place. No new dependencies, paid services, accounts, clinical data writes, or changes to application click paths outside the tutorial.

The wider 36-module curriculum and its clinical policies were not independently re-certified by this pass. Structural readiness checks are not a claim of clinical approval. Deployment is coordinated through the existing Deploy task; source completion is not proof of live release. Rollback is a revert of this bounded change; no migration or data reversal is needed.
