# Calendar Operations Contract

## Purpose

The Pipeline calendar is an operational projection of referral and assessment truth. It is not a second scheduling database and it does not own referral status.

It must answer three questions quickly:

1. What does this assessor need to do next?
2. When is each assessment scheduled?
3. Where does a supervisor need to assign, unblock, or rebalance work?

## Role Views

### Assessor

- Defaults to the signed-in assessor's work only.
- Week view is a timed schedule from 7:00 AM to 8:00 PM Pacific Time.
- Assignment and follow-up events remain in the all-day band.
- The attention queue contains only assigned intake blockers, ready-to-schedule work, and overdue assessments.
- Mobile and iPad default to an agenda rather than a compressed grid.

### Supervisor

- Defaults to a team week with one row per assessor and one column per day.
- Shows scheduled count, waiting count, overlap warnings, and high-load days.
- Can focus one assessor to open the timed week.
- Can filter by assessor, community, or work type.
- Can deliberately override a schedule conflict only after the server rejects the first attempt.

## Source Of Truth

| Calendar item | Canonical owner |
| --- | --- |
| Referral assignment | Referral `ownerId`, `assignedAt`, and `assignmentVersion` |
| Assessment appointment | Assessment schedule fields and version |
| Intake scheduling queue | Derived referral workflow status plus latest assessment |
| Required follow-up | Referral requirement owner, due date, and status |

The calendar API derives all visible items on read. Calendar cards never persist their own status.

Related follow-ups for the same referral, owner, and date are consolidated into one calendar event while retaining every source label in the detail drawer.

## Actions

- `Assign referral` opens the referral workspace because assignment remains a referral operation.
- `Finish intake` opens the referral workspace at the canonical intake surface.
- `Schedule assessment` creates or reuses the referral's assessment, then writes its schedule with optimistic version matching and an idempotency key.
- `Reschedule` updates the same assessment and keeps its audit history.
- `Mark no-show` and `Cancel appointment` require confirmation and return the referral to the scheduling queue.
- `Join Zoom` appears only for a valid HTTP(S) Zoom location.
- `Open workspace` is always available from a calendar detail.

## Concurrency And Conflicts

- The server rejects overlapping `scheduled` or `rescheduled` assessments for the same assessor.
- Local storage serializes mutations before checking for an overlap.
- PostgreSQL takes a transaction-scoped advisory lock keyed to the assessor before checking and updating.
- A normal user cannot submit a conflict override. The route honors `allow_conflict` only for Admin or Assessment Coordinator users.
- Supervisor overrides are explicit mutations and retain the normal assessment reschedule audit trail.
- Optimistic assessment versions still protect against stale edits independently of time conflicts.

## Refresh And Recovery

- Calendar responses are private and non-cacheable at the API boundary.
- The browser refreshes visible calendar data every 60 seconds and when focus returns.
- Range snapshots are cached in memory so a failed refresh does not erase the last successful view.
- A visible warning and retry action replace silent empty states.
- Requests are abortable when the range changes or the calendar unmounts.
- Mutations use unique idempotency keys and refresh the projection only after success.

## Time Handling

- The operating timezone is `America/Los_Angeles`.
- API timestamps are ISO-8601 instants with an explicit timezone.
- Scheduling inputs are interpreted as Pacific wall-clock time, including daylight-saving transitions.
- The UI states the timezone at the scheduling point rather than relying on the browser's local timezone.

## External Calendar Boundary

Outlook and Zoom automation are not yet connected. When they are added:

- Keep Pipeline assessment schedule fields authoritative for workflow state.
- Store external provider ID, event ID, sync version, sync state, and last error as integration metadata.
- Use an outbox worker for external creates, updates, and cancellations; never hold a browser request open for Microsoft Graph.
- Reconcile webhook notifications idempotently and route irreconcilable differences to a supervisor exception queue.
- Query Microsoft availability before proposing times, but recheck conflicts inside the Pipeline mutation transaction.
- Put only a neutral title such as `Pipeline assessment` and an authenticated deep link in the external event. Do not place diagnosis, medications, packet contents, or other clinical details in the calendar body.
- Generate Zoom or Teams join details server-side with least-privilege credentials. Never expose provider tokens to the browser.

## Release Tests

Minimum release evidence for calendar changes:

```bash
npm run check:api
npx tsc --noEmit
npx playwright test tests/e2e/pipeline-smoke.spec.ts --project=chromium --grep "calendar|overlapping assessor"
npm run build
```

Responsive acceptance widths are 390, 768, 1280, and 1440 pixels. The page must have no horizontal document overflow; month and week grids may scroll inside their own bounded surfaces.

