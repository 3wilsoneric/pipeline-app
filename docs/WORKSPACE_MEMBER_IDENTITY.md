# Pipeline workspace member identities

Pipeline separates **work assignment** from **Microsoft sign-in access**.

## Identity states

- `entra_linked`: an authenticated Microsoft Entra principal. This person can sign in when the app-role assignment is also present.
- `provisional`: a real staff directory entry that can own referrals, requirements, and assessments, but cannot sign in yet.
- `merged`: a retired provisional entry whose active assignments were moved to an Entra principal.

Provisional entries are displayed as `Microsoft access pending`. They never contain a guessed email address, password, token, tenant role, or Entra object ID.

## Import the historical Allo owners

Plan first:

```bash
npm run database:members:import
```

Apply only after migration `0010_provisional_workspace_members` is present:

```bash
PIPELINE_DATABASE_URL='...' npm run database:members:import -- --apply
```

The VNet-scoped Container Apps job may use
`PIPELINE_WORKSPACE_MEMBER_IMPORT_APPLY=true` instead of a command-line flag.

The manifest is idempotent and grants only `reviewer` and `viewer`. Supervisor and administrator roles must be assigned deliberately after the organization confirms them.

## Link a real Entra identity later

Use the Entra **object ID**, not an email alias, as the immutable principal ID:

```bash
PIPELINE_DATABASE_URL='...' npm run database:members:link -- \
  --provisional-id='provisional:allo:staff-slug' \
  --entra-principal-id='00000000-0000-0000-0000-000000000000' \
  --display-name='Staff Name' \
  --email='staff@example.com' \
  --apply
```

The link runs in one transaction. It moves referral, requirement, and assessment ownership, preserves the display name, deactivates the provisional entry, and records an identity-link audit event. It does not grant the Entra app role; that remains an Entra administrator action.

## Ownership import rule

Historical owner names are not applied when a canvas has multiple or conflicting owners. Pipeline requires an explicit single owner, so ambiguous spreadsheet matches remain unassigned for supervisor review instead of being guessed.

## Administrator God mode

Pipeline administrators can open the profile menu and choose **God mode** to open any other active Pipeline account and its workspaces. This includes imported Allo identities and Microsoft-linked users. God mode is a permanent application capability; it does not create or modify the selected person's sign-in account.

God mode:

- uses the selected person's exact principal ID for their account-specific state, assignments, referrals, assessments, drafts, recents, and training data;
- retains the complete administrator role set, allowing the administrator to inspect and change every Pipeline workspace while that account context is selected;
- lasts for the full authenticated browser session and remains visibly identified in the header until the administrator exits God mode;
- records entry and exit audit events and attributes ordinary workspace changes to both the selected account and the initiating administrator;
- records signatures, signed-assessment addenda, admission decisions, manual-intake authorization, outbound email, and EHR handoffs under the initiating administrator's accountable identity; and
- does not create credentials, send an invitation, call Microsoft Graph for identity management, assign an Entra app role, or change an Entra identity.

Use the header's **God mode: _Name_** control, or **Exit God mode** in the profile menu, to return to the administrator account. Signing in again or signing out also exits God mode. Invalid God mode state fails closed until it is cleared; it never silently changes account context for an API request.
