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

- Beside the questions: only the information already filled in for the topic being asked, from preparing, intake, or earlier in the interview (owner, 2026-09-27: "the info has to be relevant to the information already filled out in that section during the pre-interview"), laid out like a clinical progress-notes form (owner, 2026-09-27: "more like notes on lined notebook", then "a bit more medical chart"): a boxed sheet with a narrow label column in small capitals, a vertical rule, answers in the right column on tight blue-green ruling that runs down the panel, no repeated topic title (the section picker names it; owner, 2026-09-27: "dont need this title, make the info per section very readable and clear"); "No information recorded for this section yet." when there is none. It changes with the topic in view. That topic's notes are written below it on the same ruled page (owner, 2026-09-27: "as if you are notating it below"): a "Notes" row with the save status and View all, then the writing across the full width on the same ruling, no box; the sheet ends a few lines below the writing rather than ruling empty space, and its edge turns green while writing (owner, 2026-09-27: "so much wasted space when we don't have that much"). The label column fits its longest label (up to 40 percent) and its rule sits beside the filled-in answers only; a written answer (longer than a short fact) runs the full width under its label. When the answers run long they scroll inside the sheet and the notes stay in view below them, never under the bottom bar (owner, 2026-09-27: "what if a section has a lot of answers with text and notes"); the information side starts at 38 percent of the width. (First tried as the whole Chart as text.)
- The current topic's notes are docked at the foot of the left side. A note being typed in stays on screen even if the questions scroll to another topic, so it never swaps out from under the cursor.
- The line can be dragged (28 to 70 percent), moved with the arrow keys (Shift for bigger steps, Home and End for the limits), and double-clicked or Enter to reset to 38 percent; the width is remembered on the device. The questions keep at least 440px.
- The interview header has no Chart button while the split is on; the Notes / Current information tabs give way to the split. Below 1024px the information sits above the questions.

## Chart built by the process (owner, 2026-09-27: "more home screen the chart, where the sub parts, assessment, decision, etc, are sorta cannibalized once done, like it's a whole process of building the chart"; "drop them")

- The Chart reads in the order of the work: the referral chart (intake), then Assessment, Decision, and Finish & send. Each step's section shows what it produced; a finished step gets a green filed stamp (Assessment signed and its date; Decision recorded, outcome, who and when; Meet the Client packet sent and its date) and its way back in (Open assessment, Open decision, Finish & send). A step still under way shows its status line (for example "Decision not recorded"); Finish & send appears once the referral is accepted or the packet is sent.
- The Assessment section holds the key findings once signed, the recorded-answers line, and the full record (closed). The Decision section holds the recommendation and decision reason. Finish & send holds the admission date and EHR handoff.
- Owner revision, 2026-09-28: every step remains in the rail, including completed steps. Accepting a referral does not imply a signed assessment: its marker uses the assessment's actual signature, and an unsigned assessment stays editable and signable after acceptance. Existing post-send finalization rules are unchanged.
- Chart cleanup, 2026-09-28: admission requirements lead the page with resolved/total progress, then the compact, ruled medical field sheet. The visible “Referral chart” title is removed; small pencils retain their large accessible click targets. Assessment, Decision and Finish & send have distinct section headers and direct opening actions; Documents has a distinct file header. Requirements use the same workflow records as Decision and stay visible after completion. The questionnaire definitions, answer options, and interview/preparation groups are unchanged from pre-redesign `b39c377c`.
- This replaces "Where this referral stands" (its milestone cards) and the separate assessment summary card on the Chart. One commit, easy to revert.

## Interview layout (owner, 2026-09-27: "made it so the progress section went away during the interview ... an arrow similar to the sidebar collapse is there if you want the progress component to come back"; replaces the full-screen interview)

- On a wide screen (1024px and up), during the interview the record rail (Chart, Assessment, Decision, Finish & send, Next, the save status, Files, Activity, Trash) is tucked away so the information, notes and questions have the room. The app bar stays. An icon-only Show workspace control in the assessment's sticky section bar brings the rail back; a more prominent icon-only Focus assessment control in the open rail below Activity and Trash hides it again. Both retain accessible names, and the app sidebar keeps its separate edge arrow (owner, 2026-09-29). Once brought back it stays until it is collapsed again, across steps and reloads, on this device (owner, 2026-09-27: "have it stay expanded until you collapse it"); while open during the interview it leaves out its save status and Next pill. All questions and every other step show the rail as usual. During the interview the folder uses the full width (no right gutter; owner: "move the folder component over to the right a lot more").
- The app bar has no expand/collapse arrow in the redesign (owner, 2026-09-27: "take away the sidebar collapse open arrow"); it still opens on hover. Superseded by the owner's 2026-09-29 direction: restore the app sidebar arrow and expand it only when that arrow is pressed, without hover or focus expansion. The interview's icon-only controls live in the assessment section bar and the open workspace rail.
- The save status and interview date sit in the top-right corner of the interview bar, a size smaller (owner, 2026-09-27); the bottom bar keeps Review assessment. The interview bar leads with the client's name. In the rail, Files and Activity are a size smaller and Trash a size smaller again (owner, 2026-09-27). Schedule interview (and the "Scheduled" appointment line with its Edit) shows only while the interview has not begun.
- The interview bar has no All questions / Interview trail (owner, 2026-09-27: "dont need the bread crumbs"): the section name is a plainly bordered dropdown whose first choice is All questions, and choosing a section snaps straight to it instead of scrolling there.
- Leaving the interview is All questions (in that dropdown); the Assessment step reopens where it was left (All questions or the interview), even after a reload, and the first open of an unbegun assessment starts in All questions. While the page scrolls to a topic chosen in the picker, the picker holds that topic.
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
- Prepare assessment is one scrolling page: the five groups stack with their names as headings; the section picker stays at the top while scrolling, follows the scroll, and jumps to a group. There is no Previous or Next section. Phones and practice keep the paged view.
- Preparation cleanup (owner, 2026-09-28): on desktop, the section picker, scheduling and Chart share the compact interview-style header; the duplicate preparation/interview breadcrumb row is removed. One primary footer action opens the existing Begin interview confirmation before starting, or Return to interview afterward. Cancel keeps preparation open and does not record a start; returning never restarts the clock. Ordinary answer and Notes saves remain independent of navigation. Phones and practice retain their existing controls; this is not a Notes/sidebar-layout redesign.
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
- Owner revision, 2026-09-28: Referral received and Decision should retain color without red/green stop/go meaning, not become gray. After previewing slate-blue, the owner chose tan manila for Referral received; Decision remains muted violet with a richer tint. These Home board families cover their stage dots, progress and ordinary status chips. In progress retains its blue family; white cards, accepted-status green, document warnings and actual error/destructive colors remain unchanged. This supersedes the green/peach column tints, not the record-step outcome colors.

- A long next step (for example a list of documents to collect) stays inside the card: the green button shrinks and its text ends with an ellipsis, the full text as its tooltip (owner, 2026-09-27: "look at what happens to the folder").
- Opening a client from Home returns to where the person last was in it; the card's suggested step is used only on a first visit (owner, 2026-09-27: "when you go back to a folder have to go to the place you were most recent at, not whats needed"). The Calendar still opens the exact item chosen.
## Notes (owner, 2026-09-26: "the quick note and interview notes have to be combined, this is all about the client"; "not private, just attached to the client")

- Superseding owner direction, 2026-09-29: show one Notes editor throughout the client workspace, with no topic headings, accordions, or View all control. Existing topic notes appear together in that editor with their former labels as plain text. The first edit saves the combined text as one note; the original topic records remain stored so no entered text is deleted. A later save from an older open tab is included in the editor until carried forward. The single note retains autosave, offline recovery, version conflict handling, and the same referral access rules.

- One set of notes per referral, taken by the assessor while preparing for and doing the interview, attached to the client: anyone who can open the referral reads them, and edits follow the referral's own edit rule. They replace the private quick note and the assessment-only notebook tried earlier (neither was ever deployed).
- Headings: Before the interview, one per interview topic, then Collateral and calls. The topic in view opens and is marked by itself, so notes land in the right place without filing.
- Where: on the Assessment step, beside the questions (a "Notes | Current information" tab pair in the interview, so the questions keep their width; a column on the right while preparing, which can be hidden, remembered on this device). On every other record step, the same notes open from a round button at the bottom right. Home board cards and Workspaces rows show the latest note (first line of the most recently edited heading).
- Saving never blocks: each heading saves about 0.7 seconds after typing pauses and when it is left; one request at a time per heading; retried by itself when the connection drops; sent when the page hides. Each heading has its own version and never changes the referral's version, so notes can never make a referral or assessment save conflict. A heading changed on another screen offers "Keep mine" or "Use theirs". A note save refreshes only the latest-notes summary, never the whole app's data.
- Each heading records who last edited it and when. Notes add no audit rows, because they save as someone types and would flood the referral's Activity; they are not referral activity. They are not locked when the assessment is signed.
- Storage: pipeline.client_note_blocks (migration 0046, additive, guarded rollback), with a local-file adapter for development. The pre-merge verification exercises the real PostgreSQL adapter, migration/runtime roles, route handlers, concurrent saves and rollback preservation. Unsaved notes reuse the existing encrypted, expiring, account- and tab-scoped recovery store. Practice remains excluded.
- Phones (owner, 2026-09-27): include the same Notes button and panel without changing the assessment flow. Closing the panel keeps pending saves alive; reopening/reloading restores the draft. True same-heading conflicts preserve both copies; other headings and assessment work remain available.
- Next: prep and interview tags and time stamps on lines, "Use as answer", custom headings and "/" shortcuts.

- Fewer navigation layers (owner, 2026-09-26, trial: "give it a shot but we may undo"): beside the questions, the notes show only the topic in view, as one box under its name; "View all" opens every heading. The floating Notes panel still lists every heading. In the interview, the All questions / Interview switch and its buttons join the sticky section row, which drops its progress ring (the count stays), so the page has one in-page navigation row. On the record page the bottom bar's save status becomes a spreadsheet icon (still the way into Excel and recovery; its status stays for screen readers), since the rail's save panel is the one save status.
## Out of scope (owner, 2026-09-24)

- No age chips ("6d in stage", "over target") on the board, and no `enteredStageAt` work for them.

## Rollout (historical owner plan, 2026-09-24)

On 2026-10-17, the local candidate retired the runtime design flag and the old stylesheet blocks. The approved redesign now renders even when `PIPELINE_DESIGN_V2` is unset or false. The remaining `useDesignV2()` caller branches are unreachable compatibility code; remove each when its component is next changed, and delete the compatibility function after its final caller is gone. This source cleanup does not change the rendered design. The original rollout plan follows for historical context.

Nothing is deployed until the owner is sure. The redesign ships behind an off-by-default switch.

- **The switch.** `PIPELINE_DESIGN_V2=true` on the server sets `data-design="v2"` on `<html>`. Components read it through `useDesignV2()` in `components/design/DesignSwitch.tsx`. Unset means the current design, which is what production uses.
- **Stylesheets.** Redesigned stylesheets hold two blocks: `:where(html:not([data-design="v2"]))` for the current design and `:where(html[data-design="v2"])` for the redesign. `:where()` adds no specificity, so the current design cascades exactly as before.
- **Components.** Components branch only where markup differs: the board card, presence placement, the section rail, and status circles.
- **Local rehearsal.** `PIPELINE_DESIGN_V2=true node scripts/persona-demo.mjs --port=3216`.
- **Known ceiling.** While the switch exists, a fix to a redesigned stylesheet belongs in both blocks. The color ratchet counts both, so its totals roughly double until cleanup.
- **Removal trigger.** After everyone has the redesign and the owner confirms, delete the current-design blocks, the `designV2` branches, `DesignSwitch.tsx`, and the Geist font, then lower the ratchet baseline.

Steps: build the switch; merge with the switch off, with production pixel-identical; iterate behind it; turn it on globally after separate owner approval; clean up. The original named-user pilot is not implemented. Ask before building a per-user pilot.

## Pre-merge owner confirmations (2026-09-27)

- Approved as one set: “Finish & send”, “Open decision”, “Admission date”, “Decision reason”, “Admission requirements”, “All questions”, “All notes saved”, “Waiting to sync”, “Hide notes”, “Close notes”, “Use theirs”, “Appointment not booked”, and “Expand/Collapse navigation”. Notes-load failure: “Notes could not be loaded.” with “Retry”.
- Approved refreshing only the three stale Linux snapshots from the verified production-main render: desktop Home, desktop new intake and mobile new intake. Main `b39c377c` and the switch-off candidate produced byte-identical actual PNGs; the candidate was not used as the baseline source. Other snapshots and comparison tolerances stay unchanged.

## Delivery

Nothing is deployed without the owner's explicit go-ahead.

## Home shortcuts and Decision status (owner, 2026-10-31, local preview)

- Replace the Board / Upcoming assessments / New assignments switch with the always-visible board. Upcoming assessments is a compact count button opening the schedule in a modal, not an inline agenda. New assignments opens its existing list in a separate modal. Existing Home module preferences still apply.
- In the Decision column, accepted status is green, denied status is red, and pending review is yellow. Keep the recorded status words. This explicitly supersedes the earlier neutral-denial color restriction for these status chips only; stage colors and actions retain their existing meanings.


## Home personal schedule ribbon (owner, 2026-10-31)

Supersedes the Home modal shortcut row: remove the visible Board title, New assignments, and the completion memo ribbon from Home. A short Upcoming assessments ribbon now opens the existing schedule dialog. Its count and appointments are scoped to the signed-in assigned assessor, including supervisor accounts. Unavailable schedules remain explicitly unavailable. The current-work board stays directly below; the completion review route remains intact. Saved Home module IDs remain readable, but retired assignments and the duplicate schedule module cannot be added through Arrange Home. No deployment is authorized for this local preview.

## Intake width and progress (owner, 2026-10-31)

The local intake form fills the same content width as its document upload area. Its header is a compact section heading and one recorded-details progress indicator. Remove the repeated completion block at the bottom of a new intake; retain the existing Create referral action. Existing-referral intake retains Done or its assessment continuation action. Wide desktop fields share rows; smaller screens keep readable two-column or single-column forms. Field wording, collected data, completion calculations, and save behavior are unchanged.

## Screen audit cleanup (owner, 2026-10-31, local)

Approved after the screen-by-screen audit. A single Intake destination is a compact navigation row; the multi-step rail retains recorded progress and dates but drops the redundant selection arrow. Create referral uses its full label at the end of the phone intake. Assessment fields have one visible recorded check; phone section navigation is secondary to the interview or signed-assessment continuation. Phone Notes sits beside the client identity so it cannot cover answers or footer actions.

Meet the Client gives the working message a full column on laptop widths, using the existing stacked tools layout below it. Large desktops retain the tools alongside. The existing recipient-authorization checkbox stays beside Preview email, with all existing validation. Home file requirements are supporting text above the existing Open Files action, with the same destination. Expanded cards have a readable minimum width and a distinct paper surface. Calendar empty messaging is compact. Chart gaps, metadata, file targets, contrast, and accepted-status color follow the existing tokens. No questionnaire wording, clinical data, permissions, save rules, or sending rules change. No deployment authorized.


## Working files and transitions (owner, 2026-10-31, local preview)

The owner approved a connected Carelog pass, meaningful motion, and compact Home files that can show several clients without oversized cards. This supersedes the previous Home card density: retain name, community, assessor, next action, missing-document count and planned admission date; leave detailed chronology and notes in the record. A small stage tab and paper edge replace the milestone strip and full-width button. Decision words retain their green/red/yellow outcome colors.

Intake has a source-file tray beside the form when there is enough width. Creation opens the existing saved-workspace choices, with preparation first. Preparation puts the existing source summary/files beside answers and notes. Meet the Client puts To/Cc and the admission date above the letter; packet files sit alongside only when both remain readable. Warm neutral materials, colored typography and illustrated objects replace filled green panels. Existing copy, questions, collection requirements and send rules remain authoritative. Entry, lifted files and reordered email sections use the existing motion tokens, with reduced-motion support.

The local review also repairs assessment continuity: desktop focus records its exact question without rewriting the route during typing, and the mounted interview restores that target when returning from Files or Activity. This uses the existing per-user, per-referral continuity owner. It does not change answer storage or make step navigation wait for saves. No deployment is authorized.


## Decision and Placement hierarchy (owner, 2026-10-31, local preview)

The owner rejected a gray background as the main redesign and asked for visual outcome controls and less copy. Decision now uses three tactile outcome tiles with green, red and amber symbols, native radio semantics, raised selected edges and short selection motion. On wide screens the reason sits beside the choices, with the record action beneath; narrow screens retain readable choices and labels. The duplicate page title, client sidebar, empty-recommendation paragraph and visible tile subtitles are removed. Outcome descriptions and action guidance remain accessible; permission restrictions, errors, actual recommendations, differing-recommendation warnings and confirmation dialogs remain visible when relevant. Assessment access and secondary tools stay in one row.

Placement drops the redundant heading and duplicated decision action. The canonical handoff readiness component presents the next assessment or decision action, with secondary decision access while both remain outstanding. The ready composer retains its recorded status and More actions control. No clinical wording, decision semantics, signing, sending, data or permissions change. All changes remain local.

## Decision note and confirmation (owner, 2026-10-31, local preview)

The reason belongs beneath the three outcome choices at their combined width, superseding the side-by-side arrangement above. It uses the warm paper surface with a small focus lift and outcome-colored underline. The owner requested shorter confirmation copy: acceptance records the decision without signing or sending; denial closes the referral without sending. Keep the confirmation and Cancel action. Show a brief stamped receipt only after a confirmed successful save, without delaying the existing navigation to Placement or moving keyboard focus. Reduced motion retains the feedback without animation. No production deployment authorized.


## Workspaces finishing pass (owner, 2026-10-31, local preview)

Keep the existing Workspaces directory, sidebar views, month browser and click paths. The owner requested a small color and copy cleanup, explicitly rejecting large new category tabs. Use a warm page background, gently alternating paper rows, wider status space and small semantic status tints. Keep the canonical status words: accepted/admitted green, denied red, uncertain admission amber, assessment blue. Shorten search placeholders and row metadata to community/county; the full record and search coverage remain unchanged. No workflow, data, permissions or deployment changes.

The owner rejected the subsequent dark-header/solid-badge color pass and requested the prior softer version with crisper lines and better text fit. Retain soft status tints and the original directory layout; refine existing boundaries and column sizing, without additional copy or navigation.

The owner then rejected the gray-on-gray result and requested a closer Carelog pass with verified label fit. Supersedes alternate-row shading and boxed status badges: use compact warm rows on paper and semantic status text. Client names lead directly, with no initials or avatar marks (owner correction). Unknown names retain the canonical placeholder. Preserve the original directory navigation, fields and click paths. Long client/owner names and filter selections wrap; filters move to another row before their labels crowd the control. Motion is limited to the existing open arrow on hover/focus, with reduced-motion support. Local only.

## Remove the intake-resume banner (owner, 2026-10-31, local)

Remove the pictured “Continue intake” banner from the Workspaces landing page. Home does not render that banner. Saved intake drafts, autosave, direct draft recovery and the existing Recent work module remain intact. No deployment authorized.

## Home personal client space (owner, 2026-10-31, local preview)

The owner approved combining newly received clients into In progress, then rejected two expanded stage columns. Home now puts personal pinned clients first, followed by up to six recently opened active clients, with no duplicates. In progress and Decision are compact count buttons opening the existing full lists and All/Mine controls. Those lists also offer pinning; every client remains reachable. Individual received/preparation/assessment/decision status, original next actions and destinations are retained. No new initial avatars or stage tabs.

Pins use the existing per-user, versioned work-continuity store and survive reopening the app. Only authorized active workspaces appear; admission/closure removes a client from this Home space without altering the referral or erasing its history. Pin errors remain visible and retryable. Personal cards Resume the last visited page; a named action in a full list opens that stated destination. Pinning never opens or changes a clinical record. Six recent cards keep Home compact; the full category lists remain the overflow path. Revisit that limit only if staff need more immediate recent shortcuts. Phone layout stacks the same cards and keeps both category buttons accessible. No deployment authorized.

## Intake spacing and the later journey (owner, 2026-10-31, local preview)

New intake uses a single work area instead of a workspace rail plus a separate document column. Intake, Files and Activity remain available in a compact page header on desktop. File uploads and the document checklist share one row above the form; the repeated New Referral file heading is removed. The form uses aligned, 48-pixel controls and tighter label spacing, with four identity fields across only on wide screens. Phone fields remain stacked. Existing copy, fields, uploads and save behavior stay intact.

The intake recorded-details meter remains visible. Creating a referral restores the full Chart → Assessment → Decision → Placement journey, including its existing progress states; the compact header applies only before a referral exists. Verified locally with draft reopen/reload, creation, file labeling/queue/removal, and desktop/phone Chromium and WebKit layouts. The encrypted-recovery suite passes all nine applicable cases; its legacy session-storage case is excluded by the suite for this server configuration. No deployment authorized.


## Compact Chart checklist and steady file drop (owner, 2026-10-31, local preview)

Remove the Chart checklist's category headings. Its default view is one expandable completed/total fraction; opening it exposes the same requirements and recorded completion states. Keep the editable requirements and their canonical calculations intact. The native disclosure supports keyboard operation and reduced motion.

File drag feedback uses the existing blue tokens and a small paper-stack treatment. Dragging over Documents highlights the target without opening it or moving the page; dropping still opens the existing labeling flow. Cancel restores upload-control focus, and ending a drag clears the highlight. File validation, categories, upload limits, read-only access and retry behavior remain unchanged. No deployment authorized.


## Readable interview reference and shorter handoff guidance (owner, 2026-10-31, local)

Supersedes the split interview's ruled two-column fact grid. Recorded facts use sentence-case labels above full-width editable answers, with no grid or uppercase labels that break into narrow stacks. Shared Notes retains a warm writing area and light ruling beneath the facts, independent scrolling, visible save/error feedback and the existing resizable split. Keep all question wording, answers, edit/review permissions and note persistence intact.

The owner requested phasing out instructional copy like the handoff's date and attachment paragraphs. Keep the short “Required before sending.” date hint, rename the file heading “Community files,” and remove the repeated description of checkbox behavior/defaults. The generated data sheet still identifies itself as always included; a selected medication list gets the short local reminder “Use a current, signed list.” Validation, file selection defaults, recipient authorization, warnings and send rules remain unchanged. Local preview only.

## Carelog task emphasis on Home and Workspaces (owner reference, 2026-10-31, local)

Use the owner's current Carelog Today and Groups screenshots as the visual reference. Home keeps its personal pins/recent order and compact category buttons. The first pin, or the first recent client when no pins exist, uses Carelog's outlined task tile, a single existing workflow illustration, a warm gradient at Resume and a small raised base. The remaining clients use compact joined rows; this replaces the equal-size three-column personal cards. This is visual prominence, not a new urgency ranking. All existing status words, document counts, owners, destinations and pin behavior remain intact. Expanded category lists retain their card layout.

The app rail uses simple outline destination icons and orange for its selected destination; the white P remains the Home mark. Workspaces keeps its existing filters and month/community navigation, with a warm column header and connected paper rows instead of disconnected gray cards. These choices supersede the earlier local selected-rail styling and warm individual directory rows. Phone targets, long labels, focus, reduced motion and existing access rules remain required. No added top bar, new copy, workflow changes or deployment.

## Compact decision controls (owner screenshot feedback, 2026-10-31, local)

Replace the square decision cards with compact, tactile controls. Each combines the existing outcome symbol and label; a stamped circle, pressed surface and corner check communicate selection together. The radio remains native and the entire control is its target. The reason still spans all three choices below them. No copy, permissions, confirmation, persistence or navigation changes. Motion follows the existing tokens and reduced-motion preference; forced colors retain a selection outline. This is a local visual iteration. The owner's subsequent question about removing Decision as a separate workflow step is a proposal under discussion, not an implemented navigation change.


## A working decision carried into review (owner, 2026-10-31, local preview)

The owner approved removing Decision as a separate primary journey step and earmarking Accept or Deny before the assessment is finished. The normal rail is Chart → Assessment → Placement. Decision remains a subordinate Chart action; its existing route, permissions, decision changes, history and administrative controls remain accessible. Training without a Chart retains its existing step sequence.

Preparation and the unsigned assessment share a compact bookmark using the existing saved recommendation. Its semantic color follows the choice. Accept, Deny and Under review remain available; an early Deny does not close the referral. Saving, failure and retry remain visible. The bookmark persists across reopening and cannot be silently abandoned during an unresolved save when leaving the workspace.

Signing opens the decision confirmation within assessment review. A matching saved recommendation from the current assessment becomes a compact confirmation with a seal, Change and Record acceptance/denial. That deliberate click replaces the duplicate confirmation dialog only in this exact case. A changed choice, no choice, or a recommendation belonging to an older assessment retains the full choice and confirmation path. An accepted save opens Meet the Client; a denied save offers Done. Signing, decision recording and sending remain separate operations. No assessment questions, eligibility rules, clinical data model or authorization rules changed.

Use existing motion tokens for the bookmark and confirmation seal; honor reduced motion. Reserve the bookmark's footer space before its data arrives. Reveal the signed confirmation in the center of the visible area so sticky headers cannot obscure the next action. Local preview only; no deployment authorized.


## Matching browser and installed-app icons (owner, 2026-10-31, local preview)

Use the sidebar's existing white Pipeline P on its dark green background for the tab and installed desktop icon. The generator reuses the canonical SVG and reads `color-night` and `color-paper` from the design tokens. Versioned PNGs replace the prior icon references in metadata, the manifest and the static cache; installed-app identity and scope remain unchanged. The browser tab uses a larger mark for small-size legibility. App icons retain the maskable safe area. Verified served metadata/assets, sizes, colors and maskable crops; desktop readiness and affected lint pass. Evidence: `.data/ui40-icon-check.json`, `.data/ui40-desktop-readiness.json`. Local only.

## Handoff step name (owner, 2026-11-01)

Rename the workspace destination Placement to Handoff, including its Chart entry, continuation links, page region and actions drawer. The normal journey is Chart → Assessment → Handoff. This is a label change only: existing routes, admission and placement-cancellation terminology, assessment questions, permissions and save/send behavior remain unchanged. Local only.

## Three Home priorities (owner, 2026-11-01, local)

Upcoming assessments, In progress, and Clients in handoff are the leading Home controls, with equal widths and heights on desktop and matching stacked rows on phones. Use the existing teal, blue and green token families, a stage-colored top edge, a count and a quiet open arrow. Each opens its existing modal. Personal pinned and recent clients follow; owner-only application activity stays below the work area.

Home's In progress group includes current intake, assessment and pending-decision work. Clients in handoff includes accepted active work only; closed, denied, cancelled and admitted work remains outside these active groups. This is Home presentation grouping, not a change to stored statuses, next actions, admission rules or permissions. Existing personal schedule scope, Mine/All folder scopes, pins and recovery remain intact. An unavailable source stays explicitly unavailable rather than displaying a zero count. Local only.

## Intake file access and checklist (owner, 2026-11-01, local)

New intake already exposes uploading and uploaded files in its document area, so omit the duplicate Files navigation until the workspace exists. Existing saved-workspace Files access and direct draft file routes remain available. The Document checklist button stays in the upload row, indicates its expanded state with a chevron, and opens or closes the same requirements below it. Enter and Space work as well as clicking. Checklist state only changes visibility; file selection, upload status and intake values remain intact.

Reserve the new draft's save-status line while it is quiet. Blur-triggered saving must not move the next control between pointer-down and click. Keep pending, device-only and failed-save messages visible. Local only.

## Remove Clients from primary navigation (owner, 2026-11-01, local)

Omit Clients from the shared sidebar and phone page menu. Keep the directory route, client records, existing direct links and access rules intact. This removes one navigation item; it does not delete client functionality or data. Local only.

## Three recent workspaces and an expanding calendar (owner, 2026-11-01, local)

Recent shows the latest three eligible workspaces from the viewer's existing personal history, excluding separate pins. Older active work remains accessible through In progress and Clients in handoff. Ordering, saved destinations, ownership and storage stay unchanged.

Upcoming assessments becomes a compact date-page object beside the two work categories, superseding its equal-size category card. It expands from that object into a personal weekly schedule and returns there on close. Reuse the existing calendar's Sunday–Saturday week, Pacific time, appointment ownership and destinations. Read the full calendar on opening; the Home summary's eight-item cap must not truncate the week. Previous/next week and Today stay inside the calendar. The summary shows 8+ at its cap rather than claiming an exact total. Keep unavailable distinct from empty, abort stale requests, support Escape/focus return, phones, keyboard access and reduced motion. This is a local iteration; no production deployment for this change.

## Compact Home category controls (owner correction, 2026-11-01, local)

Replace the rejected large illustrated tiles with small blue and green shapes containing only the existing label and count. Size desktop controls to their contents; keep phone controls aligned and allow the longer label to wrap. Do not add artwork, oversized numbers, extra icons or paper layers.

The existing folder expands from the selected control using the movement token and returns to it on close. Inside, use compact client rows instead of a grid of tall cards, preserving names, statuses, community, assessor, missing documents, planned admission, next action and pin access. All/Mine scope, routes and stored data remain unchanged. Honor reduced motion, keyboard focus return and small screens. Local only.

## Pull Chart from the assessment journey (owner, 2026-11-01, local)

Press and hold the actual Chart step in the progress rail, then drag and release to open a movable reference occupying roughly a quarter of a desktop viewport. The owner explicitly rejected an additional opener icon and clarified that this is a hold gesture, not a replacement for the normal click. A normal Chart click retains full-page navigation; Alt+C provides the keyboard alternative. Phones retain a plain Chart control because their compact progress menu has no draggable step.

Reuse the canonical chart and the assessment editor's current draft. The reference is read-only and nonmodal: intake facts, supporting records and current answers remain available while assessment inputs stay active. Omit workflow controls from this reference; they remain on the full Chart. Close it when leaving the assessment or switching clients. Panel position is session-only and never writes client data. Its header supports pointer dragging and arrow-key movement; opening honors reduced motion, and resizing keeps it on-screen. Keep all assessment questions, saving, scheduling, decision and send behavior intact.

One floating reference is the deliberate scope. Revisit panel sizing only if testing with actual chart content demonstrates that the fixed desktop size or phone fallback prevents usable reference reading. No production deployment for this change.

Hold reliability correction (owner bug report, 2026-11-01): keep the actual Chart step visible by default during the interview, while retaining explicitly saved collapsed/resized rail preferences. Pointer movement during the hold must not silently cancel it. Releasing a completed hold without dragging opens the same reference at its default position; a short click still navigates. Escape and pointer cancellation leave the assessment in place. Test the real interview as well as preparation.

## Compact record utilities (owner, 2026-11-01, local)

Files, Activity and Trash move out of the large rows below the journey into a small icon row under the client identity. Hide their repeated visible labels; retain accessible names, tooltips, current-page state and full touch targets. Separate Trash from the reference tools and keep its existing confirmation and permissions. On phones, Files and Activity remain in the existing view picker so the assessment header stays compact. Save/recovery controls keep their existing behavior and position. No new overflow menu, route, data or workflow changes. Local only.

## Consolidate the client path (owner, 2026-11-01, local)

The approved cleanup table makes assessment preparation the single continuation from the workspace-created notice. Booking stays inside preparation and never begins the interview. Chart retains its appointment and recorded-answer information, with one assessment entry instead of separate scheduling, unanswered-review and bottom-next shortcuts. Existing page-by-page and source-profile navigation remains available.

Keep the working decision, signing, and explicit decision confirmation sequence. Shorten repeated review and scheduling instructions; retain nonblocking unanswered status, save failures, signature confirmation, and rescheduling recovery. Handoff's existing administrative drawer uses a small, named control, leaving the email action primary. Cancellation, actual-arrival verification, permissions and confirmations are unchanged. Files and Activity remain reference tools beside the client identity. No question, storage, admission, sending or authorization rule changes.

## Movable Notes and paragraphs (owner, 2026-11-01, local)

The owner requested both a movable Notes panel and rearrangeable paragraphs. The Notes heading is the drag source; pulling it out of preparation or the interview opens the same editable note in a nonmodal window. Drop it onto its original Notes location, use the dock control, or press Escape to return it. Notes already opened from other workspace steps can be moved by the same heading. Enter lifts the embedded note and arrow keys move the window. Keep the window inside the viewport; phones use the available screen height above the keyboard. Position is temporary and never becomes client data.

Use an uncluttered writing surface, one Notes heading and existing save feedback. Blank lines define paragraphs; each paragraph has a drag grip and Move up/Move down controls, also available through the arrow keys. Enter creates a paragraph and Shift+Enter keeps a line within it. Native textareas preserve plain-text input, spelling and selection; do not introduce HTML, topic sections, new note records, or an editor dependency. Preserve the existing separators and text when rendering or reordering. The scope is plain-text paragraphs, not Notion's rich-text/database feature set; revisit that ceiling only if the owner requests formatting or embedded content.

Continue to use the shared client-note controller, authorization, encrypted recovery, save queue and conflict controls. A pending legacy-note consolidation remains explicit until acknowledged: deleting a carried-over paragraph must not restore it merely because the remaining text matches an earlier saved unified note. The encrypted draft carries that intent through an offline reload. Original legacy records remain intact; there is no database migration or API change. Verify pending edits through lift/dock, keyboard and touch ordering, exact persisted text, reload, long legacy notes, offline/lost responses, conflicts and read boundaries. Local only.

## Optional slash blocks and resizable Notes (owner, 2026-11-01, local)

The owner requested Notion-style slash sections and resizing in addition to movable Notes and reorderable paragraphs. Keep free writing first. At the beginning of a paragraph, `/` opens a searchable menu for Heading, Bulleted list, Numbered list, Checklist, Quote and Text. `section` finds Heading. Enter accepts a choice; arrow keys navigate; Escape dismisses only the menu and leaves the typed text. Ordinary URLs and slashes within prose remain literal. Headings start optional author-named sections; no clinical template, prefilled finding, required field or assessment question is introduced. Checklists belong to the note, not the referral's official readiness or admission status.

Formatting uses readable plain-text prefixes inside the existing unified note. The editor displays them as headings, markers and checkboxes; it does not render arbitrary HTML. Merely reading existing notes does not rewrite them. Preserve original content, exact separators, ordering, autosave, encrypted drafts, version conflicts and legacy consolidation. Enter continues list items, an empty item exits the list, Shift+Enter keeps a line, and Backspace at the start removes formatting before merging paragraphs. Full rich-text formatting, embedded media and automatic clinical templates remain outside this change; revisit only on an explicit request.

Floating Notes has a quiet lower-right resize grip with pointer and arrow-key access. Constrain the window to the viewport, cancel an active resize with Escape, retain pending text and keep the phone window fitted above its keyboard. Size is temporary UI state. Existing assessment layout dividers continue to size docked references.

Design evidence: the existing private aggregate from 2026-08-31 analyzed 310 unique historical assessment notes, 240 narrative and 70 structured, with domain labels in 168. This supports optional structure rather than mandatory sections. A fresh read of completed Pipeline notes was attempted but unavailable (database DNS and Azure exec connection failures); do not characterize this aggregate as a review of current assessor notes. No production record was changed. Local preview only.

## Saved headings, full-header drag and quieter Notes saves (owner correction, 2026-11-01, local)

Supersede the six-format slash menu above with section headings and bullet points only. Reuse the existing note-heading names from the assessment topics, Before the interview and Collateral and calls; selecting a saved heading places the cursor in a blank paragraph beneath it. Keep a custom Heading choice. Older checklist, numbered-list and quoted text remains literal and intact. No new clinical answers, assessment requirements or note records are introduced.

The whole Notes header is a drag surface, including its empty space and save status. Close, dock, hide and retry controls keep their normal actions. Retain keyboard movement through the existing Notes button, resizing and the fitted phone layout.

Server autosave waits for a two-second typing pause. Moving among paragraphs, selecting slash commands and reordering paragraphs does not flush a write. Leaving Notes or closing it flushes pending edits; hidden-tab and navigation recovery remain in place. A slow save acknowledgment respects the newer edit's typing timer, while an explicit flush drains the latest text as soon as the in-flight request completes. Encrypted local recovery still records pending edits immediately, and conflicts retain both copies. No database, API or authorization changes. Local preview only.

## Chart and assessment review reading pass (owner, 2026-11-01, local)

Replace the referral chart's bordered spreadsheet cells with an identity band and aligned groups of facts. Retain every field, empty-state label and visible pencil; editing still opens the canonical intake field. Use the same responsive presentation in the full chart and reference window. Long narrative fields span their available row. Assessment, Decision and Handoff remain in that order below the intake record, with compact status/action rows and the existing expandable assessment record. Empty stage bodies no longer create blank space.

Assessment review groups the assessor, formatted date and answer count with its collapsible section index. Section progress uses the actual recorded/visible question counts. A section link opens its first unresolved field in preparation or interview according to the existing field owner; completed sections can still be reopened. Keep the nonblocking missing-answer notice and signing explanation, with the latter after the recorded answers. No questions, completion rules, signatures, decisions, permissions or send behavior change.

The shared chart text renderer displays existing heading prefixes, flat bullet lists and numbered lists, while preserving plain paragraphs and escaping all HTML. Stored answers are never rewritten. This is deliberately a small reading formatter, not a rich-text editor or a full Markdown parser; revisit only if nested formatting is explicitly requested. Local preview only.

## Preview files before adding; one medication upload location (owner, 2026-11-01, local)

The existing file-label dialog previews the first dropped or chosen file and lets staff switch or collapse previews while choosing document types. PDF and supported raster-image previews use temporary browser object URLs, revoked when closed or switched. Plain text is escaped and limited to its first 256 KB for display; original upload bytes remain untouched. Other formats retain the existing upload path with an unavailable-preview message. PDF framing requires a PDF signature and the existing document-preview MIME allowlist; CSP permits blob frames for these local previews without allowing blob scripts or object embeds. No preview uploads, extraction, new dependencies or storage changes. Office/HEIC rendering remains outside this browser-native preview; revisit only if those formats require in-app pre-upload viewing.

Remove the duplicate Medication list section at the bottom of intake. Medication uploads and the document checklist remain in the top file area. Existing typed medication history moves alongside that area with its original field and save-on-blur behavior intact. No medication data, files or checklist requirements are removed. Local only.

## Notes cadence, writing headings and direct chart edits (owner, 2026-11-01, local)

Wait five seconds after the last note change before server autosave. Dirty text shows a quiet Unsaved changes status; Saving appears only while a request is in flight. Retain immediate encrypted local recovery, save-on-leave/close/hidden-tab, serialized writes, lost-acknowledgment recovery and conflict controls. Moving between paragraphs, using slash commands and reordering remain within the same idle window.

Replace assessment-topic slash presets with optional writing headings: Client report, Observations, Staff / case manager report, History & timeline, Medication follow-up, Records to clarify, Placement preferences and Follow-up questions. Keep Bullet points and a custom Heading. These were inferred from a read-only review of 12 production note blocks attributed to Vince, dated September 28–October 30, 2026: short interview notes mixed client statements, observations, case-manager accounts, discrepancies, preferences and unresolved questions. The headings insert no answers and do not reformat existing notes. Keep legacy note keys and consolidation intact. No patient content is included in this design record.

Remove repeated pencils from chart facts and captured assessment answers. The displayed value opens its existing editor; hover and keyboard focus identify the target. Keep the chart's main Edit referral details control, a 44px minimum target, accessible Edit labels, current values as accessible descriptions, and return focus after editing. Preserve formatted narrative display and text selection. Read-only references remain read-only. This changes local interaction and presentation only, with no schema, permission, clinical-content or production changes.

## Recent work replaces pinning (owner, 2026-11-01, local)

Remove client pinning from Home and the expanded work folders. Recent contains the signed-in user's six most recently opened eligible workspaces: the first uses the existing featured resume card, with five compact rows beneath. A shorter history shows only the workspaces actually visited. Older work remains in In progress or Clients in handoff. This supersedes the earlier pinned-first and three-recent decisions.

Keep the existing per-user visit order, saved resume locations, active-work filtering and authorization. Retire pin controls, state fields and pin mutations; previously saved pin preferences are ignored while the rest of the user's continuity record still loads. No client records or workflow rules change. Remove the space reserved for pin buttons; preserve the existing Carelog styling and responsive hierarchy. Local only.

## Admissions briefing clarity (owner, 2026-11-01)

Use Pipeline's compact type scale, warm section headers and existing green/blue stage accents for the admissions report. Keep the census bars and client drill-downs. Origin remains visible; county, prior placement and assessor remain in an expandable detail group rather than a repeated prose line.

The owner removed the separate “Did not move in” category from this briefing. Keep it focused on census, admissions and clients moving toward admission. Existing placement outcome records remain in their workspaces; no admission status, counts or history are rewritten. The report does not load cancellation correspondence.


## Chart, preparation and interview (owner, 2026-11-01, local)

Chart remains the cumulative client record. Assessment preparation uses the existing assessment form to build that record before the interview. The interview completes the same assessment; facts, notes, provenance and verification state carry forward without copying or re-entry. The Decision shortcut belongs under Assessment, alongside its review and confirmation flow, rather than under Chart. Completed decisions remain part of the chart history.

Intake opens Chart, with a compact creation confirmation and an illustrated Assessment prep action above the record. This action opens the canonical assessment questions as the Chart's preparation view, keeping Chart selected. The existing assessment preparation route still owns section position and recovery; there is no second form or copy of the assessment. Opening Chart alone does not create an assessment. Entering editable preparation opens its existing draft or creates the first draft once, after history and permissions load. Failed history reads cannot create a replacement.

Scheduling and Start interview live together above preparation. The owner’s November 2 refinement removes the redundant Chart back button and stacks smaller, equal-width interview actions; the workspace navigation still returns to Chart. Reopening Chart shows the booked appointment and Begin interview (Continue interview once started). Booking never starts the interview; neither booking nor completed preparation is a prerequisite. Start uses the canonical save/start command and opens the focused interview under Assessment. The existing gap filter asks unanswered or unverified questions; recorded answers remain editable in the reference. Editing a prepared fact returns to preparation, and Continue interview does not record another start.

Source files and Notes remain beside preparation and the desktop interview. Files use the canonical workspace inventory with collapsible previews and an Open Files action for uploads and management; the duplicate uploader below Chart is removed. Phones retain paged questions and their Notes control, with file previews in Client info during the interview. Standalone assessment surfaces without a workspace inventory retain the existing twelve-file convenience fetch; Open Files remains the complete inventory. Preserve question wording, signing, working decision/confirmation, email rules, permissions, save queues, conflict handling and recovery. Local only; no schema or data migration.

## Restore Notes size (owner, 2026-11-01, local)

The floating Notes header ends with an inward-arrow control to restore its original dimensions. Resizing and restoring keep the current position and note content; existing viewport bounds still apply. Docking resets the floating size. Phones use the available viewport and omit resize/reset controls. No save-cadence or storage changes.


## Decision before the Handoff signature (owner, 2026-11-02, local)

Finishing the assessment saves its answers and opens Decision. A matching working decision offers one explicit confirmation before signing, with Change still available; an earlier assessment's recommendation does not count as that confirmation. Recording acceptance opens Handoff, where Confirm chart shows the existing intake details and assessment answers. Signing uses the same assessment signature command, conflict checks and audit trail, then reveals Meet the Client in Handoff. There is no required assessment-review detour before the decision and no return to Assessment after signing. An already signed assessment opens Meet the Client directly. Denied and under-review decisions keep their existing outcomes and do not open an email.

Reuse the kept-mounted assessment editor for Handoff confirmation; no second draft or signature implementation. Reopening an accepted, unsigned client in Handoff returns to Confirm chart. Corrections can still open the original question or intake field and return to Handoff. A failed signature stays on confirmation, and a failed decision stays on Decision. Retain signature requirements before email, recipient authorization, explicit send, permissions, provenance, save/recovery handling and server validation. No schema, admission-rule or production changes.

## Meet the Client reading order (owner, 2026-11-02, local)

Place the Meet the Client title immediately above the name and identity details in the working message and email. Omit assessment date from that identity block; keep it in the assessment record. Put the client introduction before Admission & coordination by default. Preserve sender-saved section orders and custom messages. No send, signature, packet-selection or data changes.

## Compact interview entry and signing confirmation (owner, 2026-11-02, local)

Replace the stacked preparation buttons with inline text actions: Schedule interview or Start now. Keep comfortable touch targets, visible keyboard focus, the booked appointment and existing edit, continue and retry states. This supersedes the stacked-buttons refinement above. Preserve booking and interview-start commands and their save protections.

Keep the explicit Sign assessment label. Its confirmation reuses Pipeline's compact decision-dialog styling, with the existing assessment illustration and orange confirmation action. Keep the same confirmation text, Cancel/Escape behavior, focus handling and signature command. Local only.

## Chart completeness confirmation (owner, 2026-11-02)

Replace the Sign assessment action with Confirm chart. The confirmation asks “Everything correct and included?” and continues with Confirm & continue. This supersedes the earlier explicit signing-label decision. Preserve the canonical assessment confirmation/signature command, saved timestamp, permissions, conflict checks and audit history; only its user-facing purpose and wording change. Acceptance still precedes this Handoff confirmation, and sending remains separate.


## Equal recent workspaces (owner, 2026-11-02)

Title the Home section “Recent workspaces” and use the same compact row layout for every recent workspace. Remove the first workspace’s featured illustration, larger type, extra spacing and separate surface. Rows share equal height while allowing long names to wrap. This supersedes the featured-first presentation; keep the existing six-workspace limit, personal visit ordering, eligibility and saved Resume destinations.

## Interview actions at both ends of preparation (owner, 2026-11-02)

Repeat “Schedule interview or Start now” above and below preparation, keeping the same teal underlined text style with more prominent type and comfortable touch targets. Both locations use the existing scheduling and interview commands, including their edit, continue and retry states. Keep the appointment summary and tutorial anchor at the top; preserve permissions, draft saves and start semantics.
