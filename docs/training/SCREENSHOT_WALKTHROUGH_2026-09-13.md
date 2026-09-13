# Screenshot-first assessor orientation

## Scope

The nine-slide orientation now shows actual Pipeline screens throughout. The abstract referral journey, navigation boxes, assessment map, and decision diagrams are removed. Concepts remain as short supporting copy with concrete click locations. Language Lab is shown inside the real assessment, not a separate imitation of the field.

Twelve distinct synthetic screenshots cover Home, Workspaces, Clients, Calendar, packet intake, intake review, scheduling, the guided interview, Language Lab, final review, assessor submittal, and the supervisor decision. The two current intake screenshots from the preceding pass are retained; ten other screens are new or refreshed. Workflow detail images are captures of the actual application controls, not the separate simplified rehearsal.

Screenshot selection, click-to-enlarge, native modal focus containment, Escape dismissal, and focus return are retained or improved. Arrow keys do not navigate the background deck while the image is enlarged. Desktop copy and image height are bounded so all nine slides fit at 1280×720 without article scrolling; mobile remains scrollable and free of horizontal overflow.

## Boundaries and coordination

- No clinical workflow, persistence, permission, current-client census, or live records changed by this presentation pass.
- Captures use the local isolated Playwright application, Taylor Rivera practice data, and the existing sanitized directory fixture. Workflow signed/submitted states are mocked at the API boundary for screenshots; no signed clinical record is manufactured in a store. The capture test rejects non-loopback hosts.
- Scheduling uses General Changes sources `925c58aab975403c78e3f8732f7670aa217b8ef8` and `e5b3b4fd3cd111790b9e6cfcea8b77f86bf946d3`. This pass raises the coach to 120 and spotlight to 110 above the appointment form at 100; the scheduling owner implemented the shared keyboard cycle and guide-first Escape behavior.
- The Home owner confirmed its default contents/terminology remain representative of the capture. Rearranged personal layouts can differ.
- Deployment is coordinated through the existing release task, not a separate source deployment.

## Evidence

`npm run build -- --webpack`, focused ESLint, `training:refresh`, `training:route:check`, `demo:check`, complexity audit, and `git diff --check` passed. Complexity uses the existing approved baseline/dispositions; this is not a claim that unrelated hotspots were corrected.

17 focused Chromium checks passed in 18.7 seconds in `.data/presentation-release-evidence`: all screenshot alternatives load, desktop/mobile slide sizing, native enlargement and keyboard restoration, live Language Lab parity, walkthrough navigation through all 12 assessment sections, scheduling-to-assessment continuity, full-screen scheduling layouts, guide layering/pointer operation, and appointment/coach Tab and Escape handling. This is bounded presentation/workflow-guide evidence, not a full application certification.

To regenerate synthetic source images, run the `captures the real screens` and `keeps the scheduling walkthrough` cases in `tests/e2e/presentation-screens.spec.ts` against the local prebuilt Playwright application. Inspect the PNG outputs before replacing public assets. Application UI changes—not prose-only changes—are the trigger to recapture affected screens.
