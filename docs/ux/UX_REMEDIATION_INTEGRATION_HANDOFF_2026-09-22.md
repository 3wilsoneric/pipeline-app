# UX remediation integration — handoff

Prepared 2026-09-22 for the Codex deploy session. Read with
`docs/ux/WORKFLOW_UX_REMEDIATION_PLAN_2026-09-18.md`; its non-negotiable preservation rules govern
everything below.

**This branch is not a deploy candidate yet.** Four regressions and two open product questions are
listed below. Nothing here has been pushed.

## What this is

Branch `integration/ux-remediation`, based on production `9461fc8` (PR #165), merging seven parallel
Claude sessions that each implemented one page/workflow of the remediation plan. 72 files,
+2341/−388, seven merge commits.

| Merge commit | Source branch | Plan items | Surface |
| --- | --- | --- | --- |
| `4d1b38b` | `claude/relaxed-einstein-52b9a4` | 2 | Activity and identity labels |
| `74f3c57` | `claude/hopeful-kirch-5bde25` | 1 (directory half) | Clients directory |
| `0ec8473` | `claude/lucid-elgamal-134a7f` | 1, 5, 7, 10 (assessment halves) | Assessment workspace |
| `8900ebf` | `claude/elated-booth-566d7d` | 2, 4, 6 (chart halves) | Chart page |
| `5eb7f89` | `claude/determined-saha-e50772` | 9 | Calendar and Home |
| (decision) | `claude/admiring-greider-8acc84` | 5, 7 (decision halves) | Decision page |
| `af852a6` | `claude/awesome-bell-64e0db` | 8 | App-wide control standard |

Each source branch is intact and unmodified; the merges happened only on the integration branch.

## Conflict resolutions to audit

Five files conflicted. Each resolution is a judgement call — please check them rather than assume
them.

1. **`lib/pipeline/client-navigation.ts`** (Clients directory vs #165). Additive on both sides. Kept
   #165's `usePipelineHistoryGuard` and the branch's `rememberPipelineHistoryContext`,
   `readPipelineHistoryContext`, `returnToPreviousPipelineEntry`. No behaviour dropped.
2. **`components/pipeline/ReferralPacketCanvas.tsx`** (Chart vs #165). Kept #165's `navigatePage`
   signature including its `assessmentMode` parameter, and added the branch's new
   `editReferralFieldFromChart` helper ahead of it. The branch's own `navigatePage` signature (no
   `assessmentMode`) was discarded as the older shape.
3. **`tests/e2e/client-chart-transition.spec.ts`** (Chart vs #165). Two unrelated `describe` blocks
   appended at the same point; both kept.
4. **`components/pipeline/ReferralIntakeSummary.tsx` and `TransferredWorkspaceChart.tsx`** (Calendar
   vs #165). Prop-list collisions: `assessment` from #165, `contactActions` from the branch. Both
   kept, in the component signature and at the call site.
5. **`ReferralWorkflowPanelPresentation.tsx`, `ReferralWorkspaceFolder.module.css`,
   `assessment-footer-layout.spec.ts`** (Decision vs App-wide control standard) — **the contentious
   one**. These two sessions edited the same Decision surface with different intent. The
   control-standard session was scoped to shared styles but edited Decision's presentation file
   anyway. Rule applied: **Decision's structure and behaviour win; the control standard's pure
   styling wins.** Concretely:
   - Kept Decision's "Administrative controls" `<details>` section holding the stage select and
     `CurrentGateCard` (plan item 5). The control-standard side still had them inline under
     "Admission details"; keeping it would have rendered those controls twice.
   - Kept Decision's `SecondaryButton` for the forward stage transition rather than the control
     standard's `PrimaryButton`. Rationale: in the Decision view the dominant action is recording
     the decision, and item 5 demotes stage transitions to administrative. **Re-check this against
     item 8's "one visually dominant action" if you disagree.**
   - Kept Decision's `describedBy` prop on `PrimaryButton` (item 5's adjacent explanation for a
     disabled action) *and* the control standard's sizing (`min-h-11`, 14px, `py-2`).
   - Adopted the control standard's 14px/20px typography in the CSS module.
   - In `assessment-footer-layout.spec.ts` the two sessions assert **opposite behaviour** about
     whether the "Working decision" combobox appears in the workspace header. Kept Decision's
     assertion (`toHaveCount(0)`, recommendation belongs to the deliberate review area, item 5) and
     kept the control standard's added `More workspace actions` alternative in the secondary-menu
     regex (item 8). **This is a product decision, not a merge decision — confirm it.**

## Test evidence

Run against this branch unless stated. Comparison runs were made against production `9461fc8` and
against individual source branches to classify every failure.

| Check | Result |
| --- | --- |
| `tsc --noEmit` | clean |
| `npm run lint` | 5 errors — all reproduce on `9461fc8`; not regressions |
| `npm run check:saving` | 35/35 pass |
| `referral-identity-labels`, `referral-activity-traceability`, `assessment-working-view` | 13 pass, 1 skipped |
| Affected e2e, chromium (7 specs) | **15 failed, 42 passed** |

Failure classification:

| Failure | Count | Verdict |
| --- | --- | --- |
| `calendar-workflow.spec.ts:56` | 1 | **pre-existing on production** |
| `referral-chart-context.spec.ts` | 1 | **pre-existing on production** (prod fails 2 of these; this branch fails 1) |
| `mobile-assessment-focus.spec.ts` (whole suite) | 7 | fails on `claude/lucid-elgamal-134a7f` alone — unfinished WIP, not merge damage |
| `assessment-return-flow.spec.ts:32` (1440px, 390px) | 2 | same — fails on its own branch |
| `assessment-return-flow.spec.ts:122` | 1 | **regression: passes on its branch, fails merged** |
| `assessment-return-flow.spec.ts:137` (1440px, 834px) | 2 | **regression: same** |
| `assessment-footer-layout.spec.ts:100` | 1 | **regression: passes on production and on its branch, fails merged** |

Note for the record: production `9461fc8` currently fails `referral-chart-context` (both cases) and
`calendar-workflow` in this environment, independent of any UX work. Worth a separate look.

## The four regressions

1. **`assessment-return-flow.spec.ts:122`** — the Home schedule row renders **"Prepare assessment"**
   where the test expects **"Begin assessment"**. Cause: the Calendar/Home session standardised
   next-action wording (item 9) while the Assessment session wrote its test against the older label.
   Both did their assigned job. **"Prepare" vs "Begin" is a product wording decision** — they are not
   synonyms, and item 9 requires the language to match the actual lifecycle. Decide the word, then
   fix whichever side is wrong.
2. **`assessment-return-flow.spec.ts:137` (1440px and 834px)** — same suite, not yet traced; likely
   the same label reconciliation, but confirm rather than assume.
3. **`assessment-footer-layout.spec.ts:100`** ("loading the decision cannot move assessment
   navigation during a press") — 30s timeout. The test holds a mouse press, then
   `backToQuestions.click()` never resolves and the page closes during `page.mouse.up()`. This is a
   genuine interaction failure under a held press, not a label mismatch. Untraced. It is the one
   regression that suggests real broken behaviour rather than disagreeing expectations.

## Known scaffolding to remove before shipping

`tsconfig.json` gained `.next-item9-e2e/types/**/*.ts` and `.next-item9-e2e/dev/types/**/*.ts` from
the Calendar session's private e2e run. Harmless, but it is test scaffolding and does not belong in a
release.

## Not done

- No visual/accessibility comparison at desktop, tablet and phone against before/after.
- No assessor journey: find assignment → chart → schedule → return → partial assessment → leave and
  resume → review and sign → authorised decision → packet/handoff, on both a populated admitted
  client chart and a historical chart-only workspace. Plan step 4 requires this, and it is the check
  most likely to expose seams between seven parallel sessions. It has not been run at all.
- No full required CI gate run.
- The nine WIP failures above describe behaviour the plan asks for (item 10's phone/keyboard
  continuity in particular). They need finishing, not deleting or weakening.

## Deployment

Per the plan and the repository working policy: deployment needs authorisation, the applicable
passing release checks, a known candidate and a usable rollback path. On current evidence this
branch does not meet that bar. Do not weaken assertions, raise thresholds or bless these failures
into a baseline to get there.
