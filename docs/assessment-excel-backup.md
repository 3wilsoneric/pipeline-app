# Assessment Excel Backup

## Using It

Open **Details > Excel backup** in the assessment footer and choose **Download current assessment**. The file includes the answers currently on screen, including changes waiting to sync. It is a snapshot; download again to refresh it.

Continue in the answer cells in Excel. Choice fields have dropdowns. Lists use one item per line. Put an explanation beside any answer marked unable to assess. Save the workbook, then drop it into **Excel backup** in the same assessment.

Pipeline reads mapped cells locally, without AI or uploading the workbook. It compares the original snapshot, the Excel answers, and the current assessment. Unchanged Excel cells leave newer assessment answers alone. Conflicts and clearing an existing answer require explicit approval. Apply updates the existing draft and save queue. This never signs an assessment, records a decision, or sends an email.

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

The initial implementation deliberately rejects earlier questionnaire versions rather than guessing how to migrate clinical answers. Before a production questionnaire revision that affects outstanding working copies, add an explicit old-to-new field migration with round-trip and conflict fixtures, or arrange manual reconciliation. Changing labels alone also invalidates the current fingerprint.

## Recovery And Privacy

The blank template is prefetched and cached. An already-open assessment can export and restore while offline after that template has loaded. This does not make cold-start navigation work offline, restore a failed device, or create automatic downloaded backups. Keep encrypted local recovery and normal server autosave in place. Do not remove them in favor of Excel.

Restore first persists the local recovery draft, then uses the existing version-checked save queue. On reconnect, workbook mutations made stale by an earlier queued write may retry only after the canonical three-way merge, only for this assessment, and only if there is no section conflict and the imported answer is still current. Genuine conflicts retain the local answer for review. Restored field provenance records the copy ID and export time; existing provenance and audit behavior remain in use.

The downloaded workbook contains private client data, including original answers used for conflict comparison. Hidden sheets and worksheet protection prevent accidental changes, not unauthorized reading. Use approved encrypted device/storage controls. No client-containing workbook is stored in Cache Storage; only the public blank template is cached.

## Bounded Limits And Evidence

- Current coverage is 162 fields in 12 sections. Future coverage is checked against the canonical field registry, not this count.
- Files are limited to 5 MB compressed, 24 MB expanded, and 300 ZIP entries. Macros, embedded objects, external workbook links, formulas in consumed cells, damaged mappings, and invalid answers are rejected.
- Excel limits cell length. Notes and lists use reserved continuation cells, with a 480,000-character serialized baseline ceiling per field. Over-capacity exports fail visibly; they never truncate an answer. Increase mapped continuation capacity and its tests if a valid production answer reaches this ceiling.
- Excel's maximum row height can hide part of an unusually long answer. The complete value remains in the cell and can be read in the formula bar. This is a recovery workbook, not a substitute for the clinical chart's print layout.
- Reasons for being unable to assess are currently merged as one map. Simultaneous changes to different reasons may require a conservative conflict review. Add per-reason merging if this causes material review burden.
- Automated evidence lives in `tests/e2e/assessment-excel-backup.spec.ts` and `scripts/assessment-workbook-contracts.mjs`. It covers field round trips, unsynced/offline export, drop restore, conflicts, explicit clearing, server validation, provenance, and signed-record protection.
- Local-adapter and browser tests are not PostgreSQL characterization or a native Microsoft Excel compatibility certification. Both are production-release follow-ups; this is a local trial.

## Local Verification, September 19, 2026

The uncommitted local trial passed 21 Playwright tests across the Excel backup, assessment footer, and mobile assessment suites. Those include Chromium and explicitly launched iPhone/iPad WebKit coverage. The local build, TypeScript check, lint, workbook freshness check, and whitespace check passed. An independent read of the generated OOXML confirmed the editable/locked cells, hidden continuation rows, hidden baseline sheet, internal links, and print settings. All 15 worksheets were visually inspected; the hidden metadata sheet is not a user-facing view.

Full repository certification remains blocked by the complexity ratchet. The separate assessor-workflow static suite also fails an older schedule-shell assertion that already fails against this worktree's HEAD: it expects inline portal/schedule/navigation implementations that are no longer in AssessmentWorkspace. Neither gate was weakened or given a new baseline. No production deployment, PostgreSQL characterization, or native Excel application test was performed.
