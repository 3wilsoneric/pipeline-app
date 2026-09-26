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
- Each column header is a plain row: the title, the file count as a small chip, and "View all". There is no header box and no icon (owner, 2026-09-24).
- Referral cards inside the columns stay white cards.

## Record layout (owner, 2026-09-24, prototype)

- On screens 1024px and wider, an opened record is a vertical flow: a sticky progress rail on the left and the step's page on the right.
- The rail holds:
  - the client's name
  - Chart, with a house icon, as the record's home
  - the progress steps (Assessment, Decision, Finish & send) with icon-only markers and a connecting line
  - Files, Activity, and Trash
- Markers:
  - dashed: not started
  - solid ring: in progress
  - filled check: done
- Markers derive from the recorded workflow status. They add no words.
- New-referral drafts and phones keep the tab layout.
- Moving between steps works both ways (owner): click a step in the rail, or use the small "Next: <step>" pill under the steps in the rail. "Next:" is owner-approved wording. The page's own action stays the primary button.
- Records still open on the last step the person was on. Chart stays one click away at the top of the sticky rail.
- The rail is low profile: compact rows sitting directly on the page, with no card around it (owner, 2026-09-26; earlier a floating card). It is 188px wide and the work area gets the rest, up to 1640px. Under the name it shows "Referral #id · community" (the board's wording) and a thin bar for completed steps.
- The manila folder around the page is retired in the vertical flow (owner). The page has three layers, like the Home board: the warm page, a wash in the active step's color (Chart blue, Assessment rose, Decision amber, Finish & send green), and white cards on the wash. Decision and Finish & send are one card. The Chart is split into cards: identity first, then each section's title on the wash above its card, then the checklist and the client record. Phones and narrow windows keep the folder until this is approved.

## Chart as home (owner, 2026-09-24, from staff feedback)

- The Chart leads with the admission checklist as a read-only "at a glance" panel. It shows the Decision tab's "Admission requirements": the same data from the same endpoint, grouped, with each item's status line. "Open decision" goes to the one place that edits them.
- This referral's full assessment answers leave the Chart; they live in the Assessment tab. The "n of 84 recorded" strip stays as the at-a-glance assessment status. Assessments from earlier referrals stay on the Chart as history.
- Follow-up if staff ask: editing checklist items directly on the Chart.
- The Chart ends as the whole story (owner, 2026-09-26). It opens with "Where this referral stands": the Decision page's five milestones (answers, interview, signature, decision with who and when, Meet the Client packet with its date), plus the placement recommendation and reason, the decision reason, the admission date, and the EHR handoff status once accepted. All existing wording.
- Once the assessment is signed, "Assessment summary" shows its key findings: diagnoses and acuity, current risk flags, substance use, medications and adherence, daily-living needs and mobility, conservatorship, diet, and family involvement. The full answers stay on the Assessment tab.
- The signature line ("Signed by … on …") sits on the Chart as one quiet card line.
- The referral's summary paragraph ("Referral summary", the referral's note) sits right under the identity card, not at the bottom in Referral information, and isn't repeated there (owner, 2026-09-24, from JC Wallace staff). It shows only when a summary is recorded. Intake has a plain "Referral summary" box to paste it into (redesign only; the live app's box was removed on 2026-09-15 in PR #89).

## Copy pass (owner, 2026-09-24: "a lot of words, a lot of shit competing for attention")

Cuts only; no new wording. Redesign switch only. Explanations that carry a rule move to a tooltip or hover rather than being deleted.

- Chart: the "Client files" card leaves (Files is in the rail). "Edit in intake" and the assessment's "From referral records" show on hover or focus of their field. The upload area drops its size hint and duplicate "Choose files". The assessment strip keeps the count and drops its reassurance sentence. The Chart checklist shows markers and names; instructions stay on Decision. The Referral information card drops its repeated subtitle and workspace line.
- Decision: drops the page subtitle, the "What happens next" box (a declined referral keeps "Referral closed"), and the checklist group descriptions. "Where this referral stands" keeps titles and markers; each explanation becomes the row's tooltip. "To complete" shows only on items still open.
- Assessment interview: drops the intro sentence under All questions / Interview.
- One green action per page: Chart links (Edit referral details, Review unanswered, Open decision) are ink, and the rail's Next pill hides on the Chart when the page's own button leads to the Assessment.

## Quick note (owner, 2026-09-26, from staff feedback)

- Each person keeps a short private reminder per referral ("where we are"), so they don't have to click through 10 to 20 profiles to remember progress. Owner decisions: private to each person; called "Quick note" (placeholder "Add quick note").
- Written in the record rail under the referral line. The rail shows a four-line preview; clicking it opens a larger writing panel over the page (owner: "more substantial"). It saves as you type (about a second after the last keystroke) and when the panel closes (click away or Escape). Clearing it deletes the note.
- Read at a glance on the Home board cards (up to three lines) and under each client on Workspaces (up to two), in a warm sticky-note tint.
- Stored in the per-person workspace-state store (`referral_quick_note`, migration 0046, additive with a guarded rollback), up to 2,000 characters of plain text, kept a year from the last edit. It needs read access to the referral, never changes the referral, and is not part of its Activity. Notes clear from memory on sign-out or account switch.
- Redesign only, and wide screens only for writing (the rail). Phones: follow-up if staff ask.

## Interview context (owner, 2026-09-26: "surface information without having to navigate away")

- The interview's "Current information" panel starts with the referral summary and the referral's documents. A document opens as a side sheet over the interview and closes back to the same question. The quick note is already in the rail.
- Returning clients: each history-type question that is still empty offers the answer from the client's last signed assessment on another referral ("Suggested from last assessment (Mon YYYY)" / "Use"), the same pattern as document suggestions. Only answers that rarely change are offered (history, diagnoses, legal, substance history, devices and diet, social history); current symptoms, recent incidents, and "last/most recent" dates are always asked fresh.
- Nothing fills in until a person chooses Use. The browser names the earlier assessment it used; the server re-checks that it is this client's (same Pipeline client or linked clinical client), signed, openable by this person, and that the saved value matches. Then the answer's source reads "From last assessment". Anything that does not check out still saves, recorded as entered by the person, so a stale suggestion never blocks a save.
- Document suggestions ("Suggested from <file>", Use / Reject) already exist wherever packet extraction runs; automatic filling from documents stays off.
- Follow-ups: autocomplete for doctors, pharmacies, and contacts from the saved contacts list; suggestions on phones.

## Sidebar (owner, 2026-09-24)

- The rail is warm paper with a thin edge.
- Icon buttons are 48px and rounded.
- Icons are muted by default. The active destination takes the soft green tint with green icon and text.
- The new-referral "+" uses the link green.
- The P logo, the order, and the labels are unchanged.
- Pass 2 (owner, 2026-09-25): the Alamo logo sits on the rail without its white box; the account switch reads like the other utilities (no box); the phone "More" menu uses the rail's neutral items and green active tint instead of one color per destination, with New Intake in the link green.

## Workspaces (owner, 2026-09-25)

- The Home board's layers: warm page, white cards for the tools, the browsing list, and the results.
- Search and all three filters share one control style and the same chevron.
- The results table: sentence-case headers (no uppercase tracking), readable names and detail lines, rounded progress bars in the done color, muted owner and date, and a quiet open arrow that takes the link green on hover.
- The chart thumbnail sits on paper instead of a green tile. The browsing list's active item uses the rail's green tint.
- No wording changes.

## Consistency pass (owner, 2026-09-26: "complete the full build on all pages, making it all make sense")

- One language everywhere in the redesign: the warm page, step or section washes, white cards with the card border and shadow, sentence-case labels over bold values, one filled action per view.
- Intake (new and editing) uses the Chart's tiles and titles. New referrals use the record rail too ("New Referral", Intake, Create referral, Files, Activity).
- The client profile reads as an open record: the name as the page title, the Chart's blue wash with white cards, and "Create intake" as a normal button. No manila folder remains on desktop.
- Calendar, Trash, the Clients directory, Reports, and the Files view use the shared cards, controls, and segmented style (the Home tabs). Every dropdown shares one rounded style and chevron; text fields and bordered buttons share the input radius.
- App-wide in the redesign: no uppercase letter-spaced labels, and the older black buttons take the filled action style. The phone top bar is the rail's warm sheet, not a green gradient.
- Board cards wrap cleanly when narrow: separators never start a line, names truncate instead of breaking mid-word.
- Two labels stored in capitals ("NAME", "GENDER") display in sentence case without changing their text.

## Chart field formatting (owner, 2026-09-26: "make the chart more like original with the actual field formatting")

- Chart and intake fields keep the original formatting: one grid per section with hairline dividers, the label with its always-visible pencil, and the original value sizes, in the redesign's colors and type. This supersedes the field tiles and the hover-only edit hint from the copy pass.

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
