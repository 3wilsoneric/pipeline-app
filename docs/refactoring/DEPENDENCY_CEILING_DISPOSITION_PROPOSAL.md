# Locked-Package Ceiling Disposition Proposal

Author: TARS

Status: proposed policy disposition; awaiting human approval

Observed commit: `ea076521654dcbb458ec39f666347d0818209a9a`

## Decision needed

The generated dependency inventory contains 531 locked package locations. `code-quality-policy.json` permits 530, so `check:code-quality` and the aggregate refactor setup gate cannot pass.

## Historical evidence

- The current clean integration candidate and `main` both contain 531 locked locations.
- The policy ceiling of 530 was introduced after the lockfile already contained 531 locations.
- The 530-to-531 increase came from the security-mandated `@humanfs/types` transitive location through `@humanfs/core`, not from the refactor prerequisite integration branch.
- `npm dedupe --dry-run` did not identify a safe one-location reduction; it proposed broad optional-package churn instead.
- No direct dependency was added by the candidate branch, and the repository audit matches its lockfile.

## Proposed disposition

Adopt 531 as the reviewed locked-package ceiling for the exact-start baseline, with this explicit interpretation:

- 531 is the inherited reviewed ceiling, not a target and not permission to add another package location.
- A candidate with 532 locations fails unless a separate dependency change is approved before it lands.
- The direct-dependency, duplicate-version, registry-integrity, install-hook, and unused-dependency controls remain unchanged.
- Future supported removal of the inherited transitive location should lower the ceiling in the same reviewed change.

## Alternative

Direct a supported dependency reduction that produces 530 or fewer locations without changing application behavior, weakening the security fix, adding overrides, or generating broad optional-platform lockfile churn. That reduction must be reviewed and certified as a separate prerequisite change.

## Human action

Choose one of the two dispositions. If the 531 baseline is approved, TARS will change only `maximumLockedPackageLocations` from 530 to 531, update the explanatory code-quality document/evidence note, regenerate the repository audit, and rerun the exact setup gates. This proposal itself does not change policy.
