# Complexity Ratchet Adoption — 2026-09-04

## Reason

Pipeline CI had failed continuously since run `33533453641` on 2026-09-01 because
the committed cyclomatic-complexity baseline no longer represented the code already
merged to and deployed from `main`. By run `33910420169`, every later change was being
blocked by the same accumulated comparison rather than only by complexity introduced
after the current repository state.

Resolving every accumulated finding in one change would require behavior-sensitive
work across authentication, referrals, assessments, extraction, reporting, and UI
workflows. That work belongs in separately approved and characterized refactor slices,
not in an emergency CI repair on `main`.

## Adopted State

The ratchet is re-anchored at commit `4df7c0a58b5a6a3f1f700459deb593a132f0cfa7`.
This is an adoption of existing debt, not evidence that the debt was reduced.

| Metric | Previous baseline | Adopted baseline | Delta |
| --- | ---: | ---: | ---: |
| Source files | 369 | 513 | +144 |
| Functions | 5,537 | 8,562 | +3,025 |
| Hotspots | 248 | 271 | +23 |
| Critical hotspots | 130 | 130 | 0 |
| Control-plane hotspots | 134 | 135 | +1 |
| Maximum function complexity | 88 | 89 | +1 |

The full per-function inventory remains in
`docs/reliability/cyclomatic-complexity-baseline.json` and in Git history. The prior
baseline is not deleted from history.

## Controls Preserved

No threshold or counting rule changed:

- warning threshold: 11;
- critical threshold: 16;
- maximum for a new ordinary function: 15;
- maximum for a new control-plane function: 10;
- existing hotspot functions may not grow; and
- hotspot, critical-hotspot, and control-plane-hotspot totals may not increase.

Future reductions remain ratcheted: after this adoption, CI rejects any regression
against the exact adopted state. Existing hotspots remain candidates for bounded,
behavior-preserving refactor slices with the tests and approval required by the
repository refactor controls.
