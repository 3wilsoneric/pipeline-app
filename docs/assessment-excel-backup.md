# Assessment Excel Backup

## Using It

Use the **Excel workbook strip** above the assessment questions. **Download copy** includes the answers currently on screen, including changes waiting to sync. It is a snapshot; download again to refresh it.

Continue in the answer cells in Excel. Choice fields have dropdowns. Lists use one item per line. Put an explanation beside any answer marked unable to assess. Save the workbook, then drop it on the strip in the same assessment, or press the strip to choose a file.

Pipeline reads mapped cells locally, without AI or uploading the workbook. A modal shows proposed changes alongside the populated clinical chart. Selecting or deselecting an answer updates that preview only. **Cancel** or Escape leaves the assessment untouched.

The comparison uses the original snapshot, the Excel answers, and the current assessment. Unchanged Excel cells leave newer assessment answers alone. Ordinary changes start selected; conflicts and clearing an existing answer require explicit selection. **Commit changes** applies only the selected answers to the existing draft and save queue. This never signs an assessment, records a decision, or sends an email. The normal assessment save status distinguishes local application from server sync.

Signed/read-only assessments allow download but not restore. A mismatched client, assessment, site, or questionnaire version is rejected before any answers change. Keep an incompatible workbook for manual reconciliation; do not delete it.

## Questionnaire Changes

The canonical questionnaire and tool field definitions own the workbook's labels, help, choices, types, conditional guidance, and cell mappings. No hand-maintained question list is used.

After changing those definitions, run:

```sh
npm run generate:assessment-workbook
npm run check:assessment-workbook
```

The generator uses the installed Codex artifact authoring runtime. Set `PIPELINE_ARTIFACT_MODULES` to its `node_modules` directory when installed elsewhere. It is a development tool, not a browser or production dependency. Commit the generated `public/templates/pipeline-assessment-workbook.xlsx` alongside the schema change.

`npm run build` checks the generated workbook's fingerprint, complete field coverage, choices, and required workbook controls. A stale workbook blocks the build. A changed question, choice, validation rule, or mapping changes the fingerprint.

This workbook is still unreleased. There is one current layout and mapping, with no legacy workbook aliases or migration path. Fingerprint validation rejects a mismatched questionnaire rather than guessing how to map clinical answers. A future production schema change with outstanding working copies will require an explicit reconciliation policy before release; changing labels alone also invalidates the current fingerprint.

## Recovery And Privacy

The blank template is prefetched and cached. An already-open assessment can export and restore while offline after that template has loaded. This does not make cold-start navigation work offline, restore a failed device, or create automatic downloaded backups. Keep encrypted local recovery and normal server autosave in place. Do not remove them in favor of Excel.

Restore first persists the local recovery draft, then uses the existing version-checked save queue. On reconnect, workbook mutations made stale by an earlier queued write may retry only after the canonical three-way merge, only for this assessment, and only if there is no section conflict and the imported answer is still current. Genuine conflicts retain the local answer for review. Restored field provenance records the copy ID and export time; existing provenance and audit behavior remain in use.

Pending imported answers carry their copy ID and export time per field in the existing encrypted working copy and server recovery draft. Closing mid-import, reopening, or choosing **Keep mine** retains that source. A genuine manual replacement or **Use latest** discards the pending workbook source for that field. Confirmed imported saves clear it only for acknowledged answers from that copy. A section containing manual answers and answers from different copies is saved in separate source-specific patches through the same queue; no extra audit or persistence path is used. Older drafts without this optional metadata remain readable; missing historical source information is not fabricated.

The downloaded workbook contains private client data, including original answers used for conflict comparison. Hidden sheets and worksheet protection prevent accidental changes, not unauthorized reading. Use approved encrypted device/storage controls. No client-containing workbook is stored in Cache Storage; only the public blank template is cached.

## Bounded Limits And Evidence

- Current coverage is 162 fields in 12 sections. Future coverage is checked against the canonical field registry, not this count.
- Files are limited to 5 MB compressed, 24 MB expanded, and 300 ZIP entries. Macros, embedded objects, external workbook links, formulas in consumed cells, damaged mappings, and invalid answers are rejected.
- Excel limits cell length. Notes and lists use reserved continuation cells, with a 480,000-character serialized baseline ceiling per field. Over-capacity exports fail visibly; they never truncate an answer. Increase mapped continuation capacity and its tests if a valid production answer reaches this ceiling.
- Excel's maximum row height can hide part of an unusually long answer. The complete value remains in the cell and can be read in the formula bar. This is a recovery workbook, not a substitute for the clinical chart's print layout.
- Reasons for being unable to assess are currently merged as one map. Simultaneous changes to different reasons may require a conservative conflict review. Add per-reason merging if this causes material review burden.
- Automated evidence lives in `tests/e2e/assessment-excel-backup.spec.ts` and `scripts/assessment-workbook-contracts.mjs`. It covers field round trips, unsynced/offline export, drop restore, conflicts, explicit clearing, server validation, provenance, and signed-record protection.
- Local-adapter and browser tests do not certify native Microsoft Excel compatibility. A native Excel open/edit/save/reimport remains unverified; Excel is not installed on the release-preparation machine.

## Local Verification, September 19, 2026

The uncommitted local trial passed 21 Playwright tests across the Excel backup, assessment footer, and mobile assessment suites. Those include Chromium and explicitly launched iPhone/iPad WebKit coverage. The local build, TypeScript check, lint, workbook freshness check, and whitespace check passed. An independent read of the generated OOXML confirmed the editable/locked cells, hidden continuation rows, hidden baseline sheet, internal links, and print settings. All 15 worksheets were visually inspected; the hidden metadata sheet is not a user-facing view.

That initial trial did not include PostgreSQL characterization or a native Excel application test. Full repository certification was blocked by both new workbook function complexity and other ratchet findings. The separate assessor-workflow static suite also fails an older schedule-shell assertion that already fails against the trial's HEAD: it expects inline portal/schedule/navigation implementations that are no longer in AssessmentWorkspace. Neither gate was weakened or given a new baseline.

## Isolated Release Preparation

The queued snapshot at `40ab3a48ba280ec7b924676045fb631f331d927e` was corrected without changing the original local preview. Workbook reading, answer writing, type parsing and identity validation remain in the same module with small named helpers. The four new over-limit functions changed from 17/19/13/22 to 5/7/8/7 respectively; every workbook-module function is at most 10. No complexity baseline or disposition was changed. Other repository ratchet failures remain outside this bounded correction.

`tests/e2e/operational/assessment-excel-restore.spec.ts` exercises the canonical authenticated API and store against real PostgreSQL. Run:

```sh
PIPELINE_EXCEL_PG_BIN=/path/to/postgresql/bin npm run check:assessment-excel-postgres
```

The harness creates and migrates a new loopback cluster, ignores configured application/test database URLs, and stops/removes only its own cluster. Four tests passed on PostgreSQL 16: restored answers/provenance/actor audit and idempotent replay; stale global/section versions and malformed restore; signed-record rejection; and a forced late audit failure with rollback across ten protected tables followed by a successful retry. No production data is used.

`tests/e2e/assessment-excel-recovery.spec.ts` adds two final-integration probes. Build with `NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED=true`, then run this spec with `PIPELINE_DESKTOP_E2E=true PIPELINE_E2E_PREBUILT=true` and an unused local `PORT`. The assessment-switch probe passed. The late-recovery probe exposes a release blocker on the queued snapshot: delayed recovery replaces newer typed/imported answers on screen. Keep this assertion failing until the separately owned recovery fixes are integrated; do not skip it for release. Workbook imports must participate in touched-field tracking, retries must preserve workbook metadata, and the complete combined candidate must pass the probe.

The original six Excel browser checks still pass, including all-field round trips, offline restore/conflict handling and iPad WebKit. Build, lint and whitespace checks passed. Native Excel compatibility and final recovery integration remain outstanding; this evidence is not deployment approval.

## Review-First Import Follow-Up

The visible strip opens a populated chart preview using `ClientAssessmentRecord`, rather than a second chart implementation. Import selection never mutates the assessment; only the commit action invokes the existing restore callback. In short landscape touch layouts, compact side controls preserve question space without remounting the preview or losing its selections during rotation. The parser, workbook contract, API, store, save queue and encrypted recovery code are unchanged by this UI follow-up.

The focused final run passed 18 checks: nine Excel tests, eight footer-layout tests, and the cross-assessment save-isolation probe. Evidence includes actual browser drop, unchanged record/version after preview and Cancel, live selected-answer preview, explicit clearing, selective commit/provenance, invalid-workbook refusal, offline conflicts, keyboard dismissal/focus return, iPad WebKit, and compact portrait/landscape touch layouts. Desktop, iPad and phone screenshots were inspected. Build, TypeScript, lint and whitespace checks passed; every function in the import UI component is at most 15 by the repository's complexity check.

The late-recovery integration probe still fails both original newer-answer assertions on this isolated base; it remains a release blocker for the combined recovery integration. An additional older 28-test mobile/phone/footer sweep produced 19 passes and nine failures: that recovery failure plus eight assertions against superseded navigation/full-screen assessment UI (including the former `Assessment interview` dialog and `02 Questionnaire` button). Those older test files were not weakened or rewritten here. Full `certify:refactor` still stops at inherited complexity ratchet failures; no baseline or disposition was changed. Neither this follow-up nor its focused tests certify native Excel compatibility or the final deployment candidate.

## Durable Workbook Recovery Follow-Up

On the combined integration base `3cbda08be3ac9f089f44c3169ca32bad599a52dc`, with the separate session guard `8dd0fb05f786e0c97fc0481bf73bb83a627aeb90`, the original late-recovery and cross-assessment assertions now pass unchanged. The per-field source fix adds executable coverage in `scripts/assessment-workbook-recovery.test.mjs` and `tests/e2e/assessment-workbook-provenance.spec.ts` for encrypted/server draft parsing, a real offline conflict followed by reload and **Keep mine**, closing a multi-section import between acknowledged sections, and a manual replacement that must remain manual. Assertions inspect canonical answers, workbook copy ID/time, field provenance, and import/manual audit events, not just the visible text.

The final focused run passed 31 unit/callback checks and 15 browser checks, including iPad WebKit and the existing review-first import tests. Five isolated PostgreSQL checks passed: the four existing API/rollback cases plus private recovery metadata round-trip, principal separation, stale-version rejection, invalid-source rejection, and no change to the ten protected assessment tables. Recovery drafts now accept all sections from the canonical registry rather than a hard-coded eleven-section limit. The build, scoped ESLint, and whitespace check passed. A controlled callback test additionally verifies that a principal/session change while an offline sender waits prevents dispatch and retains the queued mutation.

Repository-wide `certify:refactor` still stops at the complexity ratchet; it is not a passing certification. Compared with `8dd0fb0`, this change increases the existing recovery callback from 32 to 33, reduces the offline sender callback from 14 to 10 and the reconciliation callback from 16 to 15, and keeps new source helpers at 9 or below. No baseline or disposition was changed. Independent review of this latest diff and native Microsoft Excel open/edit/save/reimport remain outstanding. These checks support the bounded recovery behavior only, not production deployment approval.

## Local Workbook Usability Pass, September 20, 2026

The workbook now uses the app's conversation section names and order from the shared questionnaire owner. Choice rows are compact; narrative answers have more room. Questions and supporting guidance have separate font treatments. Technical metadata remains mapped but hidden from the working sheets. The final section includes a linked checklist rather than exposing metadata as an assessor task.

The **Check** column recalculates as answers change: **Needs answer**, **Explain why**, **Not applicable**, or **Review previous answer/reason**. Both checklists count missing answers/reasons and retained details separately. A negative or unknown parent never deletes a previous detail. Nested follow-ups respect every parent condition, and the shared chart/import preview labels retained inactive details as previous answers. Checklist counts are answer checks, not clinical approval or signature readiness.

The saved workbook's live formulas were recalculated in 460 states covering every conditional parent choice, blank parents, nested branches, retained answers, inability reasons and zero values. Both section totals matched canonical assessment behavior. Run this authoring-time check with the same bundled runtime as the generator:

```sh
node scripts/assessment-workbook-formula-contracts.mjs --render
```

The focused browser suite passed 25 tests across workbook import/export, conditional review, recovery/provenance, and referral handoff. After the final row-height correction for long inability explanations, 24 of 25 passed in the combined rerun; the late-recovery test timed out waiting for the import dialog button. Both unchanged recovery tests then passed in a focused rerun (7 seconds). That intermittent dialog timeout remains recorded, not dismissed as deployment clearance. A fresh export from the synthetic local **Workbook Morgan** assessment matched all 162 fields; dropping it back into the app correctly proposed no changes, and Cancel left the record untouched. The build, scoped lint, TypeScript, workbook coverage/freshness and whitespace checks passed. This is local development evidence, not a deployment or a native Excel certification. Native Excel is still unavailable here; the actual Excel open/edit/save cycle remains a release check. Repository-wide certification remains blocked by other complexity-ratchet findings; no baselines were changed.
