# Assessment appointments in Outlook

Pipeline remains the source of truth for assessment date, duration, method, location, and assessor. A saved schedule queues one private Outlook meeting organized by `admissions@alamo-pipeline.com`, with only the assigned assessor as an attendee. The invite contains a sign-in link to the workspace and no client name or clinical details. Rescheduling updates the same meeting; reassignment changes the attendee; cancellation or deletion removes the organizer meeting and sends the normal Outlook cancellation. An unassigned assessor or a missing mailbox address never blocks the Pipeline schedule; the queue retries after the account is completed.

The schedule and its queue entry commit in one PostgreSQL transaction. The one-minute job retries a bounded batch, uses Graph `transactionId` for idempotent creation, and compares the existing meeting before updating it. It does not send meeting invitations from tests, demo mode, or a local store. Existing appointments are not backfilled on activation, avoiding an unexpected invitation burst; a later schedule change queues them.

## Activate

1. In the Microsoft tenant that owns the existing Admissions Graph app and mailbox, grant that app **Application Calendars.ReadWrite scoped to the Admissions mailbox only** through Exchange Online RBAC for Applications. Do not grant an unrestricted organization-wide Entra application calendar role. The app needs no direct permission to assessors' mailboxes: they receive ordinary Outlook meeting invitations.
2. Verify the app can create, read, update, and delete a **synthetic** event in the Admissions mailbox, and cannot access a different mailbox. Verify one synthetic invitation arrives in an assessor test account and a reschedule/cancellation reaches it. Do not use a real client for the probe.
3. Set the GitHub repository variable `PIPELINE_ASSESSMENT_OUTLOOK_ENABLED=true` and run the normal full Azure deployment with existing production inputs preserved. The variable controls both the web feature and its one-minute scheduled job. Leave it absent or `false` until the scoped permission and synthetic probe pass.
4. Check the job result's `pending` count and the `pipeline.assessment_outlook_calendar` ledger for non-null `last_error_code`. Correct permissions, mailbox addresses, or Graph outages before calling the feature operational.

The deployment does not expand the existing Meet the Client email activation. A scheduled appointment still saves in Pipeline if Graph is unavailable; the UI calls the Outlook invitation **queued**, never delivered. The assessors' Outlook settings determine whether a received invitation appears tentatively or only after acceptance.

Microsoft references: [create event](https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0), [update event](https://learn.microsoft.com/en-us/graph/api/event-update?view=graph-rest-1.0), [delete event](https://learn.microsoft.com/en-us/graph/api/event-delete?view=graph-rest-1.0), [Exchange application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac).
