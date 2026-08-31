# Architecture Narrative: [Slice]

Author: [human owner]

Date: [YYYY-MM-DD]

Status: draft | verified | approved

Starting commit: [git SHA]

Dedicated worktree: [absolute path]

Branch: [codex/refactor-*]

This document must be written in the owner’s own words after reading the scoped code. Agent-generated summaries may be used afterward to challenge omissions, not as the initial explanation.

## Scope

- Files included:
- Entry points and callers:
- Explicitly excluded behavior:
- Current file/dependency audit generated at:
- Code-quality gate result:
- File audit disposition:
- Planned new files and dependency direction:
- Canonical responsibility entries:
- Architecture comprehension probes:
- Approved proof obligations:
- Slice assurance record:

## What it does

[One paragraph describing the current behavior.]

## Inputs and outputs

| Boundary | Input | Output | Validation |
| --- | --- | --- | --- |
| | | | |

## Invariants

- [State or security property that must always hold.]

## Side effects and transaction boundaries

- Database reads/writes:
- Audit events:
- Blob operations:
- Queue/events:
- External services:

## Failure and recovery

| Failure | Current behavior | Retry/idempotency | Operator recovery |
| --- | --- | --- | --- |
| | | | |

## Authorization and PHI

- Permitted roles:
- Resource-level checks:
- PHI accepted or returned:
- Logging and metric restrictions:

## Evidence used to verify understanding

- Characterization test:
- PostgreSQL fixture:
- Browser journey:
- Failure replay:
- Production/operational evidence, if applicable:

## Comprehension gaps

- Initial belief:
- Observed behavior:
- Decision needed:

## Owner explain-back

[Explain how the slice works and what would break if its main invariant were removed.]

## Assurance boundary

- Properties expected to be mechanically enforced:
- Finite behaviors expected to be exhaustive or model checked:
- Properties covered by fuzz, mutation, integration, or concurrency evidence:
- Statistical or environment-dependent uncertainty requiring human/operational control:
- What this narrative explicitly does not prove:

Approved by: [name/date]
