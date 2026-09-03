# Referral Intake Recovery Contract

## Purpose

Referral intake must survive refreshes, abandoned tabs, slow uploads, retries, and concurrent sessions without creating duplicate referrals or losing newer operator work.

This contract covers the path from **New referral** to a durable referral workspace. It does not change the assessment, decision, EHR handoff, Notes Lab, or training workflows.

## One Record, Two Short-Lived States

### Private recovery draft

A private draft is per-user working state before a canonical referral exists. It stores validated form values, selected filenames, dirty-field metadata, and the saved version. It never stores file bytes.

- Key: `new-{draft UUID}`
- Store: `pipeline.user_workspace_state`
- Concurrency: optimistic `if_match` version
- Retention: 30 days, removed by the existing retention worker
- Visibility: only the signed-in operator

### Canonical referral workspace

As soon as the operator makes a meaningful intake change, Pipeline attempts to create one canonical referral workspace. The workspace is the shared source of truth from that point onward, even if its profile or packet is incomplete.

- Create identity: stable `client_mutation_id` derived from the draft UUID
- Retry behavior: every create retry resolves to the same referral
- URL: replaced with the canonical `referralId` immediately after creation
- Visibility: existing assessor scope, workspace lists, calendar preparation, and supervisor Operations rules
- Status: deterministic workflow status such as `Needs assignment`, `Needs initial documents`, or `Profile incomplete`

The private draft is not a second referral queue. It exists only when canonical creation has not succeeded.

## Required Invariants

1. Meaningful intake creates at most one canonical referral.
2. A packet is not required to create the canonical referral shell.
3. The canonical URL is established before packet extraction finishes.
4. A failed upload leaves the canonical referral available with its true incomplete status.
5. Browser recovery stores filenames and form values, never raw file bytes.
6. After a reload, the browser may require file re-selection; it must not claim that an unconfirmed file was uploaded.
7. A successful save clears only the exact field and file snapshot it persisted. Edits made during the save remain dirty and recoverable.
8. A replacement file selected during an earlier upload is never cleared by the earlier upload's completion.
9. Cross-session draft deletion requires the exact current version.
10. Extraction proposals never overwrite locally dirty fields.

## Operator Flow

1. The operator opens **New referral**. Pipeline assigns a draft UUID in the URL.
2. Form changes are saved to private recovery state after a short delay.
3. Pipeline attempts canonical materialization after meaningful work, with bounded retry on failure.
4. On success, the URL changes to the canonical referral workspace and the private draft is removed.
5. Packet and supporting files upload against the canonical referral.
6. Retryable Blob and upload-completion failures are retried only at idempotent boundaries.
7. If a private draft remains, **Continue intake** appears on Home and Workspaces for that operator.
8. Canonical incomplete work appears in the normal workspace list with its workflow status. Supervisors see unassigned, blocked, missing-document, and stale work through existing Operations rules.

## Failure Matrix

| Failure | Durable truth | Recovery |
| --- | --- | --- |
| Refresh before canonical create | Versioned private draft | Continue the exact draft |
| Duplicate create request | Existing idempotency record | Return the same referral |
| Create service unavailable | Private draft remains | Automatic bounded retry, then manual create/retry |
| Blob PUT interrupted | Canonical referral remains incomplete | Re-select file if the browser no longer holds it, then retry |
| Upload completion response lost | Reserved upload and Blob object | Idempotent completion retry |
| Extraction delayed or failed | Raw document and packet state | Existing extraction reconciliation/dead-letter flow |
| User edits during save | Newer dirty values remain local and in recovery state | Subsequent autosave |
| Two sessions edit a draft | Version conflict | Refresh before overwriting or discarding |
| Operator abandons canonical shell | Canonical incomplete referral | Workspace status plus supervisor Operations exception |

## Observability And Cleanup

- API requests use centralized structured logging with private no-store responses.
- Recovery-list checks emit `pipeline.intake.recovery_drafts` as a count without client names, filenames, draft IDs, or other PHI.
- Draft saves, deletes, and version conflicts emit `pipeline.intake.draft_mutations`; canonical create and replay outcomes emit `pipeline.intake.workspace_materialization`.
- Scheduled cleanup emits `pipeline.retention.workspace_state` and participates in the existing retention-failure alert.
- The existing retention worker prunes expired `user_workspace_state` records.
- The existing extraction reconciliation schedule checks recoverable packet work every five minutes.
- Canonical referral create, update, assignment, upload, workflow, and activity events continue through their existing audit paths.

## Verification

Fast deterministic contract:

```bash
npm run check:intake-recovery
```

Browser lifecycle and refresh recovery:

```bash
npm run test:e2e:desktop
```

Production boundary checks:

```bash
npm run check:route-policy
npm run check:platform:fast
```

The local desktop store is for development and browser tests only. Production requires PostgreSQL for multi-instance-safe draft versions and create idempotency, private Azure Blob Storage for packet bytes, and the configured retention and reconciliation schedules.
