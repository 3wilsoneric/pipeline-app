# Assessment Language Lab

`/note-lab` is a temporary, hidden supervisor workspace for defining what a complete answer must contain for each free-text assessment field. A calibration reviews 15 fields. Each step has two decisions:

1. Confirm which documentation criteria are required for that field.
2. Judge one safely redacted historical answer as `teach`, `revise`, or `do_not_teach`, with controlled revision reasons when it is not accepted as written.

The output is an advisory field-standard profile. It does not update the live assessment, score an assessor, infer a diagnosis, or influence an admission decision.

## Documentation Standard

The lab uses nine bounded criteria. They are deliberately more specific than a generic writing-quality score:

- answer the active field directly;
- identify whether information came from the client, collateral, a supplied record, or direct observation;
- distinguish current status from history and state recency, frequency, or duration when relevant;
- use observable or reported facts instead of labels, unsupported conclusions, or character judgments;
- connect a finding to function, safety, care needs, or placement when that relationship matters;
- record the response, effective support, observed outcome, or owner of the next action;
- preserve unknown, unverified, conflicting, alleged, and incomplete information;
- use person-centered, non-stigmatizing language; and
- omit copied, stale, irrelevant, and duplicated narrative.

Each field also has a draft format, length guide, required elements, and reference answer in `lib/assessment/assessment-field-writing-spec.ts`. Supervisors refine the evidence requirements during calibration; the draft is not automatically promoted to production guidance.

## Standards Basis

The criteria are a product interpretation of authoritative documentation and safety guidance, not a claim that Pipeline is itself an EHR certification or clinical-practice standard:

- [California DHCS BHIN 23-068](https://www.dhcs.ca.gov/Documents/BHIN-23-068-Documentation-Requirements-for-SMH-DMC-and-DMC-ODS-Services.pdf) requires standardized behavioral-health assessment content and supports timely, clinically appropriate assessment.
- [DHCS Behavioral Health Documentation FAQ](https://www.dhcs.ca.gov/calaim-behavioral-health-initiative-frequently-asked-questions-calaim-bh-initiative-faq-bh-doc-redesign/) emphasizes sufficient individualized detail, strength-based person-centered care, reuse of already documented requirements to avoid duplication, and accurate representation in the member record.
- [ONC SAFER Clinical Communication Guide](https://healthit.gov/resources/2025-safer-guide-clinical-communication/) emphasizes complete and reliable information at referrals and transitions and clinician validation of generated content before signoff.
- [CMS psychiatric hospital assessment guidance](https://www.cms.gov/files/document/r235soma.pdf) identifies psychiatric history, non-psychiatric medical history, mental status, legal status, and recommended treatment as important assessment content.
- [SAMHSA person-first language guidance](https://store.samhsa.gov/sites/default/files/pep23-06-01-010.pdf) explains why language should not equate a person with substance use or a condition.
- [AHRQ patient-safety guidance on copy/paste](https://psnet.ahrq.gov/perspective/ehr-copy-and-paste-and-patient-safety) describes the risk of inaccurate, outdated, and overly long copied documentation obscuring the current clinical picture.

Program leadership and qualified clinical/compliance reviewers must approve any final standard against the exact services, licenses, contracts, and jurisdictions in which Pipeline is used.

## Historical Corpus

Historical Allo canvas text is supporting evidence, not ground truth. The deterministic corpus pipeline:

1. splits broad summaries into evidence-sized passages;
2. maps a passage to a canonical Pipeline assessment field only when field-specific language is present;
3. quarantines ambiguous and unmatched text instead of forcing a field assignment;
4. masks the source-canvas identity plus dates, email addresses, phone numbers, URLs, and common identifiers; and
5. exposes only one field-matched redacted answer at a time inside the authorized supervisor route.

The current private profile contains 445 source records, 6,444 candidate passages, and about 900 deduplicated mapped samples across 61 field groups. Its mapping rate is about 20 percent, which is intentionally conservative. Most mappings are medium-confidence routing assignments. A mapping says only that the text appears relevant to a field; it is not a quality label and does not make the answer safe to teach.

The source corpus remains private. The repository contains only aggregate counts and deterministic processing code. Automated masking reduces obvious identifiers but is not a formal HIPAA de-identification determination.

## Safety Boundary

- Only `admin` and `assessment_coordinator` roles may enter the page or call its API.
- The route is `noindex`; API responses are `private, no-store`; mutations require same-origin validation.
- Private file manifests are disabled in production. Production samples must come from access-governed Pipeline database records.
- The browser may receive one redacted historical answer for review. The saved review never contains note text, source-canvas ID, client identity, or the reference answer.
- Stored data consists of reviewer ID, calibration/scenario/field IDs, selected criterion IDs, opaque sample ID, disposition, revision reason IDs, and timestamp.
- Every field saves independently with optimistic revision checks and a per-reviewer PostgreSQL advisory lock.
- Corpus text, field standards, and supervisor decisions must not be sent to a third-party model by this feature.

## Persistence

Development stores version 3 reviews in ignored, owner-readable `.data/note-lab-field-reviews.json`. The previous pattern-selection file is preserved but not read by this calibration version.

Production stores immutable reviews in `pipeline.note_lab_field_reviews` after migration `0023_note_lab_field_reviews`. Migration `0022_note_lab_pattern_selections` remains the audit history for the retired format-only experiment. A new calibration version starts a separate review series rather than rewriting earlier decisions.

## Enable Or Remove

Set `PIPELINE_NOTE_LAB_ENABLED=true` to expose the route. Production defaults to disabled. Set the flag to `false` to close access without deleting review history.

For offline corpus analysis, set `PIPELINE_NOTE_LAB_MANIFEST_PATH` to the private prepared manifest and run `npm run note-lab:analyze`. The aggregate-only output is `.data/private-note-lab-corpus-profile.json`.

To analyze the structure of notes linked to clients with an explicit historical admission date,
run `npm run note-lab:analyze:admitted -- --manifest=/absolute/path/to/pipeline-client-history-with-allo-notes.json`.
The command deduplicates exact repeated note text and writes an aggregate-only, owner-readable
profile to `.data/private-admitted-note-structure-profile.json`. It reports documentation shape,
source and timeframe markers, uncertainty handling, action language, functional context, and
conservative field mappings. It never writes client IDs, canvas IDs, note text, or example phrases
to the profile.

The admitted profile is descriptive. Because the current master history is an admissions census,
it has no valid non-admitted comparison group and cannot identify language that caused admission,
predict rejection, or support an automated decision rule. That research requires adjudicated
non-admitted outcomes collected under the same workflow and policy version.

Run `npm run check:note-lab` for the feature boundary contract. Apply database migrations before enabling the deployed route.

## Publication Gate

The 15-field profile is a discovery artifact, not a production policy. Before live guidance changes:

1. collect reviews from the intended supervisor group;
2. measure agreement by field, criterion, disposition, and revision reason;
3. adjudicate disagreements with clinical and operational leadership;
4. approve a versioned field standard with an effective date and named owner;
5. test the standard against held-out historical answers and realistic referral scenarios; and
6. publish guidance separately, retaining the reviewed version for audit and rollback.

Do not rank employees, infer diagnoses, automate admission decisions, or use protected/client attributes as shortcuts. Any future model should predict only narrow writing attributes against held-out human labels, retain provenance, report uncertainty, and remain advisory.

## Future Research: Admission Review Cues

This is a documented research track only. It does not add UI, score an assessment,
or create admission logic. Revisit it after the assessment workflow and program-specific
admission policies are approved.

The question to study is: which combinations of structured answers and attributed
narrative evidence should tell a qualified reviewer to stop, request more information,
or perform a policy review before an admission decision? The system must not infer
`admit` or `do not admit` from a phrase alone.

### Proposed Decision Structure

1. Evaluate explicit structured answers as `yes`, `no`, `unknown`, or `not assessed`.
2. Apply only versioned, program-specific policy rules approved by clinical, operational,
   legal, and compliance owners.
3. Separate possible outcomes into `continue review`, `missing information`,
   `clinical or safety escalation`, and `program-policy review`.
4. Treat narrative language as supporting evidence or a review cue, never as a silent
   exclusion rule.
5. Require the reviewer to see the triggering field, source, timeframe, policy rule,
   and reason before confirming any outcome.
6. Preserve overrides, reviewer rationale, rule version, and the final human decision
   for audit and later calibration.

### Evidence Required for a Cue

A candidate cue must retain:

- the canonical assessment field and structured answer;
- who supplied the information: client, collateral, record, or observation;
- whether it is current, historical, alleged, conflicting, or unverified;
- relevant frequency, recency, severity, response, and outcome;
- the community or program policy in force at the time;
- the exact approved rule and effective date; and
- the follow-up action that can resolve or escalate the issue.

Phrase detection must account for negation, subject, quotation, timeframe, source,
and uncertainty. For example, a historical record statement, a client denial, and a
current direct observation cannot be treated as equivalent because they contain the
same term. Keyword matches may nominate examples for supervisor review, but they may
not create a hard stop.

### Supervisor Calibration Session

For each structured question and free-text field, supervisors should decide:

- whether any answer is a true program-policy gate or only a review cue;
- whether the concern is current, historical, resolvable, or an absolute policy issue;
- what corroborating source or documentation is required;
- what combination of answers changes the level of review;
- which facts must never be used as shortcuts, including protected characteristics;
- what safe next action the assessor should take; and
- which realistic counterexamples would make the proposed rule wrong.

Agreement and disagreement should be measured across reviewers. Candidate rules need
adjudicated examples, counterexamples, false-positive tests, false-negative tests, and
an owner before publication. Rules must be evaluated separately for each community or
licensed program when their requirements differ.

### Future Rule Artifact

If this research is approved, store rules as a versioned policy artifact rather than
component conditionals or a phrase list. Each rule should include an ID, scope, field,
structured-answer condition, required evidence, permitted outcome, explanation,
policy owner, effective dates, and test cases. The only initial runtime output should
be an explainable request for human review.

The existing `assessment_decision` patterns in
`lib/note-lab/note-lab-taxonomy-core.mjs` are corpus-routing patterns only. They are not
admission cues, policy rules, labels, or evidence that an historical decision was correct.
