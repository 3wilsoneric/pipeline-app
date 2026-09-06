# Pipeline Learning Center

The Learning Center is Pipeline's entry point for the full workflow presentation and
quick, role-aware task help. Selecting a quick-help task opens its exact clickpath before
the guided walkthrough begins.

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

## Visible Learning Center

| Surface | Purpose |
| --- | --- |
| Pipeline walkthrough | Prominent link to the existing presentation, referral journey, and synthetic practice environment at `/training/demo` |
| Quick help | Task tiles ordered from frequent frontline work to less frequent reporting and review tasks |
| Expanded task | Full-page clickpath, action list, duration, and one start control |
| Guided walkthrough | Deterministic in-product tooltip sequence that highlights and verifies authored actions |

The detailed curriculum, scenarios, job aids, product map, demo environment, and readiness
records remain maintained source material. They are not separate operator-facing tabs.

The interactive environment contract and two-week UAT plan are maintained in
[`docs/DEMO_ENVIRONMENT.md`](../DEMO_ENVIRONMENT.md).

## Maintenance

Run `npm run training:refresh` after an intentional product or curriculum change. It
updates the reviewed source fingerprint. Run `npm run training:certify` before release.
The certification fails when source anchors disappear, role paths break, required
activities drift, scenarios lose a single safe answer, or the reviewed fingerprint is stale.

Run `npm run test:e2e:training` against the configured Playwright server to exercise the
Learning Center, full walkthrough, common task interactions, pause/resume persistence,
profile-menu discovery, and narrow-screen layout.

Curriculum version changes are deliberate. Increment the version when a material workflow,
permission, safety rule, or user action changes. Users retain historical completion evidence,
but affected modules should be reassigned by the operational training owner.

## Ownership

- Product owner: defines the current workflow and role boundaries.
- Clinical/operations owner: approves safety language, stop conditions, and competency criteria.
- Engineering owner: keeps routes, source anchors, persistence, and tests current.
- Supervisor: observes real-world performance using synthetic or approved training records.
- Learner: completes assigned preparation and identifies where coaching is still needed.
