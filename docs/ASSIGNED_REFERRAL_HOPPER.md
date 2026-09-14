# Assigned referral hopper

Product change based on `c641b507727d63fb12656a4f53e8b013989b7887`, September 13, 2026.

## Organization and owners

- Home always renders the full `workflow.active_items` projection from `/api/operations/home`, not the five-item action summary. Optional Home modules and their preferences remain available.
- Home and the workspace switcher use `ReferralWorkflowTracker`. The server retains authority over personal/team scope and lifecycle membership.
- Workspace, guided assessment, and full assessment have an Assigned referrals control. Existing save/recovery owners flush pending edits before opening. A failed save keeps the current editor open and the switcher closed.
- Closing the switcher preserves the mounted assessment, answers and position. Selecting another card uses the existing durable resume location. The current card closes the switcher without reopening its record.
- Submitted referrals distinguish assessor waiting from team review work. Changes requested remain actionable; accepted referrals remain while applicable completion requirements are open.
- Signing or acceptance alone does not remove a referral. Existing canonical completion rules are unchanged, including their current boundary around admission confirmation and EHR handoff.

## Saved-data refresh

`authenticated-fetch.ts` invalidates cached projections after successful mutations and notifies mounted read surfaces. A native BroadcastChannel sends only the fixed string `changed`, never patient data, identifiers or URLs. Receiving tabs invalidate their own caches and reload through their own protected APIs, without rebroadcasting.

Home, the self-loading switcher, Calendar, Workspaces/files, Clients, client charts, typed and preset search, Reports and supervisor exceptions subscribe. Their existing cancellation owners supersede old reads. Applied report filters, calendar controls and assessment editors are preserved. Private recovery drafts, navigation bookkeeping, failed mutations and report exports do not publish saved-data refreshes. Session invalidation must not notify readers during authentication renewal.

This is same-browser notification, not server push. Other users/devices and backend jobs use existing focus/poll refresh; the visible Home/switcher fallback is 30 seconds. Add a server revision notification only when immediate cross-device propagation is required. Signed assessment evidence and approved version-pinned summaries are deliberately not rewritten by later intake edits.

## Bounded evidence

- Production webpack build, TypeScript and changed-file ESLint passed.
- Live-loading and instant-navigation contracts passed, including metadata-only cross-tab refresh, no echo, failed/draft/export suppression and session-notification suppression.
- Targeted Chromium run: 42 passed, two existing opt-in layout API/race tests skipped. Includes seven referrals at phone/desktop widths, personal/team presentation, pinned Home work, stage restoration, successful/failed save-before-switch, cross-tab refresh superseding a delayed old GET, typed/preset search replacing renamed and removed results, both assessment views preserving position/answers, Reports role boundaries and Calendar characterization.
- Synthetic screenshots inspected at desktop/phone sizes; guided assessment header also checked at 320px. No production records were modified by tests.
- Pre-implementation repository audit and refactor-guidance check passed. Refactor setup check encountered existing stale worktree metadata for `/private/tmp/pipeline-header-release-c6e7b68`. This is product work, not a refactor slice; refactor controls were not changed.

## Release gate correction

Bounded correction based on frozen `dee04abeae7dfc942d11ab08e36760486650f28c`. Local presentation/publication helpers preserve the existing guards, saves, state, errors and API behavior. No complexity baseline or approved ceiling was changed.

| Function | Before correction | After correction |
| --- | ---: | ---: |
| PipelineOverviewRoute | 25 | 20 |
| ReferralPacketCanvas | 64 | 54 |
| WorkflowCard | 16 | 8 |
| fetchPipelineApi | 18 | 14 |
| toReferralWorklistItem | 29 | 27 |

The chaos source contract now checks the cancellable directory refresh, successful revision acknowledgment and cancellation before publication. Its last-successful-snapshot guard and existing browser retention case remain required.

Production build/TypeScript, changed-file ESLint, live-loading contracts and the complexity ratchet passed. The correction's targeted Chromium run passed 42 checks with the same two opt-in skips; the existing failed-directory-refresh browser case passed separately. Independent read-only review found no correctness/security regression in the five runtime files. The full unmodified `check:platform:fast` passed with `PIPELINE_REFACTOR_CLOUD_RUN=true` in an isolated single-worktree clone using the corrected source and standard training/Academy freshness regeneration. Stale shared Git worktree metadata was not modified; Deploy must refresh metadata for its integrated candidate.

Deployment is owned by the Deploy task, using its exact ready-commit handoff.
