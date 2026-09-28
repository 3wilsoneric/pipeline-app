# Referral board redesign: implementation handoff

## Goal

Rework the referral intake board so every referral in a stage can be triaged at a glance, while keeping the existing manila folder look. The current board stacks folders so tightly that only the bottom one shows any detail; the others are just a name on a tab. The new board keeps the stack, but each folder shows enough to act on, and hovering (or focusing) a folder opens it.

`reference/referral-board.html` is a complete, dependency-free working prototype. Open it in a browser to see the target behavior. Treat it as the source of truth for layout, tokens, and interaction. Port it into the app's existing framework, component library, and styling approach rather than copying the file in.

## What changes from the current board

1. Stacked folders overlap less. Each covered folder shows its name tab, sub-status tab, referral number, community, time in stage, and next action.
2. Hover or keyboard focus on a folder lifts it 6px, deepens its shadow, fades in its details, and slides every folder below it down to reveal it. Leaving restores the stack.
3. The bottom folder in each stack is always fully open.
4. The redundant status pill (for example "Referral received" inside the Referral received column) is removed. The second tab next to the name now shows a sub-status only when one exists ("Preparation", "Missing referral info", "Last name missing").
5. Each folder shows time in stage as a chip with three states: neutral, amber, and filled "over target".
6. "File progress 14%" and "Documents needed 3" are replaced with "1 of 7 docs", a progress bar, and the first two missing document names plus a remainder count.
7. Column headers keep the white card with the folder icon tile and file count. The separate expand icon and "View all" text become one link.
8. A toolbar is added above the board: search (name or referral number), Community filter, Assessor filter, "Assigned to me" toggle, and a sort control (oldest first by default).
9. The Decision column is fixed at 300px so empty stages don't take a third of the width.
10. A List tab sits next to Board and Upcoming assessments. The list view itself is out of scope for this task; render the tab and leave it wired to nothing or to an existing route.

## Layout

Page: tabs row (Board with total count, Upcoming assessments with count, List) sitting on top of a large rounded sheet, with the New referral button at the right of the tabs row.

Sheet: toolbar, then a three-column grid `1fr 1fr 300px`, 20px gap, columns aligned to the top. Below 960px the grid collapses to one column.

Column: tinted gradient background per stage (green, blue, peach), 18px radius, 14px padding, 16px gap between header and stack.

## Folder anatomy (top to bottom)

- Tab row: name tab (beige gradient tab holding a white label, 17px bold) and optional sub-status tab (alert or info tone).
- Folder body: beige gradient with a darker edge, 12px radius, holding a paper sheet.
- Paper, always visible: `#2752 · Victoria's House` on the left, age chip on the right; then the next action as a 17px semibold link with an arrow. The next action is the primary click target.
- Paper, details (hidden on covered folders): docs count and missing docs, progress bar in the column's tone, then a rule and the assessor with initials avatar.

## Stack behavior

All of this is pure CSS in the reference. Keep it CSS if the stack allows.

- `.folder + .folder` gets `margin-top: calc(-1 * var(--stack-overlap))` with `--stack-overlap: 106px`. This value is tuned so the next folder's tab lands just below the covered folder's next-action line. If fonts or paddings change, retune it so that line is never clipped.
- `.folder:hover + .folder` and `.folder:focus-within + .folder` get `margin-top: var(--stack-gap)` (16px). This is the reveal.
- Hovered or focused folder: `transform: translateY(-6px)` and a larger shadow on the folder body.
- Details: `opacity: 0` by default, `1` on hover, focus-within, and `:last-child`.
- Transitions: margin-top 260ms `cubic-bezier(0.2, 0.8, 0.2, 1)`, transform and shadow 200ms ease, opacity 200ms.
- `@media (hover: none)`: no overlap, details always visible, no lift. Touch users get a plain vertical list of open folders.
- `@media (prefers-reduced-motion: reduce)`: no transitions, no lift. The reveal still happens, just instantly.

## Age chip rules

Days in stage = whole days between `enteredStageAt` and now. Below 3 days: neutral, label "2d in stage". 3 to 4 days: amber, "4d in stage". 5 days or more: filled dark orange with white text, "6d · over target". The thresholds are placeholders in `AGE_WARN_DAYS` and `AGE_LATE_DAYS`; make them configuration, ideally per stage, and confirm the real targets with operations before shipping.

Age must be measured from when the referral entered its current stage, not from the received date. If the backend doesn't record stage entry time yet, add it or flag it.

## Data each folder needs

```ts
type Referral = {
  id: string;
  number: number;
  name: string;
  community: string;
  stage: "received" | "in_progress" | "decision";
  enteredStageAt: string;            // ISO date or datetime
  subStatus: { label: string; tone: "alert" | "info" } | null;
  docsComplete: number;
  docsTotal: number;
  docsMissing: string[];             // display names, in priority order
  nextAction: { label: string; href: string };
  assessor: { name: string; initials: string };
};
```

Map these to whatever the existing API returns. If `docsMissing`, `subStatus`, or `nextAction` aren't available, derive them where the logic is obvious and list the rest as gaps in the PR description rather than inventing values.

## Tokens

All colors, gradients, and stack values are CSS custom properties at the top of the reference `<style>`. If the app has a theme or token system, add them there under meaningful names instead of hardcoding hex values in components. Font is Figtree with a Helvetica fallback; if the app already has a UI font, use that instead.

## Accessibility

- Each folder is an `<article>` labelled by the name; the next action is a real `<a>`.
- Focusing the next-action link opens the folder via `:focus-within`, so keyboard users get the same reveal.
- Progress bar has `role="progressbar"` with min, max, and now.
- Search input has a visually hidden label. Icon-only elements are `aria-hidden`.
- Text contrast meets 4.5:1 on every chip and tab in the reference. Keep that when mapping to theme colors.
- Age state is carried by text ("over target") as well as color.

## Acceptance criteria

- With 4 referrals in a column, all 4 names, next actions, and age chips are readable without hovering or scrolling at 1440x900.
- Hovering any covered folder reveals its full contents and nothing jumps horizontally.
- Tabbing through next-action links reveals each folder in turn.
- On a touch device or with `hover: none`, folders display unstacked and fully open.
- With reduced motion enabled, no animated transitions occur.
- Empty stages show a short empty-state message inside a narrow column.
- Search filters by name or referral number across all columns; the Board tab count updates.
- "Assigned to me" and sort work client side at minimum.
- No new runtime dependencies.

## Open questions for the product owner

- Real turnaround targets per stage for the age chip.
- The canonical document checklist and its priority order for "Needs ...".
- Whether sub-statuses come from the backend or are derived.
- Whether "View all" opens an expanded column view or the List tab filtered to that stage.
