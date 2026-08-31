# Refactor Worktree Runbook

## Rule

Never run an implementation refactor directly on `main`. One approved slice gets one dedicated worktree and one `codex/refactor-*` branch. The registry records the absolute worktree path, branch, and starting commit.

## Current inventory

Observed on 2026-08-31. Recheck with `npm run check:code-quality` before acting.

| Worktree branch | Main commits ahead | Unique branch commits | Required disposition |
| --- | ---: | ---: | --- |
| `main` | 0 | 0 | Preserve the current mixed, dirty worktree; use the live checker for its changing path count and do not use it for the refactor slice. |
| `codex/client-intelligence-release` | 48 | 1 | Review the unique commit, then merge/cherry-pick or explicitly abandon it. |
| `codex/mcmaster-audit-release` | 95 | 0 | Eligible for removal after confirming no untracked operator artifact is needed. |
| `codex/production-readiness-end-to-end` | 120 | 1 | Review the unique commit, then merge/cherry-pick or explicitly abandon it. |
| `codex/client-profile-readability-documents` | 121 | 0 | Eligible for removal after confirming no untracked operator artifact is needed. |

No worktree is removed automatically. Unique commits are reviewed before any branch or worktree deletion.

## Safe start sequence

```bash
git status --short
git worktree list --porcelain
git log --oneline main..codex/client-intelligence-release
git log --oneline main..codex/production-readiness-end-to-end

# After the current product work is committed and the slice is approved:
git worktree add ../pipeline-refactor-referral-store -b codex/refactor-referral-store <reviewed-starting-sha>
```

Then verify `git merge-base main HEAD` equals the reviewed SHA, record the new path, branch, and SHA in `refactor-slices.json`, regenerate the repository audit inside that worktree, and run `npm run check:refactor-setup` before changing implementation files.

## Safe retirement sequence

1. Verify `git -C <worktree> status --short` is empty.
2. Review `git log --oneline main..<branch>` and preserve every wanted unique commit.
3. Remove the worktree with `git worktree remove <path>` only after steps 1 and 2.
4. Delete the branch non-destructively with `git branch -d <branch>`; do not force-delete unresolved commits.
5. Run `git worktree prune --dry-run` before any prune.
