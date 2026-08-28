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

## Required Update

1. Identify affected modules, scenarios, job aids, and capability-map nodes.
2. Update behavior and safety language from the approved workflow, not from memory.
3. Increment `OPERATOR_TRAINING_VERSION` for material learner-facing change.
4. Run `npm run training:refresh` to review the current product-source fingerprint.
5. Run `npm run training:certify`, typecheck, production build, and browser journeys.
6. Decide whether existing users need the affected module reassigned.
7. Communicate the change with effective date and operational owner.

Guided targets are source-owned contracts. Rename or remove a `data-guide-target` only with
the corresponding authored-action update. Auto-advance is limited to the registered safe
click, input, and change targets. The guide may verify a user-initiated edit event but must
never read or persist its value. Create/save, schedule submission, sign, decision, export,
and handoff controls remain explicit human checkpoints and are never clicked by the guide.

## Release Rule

Passing automation proves structural alignment, not clinical or operational approval. A product
and operations owner must review material workflow guidance before release.
