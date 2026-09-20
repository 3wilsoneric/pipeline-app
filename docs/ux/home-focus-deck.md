# Home focus deck

Local product experiment: Board, Upcoming assessments, then New assignments share
one layered surface. Existing module data, destinations, acknowledgment, and Home
layout persistence remain owned by their existing components and helpers.

- Board is always available and selected on entry. Optional modules still respect
  saved visibility. The three focus panels have a fixed order; other saved modules
  remain below them. Edit Home retains its existing add/remove/reorder interface.
- Navigation is manual: labeled tabs, previous/next controls, wrapping arrow keys,
  Home/End, or a horizontal gesture starting away from record controls. Nothing
  rotates on a timer, and viewing assignments does not acknowledge them.
- Background panels stay mounted to preserve local state, but are inert and hidden
  from assistive technology. Only the foreground is interactive. Native vertical
  scrolling, pinch zoom, canceled pointers, and record controls retain their behavior.
- A ResizeObserver sizes the stack to the active content, not the longest hidden
  module. Motion is transform-based and disabled with reduced motion. The tactile
  effect is visual; it does not promise device vibration or request hardware access.
- No questionnaire, workflow, storage schema, medical-data, or delivery changes.

This is deliberately a small three-panel composition, not a general carousel
framework. Revisit it if additional primary panels are requested or usability
testing shows that simultaneous Board/schedule viewing is needed. Do not add
auto-advance to a working clinical queue.

Evidence: `home-focus-deck.spec.ts` covers desktop/tablet/phone widths, hidden-panel
inertness, keyboard wrapping, gesture cancellation/scroll intent, reduced motion,
state preservation, explicit assignment acknowledgment, destinations, and saved
customization. `home-module-library.spec.ts` covers existing module management.
Repository-wide certification remains subject to the existing complexity ratchet;
focused checks are not deployment authorization.
