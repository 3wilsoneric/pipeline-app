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

- Typeface: Inter, loaded through next/font/google and self-hosted at build (Figtree until the modern pass, 2026-09-26). This replaces Geist.
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
- The admission checklist comes right after "Where this referral stands", near the top, per the staff request that it be readable at a glance in place of the assessment section.
- Chart order, readability pass (owner, 2026-09-26: "do them all"; supersedes the order above): the client's own chart (identity, referral details, contacts, intake) comes first, then "Where this referral stands" as one compact row of milestones with no boxes, then the admission checklist, then the assessment (its recorded-answers line, review link, and closed record), then the supporting records, with Documents last. The upload is a "Drop files or choose files" button in the Documents row instead of a drop box above the page; the whole Documents card still accepts dropped files.
- Once the assessment is signed, "Assessment summary" shows its key findings: diagnoses and acuity, current risk flags, substance use, medications and adherence, daily-living needs and mobility, conservatorship, diet, and family involvement. The full answers stay on the Assessment tab.
- The signature line ("Signed by … on …") sits on the Chart as one quiet card line.
- The referral's summary paragraph ("Referral summary", the referral's note) sits right under the identity card, not at the bottom in Referral information, and isn't repeated there (owner, 2026-09-24, from JC Wallace staff). It shows only when a summary is recorded. Intake has a plain "Referral summary" box to paste it into (redesign only; the live app's box was removed on 2026-09-15 in PR #89).

## Copy pass (owner, 2026-09-24: "a lot of words, a lot of shit competing for attention")

Cuts only; no new wording. Redesign switch only. Explanations that carry a rule move to a tooltip or hover rather than being deleted.

- Chart: the "Client files" card leaves (Files is in the rail). "Edit in intake" and the assessment's "From referral records" show on hover or focus of their field. The upload area drops its size hint and duplicate "Choose files". The assessment strip keeps the count and drops its reassurance sentence. The Chart checklist shows markers and names; instructions stay on Decision. The Referral information card drops its repeated subtitle and workspace line.
- Decision: drops the page subtitle, the "What happens next" box (a declined referral keeps "Referral closed"), and the checklist group descriptions. "Where this referral stands" keeps titles and markers; each explanation becomes the row's tooltip. "To complete" shows only on items still open.
- Assessment interview: drops the intro sentence under All questions / Interview.
- One green action per page: Chart links (Edit referral details, Review unanswered, Open decision) are ink, and the rail's Next pill hides on the Chart when the page's own button leads to the Assessment.

## Interview context (owner, 2026-09-26: "surface information without having to navigate away")

- The interview's "Current information" panel starts with the referral summary and the referral's documents. A document opens as a side sheet over the interview and closes back to the same question. Notes sit beside the questions (see "Notes").
- Returning clients: each history-type question that is still empty offers the answer from the client's last signed assessment on another referral ("Suggested from last assessment (Mon YYYY)" / "Use"), the same pattern as document suggestions. Only answers that rarely change are offered (history, diagnoses, legal, substance history, devices and diet, social history); current symptoms, recent incidents, and "last/most recent" dates are always asked fresh.
- Nothing fills in until a person chooses Use. The browser names the earlier assessment it used; the server re-checks that it is this client's (same Pipeline client or linked clinical client), signed, openable by this person, and that the saved value matches. Then the answer's source reads "From last assessment". Anything that does not check out still saves, recorded as entered by the person, so a stale suggestion never blocks a save.
- Document suggestions ("Suggested from <file>", Use / Reject) already exist wherever packet extraction runs; automatic filling from documents stays off.
- Follow-ups: autocomplete for doctors, pharmacies, and contacts from the saved contacts list; suggestions on phones.

- Chart drawer (owner, 2026-09-26): a Chart button beside the interview's actions, and Alt+C anywhere in the interview, slides the whole Chart in from the right, read-only. Escape, the close button, or a click outside closes it and returns to the same question with the cursor where it was; nothing is saved or lost. It is a native modal dialog, so focus stays inside while it is open.
- The interview header row drops its fractions and step numbers (owner, 2026-09-26): section position, recorded count, and the 1 and 2 markers are hidden; screen readers still hear the position and count. The Chart button and drawer stay as above (a mini folder from the rail was tried and reverted).
- Intake answers too (owner, 2026-09-26): intake data added or changed after the assessment started is offered where the assessment is still empty, as "Suggested from referral records" with Use, ahead of the last assessment. The server credits it to the intake (the same provenance a seeded answer gets) only when the saved value equals the referral's current value; anything else saves as entered by the person. The assessor is never offered.


## Split interview (owner, 2026-09-26: "a bi-screen chart and the interview ... give it a shot, go intense"; trial)

- Beside the questions: only the information already filled in for the topic being asked, from preparing, intake, or earlier in the interview (owner, 2026-09-27: "the info has to be relevant to the information already filled out in that section during the pre-interview"), under the topic's name, labels over values; "No information recorded for this section yet." when there is none. It changes with the topic in view. That topic's notes are docked below it. (First tried as the whole Chart as text.)
- The current topic's notes are docked at the foot of the left side. A note being typed in stays on screen even if the questions scroll to another topic, so it never swaps out from under the cursor.
- The line can be dragged (30 to 70 percent), moved with the arrow keys (Shift for bigger steps, Home and End for the limits), and double-clicked or Enter to reset to 45 percent; the width is remembered on the device. The questions keep at least 440px.
- The interview header has no Chart button while the split is on; the Notes / Current information tabs give way to the split. Below 1024px the information sits above the questions.

## Interview layout (owner, 2026-09-27: "made it so the progress section went away during the interview ... an arrow similar to the sidebar collapse is there if you want the progress component to come back"; replaces the full-screen interview)

- On a wide screen (1024px and up), during the interview the record rail (Chart, Assessment, Decision, Finish & send, Next, the save status, Files, Activity, Trash) is tucked away so the information, notes and questions have the room. The app bar stays. A small arrow at the left edge, the same control as the app bar's own collapse arrow ("Expand navigation" / "Collapse navigation"), brings the rail back and hides it again. Each visit to a step starts with it tucked away; All questions and every other step show the rail as usual.
- The app bar has no expand/collapse arrow in the redesign (owner, 2026-09-27: "take away the sidebar collapse open arrow"); it still opens on hover. The only arrow on that edge is the rail's.
- With the rail away, the bottom bar shows the save status text, and the interview bar leads with the client's name. Schedule interview (and the "Scheduled" appointment line with its Edit) shows only while the interview has not begun.
- Leaving the interview is All questions, as before; the Assessment step reopens where it was left (All questions or the interview), even after a reload, and the first open of an unbegun assessment starts in All questions. While the page scrolls to a topic chosen in the picker, the picker holds that topic.
- History: tried first as a full-window takeover (hiding the app bar, a close button and Escape, a separate on/off state with an expand button, then as "the interview is always full screen"); replaced by this simpler rule on the owner's direction.

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

- Chart and intake fields keep the original formatting: one grid per section with hairline dividers, the label with its always-visible pencil, and the original value sizes, in the redesign's colors and type. This supersedes the field tiles and the hover-only edit hint from the copy pass. Readability pass (owner, 2026-09-26): the pencils stay visible but muted until their field is hovered or focused; empty fields are lighter than recorded ones; every section uses one even three-column grid (identity: the name plus three equal columns) with no gray filler cells; section titles are bolder with more room above; the record page keeps a right gutter so the floating Notes button never covers the page.

## Chart assessment section (owner, 2026-09-26: "add the assessment section")

- The Chart ends with this referral's full assessment: the original assessment record with its fields, sections, and edit pencils. It is closed by default under its "Assessment" header with the signed or in-progress status, so the checklist and summary still lead. The Assessment tab stays the place to fill it in.
- No repeats (owner: "no more lines and copy and attention grabbers ... just have it function better"). The "Assessment answers: n of 84 recorded" line and its review link move from the top to just above the Assessment section. The assessment appointment moves from under Contact information into "Where this referral stands". The lower Client files list and Assessments list leave out this referral's own files and signed assessment, which already show above, and disappear when nothing else is left. Referral information leaves out this referral's decision and recommendation facts, which the status card shows. Nothing new is added.

## Rail steps and presence (owner, 2026-09-26: "is the editing thing necessary? i think not")

- The record rail has no "is editing" pills. Saves still refuse and explain conflicting edits. The current design keeps its presence notice.
- Assessment, Decision, and Finish & send sit directly under Chart with smaller markers, joined by one line from the Chart icon and with no divider between, so they read as the steps that build the Chart.

## Modern pass (owner, 2026-09-26: "the pastels and the font have just got a little too sterile and 2000s coffee house")

- Typeface Inter instead of Figtree; titles and section headings at weight 600.
- Neutral surfaces instead of beige: cool light-gray page, white paper and cards, gray rules and borders. The step colors keep their hues (principle 1), cleaner and lighter; column washes are flat instead of gradients.
- Radii one step tighter (sheet 16, folder 12, paper 10, input 8). Shadows neutral and quieter. Focus ring blue.
- Chart status cards lose the amber top edge.
- All through app/design-tokens.css; component markup and copy unchanged.

## Sharper pass (owner, 2026-09-26: "less coffee house, sharper, better colors")

- Crisper: white sheets and cards defined by borders, with shadows only on things that float (the notes button, menus, dragged cards). Corners tighter again (sheet 12, folder 10, paper 8, input 6, chip 4).
- Colors: the component colors from the modern pass stay (step columns, washes, tiles, chips). Only the ink is darker (near-black). A later attempt that whitened the washes, and one with a dark sidebar and black buttons, were both rejected by the owner (2026-09-26: "i just wanted the component colors to be there, and sharper font and edges").
- Filled buttons (Create referral, Begin interview, Next section, Send, the begin dialog) share one deep bottle-green action color, flat, with even corners. The emerald folder-tab Create referral button from the current design is gone in the redesign.
- Headings tracked slightly tighter, with Inter's clearer letterforms (single-story a, open digits).
- Tokens and one type rule only; markup and copy unchanged.

## Step folders (owner, 2026-09-26: "bring back the folder effect for the intake through decision")

- Each record step (Intake, Chart, Assessment, Decision, Finish & send) is a folder in its step color instead of a flat wash: a white label tab at the top left with the step's name and a thin step-colored edge (owner: "white like a label"), the back panel showing as a darker band above the front flap, and the step's pages inside as white cards. This supersedes the flat wash from "Record layout" (three layers) but keeps its color mapping.
- A new referral's Create referral sits at the bottom right of the intake in a bar that stays visible while scrolling, like Next section and Review assessment on the other steps (owner: "why is create intake over there to the left? how is that good flow?"). Same control, same checks.
- In the record rail, Files, Activity, and Workspaces are secondary: smaller, muted, below the steps. On a new referral, Intake shows as the step in progress.
- The record rail has no Workspaces link; the app sidebar has it. Record pages without a step color (Files, Activity) are manila folders, never gray (owner: "go with manila when in doubt").
- Trash is a row like Files and Activity, labeled and in red. The merged-changes check mark has no visible mark in the rail; screen readers still hear its message (owner, 2026-09-26).
- The folder colors mix from the step color (front 15%, back 28%, rim 45% into paper), so every step matches without new tokens. The tab label is the section's existing name. Wide screens only; phones keep their layout.

## Step colors by decision (owner, 2026-09-26)

- Assessment is manila. Decision and Finish & send are manila until a decision is recorded, then green for Accept and red for Deny, in both the folder and the rail. Intake and Chart stay blue. This supersedes the rose Assessment, amber Decision, and green Finish & send from "Stage color families" for the record pages.
- The record page carries `data-decision-outcome` from the referral's recorded decision (or its accepted or declined status).

## Less pagination (owner, 2026-09-26: "middle option ... less pagination ... saving can keep happening as you scroll")

- Saving never depended on changing pages: intake fields and assessment answers each save as they are left (the assessment also keeps an offline copy). So removing pages changes layout only.
- Prepare assessment is one scrolling page: the five groups stack with their names as headings; the section picker stays at the top while scrolling, follows the scroll, and jumps to a group. There is no Previous or Next section; the bottom bar keeps Open interview. Phones and practice keep the paged view.
- The interview is one scrolling page too (owner, 2026-09-26: "I want both"): all topics stack under their names, the picker follows and jumps, Current information stays beside the questions and follows the current topic, and the bottom bar keeps Review assessment.
- Each record step ends with a "Next: <step>" button below its folder, the same action as the rail's, so a record reads from Chart to Finish & send without scrolling back up.

## Kept-mounted steps (owner, 2026-09-26: "return it to the old way, I just want the SPA-like saving")

- A one-page record was tried and withdrawn at the owner's request. Steps show one at a time again, as before.
- What stays: on wide screens with the redesign, a referral's Chart, Assessment, Decision, and Finish & send load once and stay mounted; switching shows another without unmounting. Moving between them (or to Files and Activity) never waits for a step to finish saving; leaving intake, which unmounts, keeps its save. A send in progress no longer blocks moving around.
- The Chart and the Assessment are one editor: it draws the Chart step and the questions, so there is never a second copy of the assessment that could save over the first.
- Imported, historical, and practice workspaces, and phones, keep the previous behavior.
- Saves are quick (owner: "make it save quick, we can't have issues"): assessment answers and intake fields save about a second after the person pauses typing, as well as when they leave the field; the saved snapshot advances so nothing is sent twice.
- Saving has one deliberate place: a panel in the rail for the whole record. One short line when all is well ("All changes saved", "Saving…", "Waiting to sync", "Not saved"); a compact row per affected part (Referral details, Assessment, Decision paperwork) with a short state and its fix (Retry, Open) when not. The full existing messages show on hover and are read by screen readers. It replaces the separate save notices above each step.

## Home board cards (owner, 2026-09-26: "take the design, color etc and give it ours, and take away percentage")

- From the owner's reference: the client's name with the status pill beside it; "Referral #n · community"; the received and planned dates; the latest client note; a milestone bar; documents needed in orange with a file icon; then the assessor with initials and the next action as a filled button that stays on one line.
- No percentage. The bar has one segment per milestone (Intake, Assessment scheduled, Interview, Assessment signed, Decision, Meet the Client packet sent) from the referral's workflow status and packet date: done in the column's color, the one underway at half strength, the rest gray. Declined and closed referrals show no step underway. Each segment names its milestone on hover; the bar reads "n of 6 steps done".
- The assessor appears once, in the footer; with none it reads "Unassigned" in orange with an empty dashed avatar.
- The card's note is the client's latest note (see "Notes").
- Columns take stronger tints (green, lavender, peach) and a dot in their color before the name.

## Notes (owner, 2026-09-26: "the quick note and interview notes have to be combined, this is all about the client"; "not private, just attached to the client")

- One set of notes per referral, taken by the assessor while preparing for and doing the interview, attached to the client: anyone who can open the referral reads them, and edits follow the referral's own edit rule. They replace the private quick note and the assessment-only notebook tried earlier (neither was ever deployed).
- Headings: Before the interview, one per interview topic, then Collateral and calls. The topic in view opens and is marked by itself, so notes land in the right place without filing.
- Where: on the Assessment step, beside the questions (a "Notes | Current information" tab pair in the interview, so the questions keep their width; a column on the right while preparing, which can be hidden, remembered on this device). On every other record step, the same notes open from a round button at the bottom right. Home board cards and Workspaces rows show the latest note (first line of the most recently edited heading).
- Saving never blocks: each heading saves about 0.7 seconds after typing pauses and when it is left; one request at a time per heading; retried by itself when the connection drops; sent when the page hides. Each heading has its own version and never changes the referral's version, so notes can never make a referral or assessment save conflict. A heading changed on another screen offers "Keep mine" or "Use theirs". A note save refreshes only the latest-notes summary, never the whole app's data.
- Each heading records who last edited it and when. Notes add no audit rows, because they save as someone types and would flood the referral's Activity; they are not referral activity. They are not locked when the assessment is signed.
- Storage: pipeline.client_note_blocks (migration 0046, additive, guarded rollback), with a local-file adapter for development; verified against PostgreSQL. Phones and practice: not yet.
- Next: prep and interview tags and time stamps on lines, "Use as answer", custom headings and "/" shortcuts.

- Fewer navigation layers (owner, 2026-09-26, trial: "give it a shot but we may undo"): beside the questions, the notes show only the topic in view, as one box under its name; "View all" opens every heading. The floating Notes panel still lists every heading. In the interview, the All questions / Interview switch and its buttons join the sticky section row, which drops its progress ring (the count stays), so the page has one in-page navigation row. On the record page the bottom bar's save status becomes a spreadsheet icon (still the way into Excel and recovery; its status stays for screen readers), since the rail's save panel is the one save status.
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
