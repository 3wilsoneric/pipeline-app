# Referral preparation

Product change in the isolated visual preview, based on e30807c33dfe30fadb951dec2ca6f92a7a58ae80. Not a refactor slice or deployment authorization.

## Behavior

- Opening an unstarted real questionnaire opens Prepare. Started and signed assessments open the full assessment.
- Preparation is embedded in the actual referral workspace, using the same client-folder and chart primitives as Intake. It does not open a second dialog or duplicate the workspace navigation. Files, Activity, Chart, and Intake stay available.
- Workspace controls await the existing assessment save/recovery routine before leaving preparation. Questionnaire entry awaits already-queued Intake saves before creating the assessment, so the last committed Intake edit can seed it. Existing recovery and conflict semantics are not replaced.
- The full interview retains its focused presentation. Closing it or pressing Escape returns to the embedded preparation file, not a collapsed placeholder. Escape on the embedded file does not close it. Its Schedule/Begin actions stay visible while scrolling.
- Embedded scheduling dialogs render at the shell overlay level, outside the file's animated stacking context. Pointer checks verify that the schedule close control is not covered by the workspace toolbar on desktop or mobile.
- Referral, Prepare, and Assessment are navigation controls, not workflow gates. The complete questionnaire remains accessible before starting the interview. Begin assessment uses the existing lifecycle command and opens the full assessment after success.
- Five preparation groups select existing questionnaire fields. They do not define a second schema or answer store. Conditional questions, field provenance review, permissions, section versions, autosave, offline queues, and signatures retain their existing owners.
- Focus within a preparation group records the field's canonical section for resume and presence without moving the preparation page.
- A chosen reference group remains mounted beside the full assessment during section navigation. Selecting a captured answer takes the assessor to the canonical editable field. On narrow screens the reference is a disclosure, not another permanent column.
- Signing is available on Assessment rather than competing with Begin assessment on Prepare. Signed answers remain read-only in both views.

## Deliberate boundaries

- Preparation groups are a bounded view over current question IDs. Revisit the mapping when the questionnaire adds or changes fields; executable tests check canonical membership, unique fields, conditional behavior, and interview-only exclusions.
- Preparation is not proof of current clinical confirmation. No new verification status is invented for manual entries, and missing information never becomes a negative answer. Existing extracted suggestions keep their pending source/review state.
- This increment references recorded answers, not a new embedded PDF reader. Add the Documents view when implementing the shared authorized document-preview owner; do not add a parallel download or PHI cache here.
- The active canonical section uses existing resume behavior. The temporary Prepare/Assessment display choice is local to the open assessment; reopening chooses from its lifecycle. If users need exact display-mode resume, extend the canonical workspace-location contract with focused recovery tests rather than storing another local clinical record.
- The practice/tutorial routes keep their full-questionnaire entry and guide targets. They are not converted to preparation automatically.
- No dependencies, migrations, application-role changes, or scheduling/admission rules are introduced. Motion is one 150ms CSS reveal and is disabled for reduced motion.

## Focused evidence

`tests/e2e/assessment-preparation.spec.ts` covers real synthetic intake-to-questionnaire creation, inherited values, cross-section edits, immediate exit, reload, same-record interview start, pinned reference navigation, narrow layouts, keyboard navigation, reduced motion, signed read-only behavior, queued-save recovery, and a mocked extracted suggestion's source/review presentation.

`tests/e2e/emerald-surfaces.spec.ts` retains existing Home/assessment responsive and contrast checks, practice route checks, and Intake editing tests. Browser evidence uses isolated local-file stores, not live assessor SSO or PostgreSQL certification.

Observed recovery edge: under a forced HTTP 503, changing a field again after the queued write reaches the server but before the browser has reconciled it can show a same-user conflict. The newer local answer remains visible rather than being overwritten. This increment does not change the reconciliation owner. The integration task was notified; follow up with a deterministic fast-edit-during-reconciliation test before changing that behavior. The passing recovery case waits for the visible "Offline changes synced" acknowledgment before its next edit.

Integration increment based on 6b4bd8be302de8d801ca09131ca248c61b0a39a6. Final focused run: 16 checks passed using `PIPELINE_NEXT_DIST_DIR=.next-preparation-check PIPELINE_E2E_PREBUILT=true PORT=3362 npx playwright test tests/e2e/assessment-preparation.spec.ts tests/e2e/emerald-surfaces.spec.ts --project=chromium --output=outputs/preparation-integrated-verified`. Added immediate Intake/Files/Activity/Chart navigation checks at 1440px and 390px, shared-folder/no-dialog assertions, action visibility, exit-to-preparation checks, and last-Intake-edit seeding. Production build, TypeScript, scoped ESLint, complexity check, and whitespace check passed. These are bounded product checks, not a refactor certification.
