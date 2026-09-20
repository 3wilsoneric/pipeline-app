# Tutorials: Workflow Rebuild

First implementation pass, 2026-09-19. Base: 991c9a279e848e49578131504d16c49d5bb92ba0.
Branch: codex/tutorial-workflows-20260919.

## Scope

Application-use walkthroughs only: where to click, what a control changes, how
to return, and how to recognize saved work. No assessment philosophy, clinical
instruction, language lab, or competency claims.

The existing Help entry is labeled Tutorials. Its tooltip library is searchable
and grouped into the current workspace, other application tasks, and explicitly
separate practice. Existing /training routes still redirect home. No deployment,
activation of retired pages, real invitations, or email deliveries are included.

## First-Pass Catalog

| Entry | Context |
| --- | --- |
| Find my next task | Home and Workspaces |
| Find and reopen a referral | Workspaces, search, existing record |
| Start a referral | Separate practice intake |
| Schedule an assessment | Current referral |
| Use the assessment | Current assessment controls |
| Try the assessment controls | Fresh local synthetic case |
| Review and sign | Current assessment review; signature remains explicit |
| Decision and admission date | Current referral decision page |
| Add and open files | Current workspace Files |
| Check change history | Current workspace Activity |
| Preview the packet and email | Current Finish & send page |
| Use Calendar | Available calendar scope and views |
| Find a client chart | Clients and Workspaces |
| Check team work | Supervisor task navigation |
| Run a report | Role-filtered report controls |

These describe the current base commit, not a proposed future workflow. In
particular, signing, recording a decision, setting an admission date, and sending
are separate actions. No guide executes them for the user. Stage-specific controls
can be unavailable on a given referral; the guide says so instead of advancing
the referral or bypassing a permission.

## Behavior

- Workspace navigation preserves referral/draft identity and uses the existing
  workspace-location helpers. A workspace-only guide cannot start from Home or
  an unsaved intake.
- Navigation awaits the shell's existing save guard. A failed guard leaves the
  current page and step in place and reports the failure.
- Practice starts with a new draft identifier and never inherits a live referral
  identifier. Ordinary page destinations drop practice parameters.
- Scheduling advances on the existing successful-save event, not a raw click.
- Skipped steps and starts partway through a tutorial do not earn completion.
  Completion means the walkthrough was reviewed, not that a clinical task,
  assessment signature, or packet delivery happened.
- Existing role/access owners remain authoritative. Direct tutorial start events
  also check the effective user's role. Guides add no permissions.
- Progress stores step identifiers and timestamps, not field contents.
- Mobile assessment targets point to the phone controls; other layouts use the
  full assessment. Tooltip placement stays within the viewport.

## Deliberate Limits

This pass reuses the existing coach, progress API, practice fixtures, and real
controls. It does not build a second simulated app or map tutorial clicks to the
retired clinical curriculum. Consequently new task guides have no curriculum
module mappings. Revisit that choice only if a separately approved nonclinical
curriculum needs those mappings.

Remaining dedicated guides: contact directory/import, extraction suggestions and
evidence review, profile settings, ownership reassignment, and save/conflict
recovery. Expand behavior-dependent decision/send guides only against the actual
next release, especially rescission and post-sign editing rules.

The old training readiness/certification scripts and operator-training.spec.ts
still encode the retired presentation, clinical chapters, and /training entry.
They are not acceptance evidence for this rebuild and have not been relabeled
as passing. Keep retired training routes disabled until the next scope explicitly
replaces those legacy contracts.

## Focused Evidence

Result: five executable contract tests and nine browser tests passed. The
production Webpack build, TypeScript, focused ESLint, and diff checks passed.
Desktop (1440px) and phone (390px) screenshots were inspected. This does not
certify every state of every authored guide or real email delivery.

- node --test scripts/tutorial-workflow-fixtures.test.mjs
- npx tsc --noEmit
- npx eslint on the changed tutorial modules and new browser test
- npm run build -- --webpack (isolated output directory)
- tests/e2e/tutorial-workflows.spec.ts: real Help entry, search, stage/context
  restrictions, desktop/phone highlights, practice reset, no live practice
  writes, skipped progress, preserved referral context, restricted-role event,
  and continued /training redirect.

Tests use the repository's isolated local E2E stores and mock authentication, not
production client records. The worktree's shared node_modules symlink prevents a
Turbopack build; the Webpack production build is the verified build path here.
The first dev-server run also hit a node:crypto browser-bundle error; browser
evidence was collected from the successful production build, not that dev run.

Before release, replay these guides against the actual candidate and record
changed controls. This document is not a deployment instruction or approval.

Local preview: http://127.0.0.1:3391/ using mock authentication and isolated data.
Open Tutorials in the sidebar, or More > Tutorials on a phone. The practice
assessment walkthrough can start without an existing referral.
