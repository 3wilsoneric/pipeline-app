# Meet the Client: Outlook setup

**Not production yet — no email will be sent.** The owner has placed this workflow on hold. Do not enable production use until the owner explicitly approves it. Deploying this code, adding credentials, or approving Microsoft permissions does not lift the hold.

`PIPELINE_MEET_CLIENT_LIVE_ENABLED` defaults to false. Both the production environment and an explicit true value are required for email, verification codes and Outlook draft creation; demo and persona environments remain disabled. Keep the switch false during setup. The handoff screen, composer and preview label the packet as a demo.

## One-time setup for the Pipeline owner

1. In Microsoft Entra, open **App registrations** and find the browser application matching `NEXT_PUBLIC_ENTRA_CLIENT_ID`. Use the same tenant as `NEXT_PUBLIC_ENTRA_TENANT_ID` and the existing Pipeline SPA redirect URI.
2. Under **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, add `Mail.ReadWrite` and `User.Read`. Grant organization consent if your tenant requires it. These are permissions for the signed-in person's mailbox. No delegated `Mail.Send` permission is needed: the assessor sends in Outlook.
3. Configure the existing server-side sender for recipient verification codes: `PIPELINE_GRAPH_TENANT_ID`, `PIPELINE_GRAPH_CLIENT_ID`, `PIPELINE_GRAPH_CLIENT_SECRET`, `PIPELINE_MEET_CLIENT_SENDER`, and approved `PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS`. The server application needs application `Mail.Send`, restricted to the approved sender mailbox. These server credentials and permissions are separate from the browser's delegated access.
4. Confirm HTTPS `PIPELINE_CANONICAL_ORIGIN`, the session secret, blob storage and PostgreSQL migration 0042 are configured. Outlook drafts use a secure link to the complete packet; recipients verify their email with a one-time code and need no Pipeline account.
5. Keep production disabled. Before proposing activation, verify a controlled work-account connection, draft preparation and send reconciliation with an approved synthetic recipient, including code delivery. Activating even a controlled live rehearsal requires the owner's approval of that concrete rehearsal.

Microsoft setup belongs to whoever administers the organization's Microsoft 365 tenant. If that is the Pipeline owner, there is no separate “Pipeline IT” team to contact. No credentials or permissions have been granted by this change.

## Assessor flow after activation

In **Finish & send → Preview email**, choose **My Outlook**. Connect the same Microsoft work account used to sign in to Pipeline, review the message and recipients, then choose **Open in Outlook**. Pipeline prepares one saved draft with the complete admission packet link. Outlook opens in a new tab. The assessor sends there and returns to **Check sent status** in Pipeline.

Preparing or opening a draft never marks the assessment sent. The saved draft can be reopened after closing the workspace. A lost response is recovered using its delivery identifier rather than creating another email. Pop-up blocking leaves a visible **Reopen draft** link; expired consent exposes **Connect Outlook** again. Acting as another assessor cannot connect or use their mailbox.

While a draft exists, Pipeline freezes its composer and prevents competing handoffs for the workspace. Remove the draft to change recipients or prepare an updated packet. Removal revokes its download link before deleting the Outlook draft. It cannot recall an email already sent. Removed or unresolved Outlook packets cannot be re-enabled using the packet renewal control.

Pipeline checks the sent message, recipient set, packet link, signed assessment version, admission decision and file inventory before completing the handoff. Changes made after preparation are shown for review. **Prepare updated handoff** explicitly acknowledges an already-sent changed email, revokes its old link, records that external send, and returns to review without certifying the changed assessment. Recipients cannot be silently expanded by editing Outlook; downloads are paused when the reviewed audience changes.

The current boundary is deliberate: Outlook sends are reconciled when the assessor selects **Check sent status**; there is no background mailbox monitoring or read receipt. If automatic reconciliation becomes a requirement, revisit this with Microsoft Graph subscriptions and a durable reconciliation worker. Contact-list setup is separate work.

Microsoft references: [create a draft](https://learn.microsoft.com/en-us/graph/api/user-post-messages?view=graph-rest-1.0), [message fields and web link](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0), [immutable message identifiers](https://learn.microsoft.com/en-us/graph/outlook-immutable-id).
