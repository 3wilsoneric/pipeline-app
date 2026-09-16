# Pipeline workspace member identities

Pipeline separates **work assignment** from **Microsoft sign-in access**.

## Identity states

- `entra_linked`: a verified Microsoft Entra principal. This person can sign in when the app-role assignment is also present and any guest acceptance is completed. `last_seen_at` remains null until their first actual sign-in.
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

Apply migration `0035_preprovisioned_workspace_member_access` first. Independently verify the target's exact Entra object ID, enabled account, email, and Pipeline app-role assignment before applying the link; the script does not call Microsoft Graph.

The link runs in one transaction. It moves referral and requirement ownership IDs (including exact matching IDs in the referral's saved owner fields) and reassigns only unsigned, non-complete assessments on active, open, non-deleted workspaces. Names, clinical answers, signatures, signed/complete assessments, and historical assessments stay unchanged. Each changed entity receives a version increment and ownership audit; referral intake/assignment and open-assessment identity versions advance, along with affected store revisions. Signed records remain readable through the linked referral's access boundary without rewriting their attribution.

The provisional entry is deactivated. Existing linked target roles and actual last-sign-in timestamps are preserved; a new target starts with only the provisional member's reviewer/viewer roles and no invented sign-in timestamp. The real sign-in refreshes roles from Entra. Nonconflicting, unexpired per-user state is copied with its original payload, expiry and versions; all target collisions and original source rows remain untouched. An exact same-target retry is audit-neutral; inactive/conflicting targets and different-target retries fail closed. Historical actor IDs are not rewritten. The tool deliberately does not remap arbitrary IDs inside saved-state payloads; revisit only if an identified provisional draft needs an exact identity-field correction. It does not grant an Entra app role or send invitations; those remain separate Entra administrator actions.

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
