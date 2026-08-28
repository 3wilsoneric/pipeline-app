# Runtime Authorization Characterization Plan

## Goal

Prove authorization through executed requests and resulting side effects. Static route-policy checks remain architecture fitness functions; they are not the complete authorization test.

## Required identities

- Unauthenticated caller.
- Authenticated viewer.
- Assigned assessor.
- Different, unassigned assessor.
- Supervisor.
- Internal extraction worker.
- Valid user from the wrong tenant or untrusted gateway.

Use synthetic accounts and records only. Each user needs an isolated browser/session context so credentials and drafts cannot leak between tests.

## Matrix dimensions

For every changed route or worker entry point, execute:

| Dimension | Cases |
| --- | --- |
| Authentication | missing, expired, malformed, trusted |
| Role | viewer, assessor, supervisor, worker |
| Ownership | assigned record, other assessor's record, unassigned record |
| Origin | same origin, absent service origin, unapproved cross origin |
| Tenant/gateway | expected tenant, wrong tenant, untrusted forwarded identity |
| Mutation version | current, stale, missing where required |
| Resource state | open, signed/terminal, trashed, missing |

## Assertions

- Exact status category is stable: `401`, `403`, `404`, `409`, or validation failure as designed.
- Unauthorized calls create no database, Blob, audit, metric-with-identity, queue, or EHR-handoff side effect.
- Supervisors do not accidentally overwrite canonical assignment while exercising override access.
- Worker credentials cannot invoke user routes, and users cannot invoke worker callbacks.
- Errors and logs remain generic and PHI-safe.
- Every API method appears in the runtime matrix or has an approved public-health exception.

## Refactor exit rule

A static `source.includes("requirePipelineUser")` assertion may remain as a boundary rule, but each high-risk mutation must also have at least one executed allow case and two deny cases covering role and resource ownership.
