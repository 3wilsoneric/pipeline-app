# Design decisions

Owner decisions for the redesign, 2026-09-23. They apply together with PRINCIPLES.md.

## Precedence

PRINCIPLES.md supersedes the conflicting parts of the root `design.md`: square corners, uppercase letter-spaced labels, flat white canvas as the only surface, and shadow restrictions. The parts of `design.md` that don't conflict still apply, such as density, focus visibility, working in grayscale, recomposing on mobile, and evidence at full width.

## Stage color families

The detail tabs follow the board stages:

| Family | Board column | Detail tabs |
|---|---|---|
| Green | Referral received | (intake) |
| Blue | In progress | Chart, Assessment |
| Orange | Decision | Decision, Finish & send |

Red stays reserved for destructive actions and errors.

## Referral board scope

The first pass is visual only: current copy and data, restyled, plus the CSS stack and hover reveal. The rest of the handoff is a separate product change and waits on product answers:

- toolbar, filters, and sort
- age chip and `enteredStageAt`
- "N of M docs" summary
- List tab
- sub-status tab in place of the status pill

## Referral board visual pass

- The "01/02/03" column numbers drawn by CSS are removed as decoration. The column label names the stage.
- Outcome tabs: accepted uses the done color, and declined uses a neutral color. The words carry the meaning, and red stays reserved.
- With `hover: none` (touch), folders show unstacked and fully open. The click target doesn't change.
- The Current Work ribbon view colors by five workflow states. Mapping those onto the stage families gets its own pass.

## Home board layout (2026-09-24, owner)

Home uses the card system from the "Referrals" board image in place of manila folders.

- Columns are warm neutral, each with a stage dot, the title, the file count, and "View all".
- There is one white card per referral: name, referral line, status chip, completion bar with "Documents needed", then the assessor and the next action in the link green.
- The Home panel tabs are a segmented control: the selected tab is a white pill and counts sit in chips.
- The board panel sits flat on the page. Background carousel panels keep their geometry and swipe behavior but are not drawn.
- Every word is existing app text. Community, File progress, and Assessor labels stay as screen-reader text.
- Folder materials remain for charts.
- The toolbar, List tab, "Referrals" page title, age chip, and docs checklist are separate product changes.

## Detail frame and assessment (2026-09-24, owner, revised to match the mockups)

- Typeface: Figtree, loaded through next/font/google and self-hosted at build. This replaces Geist.
- Stage tabs follow the "Assessment section, revised" mockup:
  - Chart: blue
  - Assessment: rose
  - Decision: amber
  - Finish & send: green
- The open record's paper takes the active tab's color as a 4px top edge, so each page reads as its stage.
- The earlier "Chart and Assessment blue; Decision and Finish & send orange" mapping is superseded.
- Rose is a stage color here, not an error signal. Destructive actions and errors keep the danger red.
- Editing presence sits in the tab row, so no notice separates the tabs from the folder.
- The assessment section header has a rose "n / 12" chip, a section rail, and a recorded ring.
- Each question has a status circle: dashed until recorded, filled once recorded.
- Current information is a folder with its own tab.
- Single-choice answers are pills.
- The page ground (`--pipeline-canvas`) is warm app-wide.
- Known gap: the interview view still shows two filled buttons (Begin interview and Next section). This needs owner approval.

## Home board colors (2026-09-24, owner)

- Stage columns are tinted: green, blue, and peach.
- Each column has a white header card with a colored folder-icon tile, the title, the file count, and "View all", as in "Board, folder style".
- Referral cards inside the columns stay white cards.

## Out of scope (owner, 2026-09-24)

- No age chips ("6d in stage", "over target") on the board, and no `enteredStageAt` work for them.

## Rollout (owner, 2026-09-24)

Nothing is deployed until the owner is sure. The redesign ships behind an off-by-default switch.

- **The switch.** `PIPELINE_DESIGN_V2=true` on the server sets `data-design="v2"` on `<html>`. Components read it through `useDesignV2()` in `components/design/DesignSwitch.tsx`. Unset means the current design, which is what production uses.
- **Stylesheets.** Redesigned stylesheets hold two blocks: `:where(html:not([data-design="v2"]))` for the current design and `:where(html[data-design="v2"])` for the redesign. `:where()` adds no specificity, so the current design cascades exactly as before.
- **Components.** Components branch only where markup differs: the board card, presence placement, the section rail, and status circles.
- **Local rehearsal.** `PIPELINE_DESIGN_V2=true node scripts/persona-demo.mjs --port=3216`.
- **Known ceiling.** While the switch exists, a fix to a redesigned stylesheet belongs in both blocks. The color ratchet counts both, so its totals roughly double until cleanup.
- **Removal trigger.** After everyone has the redesign and the owner confirms, delete the current-design blocks, the `designV2` branches, `DesignSwitch.tsx`, and the Geist font, then lower the ratchet baseline.

Steps: build the switch; merge with the switch off, with production pixel-identical; iterate behind it; pilot for named users on live; turn it on for everyone; clean up.

## Delivery

Nothing is deployed without the owner's explicit go-ahead.
