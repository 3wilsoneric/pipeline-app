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
- Day is the default working view on desktop, iPad, and phone. It separates appointments, dated follow-ups, unfinished assessments, and referrals needing a date.
- Week view is a timed schedule from 7:00 AM to 8:00 PM Pacific Time.
- Upcoming remains available as a chronological appointment list. Follow-ups stay separate from appointments.
- Past appointments without a recorded outcome are described as such, not automatically classified as missed or completed.
- Started drafts and completed interviews with unfinished documentation stay under Continue working. They retain their original appointment date, if one exists; no new due date is invented.

### Supervisor

- Defaults to Day and the signed-in person's work. Clearing My appointments exposes the team; Week then provides one row per assessor and one column per day.
- Shows scheduling queues and overlap warnings.
- Can focus one assessor to open the timed week.
- Can filter by assessor, community, or work type.
- Overlapping appointments remain visible as warnings; recording the work is not blocked by the calendar UI.

## Source Of Truth

| Calendar item | Canonical owner |
| --- | --- |
| Referral assignment | Referral `ownerId`, `assignedAt`, and `assignmentVersion` |
| Assessment appointment | Assessment schedule fields and version |
| Intake scheduling queue | Derived referral workflow status plus latest assessment |
| Required follow-up | Referral requirement owner, due date, and status |
| Continue working | Latest unfinished assessment on an open, active referral |

The calendar API derives all visible items on read. Calendar cards never persist their own status.

Related follow-ups for the same referral, owner, and date are consolidated into one calendar event while retaining every source label in the detail drawer.

## Actions

- `Assign referral` opens the referral workspace because assignment remains a referral operation.
- `Finish intake` opens the referral workspace at the canonical intake surface.
- `Schedule assessment` creates or reuses the referral's assessment, then writes its schedule with optimistic version matching and an idempotency key.
- `Reschedule` updates the same assessment and keeps its audit history.
- `Mark no-show` and `Cancel appointment` require confirmation and return the referral to the scheduling queue.
- `Interview completed` records schedule status `completed` and an `assessment_interview_completed` audit event through the existing versioned schedule API. It does not complete documentation, sign, submit, send mail, or finalize the packet. Answers remain editable under the existing finalization rules.
- The work drawer displays saved contacts, up to six recent documents with the existing preview, and existing open workspace follow-ups. Contacts are informational, not native call/email actions.
- Follow-up edits change only the next step and due date, use the requirement version and mutation ID, and never silently mark information received. Failed saves retain input; leaving with unsaved edits prompts for confirmation.
- The Day queue offers scheduling even while intake/contact information remains incomplete; completeness is not a questionnaire entry lock.
- `Join Zoom` appears only for a valid HTTP(S) Zoom location.
- `Open chart` and the appropriate workspace/assessment action use the existing canonical navigation. Assessment links resume the saved section.

## Concurrency And Conflicts

- Storage detects overlapping `scheduled` or `rescheduled` assessments for the same assessor. The current schedule route saves with an overlap alert rather than preventing staff from recording an appointment.
- Local storage serializes mutations before checking for an overlap.
- PostgreSQL takes a transaction-scoped advisory lock keyed to the assessor before checking and updating.
- Scheduling retains the existing assessment/referral authorization boundary and audit trail; this calendar change does not expand it.
- Optimistic assessment versions still protect against stale edits independently of time conflicts.

## Refresh And Recovery

- Calendar responses are private and non-cacheable at the API boundary.
- The browser refreshes visible calendar data every 30 seconds and when focus returns.
- Up to 16 range/filter snapshots are cached in memory so a failed refresh does not erase the last successful view.
- View, date, filters, and scroll position are remembered when returning within the same app session. A page reload starts fresh; client data is not placed in persistent navigation preferences.
- Drawer contacts, documents, and follow-ups load on demand with independent retry states, not as prerequisites for loading the calendar.
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
