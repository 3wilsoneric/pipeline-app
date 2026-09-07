# Ownership and Branch Protection Setup

## Current state

The repository routes all paths and high-risk control planes to `@3wilsoneric`. The program is currently in `owner_fast_lane`, so the lack of a second repository reviewer is not a start blocker. Independent review remains recommended and becomes mandatory again if the registry returns to the `standard` lane. Do not add placeholder handles.

Rechecked on 2026-09-07 through the GitHub API: `main` requires the `verify` status check with strict branch freshness, linear history, and conversation resolution, and blocks force pushes and deletion. It still requires zero approvals, does not require code-owner review, does not enforce protection for administrators, and does not require the path-selected browser, operational, PostgreSQL, or security results. The repository has no additional rulesets. Recheck again immediately before activation:

```bash
gh api repos/3wilsoneric/pipeline-app/branches/main/protection
gh api repos/3wilsoneric/pipeline-app/rulesets
```

## Required owner groups

- Referral/workflow control plane.
- Assessment lifecycle and clinical form semantics.
- Authentication, authorization, and PHI security.
- PostgreSQL schema, migration, backup, and recovery.
- Extraction, Blob, Databricks, and provenance.
- UI/accessibility and workflow presentation.
- Operational owner for admissions and EHR handoff.

One person may cover multiple groups during the pilot. The standard lane requires a named primary and backup; the owner fast lane requires a named owner and rollback operator and treats an independent backup as advisory.

Record those people in the selected slice's architecture narrative and registry metadata before creating `CODEOWNERS`. The registry's `owner` is accountable for the slice; the backup and operational rollback owner remain explicit in the narrative and pull request.

## Future `CODEOWNERS` shape

```text
/lib/auth/                                      @security-team
/proxy.ts                                       @security-team
/lib/pipeline/referral-store.ts                 @workflow-team @database-team
/lib/pipeline/workflow-store.ts                 @workflow-team @database-team
/lib/assessment/                                @assessment-team @database-team
/lib/extraction/                                @extraction-team @security-team
/databricks/                                    @extraction-team
/database/                                      @database-team
/app/api/                                       @security-team
/components/pipeline/                           @ui-team @workflow-team
```

Replace placeholders with real GitHub handles only after confirming repository access.

## Branch protection

Require in both lanes:

- Pull request before merge.
- Conversation resolution.
- Linear history or squash policy.
- Required checks: fast platform, assurance registry, production build, path-selected browser/PostgreSQL jobs, dependency review, and refactor evidence for refactor-labeled changes.
- No administrator bypass for ordinary changes.

The standard lane additionally requires at least one independent approval, code-owner review for matched paths, and dismissal of stale approvals after new commits. Two approvals for control-plane paths are preferred when staffing permits. In `owner_fast_lane`, those human-review settings are advisory; the required commit-attached machine contexts remain mandatory.

The required checks must be attached to the exact candidate commit. For a refactor pull request, the selected slice gates, complexity ratchet, full refactor certification, and any required browser/PostgreSQL/security jobs cannot be satisfied only by an older commit or an unlinked local run.

The integration candidate removes the pull-request exclusions from `browser`, `operational`, `postgres`, and `codeql`, and makes both CI workflows run for documentation/control-only pull requests so required contexts cannot disappear. After that workflow change lands, protect the exact job contexts `verify`, `browser`, `operational`, `postgres`, `dependency-review`, and `codeql`; a path-selected job may report skipped, but its workflow must still produce the commit-attached context.

## Review rule

In the standard lane, the implementation agent cannot be the only reviewer of its generated test and production changes. In `owner_fast_lane`, the named owner may authorize the candidate after all retained gates pass. Control-plane pull requests always name the operator who owns rollback, and no lane may override a failed machine gate or unresolved critical/high finding.
