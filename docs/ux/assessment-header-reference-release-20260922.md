# Assessment header and reference release handoff

Base: `d898a2ba5eaae145282425b0d3fe357d6a14da82`.
Branch: `codex/clients-ui-ready-20260922`.
Worktree: `/Users/eric/pipeline-clients-ui-ready-20260922`.

## Bounded scope

- Keep the folder tabs adjacent to the client name; put the existing working decision at the right. Preserve recommendation authorization, save failures, signing locks, and final-decision behavior.
- Open Excel and recovery from the bottom-left save-status control. Remove the duplicate recovery menu item and redundant Workspaces/trash controls only from the assessment/chart reading header.
- Improve reference-chart typography, paper edges, compact scalar rows, and complete separate medication/list entries. Preserve source/review information and click-to-edit.
- Keep phone questions usable in portrait and landscape without redundant interview prose. Keep All questions, scheduling, and begin controls.
- Reserve the lazy decision control's final space: previously its loading fallback could move a navigation button by 24px between mouse-down and mouse-up. A delayed-chunk regression test reproduces the old failure and checks the stable position and successful click.
- Preload the workbook runtime alongside the existing template when the assessment mounts. Previously a first export after going offline could fail while trying to fetch its JS chunk.

No API, schema, migration, database, email delivery, or authentication changes. No PR159 draft-mail changes. Main's current full-questionnaire, interview resume, appointment drafts, phone search, and tutorial markers are retained. The older dirty preview worktree was not copied wholesale or modified.

## Evidence and limits

Node 24.2.0 was used. Production build, TypeScript (`npm exec -- tsc --noEmit`), focused ESLint for all changed TS/TSX files, and `git diff --check` passed.

Browser evidence is synthetic local data, Chromium plus explicit iPad/phone WebKit cases. Checks cover responsive bounds and touch targets, affected-region Axe checks, recommendation persistence and failed-save retry, no accidental admission/sign/send, reference editing, workbook offline export/import/conflicts, invalid-client rejection, modal focus return, and interview continuity.

Final combined run: **24 passed, 4 failed**. All four failures are the unchanged legacy cases described below (1440, 1024, 768, and 640px), at their first attempt to fill Secondary diagnosis. Artifacts are under `test-results/clients-ui-verified` in the worktree. Earlier first-offline-export and phone layout failures were repaired; the delayed-decision regression was demonstrated failing on the prior build with a 24px shift and passing on the final build. Final desktop, iPad, phone portrait, and landscape screenshots were inspected.

```sh
env PATH=/Users/eric/.nvm/versions/node/v24.2.0/bin:/usr/local/bin:/usr/bin:/bin \
  PORT=3417 PIPELINE_E2E_CLINICAL_PORT=3418 npm exec -- playwright test \
  tests/e2e/assessment-footer-layout.spec.ts tests/e2e/assessment-open-book.spec.ts \
  tests/e2e/assessment-interview-decision.spec.ts tests/e2e/assessment-excel-backup.spec.ts \
  tests/e2e/assessment-full-questionnaire.spec.ts tests/e2e/assessment-work-resume.spec.ts \
  tests/e2e/assessment-footer.spec.ts --project=chromium \
  --grep 'assessment footer keeps|loading the decision|recommendation remains|iPad WebKit keeps|chart reference separates|open book keeps|reading pane and questions|quick recommendation|download current unsynced|drop previews the populated|backup tools stay|iPad WebKit exports|invalid or different-client|full questionnaire|returns to the exact question|secondary actions close' \
  --trace=retain-on-failure --output=test-results/clients-ui-verified
```

The unchanged legacy `open book keeps existing answers readable...` tests expect `Secondary diagnosis` directly in interview mode. Base main's `components/pipeline/assessment-working-view.ts` already excludes `secondary_diagnoses` from interview focus; it remains editable through All questions. Those legacy tests need alignment with that approved route, not restoration of the old product behavior. This handoff does not weaken or skip their assertions. The current full-questionnaire tests exercise the intended edit-and-return route.

The isolated test environment has no private community-recipient-list file, so those endpoints fail closed with 503. No private file was copied, no live email was sent, and no physical-device test is claimed.

Workbook offline export requires the assessment runtime and template to finish loading while connected. This is not an offline first-visit bootstrap guarantee. Revisit that boundary only if initial-offline launch becomes a product requirement.

## Release handling

Deployment belongs to the Deploy task and still requires its applicable integration/release checks. Cherry-pick only this bounded commit, not the old preview branch. Rollback is reverting this commit; no data or schema rollback is needed. This note is not a deployment record.
