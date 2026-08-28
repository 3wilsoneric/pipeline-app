# Ownership and Branch Protection Setup

## Current blocker

The repository does not yet contain enforceable `CODEOWNERS` entries because the correct GitHub usernames or teams have not been provided. Do not add fake handles: GitHub silently fails to request the intended review.

## Required owner groups

- Referral/workflow control plane.
- Assessment lifecycle and clinical form semantics.
- Authentication, authorization, and PHI security.
- PostgreSQL schema, migration, backup, and recovery.
- Extraction, Blob, Databricks, and provenance.
- UI/accessibility and workflow presentation.
- Operational owner for admissions and EHR handoff.

One person may cover multiple groups during the pilot, but every group needs a named primary and backup before production refactors.

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

Require:

- Pull request before merge.
- At least one independent approval; two for control-plane paths when staffing permits.
- Code-owner review for matched paths.
- Dismissal of stale approvals after new commits.
- Conversation resolution.
- Linear history or squash policy.
- Required checks: fast platform, assurance registry, production build, path-selected browser/PostgreSQL jobs, dependency review, and refactor evidence for refactor-labeled changes.
- No administrator bypass for ordinary changes.

## Human review rule

The implementation agent cannot be the only reviewer of its generated test and production changes. Control-plane pull requests include the human explain-back template and name the operator who owns rollback.
