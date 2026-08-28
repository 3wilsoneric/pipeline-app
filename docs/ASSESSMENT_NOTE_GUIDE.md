# Assessment Note Guide

Pipeline displays an embedded writing guide beneath each narrative assessment field. The guide is deterministic: it is selected from the field's assessment domain and rendered directly in the browser.

## User experience

1. Open a narrative field in the assessment interview.
2. Expand **Note guide**.
3. Review the field-specific **Things to note**, **Strong note pattern**, and documentation guardrail.
4. Enter the verified information in the assessment field.

The guide never reads, sends, rewrites, or saves the assessor's note. It makes no diagnosis, recommendation, admission decision, or workflow transition.

## Implementation

- `lib/assessment/assessment-note-guide.ts` maps assessment sections to fixed documentation domains.
- `components/pipeline/AssessmentWorkspace.tsx` renders the matching guide for textarea fields.
- Structured fields do not receive narrative guidance.
- All examples are synthetic documentation patterns rather than client records.
- No API route, external model, provider secret, feature flag, or network request is involved.

## Updating guidance

Changes should be reviewed with the assessment coordinator and clinical leadership. Keep each domain concise and operational:

- Name the facts and sources assessors should capture.
- Preserve uncertainty and current-versus-historical distinctions.
- Avoid diagnostic, legal, medication, or placement conclusions.
- Never use production client text as an example.
- Update the assessor workflow contract when the behavior changes.
