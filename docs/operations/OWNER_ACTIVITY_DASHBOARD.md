# Private application activity

Eric opens **Application activity** on Home. The same named-owner policy protects
both the Home card and `/api/operations/application-activity`; administrator roles
alone, delegated sessions, and workshop personas cannot access it.

The dashboard reads PostgreSQL's existing audit events, joined to workspace and
member identities. It includes inactive/deleted workspaces and retained actors.
Filters cover the last 24 hours, 7 days, or 30 days and a selected person. Events
load 50 at a time with a stable timestamp/UUID cursor, preserving microseconds.
Refresh takes a new snapshot. No audit writes occur when browsing the dashboard.
The API returns changed field labels, not raw before/after values, tokens, or
arbitrary audit metadata. Workspace links lead to the existing activity tools.

**Interpretation and ceilings:**

- Last activity comes from member presence, independent of the selected period.
  It is not proof someone is currently online or working.
- Sign-ins mean new Pipeline sessions established after this feature ships.
  Valid same-account session refreshes do not count again. Historical sign-ins
  cannot be reconstructed from presence timestamps.
- Sign-in recording runs after a successful login response and is best effort.
  If reporting storage fails, sign-in still succeeds and a data-free warning is
  logged. A regulatory requirement for a complete authentication ledger should
  trigger integration with the identity provider's authoritative sign-in logs.
- Actions are audit records, not clicks or hours worked. One save can write
  multiple audit records. Only actions already audited by their canonical owner
  appear. System actors may appear alongside staff.
- Local-file previews do not have a unified audit ledger. The endpoint reports
  that shared PostgreSQL is required instead of showing misleading empty data.
  Add a local adapter only if real offline administration becomes a requirement.

Verification: `node --test scripts/application-activity.test.mjs`; supply a
local-only `PIPELINE_TEST_DATABASE_URL` to include a disposable PostgreSQL test.
Browser coverage is in `tests/e2e/application-activity.spec.ts` (desktop, phone,
accessibility, filters, pagination, access denial and recovery from reporting
failure). All fixtures are synthetic and no mail is sent.
