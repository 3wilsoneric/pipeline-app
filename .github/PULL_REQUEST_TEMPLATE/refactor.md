## Refactor slice

Registry ID:

Human owner:

Architecture narrative:

Decision record:

Evidence matrix entry:

Performance budget profile:

Starting commit / dedicated worktree branch:

File audit disposition:

## Scope

- Structural outcome:
- Explicit non-goals:
- Changed paths match registry allowlist:
- Product behavior preserved:
- Intentional behavior changes, reviewed separately:

## Control-plane review

- Invariants touched:
- Authorization/resource ownership:
- Audit and idempotency transaction boundary:
- PHI/logging/metrics:
- Local/PostgreSQL parity:
- Migration/checksum impact:
- Extraction provenance or identity matching impact:

## Evidence

- Characterization tests:
- Focused gates:
- `npm run certify:refactor`:
- PostgreSQL/concurrency evidence, if applicable:
- Browser/accessibility/visual evidence, if applicable:
- Before/after baseline comparison:
- Evidence readiness (`npm run check:refactor-evidence`):
- Code quality and dependency readiness (`npm run check:code-quality`):
- Every-file audit refreshed (`npm run audit:repository`):
- Performance budget result:
- Seeded-defect result:

## Rollback

- Revert boundary:
- Data recovery required:
- Feature/shadow flag:
- Legacy deletion criterion:

## Human explain-back

[Explain in your own words what changed, why the invariants still hold, and what failure would reveal a mistake.]
