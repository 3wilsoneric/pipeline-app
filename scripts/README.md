# Verification: use the smallest relevant entrypoint

These commands serve different purposes. `check:platform:fast` means **no production build**, not a tiny unit-test run. Do not use it for every edit.

| Change or question | Focused command | Broader obligation |
| --- | --- | --- |
| CI change selection / artifact cleanup | `npm run check:tooling` | CI configuration changes still select integration lanes |
| Intake save state, assessment draft/offline recovery, upload retries, audit values | `npm run check:saving` | Affected browser flow; PostgreSQL integration for storage changes |
| Specific Node fixture | `node --test scripts/<name>.test.mjs` | Select based on the changed behavior, not a filename alone |
| Specific browser interaction | `npx playwright test tests/e2e/<name>.spec.ts --project=chromium` | Additional viewports/browsers where affected |
| Database semantics or migrations | `npm run database:assurance:integration` | Approved isolated database, current compatibility and rollback requirements |
| Complete non-browser release checks | `npm run check:platform:fast` | Required CI and security checks remain authoritative |
| Full browser regression | `npm run test:e2e` | Integration/release boundary or cross-cutting changes |
| Artifact disk inventory | `npm run clean:artifacts` | Preview only; never a pre-commit destructive hook |

`check:saving` is reused by the existing platform gate; do not separately rerun its constituent commands as another release ritual. Focused checks do not replace required CI. The change classifier preserves broad browser/database routing while fixing unsafe omission cases; it does not label untested changes safe.

For cleanup, review the preview first. An explicit `npm run clean:artifacts -- --apply --artifact=.next-SPECIFIC-NAME` can remove only a selected eligible artifact at least seven days old, without a build lock or detected runtime in this checkout. If runtime activity cannot be checked, removal is refused. `.next`, `.data`, `tmp`, dependencies, tools, credentials, symlinks, and other worktrees are not cleanup targets. Rebuildable output deletion is permanent; keep evidence needed for an active investigation.

Browser and database suites can create isolated fixtures and build output. Inspect live/cloud commands and their cost/side effects before using them; none are implied by a request for a quick code edit.
