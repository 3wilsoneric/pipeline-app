# Workflow continuity pass — September 17, 2026

Follow-up product behavior after shared editing commit `3a53a0d`:

- Active workflow stages can be revisited or skipped. The workflow panel exposes a stage selector. Acceptance and decline remain explicit decisions; choosing another working stage does not erase decision history.
- A recommendation can be saved after early acceptance. Signing and later submission continue independently. Both adapters preserve the recorded decision and its status during later assessment creation, edits, signing and recommendation saves.
- Open paperwork no longer disables queueing an accepted case for EHR handoff. Queueing does not mark a transfer sent; actual transfer results remain separately recorded.
- The Intake action opens the questionnaire even before an assessor is assigned. Assignment and missing intake fields are not navigation prerequisites.
- Questionnaire field headers show neutral unanswered guidance. The optional unable-to-assess explanation no longer has native required validation or a false warning that it blocks signing. Initial document guidance is optional.
- Save, scheduling, contact, workflow, profile activation and document-preview errors use neutral notices. The schedule and begin dialogs allow returning to the questionnaire while a request is pending.
- Offline replay uses the same save queue as live edits and acknowledges confirmed values before merging server state. A newer answer typed while a queued save returns stays local until its own save; it is not mistaken for a competing user's edit.

## Evidence

Focused operational tests cover moving ahead/back with missing fields, acceptance followed by draft and signed recommendations, acceptance status preservation, EHR queueing with paperwork open, a forced503 save followed by an immediate newer answer during acknowledgement, neutral scheduling failures, questionnaire section navigation, return to Intake and the stage selector. The API flow and decision/correction/transfer replay checks also run on disposable PostgreSQL. Build/TypeScript, scoped lint, complexity and focused contracts accompany the exact-commit handoff.

The initial new test used a viewer as an assignable assessor and an obsolete pending-save label; those fixtures were corrected. The next run exposed assessment lifecycle synchronization overwriting acceptance, which was fixed in both adapters. Its browser teardown timed out after the scheduling/return assertions; the final fresh-port result is recorded separately. Original logs and artifacts remain available; no result was waived.

## Practical limits

Incomplete work never pretends to be complete, signed or sent. Initial approved authentication, valid record references, actual persistence outcomes, optimistic concurrency, signed originals, and explicit external delivery checks remain. When either encrypted browser recovery or server persistence succeeds, navigation can proceed; if neither can preserve the sole copy, the editor keeps it open rather than discarding it. No absolute claim is made about all network/storage outages.

No migration, account invitation, production data write, deployment or maintenance-cover removal occurs in this change. Integrate alongside the Clients preparation/navigation work; its AssessmentWorkspace focus/render changes and this save-queue change are separate. The recorded offline fast-edit edge is resolved only to the behavior exercised by the focused test; genuine concurrent edits still require reconciliation.
