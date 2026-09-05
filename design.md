# Pipeline interface design language

This file is the portable visual and interaction specification for making another application look and feel like Pipeline. It describes the shipped interface as a system, not as a set of screenshots to imitate. Use it for new products, redesigns, prototypes, or agent-generated interfaces.

The goal is recognizable family resemblance: the same judgment about hierarchy, density, color, controls, and operational clarity, even when the content and workflows are entirely different.

## 1. The character of the product

Pipeline looks like a precise operational instrument. It is calm, flat, compact, and evidence-first. It should feel appropriate for work where people need to find a record, understand its state, change it safely, and know what happened.

The visual formula is:

> White working canvas + near-black type + fine gray rules + one green operational accent + small, stable color families for major destinations and exceptional states.

The interface should communicate these qualities:

- **Trustworthy:** state, provenance, errors, and next actions are explicit.
- **Fast:** common information is visible without opening decorative cards or menus.
- **Dense but calm:** small type and compact rows are balanced by strong hierarchy and consistent spacing.
- **Clinical, not sterile:** restrained green and lightly tinted surfaces soften an otherwise rigorous information system.
- **Flat:** borders and alignment do most of the structural work. Shadows are reserved for overlays, menus, and the occasional hover lift.
- **Direct:** controls say what they do. Status language describes recorded facts, not vague sentiment.

This is not a generic rounded SaaS dashboard. Do not translate it into floating cards, oversized hero copy, large empty gutters, colorful charts for decoration, or a teal gradient over every surface.

## 2. Non-negotiable rules

1. Use white as the main application surface.
2. Use rules, alignment, and spacing before using containers or shadows.
3. Keep corners square on ordinary controls, panels, tables, and cards.
4. Reserve green for brand, focus, progress, completion, selected operational state, and affirmative action.
5. Give each major destination one stable accent family. Never assign colors ad hoc.
6. Use uppercase, letter-spaced micro-labels for navigation, field labels, table headers, and categories—not for prose.
7. Show the actual record or task state close to its name.
8. Make hover states quiet and focus states unmistakable.
9. Put primary evidence at full available width. Do not squeeze tables, timelines, or structured records into prose columns.
10. On small screens, recompose the interface. Do not merely shrink the desktop layout.
11. Decorative styling must never compete with names, status, deadlines, blockers, or next actions.
12. Every view must still work in grayscale; color reinforces meaning but does not carry it alone.

## 3. Foundations

### 3.1 Typeface

Use **Geist Sans Variable**, weights 100–900, with `font-display: swap`. Use Arial and Helvetica as fallbacks. Use a native monospace stack only for code, identifiers, and commands.

```css
:root {
  --font-sans: "Geist", Arial, Helvetica, sans-serif;
  --font-mono: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
}

html { font-family: var(--font-sans); }
body { -webkit-font-smoothing: antialiased; }
```

If Geist is unavailable, use Inter or Arial. Do not substitute a geometric display face, serif, or humanist typeface; it changes the product's voice.

### 3.2 Type scale

Pipeline uses a deliberately compact application scale. The most-used text sizes are 9–12px, with larger sizes reserved for identity, page headings, major metrics, and dialog titles.

| Role | Size | Weight | Tracking / line height | Use |
|---|---:|---:|---|---|
| Micro code | 8px | 700–900 | 0.08em | Tiny sequence or completion marks only |
| Table/category label | 9px | 700–900 | 0.08–0.13em uppercase | Table heads, field groups, compact badges |
| Control label | 10px | 800–900 | 0.06–0.11em uppercase | Buttons, tabs, filters, section kickers |
| Metadata | 10–11px | 400–700 | 16–20px | Counts, timestamps, provenance, help text |
| Dense body / control | 11–12px | 500–700 | 20px | Forms, report cells, operational copy |
| Row identity | 13–14px | 700–900 | 18–20px | Person, workspace, document, or event name |
| Section title | 14–18px | 800–900 | 20–24px | Local page and section headings |
| Page/dialog title | 20–30px | 800–900 | 28–38px; -0.02 to -0.04em | Major title with clear hierarchy |
| Metric | 22–30px | 700–900 | 1.0 | Counts, percentages, readiness |
| Welcome display | 34–44px | 800–900 | 38–50px; -0.035em | Rare landing or onboarding moment only |

Rules:

- Default to `font-weight: 900` for labels and compact headings, `700` for record titles, and `500–600` for supporting text.
- Body text is sentence case. Navigation and compact labels are uppercase.
- Uppercase labels need tracking; never set dense uppercase at normal spacing.
- Use negative tracking only on headings 20px and larger.
- Use tabular numerals for counts, dates in columns, percentages, and metrics.
- Avoid long prose below 12px. The 9–11px range is for concise operational information.

### 3.3 Core color system

Use these values exactly when high visual fidelity is required.

```css
:root {
  color-scheme: light;

  /* Canvas and ink */
  --p-canvas: #ffffff;
  --p-surface-subtle: #f7faf9;
  --p-surface-muted: #f4f7f5;
  --p-ink: #111111;
  --p-ink-soft: #202320;
  --p-body: #404040;
  --p-muted: #595959;
  --p-subtle: #737373;
  --p-disabled: #b3b3b3;

  /* Structure */
  --p-rule: #d9d9d9;
  --p-rule-soft: #e1e5e3;
  --p-rule-field: #c9ceca;
  --p-rule-strong: #aebbb5;
  --p-rule-ink: #111111;

  /* Pipeline operational green */
  --p-green: #0f8b73;
  --p-green-dark: #0c705f;
  --p-green-deep: #0f6f5d;
  --p-green-soft: #effaf5;
  --p-green-selected: #e7f3ee;
  --p-green-rule: #b8dacf;

  /* Stable destination accents */
  --p-search: #c4832c;
  --p-search-ink: #8a5a10;
  --p-search-soft: #fff3dc;
  --p-calendar: #27889a;
  --p-calendar-ink: #176b78;
  --p-calendar-soft: #e9f7f9;
  --p-clients: #4b68ad;
  --p-clients-soft: #eef1ff;
  --p-reports: #7d8b3f;
  --p-reports-ink: #59652d;
  --p-reports-soft: #f4f6e8;
  --p-coral: #c85b4d;
  --p-coral-ink: #a9473d;
  --p-coral-soft: #fff0ed;

  /* Semantic exception states */
  --p-warning: #d5b75b;
  --p-warning-ink: #9a6115;
  --p-warning-soft: #fffaf0;
  --p-danger: #a9473d;
  --p-danger-deep: #7c3229;
  --p-danger-soft: #fff3f1;

  /* Overlay */
  --p-scrim: rgb(24 32 29 / 35%);
}
```

Color behavior:

- **Green:** primary focus, progress, complete, active workflow, positive CTA, brand mark.
- **Near-black:** high-commitment workflow action, title, strongest separator.
- **Amber:** attention, search, unresolved or delegated context. Amber is not an error.
- **Coral/red:** creation accent where already established, destructive action, denied/failed/error state.
- **Cyan, blue, olive:** persistent wayfinding for calendar, clients, and reports.
- **Gray:** metadata, borders, unselected state, unavailable state.

Use tinted backgrounds only with their matching border and ink family. Never place two unrelated accent families on the same small component.

### 3.4 Spacing

Use a 4px base unit. The dominant working intervals are 8, 12, 16, 20, 24, and 32px.

| Context | Preferred values |
|---|---|
| Icon-to-label | 6–10px |
| Tight control group | 4–8px |
| Ordinary inline gap | 8–12px |
| Card or row internal padding | 12–16px |
| Section internal padding | 16–24px |
| Section-to-section gap | 20–28px |
| Page gutter | 16px mobile; 20–24px tablet; 32–40px wide desktop |
| Empty-state vertical padding | 48–64px |

Do not use spacing as decoration. Large gaps indicate a real change in responsibility or reading level. Closely related metadata stays close to its record.

### 3.5 Borders, corners, and elevation

Borders are the primary layout material.

- Ordinary rules: 1px `#d9d9d9` or `#d7ddd9`.
- Field borders: 1px `#c9ceca`.
- Strong section or table-head rule: 2px near-black or a stronger gray-green.
- Active tab: 2–3px bottom border in its accent color.
- Recovery/error notice: 2–3px left border plus a very pale tinted fill.
- Ordinary corner radius: 0.
- Small menu/auth/profile radius: 2–6px.
- Primary navigation radius: 8px.
- Fully round geometry: avatar, dot, spinner, or close icon only—not ordinary buttons or badges.

Elevation rules:

- Lists, tables, forms, and content panels have no shadow.
- Menus may use `0 10px 24px rgb(17 17 17 / 12%)`.
- Dialogs may use `0 24px 70px rgb(17 17 17 / 20%)`.
- Right drawers may use `-16px 0 40px rgb(20 35 30 / 16%)`.
- Gallery cards may lift 2px on hover with `0 10px 24px rgb(25 55 45 / 9%)`.
- Do not stack border, large radius, and heavy shadow on the same ordinary component.

### 3.6 Icons and marks

Use Lucide-style outline icons.

- Default stroke: 1.8–2px.
- Inline metadata icon: 12–14px.
- Button or row action: 14–17px.
- Primary navigation: 20–21px.
- Empty state or feature: 22–26px.
- Icons inherit semantic text color.
- An icon-only button always has an accessible name and a visible tooltip on hover.
- Prefer one icon per action. Do not ornament headings with icons unless the icon communicates category or state.

The Pipeline mark is a bright green geometric mark (`#00a873`) displayed at 32px in a 48px-tall home target. When adopting the style for another brand, keep the compact single-color mark behavior but use that product's actual mark.

## 4. Layout system

### 4.1 Application shell

The product occupies the viewport and delegates scrolling to the active work surface.

```css
.app-shell {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--p-canvas);
  color: var(--p-ink);
}

.app-main {
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
```

The global header is 68px on mobile, 74px at 640px+, and 82px at 1280px+. It has a white background and no drop shadow. Content begins immediately below it.

### 4.2 Working widths

Choose width by task, not by a universal template:

- Search, editor, and article-like explanation: 640–900px.
- Client directory and ordinary structured views: up to 1240px.
- Referral/detail workspace: up to 1480px.
- Reports and high-density evidence: 1480–1680px or the full safe width.
- Directory/list surfaces may run nearly edge-to-edge with responsive gutters.

Never force a wide table or evidence grid into a narrow reading column. Conversely, do not stretch long-form copy across the whole screen.

### 4.3 Responsive breakpoints

Use the following breakpoints as layout decisions:

- **Below 360px:** preserve essential icon controls; reduce only side padding and inter-control gaps.
- **360–639px:** mobile, single-column, icon-first global navigation.
- **640px:** increase header and gutters; allow two-column local grids.
- **768px:** introduce split metadata and day/list structures where useful.
- **1024px:** switch compact list rows to full table-like rows; show desktop stage navigation.
- **1280px:** expose primary navigation labels; introduce two-column modules and side rails.
- **1536px:** allow three-column galleries and the widest evidence surfaces.

Responsive behavior must preserve workflow semantics:

- Collapse labeled global navigation to icons before hiding destinations.
- Replace an overflowing stage tab strip with a labeled select on mobile.
- Convert desktop record grids into readable stacked rows below 1024px.
- Keep tables horizontally scrollable when columns must remain comparable.
- Stack label/value sections, filters, and form columns rather than shrinking their text.
- Make full-workspace dialogs fill the mobile viewport; bound them on desktop.
- Use horizontal scrolling for stable nav docks and tab strips when necessary.

## 5. Global navigation

The top bar is a navigation dock, not a marketing header.

- Place the compact product mark at left in a 36–48px target.
- Put major destinations in one horizontal strip.
- Place help and account context at right.
- Each destination has a stable accent family in both hover and active states.
- Destination buttons are 36px square on compact mobile, 44px square by default, and 50px tall on wide desktop.
- At 1280px+, destination buttons expand to roughly 136px; the longest may be 152px.
- Use an 8px radius and a 2px border. Inactive borders are transparent.
- Active state = colored border + pale matching fill + faint matching shadow.
- Wide labels are 12px, black weight, uppercase, tracking 0.08em.

Reference mapping:

| Destination kind | Ink / border | Selected fill |
|---|---|---|
| Core work / workspaces | `#0c705f` / `#0f8b73` | `#e7f3ee` |
| Calendar / scheduling | `#176b78` / `#27889a` | `#e9f7f9` |
| People / clients | `#4b68ad` | `#eef1ff` |
| Reports / analytics | `#59652d` / `#7d8b3f` | `#f4f6e8` |
| Create / new | `#a9473d` / `#c85b4d` | `#fff0ed` |
| Search / discovery | `#8a5a10` / `#c4832c` | `#fff3dc` |

If another product has different destinations, assign colors by enduring domain, not by route order. Keep the core work destination green and use no more than six accent families.

## 6. Component grammar

### 6.1 Page headers

Application pages use compact headers:

- 18–25px black-weight title.
- Optional 10–12px muted supporting line.
- Actions aligned to the right or immediately below on mobile.
- A bottom rule usually closes the header.
- Avoid breadcrumbs unless hierarchy genuinely requires them.
- Avoid decorative eyebrow/title/subtitle stacks on routine pages.

### 6.2 Buttons

Default heights are 32, 36, 40, 44, and 48px. Use 36–40px for routine controls and 44px+ for primary mobile targets.

**High-commitment primary**

- Near-black background, white 10–11px black-weight text.
- Hover may transition to Pipeline green.
- Square corners.

**Affirmative primary**

- `#0f8b73` background, white text.
- Hover `#0c705f`.
- Use for save, confirm, schedule, continue, and successful forward motion.

**Secondary**

- White background, 1px gray or gray-green border.
- Dark or green text.
- Hover uses `#f3f8f6` and a stronger border.

**Quiet action**

- Transparent background and no permanent border.
- Hover adds a pale neutral or semantic fill.
- Use for dismiss, pagination, or low-risk row actions.

**Destructive**

- White or pale-red background, coral/red border and text.
- Solid red is reserved for the final destructive confirmation.

**Icon button**

- 32–44px square.
- Center a 14–18px icon.
- Avoid circular icon buttons except for a deliberate modal close or avatar action.

Every disabled button retains its geometry, uses 40–50% opacity or a disabled gray fill, and removes misleading hover feedback.

### 6.3 Form controls

- Standard height: 36–40px; prominent search: 48px.
- White fill; 1px `#c9ceca` or `#aeb8b4` border.
- Square corners.
- Horizontal padding: 10–14px.
- Text: 11–13px; prominent search 15px.
- Label: 9–10px, bold/black, uppercase, 0.06–0.10em tracking.
- Placeholder: `#7d8581` or `#a3a3a3`.
- Focus: green border plus 1–2px green ring or outline.
- Help text: 10–11px muted, 16–20px line height.
- Validation text appears below or in a nearby notice; never rely on border color alone.

Do not use floating labels, pill-shaped inputs, translucent fields, inner shadows, or oversized 56px controls.

### 6.4 Search

Search is visually stronger than an ordinary field:

- 48px high, full available width.
- Search icon at 16px from the left.
- Text begins around 48px from the left.
- Clear target is 40px square at right.
- Use amber for the global search affordance and neutral/green focus inside directory search.
- Results appear as direct rows grouped by meaningful category, not decorative recommendation cards.

### 6.5 Tabs and segmented controls

**Section tabs** use a bottom rule:

- Minimum height 48px.
- 11px black-weight uppercase label, tracking 0.08em.
- Active tab has a 3px green bottom border and dark-green text.
- Inactive tab has a transparent border and muted text.

**Compact segmented controls** use a 1px outer border with 2px internal padding:

- Each segment is 32px high.
- Active segment has pale-green fill and dark-green text.
- Corners remain square.

### 6.6 Tables and dense lists

Tables are the default for comparable operational data.

- Header band: `#fafafa`, 1px top/bottom rules or a 2px dark bottom rule.
- Header label: 9–10px, bold/black, uppercase, tracking 0.08–0.13em.
- Row title: 13px, 700–900 weight, near-black.
- Cell text: 10–12px, 18–20px line height.
- Row padding: 10–14px vertical, 12–16px horizontal.
- Separator: 1px `#d9d9d9` or `#e2e2e2`.
- Hover: `#f7faf9` only.
- Right-align numeric comparisons and use tabular numerals.
- End navigable rows with a green arrow or similarly clear affordance.
- Keep column headings and row values aligned exactly.

On mobile, change each row into a compact record:

1. identity and outcome on the first line;
2. progress or primary evidence beneath;
3. owner and updated time below a fine rule.

Do not turn each mobile row into a rounded floating card. Preserve the continuous list and separators.

### 6.7 Cards and modules

Use cards only when items are independently selectable or rearrangeable.

- White fill, square corners, 1px gray-green border.
- Internal padding 14–20px.
- Use a tinted evidence/preview zone at top and a white identity zone below when helpful.
- Ordinary modules are separated by rules and grid gaps, not shadows.
- Gallery cards may lift 2px and gain a faint shadow on hover.
- Customization mode may add a dashed border and an almost-white green tint.

Avoid nesting more than one bordered card inside another.

### 6.8 Status, badges, and progress

- Badges are rectangular, 20–24px high, with a fine border.
- Text is 9px, black weight, uppercase, tracking 0.08em.
- Progress bars are 4–8px high, square-ended, pale gray-green track, solid green fill.
- Always pair progress with a numeric value such as `74%` or `17 / 23`.
- State labels use plain language: `Packet needed`, `Scheduled`, `Not recorded`, `3 blockers`.
- Use color plus text or icon. Never use a colored dot by itself as the only explanation.

### 6.9 Stat strips and metrics

Metrics sit in a ruled strip instead of separate rounded cards.

- One shared top and bottom border.
- Vertical dividers appear between metrics at the active grid breakpoint.
- Label: 9–10px uppercase, tracked, muted.
- Value: 22–30px bold/black, tabular numerals.
- Detail: 10px muted, line-height 16px.
- Two columns on medium screens and four on wide screens are preferred.

### 6.10 Upload and document controls

The main dropzone is a functional work area:

- Minimum height about 126px.
- 2px dashed border.
- Pale semantic fill, typically green when ready/received and amber when attention is required.
- 44px icon block, 25–26px icon.
- 15px black-weight primary message.
- 10–11px file constraints and status.
- Actions align at the right on desktop and center/stack on mobile.

Document checklists use a shared border grid rather than individual rounded upload cards. Put completion counts in the collapsible section header.

### 6.11 Notices and exception states

Notices are compact and local to the work they affect.

| State | Treatment |
|---|---|
| Recovered/saved/positive | 2px green left rule, `#effaf5` fill, deep-green text |
| Warning/conflict | 1px amber border, `#fffbe8` or `#fffaf0` fill, brown-amber text |
| Error/failure | 2–3px coral left rule or coral border, `#fff3f1` fill, deep-red text |
| Informational | Gray-green border, white or `#f7faf9` fill |

Lead with a 12px black-weight factual sentence. Put 10–11px explanation beneath it. Put resolution controls in the same notice when the action is local and safe.

### 6.12 Empty, loading, and error states

**Empty state**

- Keep it inside the normal page geometry.
- Use 48–64px vertical padding.
- 15px black-weight title and optional 11–12px muted explanation.
- Add one direct action only when there is an obvious next step.
- Avoid mascots, illustrations, confetti, or oversized icons.

**Loading state**

- Preserve the eventual layout to avoid jumps.
- Use simple pale blocks, an inline arcade/pixel meter, or a compact status line.
- Loading text may be 9–12px, bold, and explicit about the object being loaded.

**Error state**

- Keep known content visible where possible.
- State what failed and provide a compact `Retry` action.
- Do not replace the entire application with a generic error page for a local request failure.

### 6.13 Menus, dialogs, and drawers

**Profile/action menu**

- Width about 304px.
- White, 1px gray border, 3px green top rule.
- 2px radius and restrained menu shadow.
- Menu rows are 44–64px high and may use a 3px semantic left rule on hover/active.

**Dialog**

- Use the dark green-gray scrim at about 35% opacity.
- White panel with square corners and strong shadow.
- Width follows the task: 500–640px for a focused action; up to 1080px for structured editing.
- Header uses a bottom rule; major structured editors may use a 2px near-black rule.
- On mobile, complex dialogs fill `100dvh`; on desktop, leave 20px viewport breathing room.

**Right drawer**

- Full viewport height, up to about 390px wide.
- Left border and left-cast shadow.
- Fixed header around 64px; content scrolls independently.

### 6.14 Sticky controls

Use sticky local navigation only when it keeps the current record or workflow step visible. The surface is white at 95% opacity with a slight backdrop blur and a bottom rule. Do not place translucent floating toolbars over record content.

## 7. Page compositions

Choose a composition based on what the reader must do.

### 7.1 Home / personal operations

Purpose: answer “What needs my attention?”

Composition:

1. Compact page title and customization action.
2. Full-width active-work stat strip or current-work module.
3. Two-column module grid on wide screens, one column elsewhere.
4. Short lists for new assignments, upcoming events, and work to schedule.

Do not make every metric a card. The home page should read as one work surface.

### 7.2 Directory / workspace browser

Purpose: find a record and understand enough state to open the right one.

Composition:

1. Section tabs with counts.
2. Prominent search.
3. Compact filters in one or two responsive rows.
4. Optional 220px browse/scope rail at 1280px+.
5. Full-width list as the default; gallery as an explicit alternate view.

Desktop rows expose identity, capture/progress, owner, update time, outcome, and open action. Mobile rows recompose those facts without dropping them.

### 7.3 Record / workflow workspace

Purpose: continue structured work without losing record context.

Composition:

1. Sticky identity + workflow-stage bar.
2. Numbered stage navigation on desktop; native stage select on mobile.
3. Local utilities such as files, activity, saved state, and save control.
4. Recovery/conflict notices immediately beneath navigation.
5. Collapsible document region.
6. Structured field grids divided by section rules.
7. Optional 300px completion/next-action rail on wide screens.

Number stages as `01`, `02`, `03`. Use the green underline to show current stage. Keep audit/history and source files available without letting them compete with the active task.

### 7.4 Client/profile record

Purpose: inspect longitudinal facts and supporting evidence.

Composition:

1. Compact identity header with status and actions.
2. Sections split into a 190–220px label column and a flexible content column on desktop.
3. Full-width evidence, file, and history sections below.
4. Stronger border around the canonical document/file region when it behaves as a distinct record object.

Use direct field/value presentation. Avoid lifestyle-profile visuals or oversized avatars.

### 7.5 Calendar / scheduling

Purpose: compare time, availability, owner, and action.

Composition:

1. Sticky date-range controls.
2. Pale neutral action/filter band.
3. Week grid at wide widths; grouped day list at narrow widths.
4. Bordered event rows with 13px identity and 10–11px details.
5. Focused scheduling dialog for changes.

Use cyan as the durable calendar accent; reserve coral for conflicts or destructive cancellation.

### 7.6 Reports / analytics

Purpose: audit and compare evidence, not admire a dashboard.

Composition:

1. Compact report selector/title.
2. Right-aligned filters with labels above controls.
3. Apply and export actions.
4. One shared ruled metric strip.
5. Full-width table with explicit total and truncation state.

Do not begin with charts unless a chart reveals a relationship faster than metrics plus a table. Never hide raw evidence behind visualization alone.

### 7.7 Search / command surface

Purpose: find records, destinations, files, or executable questions quickly.

Composition:

1. Large, immediate search field.
2. A small set of categorized suggested searches when empty.
3. Direct interpreted intent or grouped results while typing.
4. Explicit result counts and source availability where relevant.

Search should feel like a tool, not a chat transcript. Use conversational language only when it improves query interpretation.

### 7.8 Authentication, onboarding, and learning

These are the rare surfaces that may use a light gray-green page background (`#f6f8f7`) and centered panels.

- Auth card: up to 480px, white, gray-green border, 4px green top rule, 4–6px radius, soft `0 18px 45px rgb(29 56 48 / 11%)` shadow.
- Learning surfaces may use white bordered panels on `#f6f8f7`, but retain the same type, labels, rules, and compact controls.
- Keep training examples visually distinct from production data through text and framing, not novelty styling.

## 8. Motion

Motion is functional and almost entirely opacity or short positional feedback.

- Hover/color transitions: 150ms ease-out.
- Route/search entry: 100ms opacity fade.
- Navigation dock entry: 120ms opacity fade.
- Workflow step entry: 160ms opacity fade.
- Navigation launch feedback: up to 260ms.
- Chevron rotation and small arrow translation are acceptable.
- Gallery hover lift is at most 2px.
- Progress width may animate around 300ms.
- No spring motion, bouncing, parallax, ambient animation, or large page slides.
- Respect `prefers-reduced-motion`; remove nonessential transitions and animation.

## 9. Interaction and usability rules

- The entire row may be clickable when it has one destination. Do not scatter duplicate open links through the row.
- Keep destructive actions spatially separated from primary save/continue actions.
- Show save state near the save control: saved, unsaved, saving, conflict, or failed.
- Prefer optimistic continuity with explicit conflict handling over silently overwriting newer data.
- A hover state never substitutes for selected state.
- Preserve a visible current state in tabs, navigation, filters, and stage controls.
- Put filters above the content they affect and keep the resulting count nearby.
- Use native controls when they are clearer and more robust, especially selects, dates, and mobile stage switching.
- Do not encode unsafe state changes as drag-and-drop simply because the layout resembles a board.
- Use drawers and dialogs for bounded secondary tasks; use a full workspace for multi-step primary work.

## 10. Content style

The writing is brief, factual, and operational.

- Use sentence case for headings and actions: `Create workspace`, `Save and continue`, `Data through`.
- Reserve uppercase for compact navigation and categorical labels.
- Prefer a concrete state over a generic label: `Packet needed`, not `Incomplete`; `No recorded data`, not `N/A`.
- Use verbs on actions: `Open`, `Apply`, `Export CSV`, `Review identity`, `Schedule`.
- Name the affected object in confirmation and error messages.
- Distinguish `Not recorded`, `Unknown`, `Unavailable`, and `None`; they are not synonyms.
- Use middle dots to join short metadata: `Gender not recorded · Community name`.
- Keep explanatory copy under a control to one or two compact sentences.
- Do not use celebratory copy, exclamation marks, or cute empty-state language in operational workflows.

## 11. Accessibility

- Meet WCAG 2.2 AA contrast for text and interactive states.
- Every form control has a programmatic label.
- Every icon-only action has an `aria-label` and tooltip/title.
- Use `aria-current`, `aria-selected`, or `aria-pressed` for visible state where appropriate.
- Focus is a 2px green outline/ring with adequate offset, or an equally visible inset ring inside dense rows.
- Keep ordinary click/touch targets at least 40px; aim for 44px on mobile. Small 32–36px controls are acceptable only in dense groups with adequate surrounding space.
- Do not remove native outlines without replacing them.
- Use real headings, tables, lists, dialogs, and regions—not visually similar generic containers.
- Announce loading, save, and conflict changes with appropriate live regions.
- Trap focus in modal dialogs and restore focus on close.
- Avoid sticky regions that obscure focused content under browser zoom.
- Verify at 200% zoom and with reduced motion.

## 12. Anti-patterns

Do not produce any of the following:

- A grid of identical rounded metric cards at the top of every page.
- Large 48–72px dashboard headings that consume the first viewport.
- Gradient page backgrounds, glassmorphism, glow, or colored ambient blobs.
- Shadows on every container.
- Pills for every status, filter, and button.
- Centered marketing copy inside an operational application.
- Random color assignment per card or status.
- Low-contrast gray body text on tinted surfaces.
- Decorative charts when a number, comparison strip, or table is clearer.
- A narrow prose column containing a wide table.
- Hidden row actions that appear only on hover.
- Mobile layouts that simply reduce font sizes until the desktop grid fits.
- Generic labels such as `Item`, `Data`, `Status`, or `Submit` when the real object/action is known.
- Chat bubbles for search or AI features whose primary job is retrieval or action.
- Excessive border nesting that makes the screen look like graph paper.

## 13. AI features in this visual language

AI should appear as part of the operational workflow, not as a separate magical brand layer.

- Present extracted or generated values in the same field and evidence grammar as human-entered values.
- Label source, confidence, review state, and provenance explicitly.
- Use amber for unresolved suggestions and green only after acceptance or verification.
- Pair each suggestion with direct actions such as `Accept`, `Edit`, `Use latest`, or `Dismiss`.
- Show conflicts side by side in a ruled comparison region.
- Preserve the original source artifact and make it reachable from the proposed value.
- Avoid sparkles, purple gradients, robot avatars, and vague `AI powered` badges.
- An AI search/assistant may interpret questions, but its answer should resolve into records, destinations, filters, evidence, or a safe action.

## 14. Portable implementation starter

The following primitives reproduce the core feel in any CSS stack.

```css
* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--p-canvas);
  color: var(--p-ink);
  font-family: var(--font-sans);
}

.p-page {
  width: 100%;
  margin-inline: auto;
  padding: 0 16px 40px;
}

.p-section-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 12px;
  padding-top: 12px;
  margin-bottom: 12px;
  border-top: 1px solid #cfd6d2;
}

.p-kicker {
  color: var(--p-green-dark);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: .1em;
  text-transform: uppercase;
}

.p-field {
  height: 40px;
  width: 100%;
  border: 1px solid var(--p-rule-field);
  border-radius: 0;
  background: white;
  color: var(--p-ink);
  padding: 0 12px;
  font: 600 12px/1 var(--font-sans);
  outline: none;
}

.p-field:focus {
  border-color: var(--p-green);
  box-shadow: 0 0 0 1px var(--p-green);
}

.p-button-primary {
  min-height: 40px;
  border: 0;
  border-radius: 0;
  background: var(--p-ink);
  color: white;
  padding: 0 16px;
  font: 900 11px/1 var(--font-sans);
}

.p-button-primary:hover { background: var(--p-green); }

.p-button-secondary {
  min-height: 40px;
  border: 1px solid #b9c6c1;
  border-radius: 0;
  background: white;
  color: var(--p-green-dark);
  padding: 0 16px;
  font: 800 11px/1 var(--font-sans);
}

.p-button-secondary:hover {
  border-color: var(--p-green);
  background: #f3f8f6;
}

.p-row {
  display: grid;
  align-items: center;
  min-height: 56px;
  border-bottom: 1px solid #e2e2e2;
  padding: 12px 16px;
  background: white;
}

.p-row:hover { background: var(--p-surface-subtle); }

.p-progress {
  height: 6px;
  overflow: hidden;
  background: #e5e9e6;
}

.p-progress > span {
  display: block;
  height: 100%;
  background: var(--p-green);
}

@media (min-width: 640px) {
  .p-page { padding-inline: 24px; }
}

@media (min-width: 1024px) {
  .p-page { padding-inline: 32px; }
}

@media (min-width: 1280px) {
  .p-page { padding-inline: 40px; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
}
```

## 15. How to redesign another product with this guide

Follow this order:

1. **Name the reader's job.** Write one sentence describing what the user must decide or complete on each page.
2. **Classify the page.** Choose home, directory, workspace, record, calendar, report, search, or bounded dialog.
3. **Map semantic colors.** Keep green for core work; assign remaining durable destinations from the established accent families.
4. **Establish evidence width.** Give tables, comparisons, timelines, and structured forms the width they require.
5. **Build hierarchy with type and rules.** Add containers only when the object is genuinely independent.
6. **Place state next to identity.** Names, status, owner, time, completeness, and next action should not require hunting.
7. **Add responsive recomposition.** Design the mobile record order explicitly.
8. **Add exceptions.** Define recovery, conflict, warning, empty, loading, and error states before polishing hover effects.
9. **Add restrained motion.** Use only short feedback that explains change or continuity.
10. **Remove decoration.** If an element does not improve recognition, comparison, state, or action, delete it.

## 16. Fidelity review checklist

Review at 360px, 640px, 1024px, 1280px, and 1536px.

### Visual identity

- [ ] Main surface is white and flat.
- [ ] Geist or an approved neutral fallback is used.
- [ ] Ordinary controls and cards are square.
- [ ] Green is the dominant operational accent.
- [ ] Destination colors are stable and limited.
- [ ] Rules and alignment create structure before shadows do.
- [ ] Most operational text falls between 9px and 14px.
- [ ] Major headings are compact and black-weight.

### Information design

- [ ] The reader's job is obvious in the first viewport.
- [ ] Primary identity and actual state appear together.
- [ ] Evidence uses the full width it needs.
- [ ] Metrics include labels and exact values.
- [ ] Empty, loading, error, warning, and conflict states are designed.
- [ ] AI-derived information exposes source and review status.

### Interaction

- [ ] Hover, active, selected, focus, and disabled states are distinct.
- [ ] Icon-only buttons have accessible names.
- [ ] Destructive actions are separated and require deliberate confirmation.
- [ ] Save or synchronization state is visible.
- [ ] Mobile layouts are recomposed rather than compressed.
- [ ] Reduced motion is respected.

### Final smell test

The redesign should feel like a serious, modern work system: compact but not cramped, warm but not decorative, fast to scan, and unusually clear about what is known, what is missing, what changed, and what the user can do next.

