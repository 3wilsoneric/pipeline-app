# Meet the Client: assessor email setup

**Not production yet — no email will be sent.** The owner has placed this workflow on hold. Deploying code, adding credentials, and configuring Microsoft permissions do not lift that hold. Keep `PIPELINE_MEET_CLIENT_LIVE_ENABLED=false` and demo mode enabled until the owner explicitly approves activation.

## Assessor flow after activation

In **Finish & send → Preview email**, review the community's To/Cc recipients, message and complete admission packet. **Email draft to assessor** emails the prepared handoff from **Alamo Admissions** to the signing assessor's confirmed work address. The community receives nothing at this step. This is a preparation email in the assessor's inbox; Pipeline does not insert a message into Outlook's Drafts folder.

The assessor forwards the handoff from Outlook to the listed To/Cc recipients, removes the instruction box, and retains the packet link. The assessor is included in the reviewed onward audience. Replies to the forward go to the assessor. They return to Pipeline and select **I sent the handoff**. The confirmation explicitly records their attestation; Pipeline does not read their mailbox or verify delivery. Only the actual assessor can confirm, including when another staff member prepared the email. Acting as that assessor does not grant confirmation rights.

Preparing the email keeps the signed assessment editable. Pipeline preserves one pending handoff across refreshes and restarts. Its composer shows the saved pending handoff audience, including when another staff member prepared it; the assessor or administrator can replace it to change recipients, message or files. Replacement revokes the old link and releases only that draft's reservation. An existing inbox email cannot be recalled. A timeout retains the pending draft and instructs staff to check the inbox; no automatic resend occurs.

Confirmation rechecks the signed assessment version, admission decision and file inventory. Changed drafts require an updated handoff, and their old link is revoked. Confirmation and replacement serialize on the packet record. If finalization succeeded but recording completion failed, retry repairs completion without another email or another finalization.

## One-time setup for the Pipeline owner

1. Configure `PIPELINE_GRAPH_TENANT_ID`, `PIPELINE_GRAPH_CLIENT_ID`, `PIPELINE_GRAPH_CLIENT_SECRET`, and `PIPELINE_MEET_CLIENT_SENDER=admissions@alamo-pipeline.com`. Store the credential as a server-side Azure secret. The mail tenant may differ from Pipeline's sign-in tenant; no assessor tenant administration or delegated Outlook connection is required.
2. Give the dedicated mail application **Application Mail.Send**, restricted to the Admissions mailbox using Exchange Application RBAC. Do not also grant organization-wide Entra Mail.Send: those grants are additive. No Mail.ReadWrite access is needed for this flow.
3. Configure approved recipient domains, including the signing assessor's work domain. Resolve the assessor through an active, confirmed workspace identity. Never infer a mailbox from a display name or reconstruct a guest `#EXT#` sign-in identifier.
4. Verify HTTPS canonical origin, session secret, Blob storage, PostgreSQL migration 0042 and domain email authentication. All files use one secure packet link. Recipients verify their listed email with a one-time code; no Pipeline account is needed.
5. Keep production disabled. Before activation, obtain owner approval for a concrete synthetic rehearsal covering preparation email delivery, forwarding, packet verification/download and manual completion. A provider acceptance response alone is not proof of inbox delivery.

## Compatibility and recovery

Previously created connected-Outlook drafts retain their existing reopen, status-check and removal controls. Creating new handoffs uses the emailed preparation flow. Its lifecycle reuses the existing packet `outlook` record with `delivery: "email"`; absent delivery means the earlier Graph Drafts flow. This avoids a migration and keeps one reservation owner. Introduce an explicit transport schema only if another delivery method requires a different lifecycle.

Rollback must retain the assessor draft handlers while pending preparation emails exist. Keep sending disabled during recovery and preserve packet/audit records; do not delete reservations to resolve uncertainty. The local packet adapter supports one process; PostgreSQL owns production locking.

Microsoft references: [application RBAC and mailbox scoping](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac), [sendMail and acceptance semantics](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

## Mail infrastructure verified September 21, 2026

The GoDaddy Microsoft 365 mailbox `admissions@alamo-pipeline.com` is provisioned with display name **Alamo Admissions**. The dedicated **Alamo Admissions Delivery** application uses the mail tenant, separately from Pipeline sign-in. Exchange reports `Application Mail.Send` in scope for **Pipeline Admissions mailbox only**; the application has no organization-wide Entra application grants. Application token issuance succeeded without a mail API request.

Azure `pipeline-prod-web` stores the client credential as `pipeline-graph-mail-client-secret`. The current credential expires September 22, 2027 (UTC); rotate it before then. Sender, mail tenant/client and the seven approved domains (the six existing community domains plus `alamo-pipeline.com`) are configured. `PIPELINE_MEET_CLIENT_LIVE_ENABLED=false` and `PIPELINE_DEMO_MODE=true` remain in effect. No preparation email, community handoff or verification code was sent during setup.

Both DKIM selectors resolve to Microsoft's tenant records and Exchange reports signing **Enabled / Valid**. Existing GoDaddy SPF and quarantine DMARC records remain in place. Before live use, perform the owner-approved synthetic delivery rehearsal above; DNS and token checks alone do not establish delivery.

The Azure deployment captures existing mail environment settings and their referenced credentials into a restricted, secure ARM parameter file. It preserves the dedicated mail tenant and live-send hold even when the legacy mail-setup input is false. Changing this configuration requires an explicit configuration update; ordinary code deployments retain it.
