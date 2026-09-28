# Training Change Governance

## Change Triggers

Review training when any of these change:

- a page, route, field, status, stage, or navigation destination;
- role permissions, assignment visibility, or decision authority;
- packet extraction, human review, or document-completeness behavior;
- assessment scheduling, questionnaire, completion, signing, or recommendation;
- admission requirements, EHR handoff, retry, or exception handling;
- metric definitions, report filters, exports, retention, or privacy controls.
- a guided-tour route, target, advance rule, or safety boundary.

## Updating the current tutorials

1. Identify the instructions or walkthrough steps affected by the product change.
2. Update them from the actual workflow.
3. Run `npm run check:tutorials` and the affected tutorial browser journeys.

Normal releases do not require course-hour/module quotas, Academy atlas updates,
or Academy/training registry refreshes. The old curriculum certification commands
are optional tools for requested course maintenance. The September 26 policy in
[AGENTS.md](../../AGENTS.md) supersedes earlier mandatory certification sequences.

Guided targets are source-owned contracts. Rename or remove a `data-guide-target` only with
the corresponding authored-action update. Auto-advance is limited to the registered safe
click, input, and change targets. The guide may verify a user-initiated edit event but must
never read or persist its value. Create/save, schedule submission, sign, decision, export,
and handoff controls remain explicit human checkpoints and are never clicked by the guide.

## Release Rule

Tutorial checks must preserve access control, saved progress, safe navigation, and
the separation between fictional practice and real client records. Review material
workflow guidance when it changes; stale learning fingerprints do not block an
unrelated application release.
