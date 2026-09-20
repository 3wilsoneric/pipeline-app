# Home focus deck

Local product experiment: Board, Upcoming assessments, then New assignments share
one layered surface. Existing module data, destinations, acknowledgment, and Home
layout persistence remain owned by their existing components and helpers.

- Board is always available and selected on entry. Optional modules still respect
  saved visibility. The three focus panels have a fixed order; other saved modules
  remain below them. Edit Home retains its existing add/remove/reorder interface.
- Navigation is manual: labeled tabs, wrapping arrow keys,
  Home/End, or a horizontal gesture starting away from record controls. Nothing
  rotates on a timer, and viewing assignments does not acknowledge them.
- Background panels stay mounted to preserve local state, but are inert and hidden
  from assistive technology. Only the foreground is interactive. Native vertical
  scrolling, pinch zoom, canceled pointers, and record controls retain their behavior.
- Panels form a centered, parallel stack without rotation or sideways offsets.
  Only the foreground panel participates in document flow, so the board grows with
  its folders and their hover/focus expansion. No fixed-height board, nested scroll
  area, or JavaScript height measurement is needed. Hidden panels do not reserve
  space when switching to a shorter module.
- Motion is transform-based and disabled with reduced motion. The tactile
  effect is visual; it does not promise device vibration or request hardware access.
- No questionnaire, workflow, storage schema, medical-data, or delivery changes.

This is deliberately a small three-panel composition, not a general carousel
framework. Revisit it if additional primary panels are requested or usability
testing shows that simultaneous Board/schedule viewing is needed. Do not add
auto-advance to a working clinical queue.

Evidence: `home-focus-deck.spec.ts` covers desktop/tablet/phone widths, hidden-panel
inertness, keyboard wrapping, gesture cancellation/scroll intent, reduced motion,
state preservation, explicit assignment acknowledgment, destinations, and saved
customization. Dense fixtures cover 5 and 10 files in each of three board stages,
desktop hover/focus expansion, phone/tablet scrolling to the last file, centered
layering, and switching between long and short panels. `home-module-library.spec.ts`
covers existing module management.
Repository-wide certification remains subject to the existing complexity ratchet;
focused checks are not deployment authorization.

## Packaging Evidence, September 20, 2026

The straight-stack follow-up removes the arrow buttons and lets the foreground
panel determine page height. The targeted Home focus deck, Home module library,
and referral handoff run passed 34 tests; one opt-in preview-asset capture was
skipped. This includes 5 and 10 folders per stage, desktop hover and keyboard
expansion, phone/tablet scrolling, reduced motion, saved module customization,
and the current recipient-chip handoff. Evidence is local to this branch;
the combined release candidate still requires its own verification.
