# Pipeline Retention Policy

## Referral workspace trash

- Deleting a referral workspace is a reversible soft delete.
- The workspace and its documents remain private and restorable for 30 days.
- Deleted workspaces are excluded from active lists, search, client histories, calendars, files, queues, and direct editing routes.
- The retention worker permanently removes an expired workspace only after its source and preview blobs are deleted successfully.
- A failed blob deletion leaves the database record in trash so the worker can retry without orphaning protected data.

## Operation

The authenticated internal retention endpoint runs in dry-run mode unless called with `execute=true`. Production scheduling must use the protected internal-worker credential and should run once daily.
