# Assessment Free-Text Guide

Pipeline displays an embedded answer format beneath each free-text assessment field. There is no separate notes workflow: the guidance belongs to the canonical field where the assessor records the answer.

## User experience

1. Open a narrative field in the assessment interview.
2. Expand **Answer format**.
3. Review that field's preferred format, expected length, exact information order, required elements, synthetic example, and documentation guardrail.
4. Enter the verified information in the assessment field.

The guide never reads, sends, rewrites, or saves the assessor's answer. It makes no diagnosis, recommendation, admission decision, or workflow transition.

## Implementation

- `lib/assessment/assessment-narrative-guide.ts` assigns every textarea field to an explicit writing-purpose track and safety guardrail.
- `lib/assessment/assessment-field-writing-spec.ts` gives every textarea its own format, information order, required-elements checklist, length guidance, and synthetic example.
- `components/pipeline/AssessmentWorkspace.tsx` renders the matching guide for textarea fields.
- Structured fields do not receive narrative guidance.
- The legacy `assessment_notes` data field remains import-compatible but is not a separate interview question; assessors use the canonical fields and **Additional information**.
- All examples are synthetic documentation patterns rather than client records.
- No API route, external model, provider secret, feature flag, or network request is involved.
- Startup and contract assertions fail if a new textarea field is added without both a purpose track and a field-specific writing specification.

## Updating guidance

Changes should be reviewed with the assessment coordinator and clinical leadership. Keep each domain concise and operational:

- Name the facts and sources assessors should capture.
- Preserve uncertainty and current-versus-historical distinctions.
- Avoid diagnostic, legal, medication, or placement conclusions.
- Never use production client text as an example.
- Update the assessor workflow contract when the behavior changes.
