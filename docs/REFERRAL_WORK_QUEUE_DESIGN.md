# Referral workflow direction

The referral directory is a shared workflow tracker, not a kanban board. Its
primary job is to let a small admissions team find a referral, see where it is
in the process, and open the canonical canvas to continue the work. Exception
queues remain available when a user wants to focus on stalled or incomplete
work, but they do not define the entire referral experience.

## Primary row

Each active referral remains one compact, clickable row with:

- client and community
- the visible Pre -> Assessment -> Post workflow
- current constrained stage and data-completeness state
- owner
- last meaningful change
- next action and blocker count as secondary context

The row opens the referral canvas. Stage changes remain constrained by the
existing transition API and occur from the relevant task or canvas action, not
by moving a card.

The default workflow view includes active referrals only. Accepted and declined
records remain available in All packets as history instead of occupying the
team's working surface.

## Secondary action views

The Needs action surface exposes:

- All action
- Unassigned
- Packet review
- Assessment due
- Decision needed
- Missing documents
- Blocked

These are deterministic projections over canonical referral, requirement,
assessment, decision, document, ownership, and due-date state. They are not
manually maintained labels. One referral appears once in the selected view,
even when it belongs to multiple action categories. Its primary queue is chosen
by urgency and the remaining needs stay visible on the row.

The API returns counts for the complete active set while bounding returned rows
to 500. All packets and All files remain browse surfaces rather than work
queues.

## Shared use

The workflow tracker refreshes active referrals every eight seconds while its
browser tab is visible and refreshes immediately when the user returns to the
window. Hidden tabs do not poll. A manual refresh remains available and the UI
states when the tracker was last updated.

List rows do not edit workflow state. Four users can browse and open referrals
without list-level overwrites; edits happen in the canvas, where section
versions, optimistic conflict checks, three-second change polling, presence
leases, remote-change banners, and audit records protect simultaneous work.

## Interaction

The workflow tracker is ordered by most recent meaningful change so current
shared work stays near the top. The Needs action view separately orders by
urgency, priority, due date, then oldest untouched work. Global search can find
client, community, owner, stage, queue, or next action with partial-word and
one-character typo tolerance. Blank, pending, unknown, and unassigned owner
values are normalized to one `Unassigned` state in the API, filters, progress
engine, and transition gates.

Community, stage, owner, priority, month, and tag remain available in the All
packets browser. A row exposes the progress engine's single context-aware next
action, such as assign owner, review packet, complete assessment, record
decision, or collect a TB result. Extraction failures and extraction conflicts
take precedence because they prevent trusted downstream data. Bulk
reassignment may be added for supervisors, but bulk stage changes should remain
prohibited.

## Why this fits Pipeline

This shape scales to thousands of historical referrals while keeping the active
working set small. It supports the ordinary job of moving a referral through
the process, still makes missing data and stalled work visible on demand, and
avoids implying that workflow state can be changed safely by dragging a card.
