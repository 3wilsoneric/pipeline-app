# Refactor Worktree Runbook

## Rule

Never run an implementation refactor directly on `main`. One approved slice gets one dedicated worktree and one `codex/refactor-*` branch. The registry records the absolute worktree path, branch, and starting commit.

## Current inventory

Observed on 2026-09-07 against integration candidate `141982d908d07da06dcb9d7c19e83df2f1c7ec4b`. Recheck with `npm run check:code-quality` before acting.

| Worktree branch | State relative to `main` | Relationship to integration candidate | Required disposition |
| --- | --- | --- | --- |
| `main` | Current commit; dirty product worktree | Integration candidate is 16 commits ahead | Preserve the mixed worktree and never use it for the refactor slice. |
| `codex/ci-complexity-recovery` | 28 behind; no unique commit | Fully contained | Eligible for retirement after confirming no untracked operator artifact is needed. |
| `codex/fix-calendar-filter-stability` | 2 unique commits | Fully contained | Eligible for retirement after confirming no untracked operator artifact is needed. |
| `codex/client-intelligence-release` | 219 behind; 1 unique commit | Not contained | Review `07fe85e`; merge/cherry-pick it or explicitly abandon it before retirement. |
| `codex/mcmaster-certification-remediation` | 97 behind; 4 unique commits | Not contained | Review all four unique commits; preserve or explicitly abandon them before retirement. |
| `codex/mcmaster-audit-release` | 266 behind; no unique commit | Fully contained | Eligible for retirement after confirming no untracked operator artifact is needed. |
| `codex/production-readiness-end-to-end` | 291 behind; 1 unique commit | Not contained | Review `c58ce4d`; merge/cherry-pick it or explicitly abandon it before retirement. |
| `codex/client-profile-readability-documents` | 292 behind; no unique commit | Fully contained | Eligible for retirement after confirming no untracked operator artifact is needed. |
| `codex/refactor-prerequisite-integration` | 16 unique commits | Current integration candidate | Preserve until its prerequisite changes receive an explicit merge or abandonment decision. |
| `codex/refactor-referral-store-boundaries` | 3 unique commits | Test commit is patch-equivalent; `3fc5541` remains unique | Do not use as the execution worktree. Review the unique evidence commit, then archive or retire it before reusing the name or path. |
| `codex/referral-duplicate-review` | 3 unique commits | Fully contained | Eligible for retirement after confirming no untracked operator artifact is needed. |
| `codex/referral-ownership-history` | 1 unique commit | Fully contained | Eligible for retirement after confirming no untracked operator artifact is needed. |

No worktree is removed automatically. Unique commits are reviewed before any branch or worktree deletion.

## Safe start sequence

```bash
git status --short
git worktree list --porcelain
git log --oneline main..codex/client-intelligence-release
git log --oneline main..codex/mcmaster-certification-remediation
git log --oneline main..codex/production-readiness-end-to-end
git cherry codex/refactor-prerequisite-integration codex/refactor-referral-store-boundaries

# After the current product work is committed and the slice is approved:
git worktree add ../pipeline-refactor-referral-store-v2 -b codex/refactor-referral-store-v2 <reviewed-starting-sha>
```

Then verify `git merge-base main HEAD` equals the reviewed SHA, record the new path, branch, and SHA in `refactor-slices.json`, regenerate the repository audit inside that worktree, and run `npm run check:refactor-setup` before changing implementation files.

## Safe retirement sequence

1. Verify `git -C <worktree> status --short` is empty.
2. Review `git log --oneline main..<branch>` and preserve every wanted unique commit.
3. Remove the worktree with `git worktree remove <path>` only after steps 1 and 2.
4. Delete the branch non-destructively with `git branch -d <branch>`; do not force-delete unresolved commits.
5. Run `git worktree prune --dry-run` before any prune.
