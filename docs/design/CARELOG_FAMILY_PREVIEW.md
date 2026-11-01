# Carelog family — local Pipeline preview

Owner request, 2026-10-30: use Carelog's design system with Pipeline's current workflows, click paths, and information organization. Local evaluation only.

## Source and scope

- Pipeline base: deployed/main `0e384174b006e44562676513102a4aca29bfe739`.
- Carelog reference: `CareConnector` at `5e549b6`, from the current `carelog-workflow-plan` worktree. Consulted `web/src/ui/tokens.css`, `base.css`, `components.css`, `workspace.css`, the current adaptation notes, and its synthetic resident/agenda screenshots.
- Branch: `codex/pipeline-carelog-design`. The original Pipeline checkout and production are untouched.
- Font: self-hosted IBM Plex Sans Variable, with its license beside the font.

The common visual language is the dark teal rail, visible navigation labels, white working canvas, warm client cards, IBM typography, orange next-action buttons with dark borders, restrained elevation, and readable controls. Pipeline stage, warning, error, saved, and clinical-status meanings remain separate from the orange action color.

## Second pass: pictures and interaction

The owner requested more of Carelog's illustrated identity and animation. The reference includes `service-identity.tsx`, `service-identity.css`, `area-stack.css`, and the interaction rules in `components.css`. A small shared decorative SVG component supplies folders, calendars, client records, intake, assessments, decisions, and reports. It is used by the existing navigation, home tabs, and board headings. These pictures identify objects; they do not claim a clinical outcome or completed task. The existing labels and accessible names remain intact.

Press, selection, entry, and confirmation use Carelog's 60/120/160/180ms timing tokens. Art responds to focus and pointer interaction while controls retain their hit boxes. The home panels use a short lateral transition; the existing folder expansion retains its source origin. Notes, page menus, and dialogs settle into place. The save check draws only when the existing save owner reports saved. Reduced motion disables these movements. There are no animation dependencies, timers, or delayed network actions.

The second pass also repairs low-contrast phone menu text inherited from the dark desktop rail. The phone menu was scanned separately while open.

## Icon accuracy and larger actions

The next owner pass distinguishes incoming assignments (an inbox) from New Intake (a clipboard with an add mark). Assessment uses a written record and pencil; Decision uses document review, without implying that a decision is already approved. Clients uses multiple profile cards. Folder, calendar, and report pictures retain their familiar objects. All eight pictures were inspected at 28, 40, and 64 pixels; they remain decorative beside the existing labels. Navigation uses 40px pictures.

Main actions use a shared 56px minimum height, including assessment paging, Record decision, and email preview. Supporting handoff controls use 48px targets. Board actions occupy a full row beneath the assessor; the card remains a single keyboard/click target. At narrow widths, excess board padding is removed, labels wrap at words, and the assessment save/date footer wraps by control instead of breaking its text. The phone Notes control clears the paging bar.

This pass passed the build, changed-file lint, token ratchet, desktop/phone accessibility scans, and layout checks at 1440/390/320px. Primary action heights were measured in the browser. Phone section navigation, Notes opening/closing, and focus restoration passed at both narrow widths. Keyboard panel selection, sidebar selection, dialog closing, reduced motion, and phone navigation passed again. Evidence: `.data/carelog-pass3-icons.png`, `.data/carelog-pass3-layout.json`, `.data/carelog-pass3-*.png`, `.data/carelog-pass3-visual.log`, and `.data/carelog-pass3-build.log`.

The existing fixed-position Notes control is retained. Its phone clearance accounts for the current paging and save/date bars; adding another persistent footer row is the trigger to place the control within a shared footer layout rather than add another offset.

## Fourth pass: choices, files, and scheduled work

The additional Carelog review covered choice controls and action rows in `web/src/ui/components.css`, document selection in `documents.css`, and its empty-state presentation. The useful patterns are applied to the existing Pipeline controls:

- Yes/no/unable answers, ratings, and multiple selections share one component-owned style: 56px targets, readable values, a dark selected edge, and a warm selection tint. The old global, desktop, and phone choice overrides were removed so they cannot shrink the type or produce inconsistent corners. Questions, options, conditional fields, disabled states, handlers, and recorded values are unchanged.
- Community file selection is a document list with clear filenames and quieter metadata. Each native checkbox has a 48px label target, separate from the existing download link. Selected and partially selected groups have a visible edge. The mandatory data sheet, LIC grouping, defaults, warnings, and recipient authorization remain owned by the existing logic.
- Upcoming assessments use aligned date, client, and action columns, with calendar illustrations and 56px action areas. The entire row remains one button with its original destination. Calendar and assignment empty states use their matching shared illustrations instead of unrelated icon tiles. Existing wording is retained.
- Notes clears the phone preparation paging bar as well as the interview bar; open/close and focus return were checked at 390px and 320px. Preparation also keeps its section picker within the available width and its progress ring circular on phones.

Validation: build, changed-file ESLint, token ratchet, and diff checks passed. Targeted browser checks at 1440/390/320px cover the appointment destination, choice sizing, one-row ratings, file checkbox targets, accessibility, and horizontal overflow. Keyboard answer selection, conditional fields, answer save/reload/review, multiple-choice save/reload, file selection persistence, and email preview passed. Edited synthetic answers and file selections were restored; no email was sent. Reduced motion and forced-color focus were checked. Both empty states were checked at all three widths using read-only browser fixtures. The six-screen desktop/phone accessibility scan also passed. Evidence: `.data/carelog-pass4-results.json`, `.data/carelog-pass4-additional.log`, `.data/carelog-pass4-visual.log`, `.data/carelog-pass4-build.log`, and the corresponding screenshots.

The first four passes are presentation changes. They do not change routes, event handlers, assessment wording, save behavior, permissions, workflow transitions, API handlers, persistence, document selection rules, or outbound integrations. The desktop scrolling questionnaire and the existing phone question flow remain intact. The application and workspace navigation have the same destinations.

## Fifth pass: readable forms and movable Meet the Client sections

The owner requested distinct, readable intake and assessment forms and a document-style Meet the Client page. The owner explicitly chose to apply section order to both the working page and outgoing email.

- Intake uses a blue registration sheet, two spacious columns on desktop and one on phones, sentence-case 16px labels, and 56px native inputs. Assessment uses its rose family, 19px question labels, larger writing areas, and clearer spacing between groups. The existing questions, answers, conditional fields, and save owners are unchanged. Superseded global intake overrides were removed in favor of the intake component's stylesheet.
- Meet the Client displays its email content as a working document alongside files and recipients. Existing clinical sections have drag handles and Move up/Move down controls; keyboard focus returns to the moved handle, and Escape closes its menu. Phones use the same move controls and stack the document and sending controls.
- Section order is an optional, validated full permutation in the existing versioned handoff draft. Old drafts keep their original order. One canonical section model supplies the working document, HTML email, and plain-text email. Identity, admission date, recipients, attachments, secure packet links, and confidentiality information remain fixed. No schema migration, new save endpoint, or dependency is needed.
- Previously edited message text remains one intact Message block. It is not heuristically split into clinical sections or replaced with generated text. The mandatory medication attachment reference is preserved. The deliberate ceiling is that freeform legacy text can move as one block; separately editable custom blocks would require an explicit structured-content design and migration.

Focused evidence: strict order validation, legacy drafts, preservation and escaping of all generated content, HTML/text ordering, and custom messages passed. The delivery suite, including the three new order tests, passed with 87 tests passing and one environment-gated historical PostgreSQL assessment-addition check skipped. The delivery suite's temporary PostgreSQL admission-packet adapter check passed. No real email was sent.

Browser checks passed for native drag, keyboard movement, focus return/Escape, saved reload order, immediate workspace exit/save, actual email-preview ordering, invalid-order rejection (400), and stale-version rejection (409). An injected save failure retained the changed order, prevented preview until recovery, and saved correctly on retry. All synthetic draft changes were restored. Assessment edit/blur save/reload/review and restoration passed. The move menus passed accessibility and overflow checks at 1440/390/320px. The six-screen desktop/phone scan, TypeScript, changed-file ESLint, production build, design-token ratchet, and diff checks passed. Evidence: `.data/carelog-pass5-results.json`, `.data/carelog-pass5-*.log`, and `.data/carelog-pass5-*.png`.

## Sixth pass: notes, recipients, and file labeling

The next Carelog comparison focused on its side panels, document labeling, and recipient controls. Pipeline's floating Notes panel previously reserved most of its height as empty space below a short textbox; compact recipients squeezed addresses beside the To/Cc label; file labeling used small controls and scrolled its actions with the document list.

- The floating note now uses the panel as its writing surface, with a warm background, larger close target, and room for long notes to grow and scroll. The existing inline assessment note layout and note save/conflict owners remain intact.
- Compact recipient lists use full-width address rows, readable identities, 48px add/remove targets, and bordered 56px address inputs. The handoff list shows more recipients before scrolling. Existing suggestions, keyboard entry, authorization, draft saves, and recipient removal are unchanged.
- File labeling has larger native category selectors, clearer filenames, a scrolling file list, and visible header/footer actions. Its orange Add files action retains the existing category requirement and disabled state. Native dialog behavior, upload validation, and upload handlers are unchanged.
- The preceding logo request uses Pipeline's existing P at 42px with the same white filter treatment as Carelog's mark. Collapsed/expanded navigation and keyboard home behavior were checked.

This pass changes component CSS only. Production build, design-token ratchet, and diff checks passed. Browser checks covered Notes growth/save/reopen, recipient keyboard add/remove/save/reload, category validation, long file batches, modal cancellation, and focus restoration. Nine targeted accessibility/overflow checks passed at 1440/390/320px. A separate 320×568 check confirmed that Notes fits the viewport, the final file remains reachable, and upload actions stay visible. Reduced motion and forced-color keyboard focus passed. Screenshots were inspected after entry animation settled. Synthetic notes and recipients were restored; no files were uploaded and no email was sent. Evidence: `.data/carelog-pass6-results.json`, `.data/carelog-pass6-additional.json`, `.data/carelog-pass6-check.log`, `.data/carelog-pass6-build.log`, and `.data/carelog-pass6-*.png`.

## Profile-only lower sidebar

The owner requested that the lower sidebar contain only the profile control. Tutorials and local demo controls now live inside the existing profile menu, with their original handlers and labels. The duplicate phone-only assessment-lab entry was removed. Profile settings, Trash, account switching, and the existing administrator session controls remain available. TypeScript, changed-file ESLint, design-token and diff checks passed; desktop/phone menu access, tutorial opening, keyboard focus, and the desktop accessibility scan were checked.

## Try it locally

The owner rejected the horizontal top-navigation experiment. It has been removed from the local preview, including the horizontal client-stage strip. The compact illustrated app rail and existing client navigation are restored; prior form, Notes, recipient, and movable-message work remains. The restored navigation passed TypeScript, changed-file ESLint, and isolated checks for rail expansion, profile access, and Meet the Client. No production deployment was made.

From this worktree, run `node scripts/persona-demo.mjs --port=3308`.

Open <http://127.0.0.1:3308/>. The canonical persona launcher discards inherited production credentials, restricts the server to loopback, and uses isolated local storage under `.data/persona-demo-3308`. The preview has synthetic referrals and the existing supervisor/assessor persona switch. Email and clinical integrations are disconnected. Data entered here is local and persists between restarts.

Useful synthetic cases:

- Referral 1: chart and preparation.
- Referral 5 or 6: an interview with notes and saved answers.
- Referral 10: accepted, with Meet the Client available for preview.
- Referral 12: signed assessment, ready for decision.

## Evidence

- Production build and TypeScript: passed.
- ESLint on changed TSX files: passed.
- Design-token ratchet: passed, no new hardcoded-style regressions; baseline unchanged.
- Existing handoff/resume suite: four passed, including 1440px and 390px, reopen, explicit earlier navigation, and delayed-load navigation protection.
- Existing quick-recommendation checks: desktop and phone passed, including failure recovery and reload persistence. A temporary fixture copy substitutes the isolated demo's Jordan Lee identity for the suite's production-roster fixture; assertions are unchanged.
- Direct browser check: answer blur save, reload persistence, review display, editable field access, and return to the questionnaire passed.
- Axe WCAG A/AA scans: home, workspaces, intake, assessment, handoff, and completion at 1440px and 390px reported no serious/critical violations. None had document-level horizontal overflow. Screenshots were visually inspected for the affected working views; calendar was also inspected.
- `git diff --check`: passed.

Second-pass evidence: production build, changed-file ESLint, token ratchet, and diff checks passed. The six-screen desktop/phone accessibility and overflow scan passed again. Targeted browser checks passed for keyboard tabs and inert inactive panels, click-only sidebar expansion, stationary press targets, folder Escape/rapid close and focus restoration, notes opening and focus restoration, reduced motion, forced-color icon visibility, and phone calendar navigation. Editing an existing synthetic assessment answer, saving on blur, reloading, reviewing the persisted answer, and restoring its original value also passed. Meet the Client retained its existing recipient-authorization check; preview and close passed with no send requests. No assessment was signed or email sent.

Additional local evidence: `.data/carelog-pass2-interactions.json`, `.data/carelog-pass2-save.cjs`, `.data/carelog-pass2-visual.log`, `.data/carelog-pass2-build.log`, and `.data/carelog-pass2-*.png`.

Local evidence is in `.data/carelog-visual-results.json`, `.data/carelog-*.png`, `.data/carelog-build-final.log`, and the local check scripts. It is synthetic and is not part of the shipped application.

One existing review-summary test is stale: it expects previous/next section pagination and an answers-by-section list that the deployed desktop scrolling/review flow no longer renders. `AssessmentWorkspace.tsx` is byte-identical to the deployed base. The test was not weakened or changed; the current review and return flow was exercised directly. This is not a claim that every repository test passed or a release certification.

## Deliberate boundary

The trial maps Carelog values into Pipeline's existing token owners and presentation components rather than creating a cross-repository runtime dependency. This permits local comparison without changing either application's build or release ownership. Its ceiling is manual synchronization of design tokens. If the owner approves this visual direction for both applications, establish a versioned shared token artifact before the next coordinated design-system change. No shared workflow or clinical logic is proposed.

No PR, push, or deployment was performed.


## Pass 7 — navigation with one visible state

The owner rejected a top bar and asked to reduce redundancy and make destinations obvious. This pass keeps the app rail on the left and makes it fixed and labeled. It does not introduce a new top navigation row.

The audit found four competing signals: Home was a logo-only destination; expanding the rail revealed text already visible in the local design; workspace stage status circles looked like the navigation itself; and a second progress bar repeated the same completed stages. Orange selected destinations also competed with the next action.

- Home is labeled under the existing white P. Workspaces, Calendar, Clients, authorized Reports, and New Intake stay available with their existing routes and authorization. The redundant expand/collapse state, overlay, and arrow are removed. New Intake is separated from destination navigation. Profile remains the only lower control, with tutorials and practice controls inside its menu.
- Selected app navigation is a quiet dark surface. Orange remains the action treatment.
- Chart, Assessment, Decision, and Placement use distinct object illustrations and 56px targets on the desktop client rail. Their existing completion states sit separately at the right. The duplicate mini progress bar and decorative Home carousel grip are removed.
- Files and Activity stay reachable; Trash is visually quieter and retains its existing confirmation. The assessment rail's drag handle, phone navigation, draft guards, autosaving, and review/send actions keep their existing owners.
- Profile Escape returns focus explicitly, including WebKit. The presence dot is anchored to its icon instead of the button's former dimensions. Tablet save status keeps its icon and text together.

No assessment text, clinical rule, outgoing message content, data storage, or production configuration changed in this pass. The UI reuses existing labels. This is a local navigation iteration, not a claim that the entire application has finished design review. Board and Workspaces remain distinct: the board provides next work; Workspaces provides searchable history. Revisit that distinction only if local testing shows people cannot tell which destination they need.


Pass 7 evidence: production build, TypeScript, changed-file ESLint, and design checks passed. The final navigation run passed all 41 Chromium/WebKit and responsive tests; the earlier handoff run passed all 17 resume/exit/recovery checks. Two initial WebKit focus failures were repaired and passed in the final run, with an additional phone check that Escape leaves the parent page menu open. Isolated screenshots and axe checks covered Meet the Client at 320, 390, 834, 1024, and 1440px with no serious/critical violations or document overflow. Assessment questions and persistence were not reimplemented; a complete release gate has not been run for this local design iteration.

Artifacts: `.data/carelog-navigation-final-e2e.log`, `.data/carelog-navigation-e2e.log`, `.data/navigation-final-a11y.json`, `.data/carelog-navigation-review.png`, `.data/carelog-navigation-home.png`, `.data/carelog-navigation-build.log`, `.data/carelog-navigation-types.log`, `.data/carelog-navigation-lint.log`, `.data/carelog-navigation-design.log`.

## Pass 8 — questionnaire, intake, review, and Meet the Client

The owner requested a questionnaire once-over and then a fuller Carelog pass with distinct visuals and motion. The audit found tiny writing guidance, no visible disclosure icon, repetitive nested review panels, excessive question spacing, and three full-width yes/no choices on phones. It also reproduced a real entry defect: the section picker named the requested topic while its questions remained below the viewport.

- Assessment topics now use distinct 64-unit object drawings in the existing illustration owner: identity card, conversation, daily living, health, medication, home, history, recovery, safety, legal support, connections, and additional notes. The native section picker and the existing question sections retain their labels. Intake has its own illustrated blue header; the review heading uses the document-review picture.
- Large answer controls remain. On phones, Yes and No sit together above Unable to assess. Question spacing is tighter without reducing the clinical labels or answer choices. Writing guidance uses a book icon and a visible expand arrow, with readable token-sized text throughout and unchanged guidance content.
- Review separates facts, recommendation, signing explanation, and the record with spacing and rules instead of nested panels. Existing review, signature, decision, permissions, and send behavior remain.
- Meet the Client sections have object illustrations and animate into their new position when reordered. The existing canonical section order still controls the working page and outgoing message. No icons are injected into clinical email content. Keyboard move controls, save/version validation, retry, and preview behavior remain intact.
- Motion follows Carelog's short action feedback: section identity settles in, answer checks draw, writing guidance opens, and reordered sections move. There are no repeating decorative animations. Reduced motion disables these transitions; clinical inputs are never remounted to animate a transition.
- Section entry now waits for the loaded questionnaire to mount. Exact question targets retain priority. The assessment becomes interactive only once the parent draft recovery finishes, so a restored question can actually receive focus. The scroller's existing sticky-header allowance is no longer doubled by section margins.

Local evidence: production build (including TypeScript and question/conditional contracts), changed-file ESLint, design-token check, and diff check passed. Six focused browser regressions passed: desktop/tablet section links and saved-question reopening, real phone save/reload, signing with internal navigation, captured-answer autosave, and conditional follow-ups. Twenty ready-state visual/accessibility checks covered intake, preparation, interview, review, and Meet the Client at 320, 390, 834, and 1440px, with no document overflow or serious/critical axe findings. The existing message-order rehearsal passed keyboard and drag movement, reload, conflicts, failed save/retry, immediate exit, email preview order, and 48px move controls; the synthetic draft was restored and no email was sent.

Artifacts: `.data/carelog-questionnaire-build.log`, `.data/carelog-questionnaire-lint.log`, `.data/carelog-questionnaire-design.log`, `.data/carelog-questionnaire-e2e.log`, `.data/questionnaire-pass8-visual.json`, `.data/carelog-questionnaire-reorder.log`, `.data/carelog-pass8-assessment-final.png`.

This is local UI work. No assessment question, clinical definition, provenance rule, database schema, or production configuration was changed. A full release gate remains a separate deployment boundary.

Pass 8 motion evidence: Chromium and WebKit both passed section navigation, animated reorder/save, and reduced-motion checks. Section motion is 260ms and reorder motion uses the same token; reduced motion produces no section animation or reorder animation. No page errors were recorded. The synthetic message draft was restored after each check. Evidence: `.data/carelog-pass8-motion.json`.

## Pass 9 — connected workspace timeline

The client rail previously showed disconnected destination buttons, a separate tiny status dot, and no event dates. It now connects the existing Chart → Assessment → Decision → Placement destinations with numbered stops. Recorded completion changes the appropriate stop to a check; the page being viewed has its own top edge, background, and arrow. Opening a later page does not complete an earlier step.

The rail reuses the existing illustrated icons, status wording, date formatter, planned-date helper, and assessment status helper. It shows referral creation, assessment start/schedule/signature, decision, and planned or recorded admission dates when available. Cancelled and declined outcomes use a neutral completed marker. The Chart stop does not claim that every intake field is complete. A planned date never becomes a confirmed admission in this presentation.

Desktop gets 248px for the timeline; the draggable interview rail keeps its saved width and existing 160px minimum. A container query adapts the timeline to that width. Phones retain the compact native picker. Buttons keep their original accessible names, add status/date descriptions, and continue through the same save-aware navigation handler. Motion uses existing tokens and is disabled for reduced motion.

Local validation: production build, TypeScript, affected ESLint, design-token ratchet, and whitespace checks. Isolated headless Chromium/WebKit checks cover 320, 390, 834, 1024, and 1440px; keyboard navigation; unchanged progress when navigating; phone selection; reduced motion; and accessibility scans. Read-only browser fixtures also cover admitted and cancelled outcomes and an accepted decision with an unsigned assessment; the signature remains independently incomplete. Both engines passed the 160px draggable-rail and Files/Activity navigation checks. Evidence is in `.data/rail-pass9-*`. No production changes or release claim.

This is a compact current-state timeline, not an audit-history viewer. Activity remains the canonical full history. Extend the timeline only if staff need an additional recorded milestone; do not infer missing dates or completion from navigation.

## Pass 10 — Home action hierarchy

Owner correction: the repeated client actions on Home should not all be orange. The shared client-card action now uses a white surface, thin outline, and teal text; hover and keyboard focus use the existing soft teal token. The same component supplies expanded-folder cards. Upcoming-assessment actions use that same quiet hover treatment. Large targets, labels, card navigation, status colors, and primary workflow actions retain their existing owners.

Verified in isolated Chromium and WebKit at 1440px and 390px: neutral card actions, visible keyboard focus, expanded folders, Enter opening the client workspace, no page overflow, and no serious/critical accessibility findings. Design-token and whitespace checks pass. Evidence: `.data/home-button-hierarchy-*`. Local only.

## Pass 11 — Activity hierarchy and purposeful action color

Owner correction: removing orange did not mean making every action white, and the workspace Activity page was still a dense text log. This supersedes Pass 10's white client-card actions. Home and expanded-folder actions now use their existing tan, blue, and violet board families, with darker hover/focus tints. Upcoming assessment actions use the existing blue family. Primary workflow actions retain orange.

Activity uses a compact illustrated people header, day markers, a connected event timeline, and distinct illustrations for assessment, schedule, documents, decisions, and placement events. Lifecycle events carry stronger type and a soft object tint; referral status synchronization rows are visually quieter. The main timeline uses the existing workflow label vocabulary instead of raw status codes. Detailed history keeps original before/after values, provenance, masking, reasons, and restore controls. No audit rows were merged or removed; synchronized rows remain separate because no stored correlation ID proves they are one event. Day grouping and event order retain their existing owners.

Validation: production build, TypeScript, ESLint, design-token ratchet, whitespace checks; the two existing desktop/phone activity tests were extended to cover readable status labels and preservation of both synchronized audit rows and raw detailed values. Both pass, including masked-data checks. Headless Chromium and WebKit at 1440px and 390px passed Activity/Home visual and accessibility checks, keyboard disclosure/navigation, complete history counts, and page-overflow checks. Evidence: `.data/activity-pass11-*` and `.data/home-pass11-*`. Local only.

## Pass 12 — fewer repeated Home icons

Owner correction: Home repeated the same illustrations across app navigation, tabs, column headings, and card details. The main navigation keeps its distinctive illustrations. Home tabs and board headings now use their existing labels and counts; the completion ribbon drops its decorative clipboard. Client cards retain names, assessor text, document counts, milestones, and colored actions while removing the repeated document glyph and initial avatar. Action arrows and the phone picker chevron remain functional cues. Expanded-folder cards use the same shared card; their single dialog illustration remains.

No labels, click paths, data, or save behavior changed. Existing stage colors and large controls remain. Removed unused imports, the avatar helper, and obsolete icon CSS. Headless Chromium and WebKit at 1440px and 390px passed tab keyboard navigation, folder opening/Escape/focus return, client-card navigation, icon-presence checks, stage-color distinction, overflow checks, and accessibility scans without serious/critical findings. A first test run assumed the desktop rail existed on phones; the corrected test explicitly checks the existing phone page-menu control. ESLint, design-token ratchet, and whitespace checks passed. Evidence: `.data/home-pass12-check.*` and `.data/home-pass12-*.png`. Local only.

## Home category controls — owner scope correction, 2026-10-31

The owner limited this pass to Board, Upcoming assessments, and New assignments. The rejected broader card, schedule-row, and assignment-row changes were restored from the pre-pass snapshot. Only the category-control styles differ from that snapshot: existing Carelog illustration tokens provide soft ochre, blue, and sage surfaces; a dark outline and dark count identify the selected view. Labels, counts, icons, panels, and navigation behavior retain their existing owners. No new icons or copy were added.

Validation: exact snapshot comparisons confirm restoration of the four broader component files and all CSS after the category controls. Eighteen Chromium/WebKit states at 1440, 390, and 320px passed keyboard navigation, target-size, reduced-motion, overflow, and accessibility checks with no serious/critical findings. An initial test focused an unselected tab programmatically; the corrected setup selects Board before exercising its arrow-key navigation. The design-token and whitespace checks passed. Evidence: `.data/home-category16-check.json`, `.data/home-category16-design.log`, and `.data/home-category16-*.png`. Local preview only; no deployment.

## Home modal shortcuts — owner correction, 2026-10-31

The owner replaced the category-switch request with a smaller Upcoming assessments control opening a modal. Home now keeps the board visible and provides compact Upcoming assessments and New assignments buttons with counts. Both reuse HomeDialog and the existing lists. The carousel, hidden panels, swipe handlers, and obsolete tab styling were removed. Module customization, assignment acknowledgment, and appointment destinations retain their existing owners. The schedule now renders all appointments supplied by the existing Home endpoint (currently capped at eight), matching its count; Calendar remains the full schedule.

Decision status chips use the requested green/accepted, red/denied, and yellow/pending-review tokens, retaining their recorded labels. The shared card owner applies this in the board and expanded folders. No clinical state, workflow rule, save behavior, outgoing message, or production configuration changed.

Nine focused browser tests passed for desktop/tablet/phone modal entry, Escape/focus return, assignment acknowledgment/navigation, appointment destinations, all eight returned appointments, outcome colors/contrast, and persisted module customization. Eighteen additional Chromium/WebKit Home and modal visual/accessibility states at 1440, 390, and 320px passed without serious/critical findings or page overflow. WebKit initially exposed pointer entry without opener focus; the shortcut now establishes focus before the canonical dialog captures it. The eight-appointment fixture initially used numeric name suffixes stripped by the existing identity formatter; using named synthetic clients corrected the fixture. TypeScript, changed-file ESLint, design-token ratchet, and whitespace checks passed. Evidence: `.data/home-modal17-final-e2e.log`, `.data/home-modal17-visual.json`, `.data/home-modal17-*.png`, `.data/home-modal17-types.log`, and `.data/home-modal17-lint.log`. This is focused local evidence, not a full release gate.

## Pass 18 — personal Upcoming assessments ribbon

Owner request: remove the Home Board heading, New assignments, and the top completion memo ribbon; replace them with a compact Upcoming assessments ribbon scoped to each assessor. The ribbon now opens the canonical HomeDialog with the existing appointment list. Current work remains directly below it. Removed the obsolete HomeFocusDeck component and assignment acknowledgment side effects from Home. The completion review route remains unchanged. Existing saved module IDs remain readable, but the library excludes retired assignments and the redundant schedule module. Revisit that compatibility storage only if the saved-layout schema is deliberately migrated.

Home briefing filters calendar events with the canonical assigned-user helper before sorting and the existing eight-appointment limit. Supervisor accounts also get their own schedule here. The cap remains unchanged; Calendar is the full schedule. If assessors need more than eight appointments in this ribbon, expand the endpoint and count together. Unavailable and empty schedules remain distinct. There are no new clinical rules or data writes.

Validation: three executable service tests cover assessor and supervisor identity scope, stable IDs versus matching display names, legacy name/email fallback, cancelled/completed exclusion, filtering before the limit, and calendar failure. Eleven focused browser tests cover the ribbon at 1440/834/390/320px, modal keyboard entry and focus return, destinations, all eight rows, empty/unavailable states, decision colors, and saved-layout retirement. Five additional customization tests pass for board persistence, add/remove/cancel, pointer/keyboard ordering, and restoring defaults. An initial customization run used the browser-only recorder against the desktop-backed preview, counting cache writes as saves; rerunning with PIPELINE_DESKTOP_E2E=true passed without changing assertions. A new test initially looked for a nonexistent Add Search button and was corrected to the existing Search checkbox.

Twelve Chromium/WebKit Home/modal states pass accessibility and overflow checks. Visual review caught and fixed an orphaned ribbon arrow at 320px. TypeScript, changed-file ESLint, the design-token ratchet, and whitespace checks pass. Evidence: `.data/home-ribbon18-scope.log`, `.data/home-ribbon18-final-e2e.log`, `.data/home-ribbon18-customize-final.log`, `.data/home-ribbon18-visual.json`, `.data/home-ribbon18-*.png`, and the associated lint/types/design logs. Local preview only; no deployment.

## Pass 19 — intake width and one progress indicator

The owner reported the narrow form and oversized/redundant intake progress presentation. The intake article previously shrink-wrapped to 732px inside 1264px at a 1920px viewport. It now fills the available content area, matching Documents: 1230px of content after the existing outer padding and borders. The header reduces from 109px to 69px on desktop, with a smaller illustration, section-scale title, and one native progress indicator using the existing recorded count. Identity, routing, and contact fields share rows on wide desktops, remain two columns on smaller desktop/tablet widths, and stack on phones. Labels and native controls retain their readable sizes. New intake drops the duplicate lower progress/status block; saved-intake Done/assessment controls remain.

Validation: twelve Chromium/WebKit views at 1920, 1440, 1024, 834, 390, and 320px pass width, single-progress, Create action availability, accessibility, and overflow checks. Screenshots include the top and bottom of the form. Container-query containment initially collapsed the nested flex form in Chromium; replaced it with the established media-query layout before final verification. The width assertion was corrected to measure the parent content box rather than including its padding. The existing create-once/reload test was extended to verify progress updates from 1 to 2 of 13 when Name is entered; it passes with the same creation and persistence assertions. TypeScript, changed-file ESLint, design-token ratchet, and whitespace checks pass. No saving handler, authorization, data definition, or outgoing-message behavior changed. Evidence: `.data/intake19-visual.json`, `.data/intake19-*.png`, `.data/intake19-create.log`, and associated lint/types/design logs. Local only.

## Pass 20 — whole-screen audit

Read-only local audit of Home and its modals, Workspaces, Calendar, Intake, Chart, Assessment preparation/interview/review, Decision, Placement, Files, Activity, completion review, Clients, Reports, Settings, Contacts, Tutorials, Trash, and Communications. The findings and before screenshots are in `.data/ui20-findings.json` and `.data/ui20-*.png`. Populated Clients and Reports use sanitized/synthetic repository fixtures; the default demo identity correctly cannot open production-only report routes. No production reads, sends, or patient writes.

## Pass 21 — apply the approved audit cleanup

The Intake link is now compact; the multi-step journey keeps its state and dates with one less selection cue. Phone Create referral retains its full label and a 56px target. Assessment answers retain one visible check and their accessible Recorded text. Phone paging and signed continuation share one footer with a clear primary action. Notes is in the phone record header, outside the form and footer; its existing editing, save, close, and focus-return behavior stays intact.

Meet the Client uses the existing one-column message layout through ordinary laptop widths, then a side-by-side layout on large desktops. The recipient confirmation is next to Preview email, retaining the exact check and invalidation rules. Home file requirements are separated from the Open Files action; the original route and detail are preserved. Expanded board cards have a 360px desktop minimum and visible paper edges. Calendar empty-state height is reduced. Client grids lose filler paint; Workspaces lose repetitive decorative thumbnails. Trash, profile links, missing chart values, file controls, report metadata, and accepted completion status are more legible and consistent.

Validation: the 23 selected browser cases pass after narrowing an outdated email-test helper to the Client summary disclosure (the new message reorder menus also use summary elements). Assertions were retained. Coverage includes answer autosave, conditional follow-ups, handoff reload, recipient-change invalidation, complete demo preview, full recipient lists, Chromium/WebKit intake widths from 320 to 1440px, and create-once persistence. The final laptop handoff and client-directory checks also pass. Fourteen rail/state/motion checks pass in Chromium/WebKit, and eight controls/expanded-board checks cover 320, 390, 1440, and 1920px. The 1440px working message now exceeds 600px; checkbox and Preview remain in view. Notes opens/closes with focus return and does not overlap either control. Landscape and portrait phone Notes were checked separately with actual pointer clicks on the editor and Close notes. This caught a header stacking issue when the panel was initially moved inline; the trigger remains in the header, while the panel uses its original body portal so it stays above navigation.

The screen audit captured 42 desktop/phone route states and 14 populated fixture/supplement states with no serious/critical accessibility findings or document-wide overflow. The Reports redirect in the base sweep is not counted as report verification; the fixture-backed supplement verifies that screen. The initial 20-state questionnaire check covered desktop/tablet/phone at 1440/834/390/320px. Later affected changes were checked separately. TypeScript, changed-file ESLint, design-token checks, whitespace checks, and the isolated production build pass. No baselines or thresholds were changed.

Evidence: `.data/ui21-audit.json`, `.data/ui21-supplement.json`, `.data/ui21-questionnaire-visual.json`, `.data/ui21-rail-check.json`, `.data/ui21-controls.json`, `.data/ui21-behavior.log`, `.data/ui21-email-recheck.log`, `.data/ui21-final-focused.log`, `.data/ui21-build-final.log`, and `.data/ui21-*.png`. These are local visual/workflow checks, not a production-health claim or full release certification. Existing clinical copy and data stay authoritative. The intentionally simple laptop tools layout uses the existing stacked presentation; revisit only if actual assessor testing shows that moving between the wider message and file/recipient tools needs another navigation aid.


## Pass 23 — files, preparation and correspondence

Owner approval: “give it all a shot … animations, thematic elements, every page, check everything.” Local only, continuing the current worktree and preserving the existing questionnaire and workflow. The intervening oversized filled-panel experiment was withdrawn; this pass starts from Pass 21.

Home files are approximately 120px minimum height instead of the former tall cards. Name, community, assessor, next action, missing-document count and planned admission date remain; a small stage tab and layered paper edge identify each file. There is still one resume target, with the same destination and per-user continuity. The common card implementation replaces duplicate legacy/render branches and drops the unnecessary latest-notes request. Detailed notes and chronology stay in the record.

Intake uses the available width with a source-file tray next to the existing form on large screens. The live name labels that tray; queued documents appear there using the actual upload owner. Smaller screens stack the same controls. The existing creation confirmation opens with a short file animation and the existing preparation/scheduling choices. Preparation now puts the source summary, documents and notes alongside editable answers. The interview uses clearer answered-value weight and less separator noise.

Meet the Client now has To/Cc and the admission date at the top, a letter with its subject/Edit action, and the existing packet tools alongside when enough width is available. Phones stack the message and tools. Drag and keyboard ordering still saves into the same versioned draft and outgoing email. Saved decisions and the selected journey step use warm neutral paper instead of filled green blocks. Stage/outcome colors, the dark rail and illustrated objects retain the family identity. File lift, creation, drawer and reorder motion use existing timing tokens; reduced motion disables them.

Checking the complete journey exposed a desktop continuity defect: focus had stopped publishing its question in order to avoid disrupting typing. The existing continuity callback now records focus without reflecting it into the route. Mounted interviews retain the target when hidden, and the section picker follows the visible focused question. Answers, schema, save queues and nonblocking navigation rules are unchanged. The actual first typed characters, saved answers, explicit-link precedence, Files/Activity return, cold return and workspace isolation are covered. Duplicate source/notes React keys and a keyboard-inaccessible notes scroller were corrected. Loading placeholders now have valid status semantics.

Validation: production build, TypeScript, changed-file ESLint, token ratchet and whitespace checks pass. The final assessment/return/recovery suite has 28 passing tests and one existing session-storage-only check skipped in this desktop-backed demo. The email/packet suite has 43 passing cases across the main run and the successful focused rerun; creation-once and reload also pass. Earlier failures included retired Home selectors, the old collapsed upload control, a hard-coded assessor absent from the isolated demo, and setup timeouts during concurrent builds. Tests now use the real current controls and available assessor; assertions for persistence, authorization, recovery and request counts remain intact.

The 42-route desktop/phone sweep and 14 populated fixture/supplement states cover Home, Workspaces, Calendar, Intake, Chart, preparation, interview, review, Decision, Placement, Files, Activity, completion, Clients, Reports, Settings, Contacts, Tutorials, Trash and Communications. The default demo redirects away from Reports; actual report layout is checked with repository fixtures. The sweep caught invalid ARIA on a Home loading placeholder during that redirect; the corrected loading state was checked separately. Twenty questionnaire states at 1440/834/390/320px pass accessibility and overflow checks. Eight Chromium/WebKit checks cover Notes clearance, keyboard return, packet confirmation, expanded-card widths and phone controls. Reorder checks cover native drag, keyboard movement, Escape/focus return, saved order, malformed/stale order rejection, injected save failure/retry, actual email-preview order and immediate exit flush. No real email was sent.

Evidence: `.data/ui23-assessment-final.log`, `.data/ui23-behavior.log`, `.data/ui23-focused-rerun.log`, `.data/ui23-reorder-results.json`, `.data/ui23-audit.json`, `.data/ui23-supplement.json`, `.data/ui23-questionnaire-visual.json`, `.data/ui23-controls.json`, `.data/ui23-motion.json`, `.data/ui23-build-final.log` and screenshots. Synthetic test referrals created during this pass were moved to local Trash using version-checked API calls; earlier preview records are unchanged, and the records/audit remain recoverable. This is a local design candidate, not release certification or a production-health claim.

The deliberate layout ceiling remains native responsive stacking rather than a separate phone workflow. Revisit that choice only if assessor testing shows repeated travel between message and attachment tools on smaller screens. No new dependency, schema migration, clinical wording or send rule is introduced.


### Pass 24 — Decision choices and Placement readiness

Replaced the repeated Decision page explanation with three outcome tiles, a reason field and one record action. Outcome tiles retain native keyboard/radio behavior, use colored raised edges and 260 ms selection motion, and respect reduced motion. Removed the duplicate client sidebar and consolidated assessment access and secondary actions. Removed Placement's redundant title and competing readiness presentations; retained the original assessment/decision routes and confirmation requirements.

Validation: 13 Decision browser scenarios passed (12 in the final full run; the Under review case passed after waiting for its existing entry animation before contrast measurement). Checks cover acceptance/denial/under-review persistence, confirmation cancellation, read-only permissions, recommendation attribution, workflow-loading recovery, unsigned/signed Placement navigation and no accidental sending. Twenty visual/accessibility states across 1920, 1440, 834, 390 and 320 pixels cover pending Placement, Decision, recorded acceptance and the ready composer. Keyboard selection and normal/reduced motion checked separately. TypeScript, affected ESLint and token ratchet passed. The previous test's hard-coded Playwright QA actor was corrected to the actual authenticated test identity. Evidence is in `.data/ui24-*`. Production untouched.

### Pass 25 — Wide reason, compact confirmation, saved-decision feedback

The reason now sits directly below and spans all three outcome choices. Its warm paper surface lifts slightly on focus, with one keyboard focus ring and a short outcome-colored underline. Its accessible label remains stable while typing. Acceptance/denial confirmations use a compact outcome stamp, short effect statement, Cancel and the existing record action. A noninteractive receipt appears only after the server confirms the decision; acceptance continues immediately to Placement. The receipt neither moves focus nor plays again on reload. Reduced motion disables the animation but retains confirmation feedback.

Validation: all 16 focused Decision browser cases pass. Added checks cover alignment at 1440, 834, 390 and 320 pixels; dialog accessibility and keyboard cancellation; delayed responses; successful acceptance/denial receipts; reduced motion; and failed-save note retention without false success feedback. The timing check caught CSS optimization serializing milliseconds as seconds; the dismissal timer now handles both units. Existing permission, persistence, recommendation, navigation and no-accidental-email assertions pass. TypeScript, affected ESLint, design-token ratchet and whitespace checks pass. Evidence: `.data/ui25-decision-verified.log`, `.data/ui25-types-final.log`, `.data/ui25-lint-final.log`, `.data/ui25-design-final.log`, and `.data/ui25-confirmation-preview.png`. Only this pass's synthetic fixtures were moved to local Trash with version checks; previous records are preserved. Local preview only.


### Pass 26 — Workspaces finishing pass

Retains the existing directory and navigation. Adds a warm background, quiet alternate-row shading and compact semantic status color; gives longer statuses more room. Shortens search placeholders and client metadata to community/county while keeping current statuses, owner, date, notes, document counts and whole-row opening. No category-tab redesign, new click path or persisted-data change. Retired unreachable legacy-render branches in the touched worklist.

Validation: 20 focused browser cases pass, including Chromium/WebKit navigation, paging, search, retry, multiple filters, carryover, completed and admitted folders. Eight desktop/phone states at 1600, 1024, 390 and 320 pixels pass WCAG checks and row/page overflow checks in Chromium and WebKit. The existing older-history screenshot assertions still describe the retired thumbnail/white-surface design and were excluded; no baselines or assertions were weakened. Evidence: `.data/ui26-workspaces-tests.log`, `.data/ui26-visual-accessibility.json`, and `.data/ui26-tuck-*.png`. Local only.


### Pass 28 — Restore soft colors; refine text and lines

Removed the rejected dark table header, saturated status badges and cream color pass. Restored Pass 26's soft palette. Refined existing table, row and status boundaries, removed excess cell padding and the fixed inner width, and allowed client/owner names to wrap with the established type scale. No navigation, wording, status semantics or data changes.

Validation: 14 existing directory/navigation/filter checks pass. Six live local viewport checks (320–1600px) have no page or row clipping and no WCAG violations. Chromium/WebKit long-name checks exposed faint empty-archive text at 1280px; it now uses the existing meta/ink-muted tokens and both targeted rechecks pass. TypeScript, ESLint, token ratchet and whitespace checks pass. Evidence: `.data/ui28-workspaces.log`, `.data/ui28-a11y.json`, `.data/ui28-long-text.json`, `.data/ui28-contrast-recheck.json` and `.data/ui28-fit-*.png`. Read-only/mock fixtures only; production untouched.

### Pass 29 — Carelog spacing and readable directory rows

Read Carelog's current resident-card implementation and reference captures. Retained Pipeline's directory, month browser and filters. Replaced the striped table and repeated status boxes with compact warm rows, semantic status text and restrained arrow feedback. Removed the proposed initials/avatars at the owner’s request; client names lead directly, and unknown identities use the existing placeholder. Colors come from the existing design tokens. Long names, owner names and filter summaries wrap. Filter controls wrap to another line when needed so county labels cannot collide with their arrows. No copy, workflow, stored data, authorization or route changes.

Validation: all 14 existing selected directory tests passed, covering Chromium/WebKit navigation, search, pagination, filters and admitted folders. Thirty-two synthetic Chromium/WebKit row/filter states at 320, 390, 640, 834, 1024, 1280, 1440 and 1600px pass WCAG and text/page overflow checks; eight live-local view states cover Current, Completed, Admitted and All files on desktop and phone. Visual review also caught and repaired tablet county-label crowding before delivery. ESLint, TypeScript and the design-token ratchet pass. No new snapshot baselines or weakened assertions. Evidence: `.data/ui29-visual.json`, `.data/ui29-live.json`, `.data/ui29-workspaces.log`, `.data/ui29-filters-final.log` and `.data/ui29-*.png`. Production untouched.

### Pass 34 — Local application and workflow audit

Audited the current Carelog-family preview across Home, Workspaces, Calendar, Clients, Intake, Chart, assessment preparation/interview/review, Decision, Placement/Meet the Client, Files, Activity, completion memo, reports, Trash, Settings, contact lists, tutorials and communications. Used synthetic local data; clinical/report fixtures provide populated states without connecting to live clinical services.

Repaired four functional gaps at their existing owners:
- Phone navigation no longer closes when interview scroll tracking updates question query parameters; actual navigation and browser history still close it.
- Recorded answers in the split interview reference pane open the existing answer editor/review path. Finalized records retain their existing restrictions.
- Chart's assessment scheduling control renders when the chart is mounted through its portal, using the same scheduling dialog as Assessment.
- A confirmed calendar follow-up save clears its dirty marker before the versioned editor remounts, preventing an immediate false unsaved-changes confirmation.

Validation: 178 distinct browser scenarios passed across the initial run and focused repairs/rechecks; the deduplicated evidence index is `.data/ui34-passing-scenarios.json`. Coverage includes save/reload, failed saves, signing and sent-record addenda, decisions, handoff preview/recipient persistence, upload labeling and deduplication, partial-upload retry, preview focus/Escape, restoration, role boundaries, completion-memo additions and tutorials. Contact-list mutations ran separately in the isolated port-3355 demo; all 12 checks passed, including Safari. An intermittent post-save calendar warning was reproduced, repaired, then passed three consecutive rechecks.

Forty-two page/viewport checks plus 14 populated-state checks found no readiness errors, page overflow, JavaScript errors or serious/critical WCAG violations; four affected Chart/interview checks passed again after fixes. Chromium and WebKit upload checks passed. Production build, TypeScript, affected ESLint, design-token ratchet, 13 continuity/lifecycle model tests and whitespace checks passed. Existing stale test fixtures were updated to use a currently active local assessor and the current UI entry points; retired exact-color assertions were replaced with WCAG checks for readable error feedback. No failure thresholds or baselines were changed.

Evidence: `.data/ui34-*.log`, `.data/ui34-audit.json`, `.data/ui34-supplement.json`, `.data/ui34-repaired-audit.json` and corresponding screenshots. Moved 108 audit-owned synthetic referrals into recoverable local Trash, preserving earlier preview records; the manifest is `.data/ui34-cleanup-manifest.json`. Stopped the isolated contact-list server and left port 3308 available. This is local UI/workflow validation, not a live Outlook/Azure delivery or clinical-integration check. No deployment or real messages.


### Pass 35 — Compact checklist and file-drop feedback

Chart requirements now start as a completed/total disclosure. Removed repeated category headings while retaining every task and the shared completion calculation. File upload has a paper-stack detail and blue drag feedback; entering Documents no longer expands the section and shifts the target. Drop cancellation restores upload focus, and drag cancellation clears the highlight. Existing file labels, validation, permissions and persistence are unchanged.

Validation: all 10 existing upload/file browser scenarios pass, covering Chromium/WebKit drops, labeling, cancellation, phone controls, read-only rejection, preview focus, deduplication and partial-failure retry. Twenty desktop/phone states in Chromium and WebKit pass overflow and serious/critical WCAG checks. Dedicated checks cover default collapse, keyboard disclosure, unchanged task counts, stationary drag targets, canceled-drag cleanup, label-dialog focus recovery and reduced motion. Production build, TypeScript, affected ESLint, token ratchet and whitespace checks also pass. Moved the eight pass-owned synthetic referrals into recoverable local Trash, preserving earlier preview records. Evidence: `.data/ui35-uploads.log`, `.data/ui35-visual.json`, `.data/ui35-build.log`, `.data/ui35-cleanup-manifest.json` and `.data/ui35-*.png`. Local preview only.


### Pass 36 — Interview reference readability and shorter handoff guidance

Replaced the split reference's narrow ruled fact columns with sentence-case labels above full-width editable answers. The shared notes editor keeps a separate warm writing surface, light ruling, save/error feedback and independent scrolling. A minimum readable split width prevents the divider from crushing labels into word stacks when the workspace rail is open. The same answer edit/review callbacks, clinical wording and persistence remain intact.

Meet the Client now labels its file selector “Community files.” Removed the paragraph explaining checked files and defaults; the client data sheet retains its always-included caption, and selected medication lists receive the short current/signed reminder. The planned date retains only “Required before sending.” Existing validation and recipient authorization are unchanged.

Validation: 16 Chromium/WebKit desktop, tablet and phone states pass page/content overflow and serious/critical WCAG checks, including the narrowest reference setting. A synthetic local workflow verifies reference edit focus, answer autosave, shared-note saving and persisted answers/notes after reopening. Seven distinct handoff scenarios pass across the initial run and focused recheck: date-save recovery, conflicting-date reload, unfinished draft/file recovery, recipient authorization reset, assessment/file navigation and file-selection defaults on phone/tablet. The initial concurrent run had three timeout failures; the unchanged checks passed in the focused recheck without relaxed assertions or timeouts. Production build, TypeScript, affected ESLint, token ratchet and whitespace checks pass. Moved the 14 pass-owned synthetic records to recoverable local Trash, preserving earlier preview records. Evidence: `.data/ui36-build.log`, `.data/ui36-cleanup-manifest.json`, `.data/ui36-visual.json`, `.data/ui36-edit.log`, `.data/ui36-email-recheck.log` and `.data/ui36-*.png`. Local only; no real email or production data changes.

### Pass 37 — Carelog's task hierarchy, not just its palette

- Reference: owner's Carelog Today/Groups screenshots; matching `p-floor-task` in the CareConnector `carelog-code-audit` worktree (`cdcaf21`, `web/src/ui/floor.css`). Copied the task's warm action-end material into Pipeline tokens, with the existing Pipeline typography and motion tokens.
- Home: one prominent resume target (first pin, otherwise first recent), quieter joined rows, existing small personal schedule dialog trigger and stage-list controls. No client reprioritization, new fields, backend changes or copy changes. The full category dialogs retain their existing card layout. Six recent entries remains the known Home limit; revisit only if assessors need more immediate shortcuts.
- Navigation: simple destination outlines, an orange selected destination and the white P. Workspaces: connected rows, warm heading, crisper edges and wider owner column. Existing filters, month browser and click paths stay in place.
- Validation: 33 Home workflow tests passed, including personal pin/unpin, reload, resume destinations, empty/unavailable schedules, keyboard dialogs, status colors and narrow layouts. Four Chromium/WebKit keyboard-navigation checks passed. Twenty directory visual/filter states and eight populated Home states across Chromium/WebKit at 320–1440px passed overflow, long-label and accessibility checks. Screenshot review caught and fixed a phone Resume wrap before delivery. Lint and token ratchet passed; no baselines regenerated.
- The broad fixed-navigation test was stopped because its unconditional Reports expectation does not apply to this local Alex Morgan account. Reports was absent in the pre-pass screenshot too; no authorization rule was changed. The relevant keyboard/profile scenarios passed. The former category border-color assertion was updated to the approved crisp neutral edge, retaining a separate stage-background assertion.
- Evidence: `.data/ui37-final-layout.log`, `.data/ui37-navigation.log`, `.data/ui37-home-visual.json`, `.data/ui37-visual.json`, `.data/ui37-lint.log`, `.data/ui37-design.log`, `.data/ui37-types.log`. Only local, request-intercepted synthetic fixtures were used for the Home/directory checks. No production activity or email.

### Pass 38 — Decision choice composition

Replaced the empty square radio cards with compact outcome controls combining the symbol and label, a stamped selection treatment and pressed feedback. Kept the full-width reason below the controls and every existing record/confirm/error/permission path. No wording or navigation changes.

Validation: 16 existing Chromium decision/Placement tests pass, including desktop/phone accessibility, confirm/cancel, denial, under review, failed-save note recovery, recorded-response feedback and read-only access. Sixteen WebKit visual/keyboard states at 320, 390, 834 and 1440px pass overflow, label fit and WCAG checks. Inspected unselected/selected desktop and phone screenshots. TypeScript, affected ESLint, token ratchet and whitespace checks pass. No baselines changed. Evidence: `.data/ui38-decision.log`, `.data/ui38-webkit.json`, `.data/ui38-types.log`, `.data/ui38-lint.log`, `.data/ui38-design.log`, `.data/ui38-pass.diff`. Sixteen pass-owned test referrals were moved to recoverable local Trash; earlier preview records retained. Local only. Removing Decision from the normal navigation path has been proposed, not implemented.


### Pass 39 — Carry a decision through the assessment

The normal journey is now Chart → Assessment → Placement. The existing Decision page is nested under Chart, with old links and all existing controls retained. A compact colored bookmark in preparation/interview/review persists the existing working recommendation. Signing brings the current assessment's exact saved choice into review as a short confirmation; acceptance continues into Meet the Client. Changing the choice, an absent choice, or an older assessment's recommendation uses the full decision controls and confirmation. The same workflow owner is displayed inside review, so there is no second mutation owner or new decision store.

The bookmark and confirmation use the existing semantic colors, seal/pressed treatment and reduced-motion-aware animation tokens. The bookmark reserves its footer space while loading. Signing reveals the confirmation below sticky headers. Question content, signed-data rules, permissions, admission semantics, audit behavior, request replay and email sending remain unchanged. An early Deny does not close the referral or send anything.

Regression checks also found two safety gaps: kept-mounted assessment edits were not consulted on full workspace exit from another stage, and the interview reference omitted the existing unverified-source marker. The persistent assessment exit guard now checks those drafts; the reference uses the canonical question-status helper to restore the marker. Internal stage navigation remains available.

Evidence: 33 focused Chromium cases passed across the final regression and bookmark runs; nine bookmark-flow WebKit cases passed. The post-sign visibility scenarios were repeated in both browsers at 320, 390, 834 and 1440px after correcting the tablet sticky-header overlap. Coverage includes persistence/reopening, reversible choices, explicit finalization, no automatic emails/admissions, no stale-assessment shortcut, changed choices, failed-save retry with the same command, pending/failed-save exit protection, read-only access, denial/under-review behavior, accessibility and layout stability. Source: `.data/ui39-final.log`, `.data/ui39-bookmark-final.log`, `.data/ui39-webkit.log`, `.data/ui39-chromium-focus.log`, `.data/ui39-webkit-focus.log`. TypeScript, affected ESLint and design-token ratchet passed; no baselines regenerated. Production build and tutorial checks are recorded in `.data/ui39-build-final.log` and `.data/ui39-tutorials.log`. Current-pass synthetic records are tracked in `.data/ui39-cleanup-manifest.json` and moved only to recoverable local Trash. Local preview only, no real email or production changes.
