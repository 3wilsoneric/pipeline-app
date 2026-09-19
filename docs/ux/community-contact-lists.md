# Community recipient editor

Local draft editor at `/settings/contact-lists`, linked from Profile settings for
admins and assessment coordinators in the isolated persona demo. This is a
product feature, not a structural refactor or live mail activation.

## Scope

- One list per canonical community, with separate To and Cc lanes.
- Name/email chips, removal, single-removal Undo, suggestions from saved lists,
  and individual or pasted `Name <email>` / plain-email entry.
- Address-based, case-insensitive deduplication across both lanes. Display-name
  similarity never merges distinct addresses.
- Save includes any valid text still in the input. Invalid batches stay editable
  and are not partially inserted. Failed saves preserve the working copy.
- App navigation saves first; a failed save keeps the editor open. Switching
  communities with unsaved edits requires explicit discard confirmation.
- Reload/close uses the browser's unsaved-changes warning. Unsaved edits are not
  an offline durable draft; use Save before leaving. Browser history navigation
  is not a substitute for Save.
- Removed entries are removed only from this community list, not from the
  client-contact directory or other community lists.

## Local data boundary

The authoritative editable file is
`$PIPELINE_PERSONA_DEMO_ROOT/community-recipient-lists.json`. The five initial
lists were converted from the ignored local Markdown collection; that document
remains a source snapshot, not a second synchronized store. No real addresses or
patient details are checked into source or fixtures.

The endpoint requires `requirePipelineUser` with admin/coordinator roles, uses
same-origin mutation protection, bounded validation and no-cache API responses,
and returns unavailable outside the isolated local persona demo. No endpoint
calls Graph or the email delivery route. Recipient inclusion is not approval to
send clinical information. Meet the Client coverage remains unconfirmed.

Saves use a per-file exclusive lock, per-community version checks, exact last
mutation replay, a synced temporary file, atomic replacement, and restrictive
file permissions. Concurrent or stale writers cannot silently replace the saved
list. Failed replacement preserves the previous file. A crashed process can
leave a `.lock` file; stop the owning local server and confirm no save process is
running before removing that lock. Never force-clear an active writer's lock.

This deliberately does not introduce a production mailing-list database or
borrow the client-specific scheduling-contact store. Before team-wide/live use,
move this owner to an approved database-backed shared store with audit/recovery
evidence, import the reviewed contacts, establish list-management permissions,
and connect approved To/Cc lists to the actual mail validation/recipient limits.
In particular, the draft editor's 100-address ceiling is not the live sender's
20-recipient limit, and must not bypass it. Production UI/send wiring needs its
own approval; this local-only editor must not be represented as a deployed
mailing list manager.

## Evidence

- `node --test scripts/community-recipient-lists.test.mjs`: parser/validation,
  atomic persistence, replay, competing writers, corrupt files, rejected writes,
  origin/auth gates, and permissions. Synthetic contacts only.
- Start `npm run demo:personas -- --port=3355`, then run
  `PIPELINE_E2E_EXTERNAL_SERVER=true PORT=3355 npx playwright test tests/e2e/community-contact-lists.spec.ts --project=chromium`.
  This spec seeds only port 3355's dedicated synthetic contact-list file. Never
  put user contact lists in that test root. It includes Chromium and WebKit,
  phone/iPad/desktop widths, keyboard suggestions, Undo, save/reload, conflicts,
  failure-safe navigation, and accessibility checks.
