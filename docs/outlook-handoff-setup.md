# Meet the Client email and communications history

The current candidate prepares and sends Meet the Client from **Alamo Admissions**, with the assigned assessor in Cc and Reply-To. The recipient list remains the reviewed To/Cc list; recipient-domain allowlists are not enforced. The assessor does not need to connect Outlook for this route. Existing assessor-owned Outlook drafts and previously emailed packets retain their recovery controls.

## What the assessor does

1. Sign the assessment and record the admission decision.
2. Open **Finish & send → Review handoff**. Confirm the admission date, client summary, complete packet and recipients in separate review dialogs. The date saves to the workspace and populates the email.
3. Review the actual email: Alamo branding, From, To, Cc, Reply-To, subject, message, uploaded originals and the generated PDF client data sheet. Opening an attachment displays or downloads its preserved copy. Editing the message requires preparing a new preview.
4. Choose **Send email & packet**. The server sends the saved preview and preserved attachments. It does not silently omit files, substitute secure links or require recipients to obtain codes.
5. Open **Email history** in the client workspace, or **Communications** in navigation. Reopen a saved message, inspect its recipients and attachments, or review an updated handoff. Updating requires fresh review and an explicit send; it never changes the earlier record.

The assigned assessor receives a copy and replies. If already in To, the assessor is not duplicated in Cc. A coordinator preparing the packet does not replace the assessor's identity. The assessor must have a valid email on their account. Email clients may render HTML differently; the saved HTML, recipient envelope and attachment bytes are the content submitted to Microsoft.

## What history means

History distinguishes saved previews, sending, submitted for delivery, not sent and confirmation pending. **Submitted for delivery means Microsoft accepted the message**, not that recipients received or read it. Replies, bounce notifications and later delivery outcomes are not ingested into this history. Check the Admissions mailbox for them. Earlier messages are not reconstructed from today's assessment: their existing events remain in workspace Activity, and legacy drafts retain their recovery controls.

History is authenticated and follows existing client access. My handoffs includes messages prepared by or assigned to the signed-in assessor. Team history requires existing team-board access, with client access checked for each record. The saved email, original attachment copies and PDF remain available after subsequent edits or file withdrawal. Archived originals still respect adverse document safety verdicts, including soft-deleted documents. These internal records cannot issue verification codes or public download links.

## Service sender setup and release verification

Production activation was authorized by the owner on September 22, 2026. That authorization is not evidence of current deployment or delivery. Deploy only after applicable release checks and use the existing activation settings; local demos remain demos.

The Admissions service application needs its configured tenant, client ID, secret and sender mailbox, with mailbox-scoped sending access. Large attachments also require the application to create a message and upload attachments in that mailbox. `PIPELINE_GRAPH_MAIL_READ_WRITE=true` declares that this capability has been provisioned; it does not grant access. Confirm the actual mailbox authorization before setting it. Do not grant the application access to unrelated mailboxes.

A verified sender, Blob storage and PostgreSQL migration 0042 are required. No new migration is introduced: communication snapshots extend the existing packet JSON records. Recipient lists use syntax/count validation, without organization-domain restrictions. New handoffs do not require the public Outlook application, assessor consent or another community's Microsoft administrator.

Before live rollout, verify service configuration, sender authorization, small and large attachment delivery, actual inbox receipt and retained originals using an authorized synthetic rehearsal. Do not infer successful receipt from an HTTP 202. A previous September 22 synthetic send was accepted and subsequently bounced with `550 5.7.708 AS(7910)`. A September 23 recipient-free draft creation probe returned `403 ErrorAccessDenied`; mailbox write permission remained unverified at that check. Recheck current state rather than treating historical results as current configuration.

## Recovery, storage and known limits

The server preserves uploaded originals with conditional Azure Blob copies and freezes the generated PDF and rendered email. ETags and source versions guard the reviewed content. A per-packet transition and the existing per-workspace delivery reservation prevent concurrent send clicks and cross-transport duplicates. Provider acceptance is persisted before assessment finalization; a failed finalization never invites another copy.

A definite refusal records Not sent and releases the reservation. An uncertain provider response keeps its reservation and records Confirmation pending. There is no automatic resend or automated mailbox reconciliation for this direct route. Resolve an uncertain outcome against the Admissions mailbox before administrative recovery; revisit automated reconciliation if pending outcomes become an operational burden. Do not clear a reservation merely to retry an unknown send.

Preview preparation runs within the request and reuses matching completed previews. Concurrent preparation can preserve more than one preview, but send attempts remain serialized. Earlier previews remain read-only history; choosing an updated handoff reviews current data. Revisit background preparation if observed preparation time approaches the request deadline. Microsoft message and attachment limits still apply; failures leave an explicit outcome, never a partial packet presented as complete.

Original file copies live under `artifacts/communications/<referral>/<packet>/...` (or the configured artifacts container). Every destination is recorded before copying so interrupted copies can be removed. Referral retention deletes these archive objects before purging the packet records through the existing referral cascade. Do not introduce a shorter independent Blob lifecycle rule for this prefix. History follows workspace retention and is not an unlimited independent archive. The local file adapter is restricted to explicit mock sessions and a single process; production uses PostgreSQL locks and atomic audit writes.

For rollback, pause new handoffs with the existing activation control, preserve packet/audit records and archives, and restore the known prior image/configuration. Older code will not display the new history, but its legacy packet-link operations exclude these internal records in this candidate. Preserve this exclusion when backporting or rolling back public packet-access handlers. Do not delete records or archives as a rollback step.

## Existing Outlook drafts and inbox packets

Previously prepared Outlook drafts can still reopen, be removed if unsent, or be checked after sending. Previously emailed assessor packets can still be confirmed as forwarded. These controls do not send a replacement automatically. A legacy draft belongs to its original Pipeline owner and Microsoft mailbox; other users cannot take it over. Existing assessment version, attachment, recipient, authorization and uncertain-outcome checks remain applicable.

The optional Outlook integration retains its separate public client, `common` authority and Microsoft-managed browser credential cache. Temporary connection-check failures do not erase its cache. Microsoft sign-out, revoked consent, a different browser or cleared site data can require sign-in again. There is no automatic connection prompt on entry for the new direct-send workflow.

Microsoft references: [sending messages](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0), [large attachments](https://learn.microsoft.com/en-us/graph/outlook-large-attachments), [mailbox-scoped application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac).
