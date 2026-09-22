# Meet the Client: Outlook Drafts setup

**Not production yet — no draft will be created and no email will be sent.** Deploying code, registering a Microsoft app, or configuring credentials does not lift the owner's hold. Keep `PIPELINE_MEET_CLIENT_LIVE_ENABLED=false` and `PIPELINE_DEMO_MODE=true` until the owner explicitly approves activation.

## Assessor flow after activation

In **Finish & send → Preview email**, review the community's To/Cc recipients, message and complete admission packet. Connect the Outlook mailbox matching your authenticated Pipeline email, then choose **Save to Outlook Drafts**. Pipeline saves the prepared message and secure packet link directly in that mailbox's Drafts folder and opens it in Outlook. The assessor reviews and presses Send in Outlook; replies go to that assessor.

Each assessor connects their own mailbox. Eric's Outlook.com account can be used for his own synthetic rehearsal; it cannot place drafts into other assessors' mailboxes. Work, home-tenant guest and personal Microsoft accounts are supported. Pipeline's sign-in tenant and access policy remain unchanged. Microsoft may require the assessor's organization to approve the connection.

The draft persists across leaving, refreshing and returning. Preparing it does not complete or lock the assessment. After sending from Outlook, choose **Check sent status**. Pipeline checks the actual message's sent timestamp, reviewed recipient audience, packet link, assessment version, decision and file inventory before completing the handoff. Sent status does not prove recipient delivery or reading. Changed recipients pause packet downloads; other source changes require review and a replacement. An uncertain creation response retains its reservation and recovers the existing message instead of sending or creating a duplicate.

The composer displays the saved draft's To/Cc, mailbox and file count. To change the prepared packet or recipients, remove the draft and review a replacement. Removal revokes packet access before deleting the Outlook draft. An already-sent email cannot be recalled. Older Graph drafts without saved To/Cc still reopen in Outlook; their combined recipient set is not presented as an exact To/Cc split.

## One-time setup for the Pipeline owner

1. Register a separate **Pipeline Outlook Drafts** public application, supporting work/school and personal Microsoft accounts (`AzureADandPersonalMicrosoftAccount`). Add the SPA redirect `https://alamo-pipeline.com/outlook-auth.html`, or the approved canonical origin and base path. Request only Microsoft Graph **delegated Mail.ReadWrite** and **User.Read**. No client secret, application mail permissions or Mail.Send grant is required for assessor drafts.
2. Set server runtime `PIPELINE_OUTLOOK_CLIENT_ID` to that application's client ID. The authenticated draft-status API supplies this public identifier to the browser; it is not a build-time sign-in configuration. The separate MSAL client uses `common`, session storage and a static popup callback. Installed MSAL v4's parent window consumes the callback hash. Revisit this callback when upgrading MSAL's major version; v5 has different redirect-bridge requirements.
3. Keep the Admissions application's existing **Application Mail.Send**, restricted to `admissions@alamo-pipeline.com` through Exchange Application RBAC, for recipient verification codes. Do not grant organization-wide Entra Mail.Send in addition: those permissions are additive. Configure its server-side tenant/client/secret and sender independently of the public Drafts client.
4. Verify HTTPS canonical origin, session secret, Blob storage, PostgreSQL migration 0042 and approved recipient domains. All uploaded files and the generated chart use one secure packet link. Recipients verify their listed email with a one-time code; they need no Pipeline account. Do not broadly allow personal domains just to conduct a sample.
5. Before activation, obtain owner approval for a concrete synthetic rehearsal covering connection, draft save/reopen, onward sending, status reconciliation and packet verification/download. Verify actual inbox delivery of the verification code. Provider acceptance alone is insufficient.

Mailbox binding uses the Microsoft Graph profile and Pipeline's authenticated identity, never an editable contact field or a supplied address. Home-tenant and personal mailbox IDs may differ from the Pipeline identity's ID; the authenticated email must match in that case. New packets pin both the Pipeline owner and the actual Graph mailbox ID. Subsequent checks/removal require both. Delegated assessor sessions cannot connect as the assessor. Tokens are never persisted in packet records, returned in API responses or logged.

## Recovery and rollback

Existing Outlook drafts remain recoverable. Older packet records without a separate mailbox ID use their original owner ID; new records pin both IDs. Older drafts without saved To/Cc reopen in Outlook without inventing a recipient split. No database migration is required.

The proposed inbox-forwarding transport was never deployed and has been removed from this candidate. There are no emailed-draft lifecycle handlers to maintain. Keep sending disabled during rollback, preserve packet/audit records, and retain the existing Graph Drafts recovery controls. The local packet adapter supports one process; PostgreSQL owns production locking.

## Infrastructure status on September 21, 2026

The separate **Pipeline Outlook Drafts** registration is `aab08e3a-c58f-4a74-a021-c235c4f04f81` in Pipeline's tenant. It requests only the two delegated scopes above and has no secret. Registered callbacks are the canonical HTTPS callback and `http://localhost:3397/outlook-auth.html` for the isolated synthetic rehearsal. Individual mailbox consent and a live rehearsal remain outstanding. Registration alone does not enable the workflow.

The GoDaddy **Alamo Admissions** mailbox is provisioned. Its dedicated delivery application uses the separate mail tenant and has Exchange `Application Mail.Send` scoped only to that mailbox, with no organization-wide Entra application grants. Azure stores the client secret as `pipeline-graph-mail-client-secret`; rotate it before September 22, 2027 (UTC). DKIM is Enabled / Valid, and the existing SPF and quarantine DMARC remain in place.

One owner-authorized fictional sample to Eric on September 22 at 00:35:44 UTC received Graph 202, then **bounced with 550 5.7.708 AS(7910)**. It was not delivered. GoDaddy support has been contacted for the Microsoft outbound restriction. Do not treat the sender or recipient verification as production-ready until that is resolved and an authorized rehearsal succeeds. Production remains disabled.

Microsoft references: [create a draft, including personal account support](https://learn.microsoft.com/en-us/graph/api/user-post-messages?view=graph-rest-1.0), [application account types](https://learn.microsoft.com/en-us/graph/api/resources/application?view=graph-rest-1.0), [mailbox-scoped application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac).
