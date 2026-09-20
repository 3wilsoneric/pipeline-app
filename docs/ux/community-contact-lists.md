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

The read endpoint requires an authenticated Pipeline user so assessors can load
their community's default audience. Editing templates requires admin/coordinator
roles and the isolated persona demo. A configured
`PIPELINE_COMMUNITY_RECIPIENT_LIST_PATH` can supply a private, read-only template
file outside that demo. Mutations retain same-origin protection, bounded
validation and no-cache responses. Recipient inclusion is not approval to send
clinical information; admission examples are a starting audience, not evidence
of approval for every Meet the Client handoff.

Saves use a per-file exclusive lock, per-community version checks, exact last
mutation replay, a synced temporary file, atomic replacement, and restrictive
file permissions. Concurrent or stale writers cannot silently replace the saved
list. Failed replacement preserves the previous file. A crashed process can
leave a `.lock` file; stop the owning local server and confirm no save process is
running before removing that lock. Never force-clear an active writer's lock.

This deliberately does not introduce a production mailing-list database or
borrow the client-specific scheduling-contact store. Shared template editing is
still local-only. Before enabling team-wide template administration, provide a
database-backed shared owner with audit/recovery evidence and defined management
permissions. Do not represent this as a deployed mailing-list manager.

## Intake and handoff

- Choosing a community fills the intake's compact Handoff contacts section.
  After creation, To/Cc chips can be removed or added; the same audience appears
  in Finish & send. Changes are personal to this handoff, not template edits.
- A saved draft matches both referral and community. A different community
  loads its own template, never the previous community's audience. No source
  list means an explicit empty state, not a guessed corporate-wide list.
- Existing private `user_workspace_state` owns recipient drafts, using referral
  ID as key, principal ownership, version checks, and a 30-day expiration. Input
  must be added with Enter or the plus control before it becomes a recipient.
  Added/removed chips save serially. Failed saves preserve visible edits and
  block guarded navigation; these are not durable offline recovery drafts.
- Migration `0040_referral_email_drafts.sql` is additive. Its rollback refuses
  while drafts exist. App rollback can leave the additive migration in place;
  never delete records merely to permit a database rollback.
- Email To and Cc remain separate, deduplicated, with a combined 100-address
  ceiling and the existing approved-domain checks. Community membership does
  not bypass recipient authorization, signing, acceptance, attachment scanning,
  explicit confirmation, or duplicate-delivery protection. The demo cannot send.
- Copy follows the supplied admission email structure: admission coordination,
  Med room, allergies/diet, billing, support, and attachments. Only recorded
  chart facts are used. SSI/payee and allergies are not structured questionnaire
  fields here, so the copy requests confirmation rather than inventing facts.
- Med room includes recorded medications, support/PRNs, injection medication,
  frequency, last given, and next due. Dates remain verbatim, never calculated;
  missing injection details are explicit when injections are reported. An
  explicit No hides stale conditional injection details, matching the form.
- Behavior and safety separates reported altercations/assault history and their
  context from current concerns and supports. Missing history is not a No;
  historical incidents are not promoted to a present risk classification.
- The signed admission agreement status comes from current workflow work items
  in the preview, delivery, and data sheet. Received means signature review is
  still needed; reviewed is described as marked reviewed, not a new verification.
  Missing evidence remains explicit. Neither a signed assessment nor an uploaded
  filename proves agreement signatures. No new assessment fields or Excel mapping
  changes are needed for these additions.
- All referral chart files, including assessment documents, enter the attachment
  inventory with a generated `Client data sheet.html`. The data sheet is a
  printable, escaped, self-contained HTML snapshot using the canonical chart
  report, not a second questionnaire or a PDF. It is downloadable before signing
  with an unsigned label; delivery uses the selected signed assessment.
- Unavailable/unsafe files block sending rather than being skipped. Count/byte
  limits include the generated sheet (default 20 total files, 25 MB); larger
  Graph upload-session packets retain the existing configuration checks.

Production activation requires the reviewed private template source, migration,
approved recipient domains, existing Graph delivery configuration, and release
approval. No production settings or real messages were changed by this feature.

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
- `node --test scripts/community-handoff.test.mjs scripts/meet-client-delivery-fixtures.test.mjs`:
  canonical email/data-sheet copy, escaping, To/Cc transport, exact generated
  attachment bytes, scan/referral boundaries, and existing no-duplicate-send gates.
- `PIPELINE_DESKTOP_E2E=true PORT=3378 npx playwright test tests/e2e/community-handoff.spec.ts tests/e2e/email-packet-page.spec.ts --project=chromium`:
  actual draft API save/reload, community changes, conflicts, failed saves,
  downloads, explicit send confirmation and desktop/iPad/phone widths.
- `PIPELINE_HANDOFF_POSTGRES=true PIPELINE_HANDOFF_PG_BIN=/path/to/postgres/bin node --test scripts/community-handoff-postgres.test.mjs`:
  creates and removes its own loopback PostgreSQL cluster, verifies persistence,
  private ownership, concurrent version conflicts and non-destructive rollback.

The repository-wide `certify:refactor` gate remains blocked by its complexity
ratchet, including existing UI hotspots and growth in touched handoff owners.
Focused tests/build do not certify the entire application or authorize deployment.
