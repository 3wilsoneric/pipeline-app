# Assessment Summary and Meet the Client

## Purpose

Pipeline produces two read-only chart outputs from the canonical signed assessment record:

- **Complete chart:** the full assessment rendered as a medical record, with every populated assessment field grouped under the same clinical sections used during the interview.
- **Meet the Client:** a smaller care-coordination face sheet sent only after an accepted decision. It contains identity, a short deterministic bio, reconciled medications, medication notes, and immediate support information.

Neither output replaces the signed assessment or the EHR. Both include the source assessment ID and version so the rendered output can be traced back to its source record.

## Workflow

1. The assigned assessor completes and signs the assessment.
2. Pipeline generates the Complete chart and Meet the Client face sheet from that signed version.
3. The existing admission workflow records the decision separately; the chart viewer never changes workflow state.
4. An accepted decision unlocks email delivery of Meet the Client.
5. The supervisor enters approved recipients, confirms authorization, and sends the face sheet through Microsoft 365.

The report is generated deterministically from structured assessment fields. It does not ask a language model to invent or rewrite clinical content.

## Email Controls

- The route is limited to supervisors and requires same-origin mutation protection.
- A signed assessment and accepted admission decision are required server-side.
- If an assessor recommendation exists, its exact assessment is the source of the report and email.
- Recipients are limited to exact domains in `PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS`.
- The email subject never includes the client's name.
- A unique mutation ID prevents the same request from being processed twice.
- Delivery success and failure are audited without storing client names, note text, or recipient local parts in audit metadata.
- Microsoft Graph failures are not automatically retried because the provider may have accepted a message before the connection failed.

## Microsoft 365 Setup

Configure these server-only variables:

```text
PIPELINE_GRAPH_TENANT_ID=
PIPELINE_GRAPH_CLIENT_ID=
PIPELINE_GRAPH_CLIENT_SECRET=
PIPELINE_MEET_CLIENT_SENDER=
PIPELINE_MEET_CLIENT_ALLOWED_EMAIL_DOMAINS=
```

The Entra application needs Microsoft Graph `Mail.Send` application permission with administrator consent. Restrict the application to the approved sender mailbox using an Exchange application access policy. Do not grant unrestricted tenant-wide mailbox access for this feature.

## Operational Notes

- Microsoft Graph returning HTTP `202` means the message was accepted for delivery, not that every recipient opened or received it.
- The sender's Sent Items folder remains the operational delivery record because `saveToSentItems` is enabled.
- A failed result requires a supervisor to verify Sent Items before submitting a new request.
- Production must use the PostgreSQL audit store. The local file audit exists only for development.
