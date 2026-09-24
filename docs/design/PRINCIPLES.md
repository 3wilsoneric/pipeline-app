# Design principles

These rules govern visual design only. They never change product copy. Labels, headings, helper text, button text, status names, and empty states stay exactly as they are in the codebase unless a human asks for a wording change.

## 1. One color per stage, everywhere

Each workflow stage owns one color family (ink, tile, border, column background). That family is used for the stage's tab, its board column, folder accents, and section headers inside that tab. A stage never appears in two different colors across screens.

Red is reserved for destructive actions and errors. No stage uses red.

The stage-to-color mapping lives in one token file. Starting values come from the board (green, blue, orange families in `reference/referral-board.html`). The mapping of detail tabs (Chart, Assessment, Decision, Finish & send) to families is a product decision: if it has not been set in the token file, stop and ask rather than choosing.

## 2. The folder is the structure

Tabs are navigation. The manila layer is the record. White paper is the content being read or edited. The board card and the open detail screen use the same materials, so opening a card reads as opening that folder: beige tab and edge, paper sheet inside.

## 3. Three surface levels at most

Page ground, sheet, paper. Inside paper, separate content with spacing and at most a single hairline. No bordered grid cells, no box inside a box inside a band.

## 4. One accent device

A colored top edge, in the stage color, is the only accent used to mark stage membership or current state. No left bars on headings, no left borders on cards.

## 5. Short type scale

Five roles with fixed size and weight: page title, section heading, field label, field value, meta. Labels use one case style everywhere (sentence case unless the token file says otherwise). Weight carries state: entered values are bold, empty and placeholder states are regular weight and muted color. This is a styling rule and never requires new text.

## 6. Inputs and status look different

Radio buttons, checkboxes, and selectable cards are only for things the user can click. Status uses a separate, non-interactive icon set (done, pending, in progress, blocked) that looks the same in side rails, board cards, and chips.

## 7. One primary action per screen, in one place

Exactly one filled primary button per screen, in the same position on every screen (end of content or a sticky footer). Tabs contain navigation only. Secondary actions are outlined or text. Destructive actions are quiet: muted style or an overflow menu.

## 8. Fixed frame for detail screens

Every tab of a referral shares the same header height, content width, and right rail width and position. Switching tabs changes content, never the frame.

## 9. Radius and shadow follow nesting

Radius steps down as surfaces nest: sheet 24, column or folder 16 to 18, card or paper 12, input 10, chip 6. Shadows only on things that sit above other things (folders, popovers, lifted cards), never on flat sections.

## 10. One motion language

The folder reveal defines motion: 260ms `cubic-bezier(0.2, 0.8, 0.2, 1)` for movement, 200ms ease for shadow and opacity. Tab switches, selection changes, and save confirmations reuse these values. `prefers-reduced-motion` removes transitions everywhere.

## About the reference files

`reference/referral-board.html` and `reference/board-handoff.md` show the board's layout, stacking, hover reveal, tokens, and accessibility behavior. Their sample text (status labels, chip text, empty states, missing-document lines) is placeholder and is not approved copy. Take structure and styling from them, never wording.
