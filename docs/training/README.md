# Pipeline Learning Center

The Learning Center is Pipeline's maintained end-user training and readiness system.
It teaches the governed referral-to-assessment workflow through role-specific instruction,
synthetic practice, decision simulations, job aids, and supervisor-observed certification.
It also provides deterministic guided mode over the real product interface.

## Product Contract

- `/training` is available to every authenticated Pipeline user.
- The learner's assigned Pipeline role determines the required path.
- Training never grants application permissions.
- Exercises and evidence use synthetic information only. PHI, packet text, credentials,
  production identifiers, and live meeting links are prohibited.
- Per-user progress is stored in `pipeline.user_workspace_state` as
  `operator_training_progress`, with optimistic revision checks and browser fallback.
- Completion means the digital preparation gates passed. A supervisor still owns observed
  practice and final sign-off.
- Guided mode is authored and versioned. It does not call an LLM, inspect field values, or
  perform save, sign, decision, export, or handoff actions.

## Learning Surfaces

| Surface | Purpose |
| --- | --- |
| My Path | Four-step mastery sequence for every required role module |
| Guided Workflows | Chat-style, action-verified job rehearsals inside the real application |
| Practice Lab | Adverse and routine decision simulations with rationale |
| Job Aids | Current, pressure-ready workflow checklists and stop conditions |
| Product Map | Connected ownership map from inbound referral through EHR handoff |
| Certification | Readiness gaps, confidence, scenario results, and sign-off status |

## Maintenance

Run `npm run training:refresh` after an intentional product or curriculum change. It
updates the reviewed source fingerprint. Run `npm run training:certify` before release.
The certification fails when source anchors disappear, role paths break, required
activities drift, scenarios lose a single safe answer, or the reviewed fingerprint is stale.

Run `npm run test:e2e:training` against the configured Playwright server to exercise the
actual learner path, simulation, guided clicks/input/selection changes, human commit boundaries, job-aid search,
product map, certification, persistence, profile-menu discovery, and narrow-screen layout.

Curriculum version changes are deliberate. Increment the version when a material workflow,
permission, safety rule, or user action changes. Users retain historical completion evidence,
but affected modules should be reassigned by the operational training owner.

## Ownership

- Product owner: defines the current workflow and role boundaries.
- Clinical/operations owner: approves safety language, stop conditions, and competency criteria.
- Engineering owner: keeps routes, source anchors, persistence, and tests current.
- Supervisor: observes real-world performance using synthetic or approved training records.
- Learner: completes assigned preparation and identifies where coaching is still needed.
