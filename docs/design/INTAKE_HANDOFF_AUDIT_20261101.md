# Intake through handoff: 2026-11-01 release audit

Scope: the approved Carelog presentation and navigation updates. Assessment questions, stored answers, admission rules, APIs, authorization, migrations, and mail delivery behavior are unchanged. Synthetic local records were used; no production patient records or real email were created.

## Flow reviewed

| Surface | User action and retained behavior | Audit result |
| --- | --- | --- |
| Home | Open Upcoming assessments, In progress, or Clients in handoff; resume pinned/recent work | Three equally sized entry points. Accepted work enters Handoff only when its authoritative board stage is decision; reassessment remains In progress. Unavailable data is not shown as zero. |
| New intake | Upload and label files, enter details, expand/collapse the checklist, create the referral | Removed the duplicate Files destination from unsaved intake. The checklist stays at its trigger and supports keyboard toggling. Reserved draft-save space fixes a six-pixel control shift on narrow screens. |
| Created chart | Prepare now or schedule; reopen the created workspace | Removed the repeated explanation below the two explicit actions. Neither action starts an interview. Files and progress are available after creation. |
| Preparation and interview | Review source information, schedule, explicitly begin, move between all assessment sections, save and reopen | Removed the recurring phase paragraph in the redesigned view. Questions, conditional fields, notes, and collected data are untouched. |
| Working decision | Earmark Accept/Deny before signing; change it or leave it unset | The existing recommendation persists without finalizing a decision. Hidden after signing/recording when clean; pending saves, errors, and retry remain mounted and visible. |
| Review and signature | Review answers and sign explicitly | Signing remains separate from acceptance and email. Incomplete-answer notices remain informative. Existing answers and signed history are retained. |
| Final decision | Confirm a matching earmark, or deliberately choose the final outcome | Matching current signed recommendations use one confirmation. Changed, older, or absent recommendations retain the full choice and confirmation. Failed saves remain retryable without duplicate commands. |
| Handoff | Review To/Cc, admit date, branded message, selected files, authorize recipients, preview and send | Placement is labeled Handoff. The working message now shows the same Alamo logo as the outgoing preview. Removed the stale instruction to enter the admit date in Decision. No automatic send on acceptance or reopen. |
| Reopening and failures | Leave and return; recover failed draft, date, signature, decision, and recipient saves | Entered values persist; unsaved/invalid values remain visible for correction. Changed recipients clear authorization. Existing send and duplicate-send warnings remain. |

The Clients sidebar entry is removed as requested. Existing direct URLs, profile data, and Back to profiles remain functional. Performance checks now cover direct directory entry under the existing useful-content budget, retained profile-return navigation under its existing warm budget, and the visible intake checklist instead of the removed draft Files button.

## Evidence

- Production build, TypeScript, ESLint, full platform fast contracts, assurance registry, and enterprise foundation checks passed locally.
- Initial isolated journey run: 103/108 passed. Three narrow-screen checklist position failures exposed the layout shift; two stale Placement selectors were corrected to Handoff without changing assertions.
- Follow-up isolated production-build run: 77/77 passed, covering those failures, interview recommendations, signature/decision recovery, handoff editing/reopening, inbox history, file choices, keyboard controls, and desktop/phone/iPad layouts.
- Reviewed desktop and phone screenshots; Mac and Linux visual snapshots were updated only for the approved home, sidebar, and intake changes and passed a separate comparison run.
- The full CI browser run exposed a remaining accessibility test using the removed draft Files destination. It now exercises the inline checklist and verifies Files after creation; all six desktop/phone accessibility checks passed locally with the existing assertions and thresholds.
- Required GitHub PR, security, browser, operational, and performance gates remain release requirements. No branch-protection bypass or assertion/threshold relaxation is authorized by this audit.

Rollback uses a known production image and preserved runtime configuration, not a database restore. Friday's image rollback remains documented in [CARELOG_RELEASE_ROLLBACK.md](CARELOG_RELEASE_ROLLBACK.md).
