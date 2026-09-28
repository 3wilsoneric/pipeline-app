# Redesign go-live handoff (2026-09-27)

The owner is handing the redesign to Codex to merge and deploy. This file tells you what the branch holds, what ships even with the switch off, what must happen before it goes live, and the order to do it in. The owner approves each outward step: the PR merge, each deploy, and turning the switch on. There is no approval gate in GitHub (see "Deploy facts"), so asking the owner is the only gate.

## Pre-merge follow-up (2026-09-27)

The implementation and current evidence are recorded in [PREMERGE_REVIEW.md](PREMERGE_REVIEW.md). The original test state below is historical, not a current failure inventory.

- The prior saving/upload/test repairs were already merged through `448a6595` / PR #206 into `b39c377c`; do not reapply them from an older worktree.
- Deploy switch plumbing and unique per-run revision identities are now implemented locally. Fast image-only deployment verifies that runtime flags remain unchanged.
- Eric approved the wording set, Notes on phones, and refreshing only three stale Linux baselines from the independently verified production-main render. See DECISIONS.md. This supersedes the blanket snapshot-update prohibition for exactly those three files.
- Notes now retain encrypted recovery and survive panel changes, request failure, reload and lost acknowledgments; clean reopening/focus refreshes server notes without replacing newer typing.
- Push, PR, merge, production deployment and global switch activation still each require Eric's approval. None has occurred in this pre-merge work.

## Where it is

- Branch `design/redesign-switch`, local only, never pushed. Worktree: `/Users/eric/pipeline-app/.claude/worktrees/design-redesign`.
- Head: the commit that adds this file, on top of `197d2ef1` (the merge of `main` at `b39c377c`, which is what production runs). The branch is up to date with `main` as of 2026-09-27.
- Leave out the uncommitted `tsconfig.json` change. The local demo server writes it (`.next-persona-demo-3216` type paths).
- The main checkout `/Users/eric/pipeline-app` has unrelated uncommitted work on another branch. It is not part of this handoff.

## What the redesign is

- Owner rules and every design decision, with the owner's words, are in `docs/design/PRINCIPLES.md` and `docs/design/DECISIONS.md`. Read "Rollout" first.
- **The switch.** `PIPELINE_DESIGN_V2=true` on the server makes `app/layout.tsx` put `data-design="v2"` on `<html>`, per request. Components read it through `useDesignV2()` (`components/design/DesignSwitch.tsx`). Unset means the current design.
- **Stylesheets.** Redesigned CSS modules hold two blocks: `:where(html:not([data-design="v2"]))` for the current design and `:where(html[data-design="v2"])` for the redesign. Interview-layout rules are top-level `:global(html[data-design="v2"][data-interview-focus] …)`, because nesting them in `:where(html…)` never matches.
- **Local rehearsal.** `PIPELINE_DESIGN_V2=true node scripts/persona-demo.mjs --port=3216`. Leave the variable off for the current design.

With the switch on, the redesign also changes how screens behave, not just how they look. The owner asked for each of these (see DECISIONS.md):

- Opening a referral resumes where you left off.
- The Chart is the workspace home. Finished steps (signed assessment, recorded decision, completed Finish & send) are filed into it as sections and drop off the rail.
- Steps stay mounted and save as you scroll.
- During an unsigned interview the progress rail tucks away behind an arrow. The interview uses a split with the section's intake answers on the left and notes ruled below them.
- There is one set of client notes per referral, which replaces the quick note and the assessment notebook.
- "Schedule interview" shows only until the interview begins.
- An interview can offer answers from the client's last signed assessment and from intake. They are credited to that source only when unchanged, and the server verifies them.

## What ships even with the switch off

These go live with the merge, whatever the switch says. Verify them on PostgreSQL, not just the local store.

- **Migration `database/migrations/0046_client_notes.sql`.** Additive: it creates `pipeline.client_note_blocks`, one row per referral and heading, versioned. It has a rollback, `database/rollbacks/0046_client_notes.sql`, which refuses to run if any notes exist. On an app rollback, leave the table in place.
- **New routes.**
  - `app/api/referrals/[referralId]/notes/route.ts` and `notes/[headingKey]/route.ts`: read and save client notes. Each heading has its own version, and a stale save returns 409 with the current text.
  - `app/api/client-notes/latest/route.ts`.
  - `app/api/assessments/[assessmentId]/prior-answers/route.ts`.
- **Assessment PATCH** accepts `prior_answers` and `referral_answers`. `lib/assessment/assessment-prior-answers-server.ts` verifies them. The browser cannot send the `*_sources` fields.
- **Store and helpers.**
  - `lib/pipeline/client-notes-store.ts` has both local and PostgreSQL adapters.
  - Notes add no audit rows, by owner decision (DECISIONS.md, "Notes"). Last editor and time are kept on the row.
- **`lib/auth/authenticated-fetch.ts`.** A notes save refreshes only the latest-notes summary. Session clear now notifies listeners.
- Only the local adapter is exercised by the operational browser tests. Run `npm run database:migrate` and `npm run database:assurance:integration` against a real PostgreSQL. No existing script checks client notes on PostgreSQL, so add a save, read and stale-version check there.

## Before merging

1. **Check that the current design is unchanged.** With the switch off, production must look and behave exactly as `main` does.
   - Operational suite, switch off: `PIPELINE_OPERATIONAL_E2E=true PORT=3242 npx playwright test -c playwright.operational.config.ts`.
   - Visual regression (`npm run test:e2e:visual`): must pass against `main`'s snapshots without updating any.
   - Full CI `verify`.
2. **Update the switch-on test failures to the new behavior.** With the switch on, 11 operational tests fail. They assert pre-redesign behavior that the owner changed:
   - assessment-outcome-handoff ×2
   - assessment-preparation ×2
   - field-blur-upload ×3
   - workflow-flow-pass ×1
   - workflow-interaction ×3

   The exact tests are listed under "Test state at handoff".

   Before the switch goes on in production, update each to assert the redesign's equivalent behavior. Do not delete or weaken them, and do not change what the switch-off run asserts. Then add a switch-on operational run to CI, so the live design has coverage. The redesign-only specs `chart-process`, `interview-layout` and `client-notes-ui` skip themselves unless `PIPELINE_DESIGN_V2=true`.
3. **Deploy plumbing (missing).** Nothing in deploy sets `PIPELINE_DESIGN_V2` yet.
   - Add a `workflow_dispatch` input `enable_design_v2` (boolean, default false) to `.github/workflows/deploy-azure.yml`.
   - Pass it to `infra/azure/runtime.bicep` as `param enableDesignV2 bool = false`, with the env entry `{ name: 'PIPELINE_DESIGN_V2', value: enableDesignV2 ? 'true' : 'false' }`. This follows `enableNoteLab`.
   - Check that `deploy-azure-fast.yml` carries it over from the current revision like the other flags. Otherwise a fast deploy could flip it back.
4. **Wording.** The owner's rule is no new wording without asking. The redesign adds some visible text, for example:
   - "Finish & send", "Open decision", "Admission date", "Decision reason", "Admission requirements"
   - "All questions", "All notes saved", "Waiting to sync", "Hide notes", "Close notes", "Use theirs", "Appointment not booked"
   - "Expand navigation" / "Collapse navigation"

   The owner has used all of these locally. Confirm them with the owner once, in one list, before the switch goes on.

## Order to go live

1. Open a PR from `design/redesign-switch` to `main` (about 90 commits) and get CI green. The owner merges or approves the merge.
2. **Deploy 1, switch off.**
   - Before dispatching, re-read the last successful run's inputs: `gh run view <id> --log | grep -E 'enable_|extraction_backend|clinical_data_mode|initial_database'`.
   - The last run (36286494103, `b39c377c`) used `extraction_backend=manual` and `enable_demo_center=true`. Older notes had `azure_databricks` and `false`. Ask the owner which is intended before dispatching; don't assume either.
   - Afterwards verify:
     - `/api/health/live` and `/api/health`;
     - that `0046_client_notes` is recorded in `pipeline.schema_migrations`;
     - that the site looks unchanged.
3. **Deploy 2, switch on** (`enable_design_v2=true`), once the owner says go.
   - Smoke test as real roles: open a referral, begin an interview, write notes, sign, record a decision, and check that the Chart files each step.
   - Include phone width, which the redesign keeps working (`use-phone-layout.ts`).
   - To roll back, redeploy with `enable_design_v2=false`, or activate the recorded previous Container Apps revision. New full rollouts use `pipeline-prod-web--<sha10>-r<run_id>-<attempt>` so the same image can be deployed with the switch off and then on. Older revisions use `<sha16>`; always record the actual revision. Keep the notes table either way.
4. **Later: remove the current design** once everyone is on the redesign and the owner confirms. Follow the "Removal trigger" in DECISIONS.md "Rollout".

The switch is global. There is no per-user pilot, even though the original rollout plan lists "pilot for named users". If the owner wants a pilot, that needs new code, such as a per-user flag. Ask before building it.

## Deploy facts

- Production deploys only through `.github/workflows/deploy-azure.yml`, run by hand on `main`.
- It has no environment protection and no reviewer, so a dispatch goes live immediately. Branch protection on `main` requires only `verify`.
- Runbook: `docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md`. Live site: https://alamo-pipeline.com.
- Web app: Container App `pipeline-prod-web`, resource group `rg-pipeline-prod`.

## Current status and remaining workflow limits

- The interview-mode restoration now runs before paint to avoid the brief "All questions" flash.
- Finish & send drops off the rail only when the client is admitted or closed, per the existing `workspaceStepProgress`, not as soon as the packet is sent.

## Test state at handoff

Operational suite on `197d2ef1` (`playwright.operational.config.ts`, local store), run 2026-09-27:

- **Switch off** (`PIPELINE_OPERATIONAL_E2E=true PORT=3242`): 73 passed, 38 skipped, 0 failed.
- **Switch on** (`PIPELINE_DESIGN_V2=true PIPELINE_OPERATIONAL_E2E=true PORT=3241`): 66 passed, 34 skipped, 11 failed. These are the same 11 as before the merge, and none is new. Each one asserts behavior the redesign changed:
  - `assessment-outcome-handoff.spec.ts:15` sign, save under review, reopen active work and clarify its recommendation
  - `assessment-outcome-handoff.spec.ts:71` supervisor records accepted; completed workspace remains available
  - `assessment-preparation.spec.ts:11` assessorA prepares from intake, resumes and reschedules
  - `assessment-preparation.spec.ts:11` assessmentCoordinator prepares from intake, resumes and reschedules
  - `field-blur-upload.spec.ts:45` intake saves only the departed cell, even while that save is slow
  - `field-blur-upload.spec.ts:89` assessment snapshots on blur, keeps the next answer local, and saves reasons on exit
  - `field-blur-upload.spec.ts:211` a new intake draft saves on blur and creates one referral with one initial packet
  - `workflow-flow-pass.spec.ts:96` incomplete assessment and scheduling errors keep navigation available
  - `workflow-interaction.spec.ts:197` confirms creation without claiming that a selected packet is already stored
  - `workflow-interaction.spec.ts:294` keeps a durable last answer during a slow save and resumes
  - `workflow-interaction.spec.ts:386` uses Pacific Time from a different browser timezone
- `npx tsc --noEmit` is clean.
- Not yet run on this merge:
  - visual regression;
  - CI `verify` (`check:platform:fast`, build, release evidence);
  - PostgreSQL integration.
