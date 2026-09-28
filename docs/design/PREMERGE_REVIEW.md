# Redesign integration review — 2026-09-27

Local branch: `design/redesign-switch`. Production/base: `b39c377c21d11ae9e03446171c7d4b5e21aea35f` (remote main rechecked during this pass). No push, PR, merge or deployment is authorized by this report.

Current status is recorded in the follow-up below. The original review and its evidence are retained as historical results, not a claim that the current candidate has passed every hosted check.

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

## Saving and non-blocking carry-over — 2026-09-27 (2026-09-28 UTC)

Eric requested that the previous saving and non-blocking repairs carry into the redesign. Work continues locally on top of `95aa40c1fd72d482c4bce858b9100d284fb9edf5`; this follow-up has not been committed, pushed, merged or deployed. The automatic merge heartbeat is paused. The local demo changes in `DemoAssessmentLabButton.tsx`, `scripts/persona-demo.mjs` and `tsconfig.json` remain excluded from this work.

### Regression coverage and repairs

- Reused the existing desktop recovery tests instead of replacing them. `npm run test:e2e:save-recovery` covers out-of-order writes, newer edits during pending recovery, separate browser-tab recovery copies, offline reconciliation, navigation during save failures, late cleanup, lost acknowledgments, queued file bytes and labels, and non-blocking Decision edits. Layout-specific navigation now uses the existing assessment helpers; persisted-value, isolation and byte-identity assertions remain intact.
- Added this command to both existing operational CI matrix jobs (`PIPELINE_DESIGN_V2=false/true`), reusing their production build. Both test configurations now isolate and clean up the Client Notes store too.
- Fixed a redesign regression where keeping the assessment mounted skipped its exit recovery checkpoint. Leaving the visible questions now invokes the existing recovery/save owner in the background, without awaiting it to change tabs.
- Fixed a kept-mounted handoff dialog remaining in the browser's modal layer after opening Files or Assessment. The dialog closes on those actions and does not render for an inactive workspace step; the test asserts no open dialog remains.
- Preserved handoff review progress after confirming an admission date: its already-validated summary is marked current rather than reloaded as an external revision when the dialog closes.
- Kept an unsaved admission-date/decision error visible across a background workflow refresh. A successful read is not a successful write. The lost-response test now checks the actual conflict alert instead of accepting Next's unrelated route announcer.

### Local evidence

- Final production build with desktop recovery enabled passed. On that same artifact, the focused browser command passed **40 tests with design off and 40 with design on**, zero failures. Each run retains one existing skip for a session-storage-only cleanup case that belongs to the non-desktop run; it was not removed or newly disabled. Logs: `/tmp/pipeline-carryover-reviewed-false.log` and `/tmp/pipeline-carryover-reviewed-true.log`.
- Existing save unit tests: **38/38**. Notes recovery/local-store tests: **10/10**, with their real-PostgreSQL case not enabled in this follow-up. The earlier PostgreSQL evidence above is not a new run.
- Additional focused operational tests: **24/24**, covering blur-only saves, uploads, phone Notes recovery, assessor navigation, acceptance recovery and workflow interaction. After the final workflow-refresh adjustment, all **3/3 acceptance recovery cases** were rerun successfully. Logs: `/tmp/pipeline-carryover-operational.log` and `/tmp/pipeline-carryover-reviewed-acceptance.log`.
- The cloned-tab recovery scenario also passed three repetitions. Focused ESLint, TypeScript/build, workflow YAML validation and `git diff --check` passed. No baselines, thresholds, authorization or clinical workflow rules were weakened.
- Local browser runs must be sequential when sharing a standalone build: `start-standalone.mjs` restages its static directory at startup. An earlier overlapping run served transient missing chunks; it is not counted as passing evidence. The final runs above were sequential.

### Remaining blocker, not a green release

PR #193 remains open at the original approved head and base. Its original [GitHub browser job](https://github.com/3wilsoneric/pipeline-app/actions/runs/36370519902/job/108766154743) failed: **33 failed, 9 flaky, 712 passed, 161 skipped** in the primary browser journeys. Examples include late assessment recovery/section restoration, sign-review-decision separation, workspace resume, chart keyboard editing and Home/Reports expectations. These require root-cause investigation; they have not been established as all stale tests or all application regressions. The focused local passes do not supersede that failure. Verify, security, PostgreSQL and both original operational jobs passed; later browser-job steps were not reached.

Two additional local broad diagnostics were not green: `check:code-quality` stopped on missing registered temporary worktree directories, and `complexity:check` reported violations against the historical ratchet. Neither diagnostic, its baseline nor worktree registration was modified to obtain a pass; neither is included in the successful focused evidence above.

Next: resolve the concrete hosted failures, obtain approval before pushing a revised candidate, and require passing hosted checks on that exact head before a newly approved merge. No production deployment or redesign activation is authorized by this follow-up. All browser data in this pass was synthetic/local; this is not production acceptance or a guarantee against every future failure.

## Hosted browser failure repair — 2026-09-28 UTC

The owner authorized repairing the failed browser checks locally. This section supersedes the investigation status above, not the original hosted result. PR #193 is still open at `95aa40c1`, with main/base `b39c377c`; no follow-up push, merge, deployment or production flag change has occurred.

### Causes and narrow repairs

- The hosted primary browser build/runtime omitted desktop workspace state even though its Home, resume, draft and handoff journeys require it. CI now enables the compile-time **and** server flags for that artifact/run, matching the production app's workspace-state capability. The browser-only recovery paths are retained in a separate non-desktop run; no skip condition, assertion or threshold was weakened to hide the mismatch.
- The chart's successful supporting-records render introduced a different fragment nesting than its loading/error render. React remounted the intake controls when the response arrived, losing keyboard focus. The sibling slots now remain stable. A deterministic browser regression holds the supporting response until a chart pencil has focus, releases it, verifies the original element stayed mounted/focused, and edits/saves through it.
- The existing `editPreparedAnswer` helper returned without clicking when a field was already visible. It now performs the edit-focus action its callers request.
- The supervisor queue silently truncated the entire canonical snapshot at 250 entries. A failed downstream EHR handoff could therefore disappear from both the queue and its report. The canonical internal snapshot is complete; API/dashboard responses remain bounded to 250 entries per page. `Show all` follows the pages, retains the last successful view on failure, allows navigation/retry, and fences superseded requests. Portfolio severity totals no longer count only the first page. The EHR journey follows pagination and still requires its actual failed referral to be present.
- Added route tests with 501 exceptions, including a failed EHR handoff on the final page, invalid-offset rejection before storage reads, and authentication on subsequent pages. These run in the existing non-browser contract gate. Added a 251-entry browser scenario for expansion, page failure, retry, collapse and opening the final recovery item.

These are shared bug fixes, including with the design switch off; they do not change clinical writes, permissions, intake requirements or the visual redesign. No migration was changed.

### Pagination limit

Queue reads remain live, not a transaction spanning several browser requests. Stable tie-breaking and ID deduplication handle overlaps; a fresh read from page one reconciles entries whose priority changed between pages. The existing focus/minute refresh remains. Large, rapidly changing queues or measured slow expansion are the concrete trigger for server-side snapshot/keyset pagination and windowed rendering; this repair does not promise an immutable cross-page snapshot or unlimited rendering capacity.

### Startup race investigation

A later switch-on repetition exposed three test assumptions rather than new server-write failures. The retained failure trace showed `fill` completing while `packet-workspace` was still `inert` with `aria-busy=true`; no focus or input event reached the textarea, so there was no edit to save. The test now waits for the **existing bounded workspace restore**, without waiting on or changing saves. The duplicate-tab test waits for the first tab's recovery-session ID before cloning it; typing in the two tabs remains concurrent. The navigation helper moves the pointer outside an open hover preview before clicking the underlying record-rail control, without forced clicks or overlay bypasses. Temporary diagnostic instrumentation was removed. These changes add no application lock, debounce, artificial typing delay, or looser assertion.

### Local repair evidence

- After the runtime/focus repairs, **125/125 affected and adjacent browser scenarios passed** (`/tmp/pipeline-browser-repair-verified.log`). This includes Chromium/WebKit chart controls at desktop, tablet and phone sizes, Home/Reports, scheduling/resume, assessment sections and full-questionnaire behavior. This run preceded the queue-pagination change.
- On the final application artifact, the expanded switch-off run passed **73 scenarios**, including all **40 save/recovery scenarios**, with the existing one mode-specific skip. Its sole failure was the newly added queue test using a synthetic name that the real first/last-name formatter shortened. The fixture was corrected; the focused rerun passed **4/4**, including queue failure/retry/final-item navigation, deterministic late-profile focus, and both previously failing chart/EHR end-to-end journeys. Logs: `/tmp/pipeline-final-off.log`, `/tmp/pipeline-final-browser-corrected.log`.
- The separate non-desktop build passed **11/11 browser-only recovery scenarios**, with eight existing desktop-only cases skipped (`/tmp/pipeline-browser-recovery.log`). The lab-only access boundary passed **1/1** against the newly desktop-enabled browser artifact (`/tmp/pipeline-final-access.log`).
- With startup/readiness assumptions corrected, the final switch-on save/recovery run passed **40/40**, with the same single non-desktop-only skip (`/tmp/pipeline-final-on-stable.log`). The cloned assessment-tab recovery case also passed **3/3 consecutive repetitions** with both editors interactive before concurrent typing (`/tmp/pipeline-clone-ready.log`). Earlier intermittent runs are retained as diagnostic evidence, not counted as passes.
- The final switch-on chart focus, desktop/phone keyboard editing and queue expansion/retry checks passed **4/4** (`/tmp/pipeline-final-on-browser-ready.log`). The revised cross-tab save/isolation tests passed **10/10** again with the switch off (`/tmp/pipeline-final-off-updated-tests.log`), and the strengthened delayed-profile focus test passed there too (`/tmp/pipeline-final-off-focus-ready.log`). That focus test now verifies the workspace is interactive and the original control actually has focus before releasing the held response.
- Save unit tests **38/38**; report/access and new pagination route tests **28/28**. Production build, TypeScript, focused ESLint, the unchanged design-token ratchet, workflow YAML parsing, API authorization-policy audit, supply-chain workflow checks and diff whitespace checks passed. No PostgreSQL migration or write owner was changed in this repair; prior PostgreSQL evidence is not represented as a new run.

Hosted verification still requires an approved push of the revised candidate. The original failed GitHub run has not been restarted or bypassed, and its result remains failed. Local evidence is not a full hosted CI pass or production acceptance.

## Fresh hosted result and two fixture repairs — 2026-09-28 UTC

Eric approved pushing `5d9e6370`. In run `36376664498`, verify, security, PostgreSQL and both operational modes (including the save/recovery suite) passed. Primary browser journeys finished with **844 passed, 2 failed, 7 flaky, 64 skipped** in 37 minutes. Later browser-job steps did not execute; this is not a green release. The follow-up heartbeat is paused. No merge or deployment occurred.

- Contact settings reached the application's not-found page, before any address was entered. The hosted external server omitted `PIPELINE_COMMUNITY_RECIPIENT_LIST_PATH`; the managed local test server already configured it. CI now points to the same isolated fixture seeded by global setup, and the navigation test explicitly checks the page heading before editing. No production permission or save logic changed.
- The workspace-filter layout snapshot contained six unfinished referral drafts from earlier recovery tests sharing the synthetic server account. That fixture already stubs the directory and file APIs but omitted the draft list. It now supplies an explicitly empty draft list and verifies the recovery panel is absent before measuring. The original 32-pixel layout limit and filter/accessibility assertions remain unchanged; actual recovery behavior remains covered separately.

The two repaired cases (filter test at desktop and phone sizes) passed **3/3** locally with design off (`/tmp/pipeline-ci-final-two.log`) and **3/3** with design on (`/tmp/pipeline-ci-final-two-v2-reviewed.log`). The additional switch-on check initially exposed its approved padded search wrapper: its input begins 40.5 pixels below the directory, while the control itself begins within 32 pixels. The redesign assertion now checks the same 32-pixel control placement plus exact vertical input centering; the original switch-off assertion is unchanged. Focused ESLint, YAML/fixture-path checks and diff whitespace checks passed. Failure logs and downloaded synthetic traces are retained in `/tmp/pipeline-pr193-repair-ci-failed.log` and `/tmp/pipeline-pr193-ci.l1CdIX`. These follow-up changes still require approval before another push.

## Owner-approved parallel browser checks — 2026-09-28 UTC

Eric subsequently approved splitting the unchanged suites into isolated parallel jobs and pushing the fixture repairs. Primary browser journeys now use Playwright's four file-level shards, each with its own runner, build, server and stores; individual tests still use one worker. The desktop, cross-browser, Linux visual, access/performance and browser-only recovery commands run on separate runners rather than waiting behind the primary suite. The access/performance job compiles the non-desktop artifact that its existing performance runner expects. No tests, retries, budgets, snapshots or assertions are removed to accelerate CI.

`browser` remains an aggregate gate and fails unless verification, every primary shard and every supplemental suite succeed. Local shell checks verified that failure, cancellation or a skipped dependency cannot pass it. All six previous supplemental commands remain present unchanged. Full Playwright discovery contains **917 test cases**; shard discovery yields **235 + 226 + 229 + 227**, with exactly the same identities and no overlap. The supply-chain guard now parses the workflow and checks both browser containers instead of assuming one job name. YAML, focused ESLint, supply-chain and diff checks passed.

This reduces the serial critical path, not total test coverage. Separate builds add runner overhead; actual elapsed time remains subject to runner availability and the slowest shard. No application or production configuration was changed in this follow-up. Fresh hosted checks are still required before merge; merge, deployment and global redesign activation remain separately approval-gated.

## Performance harness blocker — 2026-09-28 05:15 UTC

Candidate `73c4ee683da7c16b33586beac613dbc56fcdca38` remains open against the unchanged main/base. Hosted job `108795733844` in run `36380427618` passed note-lab access and the performance contracts, then failed in `source_pdf_complete_body`: the scorecard waited for a popup, while the current source-file links intentionally navigate the same tab. This is an obsolete harness interaction, not an observed failed save. The heartbeat is paused; no merge, push, deployment or production settings change followed this failure.

Two local harness repairs are uncommitted:

- The source PDF journey follows a trusted link click, requires a navigation response in the current page's main frame and no additional tab, validates PDF response headers, and retains the bounded browser fetch and complete PDF-body signature check. Headless Chromium can download instead of committing a native viewer URL; the test does not equate native viewer rendering with byte delivery. Returning to the chart is verified before subsequent work. Timing falls back to full driver duration if document navigation replaced the input marker; no limits changed.
- The Files journey now checks the visible upload control and the loaded empty-file state. `Signed Medication List` is inside a closed menu, not the current Files-page readiness indicator.

The local production-artifact run progressed through both repaired journeys, then stopped at the next stale expectation: `Guided tutorial library` is now `Tutorials`, and its old team-work, resume and end controls do not match the current tutorial interface. The whole performance scorecard is **not passing**. Updating those scenarios requires preserving their interaction coverage against the current tutorial lifecycle, not deleting them or increasing budgets. Log: `/tmp/pipeline-mcmaster-current-files.log`. Earlier diagnostics are `/tmp/pipeline-mcmaster-same-tab.log` and `/tmp/pipeline-mcmaster-same-tab-fixed.log`.

The strengthened scorecard contracts (45 reported checks), focused ESLint and diff whitespace checks passed. Application code, migrations and the three pre-existing local preview changes were left untouched. Hosted operational/save-recovery jobs passed in both designs; security, verify, PostgreSQL, desktop, cross-browser, visual and browser-only recovery passed. Primary browser shards were still finishing when this blocker was investigated. These successes do not override the failed performance gate.

## Completed performance repair — 2026-09-28 UTC

Eric authorized finishing the bounded repair, then explicitly approved pushing the tested repairs to PR #193. This does **not** authorize merge, deployment or design activation. Fresh inspection confirmed `73c4ee68` remains open against `b39c377c`; all four primary browser shards also passed. Access-performance and its aggregate browser gate are the only failed hosted checks. They remain failed historical runs, not overridden results.

### Final changes and root causes

- Kept the same-tab PDF and Files readiness repairs above. The performance scorecard now exercises the current Reports guide lifecycle (open, start, next, previous, pause, reopen, restart, return to library, close), plus entering, progressing through, exiting and reopening fictional referral practice. Retired Resume/End/team-work controls were not recreated or silently skipped. All numerical budgets, real clicks, content checks and nine guide interactions remain enforced. Interaction timing retains earlier document samples rather than losing them across navigation.
- Fictional tutorial entry/exit previously reloaded the whole application. Both now use Next client navigation, retaining the identity recheck, navigation/save guard and safe local return URL. The persistent guide follows `usePathname`, so it becomes available again after returning. No clinical save, authorization, layout or wording changes were made.
- Default Next prefetch only warmed the dynamic route's loading boundary. The open Tutorials menu now fully prefetches its authorized fictional practice destinations using the installed router's typed `PrefetchKind.FULL` option; it does not fetch tutorials at application startup or bypass the actual entry authorization. This bounded menu-only strategy has no polling or custom cache. Revisit the prefetch option when upgrading Next or if this small tutorial catalog becomes large; build/type checks and performance tests cover the current framework API.
- Instrumentation separated actual DOM arrival (~337 ms) from Playwright's delayed visibility polling (~825 ms). Full route prefetch removed the underlying wait; no measurement budget or visibility assertion was relaxed to compensate for polling. The final observed tutorial entry was at most **66 ms**, versus ~817 ms before full prefetch.
- Failed calibration now stops its server before the runner exits. Health checks have an actual eight-second deadline with bounded individual requests, so a stale local listener cannot hang readiness indefinitely. An intentional missing-browser failure exited as expected and left no calibration server listening on port 3290.
- Strengthened tutorial tests verify same-document entry/exit/re-entry on desktop and phone, no live clinical writes, and preservation of a real intake draft after a fictional tutorial round trip. Two existing focus tests were racing initialization: one clicked before its assessment target appeared; the other changed a server-rendered phone selector before hydration. They now require the existing visible target/highlight readiness, and retain focus assertions; the phone test additionally requires the selected stage and hidden card before testing guidance.

### Evidence and limits

- Production artifact build and its TypeScript check passed: `/tmp/pipeline-tutorial-full-prefetch-build.log`.
- Unchanged three-sample performance certification passed **every check in all three scored runs** (plus discarded calibration): `/tmp/pipeline-mcmaster-full-prefetch.log`. Worst warm navigation 147.1 ms (limit 167), tutorial entry 66 ms, assessment tutorial entry 82.3 ms, INP 48 ms, zero API errors. This performance run used the switch-off design; it is local sanitized-fixture evidence, not production latency or a hosted pass.
- Tutorial fixtures **18/18**, performance contracts **57 checks**, focused ESLint and diff whitespace checks passed.
- Old-design tutorial/browser regression: **43/43** passed (`/tmp/pipeline-tutorial-final-off.log`). Redesign regression: **42 passed**, with the phone initialization race described above; after correcting that precondition, both affected focus cases passed **3 consecutive repetitions each** (`/tmp/pipeline-tutorial-focus-on.log`). Same-document navigation, draft preservation, isolation, access restrictions, sample scheduling, signing, file labeling and return paths passed in both designs. Earlier failed attempts are retained, not counted as passes.
- Failure-cleanup exercise: `/tmp/pipeline-mcmaster-failure-cleanup.log`; expected failure and absence of the server listener were verified.
- The final strengthened focus tests also passed **6/6** with the switch off (`/tmp/pipeline-tutorial-focus-off.log`), completing validation of those test changes in both designs.
- An extra historical `complexity:check` still reports unrelated repository-wide baseline/disposition failures; none name the modified tutorial/performance owners. The optional `check:code-quality` inventory command did not complete because a registered worktree path no longer exists. Neither is the current CI gate; no baseline, disposition, worktree metadata or threshold was changed. Logs: `/tmp/pipeline-tutorial-complexity.log`, `/tmp/pipeline-tutorial-code-quality.log`. Required hosted verification remains mandatory on the new candidate.

The three pre-existing preview-only changes remain byte-for-byte unchanged and excluded. No applied migration, Notes data, production setting, deployment or main checkout was modified. This supersedes the incomplete local repair status above; it does not replace the upcoming fresh hosted checks.
