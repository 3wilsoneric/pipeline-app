# Locked-Package Ceiling Disposition Record

Author: TARS

Status: approved policy disposition

Approval context commit: `4730a4ef4e75dd4429ba0b6d1fb9e000eaba852f`

Approved by: Eric (application owner)

Approved at: `2026-09-07T13:50:16Z`

Recorded instruction: `approve 531`

## Decision

Adopt 531 as the reviewed inherited locked-package ceiling. A count of 532 or greater is an unapproved increase and fails `check:code-quality`.

## Historical evidence

- The current clean integration candidate and `main` both contain 531 locked locations.
- The policy ceiling of 530 was introduced after the lockfile already contained 531 locations.
- The 530-to-531 increase came from the security-mandated `@humanfs/types` transitive location through `@humanfs/core`, not from the refactor prerequisite integration branch.
- `npm dedupe --dry-run` did not identify a safe one-location reduction; it proposed broad optional-package churn instead.
- No direct dependency was added by the candidate branch, and the repository audit matches its lockfile.

## Approved disposition

Adopt 531 as the reviewed locked-package ceiling for the exact-start baseline, with this explicit interpretation:

- 531 is the inherited reviewed ceiling, not a target and not permission to add another package location.
- A candidate with 532 locations fails unless a separate dependency change is approved before it lands.
- The direct-dependency, duplicate-version, registry-integrity, install-hook, and unused-dependency controls remain unchanged.
- Future supported removal of the inherited transitive location should lower the ceiling in the same reviewed change.

## Rejected alternative

Direct a supported dependency reduction that produces 530 or fewer locations without changing application behavior, weakening the security fix, adding overrides, or generating broad optional-platform lockfile churn. That reduction must be reviewed and certified as a separate prerequisite change.

## Effect

`maximumLockedPackageLocations` changes from 530 to 531. Direct-dependency, duplicate-version, registry-integrity, install-hook, and unused-dependency controls remain unchanged. This decision does not authorize application refactoring or activate a slice.
