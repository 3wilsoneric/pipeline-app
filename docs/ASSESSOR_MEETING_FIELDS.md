# Assessor meeting follow-up — September 17, 2026

The owner requested the proposed injection, acknowledgment, triggers, and physical-altercation changes, excluding Recovery History restructuring and source-attribution changes, and explicitly requested removal of Aggression Risk.

- IM injections reveals optional frequency, last injection, and next due entries. Existing injection notes remain separate. Each entry supports named medications on separate lines, approximate dates, and unknown values.
- Acknowledgment now explicitly concerns the impact of substance use. Saved `yes`/`no` values remain compatible; `partially` and `not_discussed` are additional choices. Notes are optional. The Recovery History grouping, sobriety choices, and treatment-history content remain unchanged.
- On follow-up, the owner requested removal of Triggers. The question is absent from the interview, current summary/profile, and newly requested extraction targets. Stored trigger history remains intact.
- Physical altercation Yes reveals optional prompts for the event, timing, context, and outcome.
- Aggression Risk remains absent from the interview and is removed from the current chart summary, profile presentation, and newly requested extraction targets. Its stored data is retained; no migration, stored-answer deletion, or rewrite of existing signed records or generated packet files occurs. Assault and elopement questions remain.

The new timing entries deliberately use the existing free-text field implementation. This supports incomplete and multi-medication answers without format-related save gates or invented due dates. They do not calculate medication schedules or support date-based reminders. Revisit structured per-medication rows only if the owner requests scheduling, reminders, or reporting over these dates.

Validation uses a production build/TypeScript check, scoped ESLint, assessment-practice/workflow/API contracts, and two isolated operational tests. The operational tests exercise actual field-exit saves, reopening the questionnaire, new and legacy acknowledgment values, signing with empty follow-ups, and retaining retired data while excluding it from the current report. Synthetic data and local test stores only; no external mail or production mutations.

Final results: build/TypeScript and scoped lint passed; 28 practice, 129 workflow, and 115 API contracts passed; both operational tests passed in 3.1 seconds. Initial browser attempts exposed fixture mistakes (a collapsed group, missing focus before synthetic select changes, and trying to reopen an already-restored questionnaire); these were corrected without changing product behavior. Original logs and traces remain under `.data/releases/meeting-*`.

This change is held with the existing release queue. It does not deploy or change maintenance availability.
