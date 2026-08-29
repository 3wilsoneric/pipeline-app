# Guarded Cloud Refactor Runbook

The cloud controller lets an approved refactor slice continue on GitHub-hosted infrastructure while a developer computer is off or asleep. It does not authorize a refactor by itself, merge code, deploy, access production, or replace human review.

## Safety model

- `docs/refactoring/refactor-slices.json` remains the authorization source.
- The registry must be `active`, and exactly one slice must be `in_progress`.
- The active slice must satisfy the existing owner, approval, architecture, file-audit, branch, starting-commit, allowlist, and evidence controls.
- Codex receives a workspace-only permission profile and no Azure, production, patient-data, or deployment credentials.
- The agent checkout does not retain GitHub credentials; the workflow authenticates only after validation when it publishes a safe checkpoint.
- Workflow, governance, dependency, migration, infrastructure, environment, and deployment files are unconditionally agent-immutable.
- Every attempt runs in one `codex/refactor-*` branch and can only open or update a draft pull request.
- Focused slice gates and `npm run certify:refactor` run independently after Codex exits.
- The post-agent boundary validator is installed root-owned before Codex starts, so workspace edits cannot weaken the validator used to publish a checkpoint.
- Every remote checkpoint explicitly dispatches the independent CI and security workflows because GitHub suppresses ordinary workflow events created by `GITHUB_TOKEN`.
- Successful certification pauses the loop for human review. A blocker or three unsuccessful attempts also pauses it.
- GitHub concurrency permits only one refactor attempt across the repository.

## Cloud lifecycle

1. The selector reads the committed registry from `main`.
2. A preflight exits without invoking Codex when the registry is `setup_only`, no slice is active, approval metadata is incomplete, scheduled continuation is disabled, or a PR is already waiting for review.
3. A live run checks out the recorded branch or creates it from current `main` after verifying the recorded starting commit is an ancestor.
4. Existing setup checks run before editing.
5. The static prompt is combined with only the approved slice context.
6. Codex edits inside the isolated checkout and returns schema-validated JSON.
7. A root-owned controller copied from trusted `main` rejects any changed path outside the allowlist before tests or Git publication.
8. Hash-backed repository evidence is refreshed, focused gates run, and full certification runs.
9. A safe checkpoint is committed to the slice branch, independent CI and security runs are dispatched for that commit, and a draft PR is created or updated.
10. Scheduled continuation resumes only a `needs-work` PR below the attempt cap.

## One-time GitHub configuration

The repository requires:

- A GitHub environment named `Refactor`.
- An environment secret named `OPENAI_API_KEY`.
- A repository variable named `PIPELINE_REFACTOR_AUTORUN_ENABLED`, initially `false`.
- Main-branch protection that blocks force pushes and deletion and requires the standard CI checks before merge.
- Repository Actions permission for the pinned `openai/codex-action` and for `GITHUB_TOKEN` to create the draft PR. The workflow never submits an approval.

The environment and disabled repository variable are provisioned during controller setup. Add the API key directly in GitHub; never place it in `.env.local`, repository files, workflow inputs, logs, or a Codex prompt.

## Proving the controller without API usage

Run **Pipeline Guarded Codex Refactor** from GitHub Actions with:

```text
slice_id: auto
execution: preflight
reasoning_effort: high
```

Expected result while preparing the program:

```text
Live Codex run authorized: false
Decision: The refactor registry remains in setup_only mode.
```

This validates checkout, controller fixtures, registry parsing, and the no-run decision without calling Codex.

## Activating one slice later

Follow `docs/refactoring/README.md` and `docs/REFACTORING_PLAYBOOK.md`. Do not activate through workflow inputs. Commit the reviewed registry metadata to `main`, including:

- `mode: active`
- exactly one `status: in_progress`
- human `owner`, `approvedBy`, and `approvedAt`
- existing `architectureNarrative` and `fileAuditDisposition`
- exact `allowedChangePaths`
- `branch` beginning with `codex/refactor-`
- full `startingCommit`
- recorded `worktreePath`

Run `npm run audit:repository` and `npm run check:refactor-setup` from the approved slice checkout before enabling execution.

For one cloud attempt, dispatch the workflow with `execution: run`. To allow six-hour continuation attempts, change the repository variable only after reviewing the first run:

```bash
gh variable set PIPELINE_REFACTOR_AUTORUN_ENABLED --repo 3wilsoneric/pipeline-app --body true
```

Disable it immediately when pausing or reviewing:

```bash
gh variable set PIPELINE_REFACTOR_AUTORUN_ENABLED --repo 3wilsoneric/pipeline-app --body false
```

## Failure and recovery

- **Out-of-scope path:** no checkpoint is published; inspect the failed run and tighten the prompt or allowlist through human review.
- **Focused or full gate failure:** the safe in-scope checkpoint is published as `needs-work`; the next enabled scheduled attempt may continue it.
- **Blocked result or attempt cap:** the PR is labeled `blocked`; a person must resolve scope, evidence, or design before any restart.
- **No API key:** the live Codex step fails without exposing or weakening credentials. Preflight still works.
- **Runner interruption:** committed checkpoints survive. An uncommitted interrupted attempt restarts from the last remote checkpoint.
- **Production:** no cloud-refactor job has production secrets, Azure credentials, migration authority, merge authority, or deployment steps.
