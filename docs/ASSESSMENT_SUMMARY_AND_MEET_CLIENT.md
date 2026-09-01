# Assessment Summary and Meet the Client

## Purpose

Pipeline produces two read-only chart outputs from the canonical signed assessment record:

- **Complete chart:** the full assessment rendered as a medical record, with every populated assessment field grouped under the same clinical sections used during the interview.
- **Meet the Client:** a smaller care-coordination face sheet sent only after an accepted decision. It contains identity, a short deterministic bio, reconciled medications, medication notes, immediate support information, and the admission packet uploaded to that referral.

Neither output replaces the signed assessment or the EHR. Both include the source assessment ID and version so the rendered output can be traced back to its source record.

## Workflow

1. The assigned assessor completes and signs the assessment.
2. Pipeline generates the Complete chart and Meet the Client face sheet from that signed version.
3. The existing admission workflow records the decision separately; the chart viewer never changes workflow state.
4. An accepted decision unlocks email delivery of Meet the Client.
5. Pipeline lists the exact admission files that will be attached. The supervisor enters approved recipients, confirms authorization, and sends the face sheet and complete packet through Microsoft 365.

The report is generated deterministically from structured assessment fields. It does not ask a language model to invent or rewrite clinical content.

## Email Controls

- The route is limited to supervisors and requires same-origin mutation protection.
- A signed assessment and accepted admission decision are required server-side.
- If an assessor recommendation exists, its exact assessment is the source of the report and email.
- Recipients are limited to exact domains in `PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS`.
- The email subject never includes the client's name.
- The server selects files from the current referral; the browser cannot submit arbitrary document IDs.
- Every current-referral Pipeline upload is included except the assessment workbook. This intentionally includes referral packets, face sheets, LIC 602, medication records, TB results, conservatorship documents, admission agreements, LIC 601/603, provider forms, and other admission material. Categories can be narrowed later in one server-side policy.
- Delivery is all-or-nothing. Pipeline does not send if the packet is empty, exceeds its configured count or size, contains an unsafe/unscanned file, or a source file changes before delivery.
- A unique mutation ID prevents the same request from being processed twice.
- Delivery success and failure are audited with attachment count and total bytes, but without client names, filenames, note text, or recipient local parts in audit metadata.
- Microsoft Graph failures are not automatically retried because the provider may have accepted a message before the connection failed.

## Microsoft 365 Setup

Configure these server-only variables:

```text
PIPELINE_GRAPH_TENANT_ID=
PIPELINE_GRAPH_CLIENT_ID=
PIPELINE_GRAPH_CLIENT_SECRET=
PIPELINE_MEET_CLIENT_SENDER=
PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS=
PIPELINE_GRAPH_MAIL_READ_WRITE=false
PIPELINE_MEET_CLIENT_MAX_ATTACHMENT_COUNT=20
PIPELINE_MEET_CLIENT_MAX_ATTACHMENT_BYTES=26214400
```

The Entra application needs Microsoft Graph `Mail.Send` application permission with administrator consent. Restrict the application to the approved sender mailbox using an Exchange application access policy. Do not grant unrestricted tenant-wide mailbox access for this feature.

Small packets are sent directly with `Mail.Send`. Larger packets use a Microsoft Graph draft and attachment upload session. That path additionally requires the Microsoft Graph `Mail.ReadWrite` application permission with administrator consent; set `PIPELINE_GRAPH_MAIL_READ_WRITE=true` only after it is granted and mailbox access remains restricted. Pipeline defaults to an all-in 25 MiB packet cap so delivery stays below ordinary Exchange message-size limits after encoding and message content.

For the Azure deployment, store the Graph application secret only as Key Vault secret `pipeline-graph-mail-client-secret`. Configure repository variables `PIPELINE_GRAPH_MAIL_CLIENT_ID`, `PIPELINE_MEET_CLIENT_SENDER`, and `PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS`. Run `Deploy Pipeline to Azure` with `enable_meet_client_mail=true` only after those values and `Mail.Send` are ready. Leave `enable_meet_client_large_packets=false` until `Mail.ReadWrite` is separately approved; this keeps oversized packets blocked rather than partially sent.

## Operational Notes

- Microsoft Graph returning HTTP `202` means the message was accepted for delivery, not that every recipient opened or received it.
- The sender's Sent Items folder remains the operational delivery record because `saveToSentItems` is enabled.
- A failed result requires a supervisor to verify Sent Items before submitting a new request.
- A file inventory failure blocks email but does not prevent the signed assessment charts from rendering.
- Production must use the PostgreSQL audit store. The local file audit exists only for development.
