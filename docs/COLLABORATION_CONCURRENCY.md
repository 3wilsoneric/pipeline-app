# Referral collaboration and concurrency

Pipeline protects active referral work at three levels. PostgreSQL remains the
source of truth; browser state and editing presence are never authoritative.

## Version checks

- Every referral has a monotonic referral-wide `version`. It is the lightweight
  change sequence used by active-canvas polling.
- Every referral also has versions for `identity`, `intake`, `documents`,
  `assessment`, `workflow`, and `decision`.
- A save includes the versions the editor loaded. Changes to separate sections
  can merge. A stale save to a section that changed returns `409` and identifies
  the conflicting section.
- Extracted fields carry their own versions. Confirming or correcting a field
  requires `if_match`; a stale review returns `409` instead of overwriting a
  newer review.

## Active-canvas refresh

An open canvas calls `GET /api/referrals/{referralId}/changes` every three
seconds and when the window regains focus. The small response contains the
change sequence, section versions, last editor metadata, and active presence.
The full referral is fetched only when the sequence advances.

Clean local fields accept remote values immediately. Dirty local fields are
preserved. When the same field changed remotely, the canvas shows both the
local draft and latest saved value and requires the editor to choose one before
saving.

## Editing presence

The active canvas sends a presence heartbeat every 15 seconds. A lease expires
45 seconds after the last heartbeat, so a crashed tab disappears without an
unlock operation. Closing or navigating away releases the lease when possible.

Presence is a coordination hint. It does not lock records, reveal field values,
or permit an otherwise stale save. Version checks are the data-loss boundary.

## Scale and privacy

The change endpoint is bounded to one referral and carries no packet content.
Presence records store only the authenticated actor identity, referral ID,
section, and lease timestamps. Application logs use route templates and never
record query strings, referral IDs, resident data, tokens, or response bodies.
