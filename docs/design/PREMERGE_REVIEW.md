# Redesign integration review — 2026-09-27

Local branch: `design/redesign-switch`. Production/base: `b39c377c21d11ae9e03446171c7d4b5e21aea35f` (remote main rechecked during this pass). No push, PR, merge or deployment is authorized by this report.

## Integration

The earlier save, navigation, upload and recovery repairs are already included through main's `448a6595` merge of PR #206. They were preserved, not copied again from an older dirty worktree. The unrelated primary checkout and the demo-generated `tsconfig.json` change are excluded.

The switch remains global and defaults off. There is no per-user pilot. New deployment input `enable_design_v2` reaches both what-if and runtime deployment. The rollout identity is separate from the immutable image SHA, allowing off/on rollouts of the same image. Fast image-only rollout preserves environment values and verifies their digest; it refuses a changed production revision. No Azure settings were changed.

## Repairs

- Client Notes use one owner per account/referral within the page, with independent heading queues, encrypted account/tab recovery, retries, lost-acknowledgment reconciliation and retained edits after closing the panel. A conflicting heading preserves both versions and does not stop other headings or assessment work. Late account responses and stale refreshes cannot replace the current draft.
- Notes load failure is visible with Retry. Browser-storage failure does not disable server editing. Local corrupt/unreadable files fail visibly rather than becoming an empty notes store; failed writes do not advance cached versions.
- Notes are available on phones, with keyboard-viewport sizing and adequately sized close controls. Practice remains excluded. This and the wording are explicitly approved in DECISIONS.md.
- Latest-note requests retain canonical access checks with bounded concurrency. Summary requests are fenced across sessions and newer saves; clearing a heading reloads the remaining canonical summary.
- Kept-mounted Finish & send refreshes the admission summary when activated or when its source version changes, without resetting an open review or looping after a failed refresh.
- Restored interview mode is applied before paint. Split-width preference uses the native external-store subscription rather than an undocumented lint suppression.
- Operational tests now exercise the approved redesigned navigation and idle-save behavior while retaining switch-off assertions, persisted-value checks, single-upload checks, byte identity, reopen, time-zone and responsive checks. CI runs both switch settings.

## Evidence

- Real PostgreSQL 16: all migrations applied using the existing runner; database assurance **49/49** passed. Disposable loopback database only, stopped after the run.
- Additional real PostgreSQL Notes test: unchanged migration 0046, separate migration/runtime-role privileges, eight-way first-save race, read/write/stale-version route behavior, independent heading/referral versions, latest-note summary and refusal to drop populated notes on rollback. Passed. No applied migrations rewritten.
- Notes recovery/controller tests: **8/8** passed. Local-store failure tests: **2/2** passed. Phone browser scenario verifies encrypted recovery through reload, then exactly one canonical save once the injected outage ends.
- Deployment rehearsals: **7/7** passed, including switch defaults/wiring, image-only flag preservation, configuration drift detection, backup/migration failure stop conditions. Bicep compilation passed; the existing secure-parameter-default warning on `preservedMail` remains.
- Linux visual comparison: **6/6** passed after the owner-approved refresh of exactly three stale snapshots from production main. On those three screens main and switch-off candidate actual PNGs were byte-identical. No comparison thresholds changed.
- Final operational suites against the same correctly configured production build: **switch off 73 passed, 39 skipped; switch on 78 passed, 34 skipped; zero failures in either run**. Skips are the existing environment/feature-specific exclusions and the opposite-design scenarios, not removed assertions. Both runs include the final handoff-summary refresh repair.
- Local equivalent of CI's non-browser contracts, TypeScript, ESLint, assurance, enterprise foundation and dependency audit passed. GitHub CI itself cannot run until an approved push/PR.
- Production build and artifact audit passed: no source maps or server credential markers in the browser output; all byte budgets unchanged and passing.

The operational logs are `/tmp/pipeline-redesign-approved-off.log` and `/tmp/pipeline-redesign-approved-on.log`; the non-browser gate log is `/tmp/pipeline-redesign-verify-final.log`. The local release manifest and SBOM are generated from a clean clone of the committed candidate, excluding the unrelated demo `tsconfig.json` change.

A manual prebuilt operational run must build with `NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED=true`, as the normal operational configuration does. An earlier reused build omitted that compile-time flag; its two server-draft assertions were invalid test setup, not counted as passing evidence.

## Remaining release gates

1. Eric's approval to push, then approval to open the PR; hosted required CI must pass on the exact candidate. Ask separately before merge.
2. Before any production deploy, reread the last successful run's inputs and ask about `extraction_backend` and `enable_demo_center`. Last inspected run `36286494103` used `manual` and `true`, unlike older notes. Do not infer a new choice.
3. Owner-approved full deployment with design off; verify health, migration 0046 and unchanged appearance. Preserve the recorded previous image/revision and the notes table.
4. Separate approval to activate the global redesign; role-based production acceptance including a phone. This local pass is not production acceptance or a claim of zero possible failures.

## Deliberate limits

Notes recover while the browser/device retains its encryption key and storage; clearing site data can remove unsynced recovery. True conflicting text requires a choice for that heading. Retry work cannot run while a browser is closed. Finish & send still leaves the rail only after admission/closure, not merely after sending; no workflow rule was changed to conceal that distinction.
