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
