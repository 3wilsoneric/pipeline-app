# Admission packet delivery

Meet the Client includes the saved message, every available uploaded workspace file, and the generated client data sheet. The primary assessor email flow always uses one secure packet link. Legacy direct delivery uses a link for a packet over 50 files or 20 MiB. These are delivery thresholds, not limits on the packet. Lower configured thresholds also select links. Missing Microsoft Graph Mail.ReadWrite permission selects links when direct email is too small. A definite provider size rejection switches to a link; timeouts never trigger a second send.

The signed assessment, accepted admission decision, admission date, authorized recipients, saved message and reviewed file revision are still required. Refreshing a changed packet preserves every current file. Unavailable, withdrawn or unsafe files are never silently omitted.

## Recipient and sender experience

Recipients open the link, enter the email address used in To/Cc, and receive an eight-digit code. They need no Pipeline account. The code expires after ten minutes, is usable once, and allows five guesses. A recipient can request one code per minute and five per hour per packet. Limits and sessions are stored in PostgreSQL and locked across replicas. Unknown addresses receive the same request response and no email.

Verification creates a one-hour HttpOnly session scoped to that packet. File bytes stream through Pipeline with byte-range support; storage credentials never reach the browser. Each download checks the file's current referral, availability and original ETag. The reviewed manifest and generated chart are saved; subsequent uploads do not change a previously sent packet. Removing a workspace or file withdraws access. Hard deletion of a referral cascades to its packet records.

Links expire after 30 days. Workspace staff can renew access for 30 days or revoke it from the email preview's Packet access section. Both actions invalidate existing codes and sessions. Renewal keeps the original audience, message and files. Recipients can reuse the same link with a fresh code. Revocation cannot recall files already downloaded or cancel bytes already streaming. The UI clears session content when access expires and supports explicitly closing the packet. Private packet routes never use the staff offline assessment fallback.

## Recovery and deployment

Reservation and the send-start audit commit together. A reservation belongs to the assessment version, independent of browser request IDs. Definite rejections release it for a retry. Unknown provider outcomes remain reserved across refreshes, tabs and process restarts and have an `unconfirmed` audit event plus delivery reference. A provider-accepted email is never described as failed because finalization or auditing failed afterward. Microsoft acceptance is not a delivery receipt.

For an unconfirmed send, the operator must check the sending mailbox/message trace using the delivery time, recipients and `x-pipeline-delivery-id`. Do not delete its reservation or repeat the send on a guess. Reconcile confirmed acceptance through the existing finalization/audit owner; release a reservation only after confirmed non-acceptance, with an operator audit. There is no unattended resend worker or automatic mailbox reconciliation in this implementation. Add that capability if unconfirmed outcomes require unattended operational recovery; Microsoft Graph sendMail does not provide an exactly-once send contract.

Before enabling delivery, apply migration `0042_admission_packet_links` and verify PostgreSQL readiness, an approved HTTPS `PIPELINE_CANONICAL_ORIGIN`, `PIPELINE_ENTRA_SESSION_SECRET` of at least 32 characters, and the existing Microsoft Graph sender credentials and recipient-domain allowlist. Mail.Send is sufficient for secure-link delivery and verification codes. Keep demo guards enabled in demo deployments. Sender setup is described in [the Outlook Drafts setup guide](outlook-handoff-setup.md). Infrastructure configuration does not enable live mail.

Roll back the application revision while retaining the additive migration and access/audit records. Existing delivered links require this revision's recipient routes, so pause live sending and retain those routes during rollback if any links have been issued. Never drop packet or reservation records to restore service. The explicit local fixture adapter requires mock auth and `PIPELINE_PACKET_LINK_STORE_PATH`; it supports one process only. Production uses PostgreSQL. Metadata preparation uses batches of eight within the existing five-minute send request; introduce durable background preparation if measured packet preparation approaches that deadline.

## Focused evidence

- `node --test scripts/admission-packet-links.test.mjs scripts/meet-client-delivery-fixtures.test.mjs`: packet authorization, actual PostgreSQL migrations and locking, local parity, audit rollback, one-use codes, throttling, expiry, renewal/revocation, same-origin API/cookies, demo guards, paginated 205-upload packet, download ranges/ETags, changed previews, size fallback and duplicate-send recovery. The PostgreSQL fixture starts a disposable cluster using `pg_config --bindir` or `PIPELINE_TEST_PG_BIN`.
- Production build and focused ESLint checks.
- With a built local server: `PIPELINE_PACKET_UI_URL=http://127.0.0.1:3398 node --test scripts/admission-packet-ui.test.mjs`. Uses synthetic API responses, checks desktop/phone Chromium and iPad WebKit, code errors, keyboard focus, complete file list, closing access, no horizontal overflow, and WCAG A/AA checks. It does not send email.

Live Microsoft delivery and production Azure downloads still require a configured environment and a controlled delivery check before rollout of live sending.
