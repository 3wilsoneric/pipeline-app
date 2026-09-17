# Input, save, and upload dependencies

Audit date: 2026-09-17. Scope: referral intake chart, assessment questionnaire, their draft/recovery paths, and file uploads. This is a workflow-dependency inventory, not an npm-package list or a claim that every application surface has been certified.

The preparation, blur-save, and upload changes below are release candidates. Production is under the separate deployment task's maintenance/feature hold; writing this document does not deploy them.

## Workflow dependencies that should not stop data entry

| Dependency | Candidate behavior / disposition |
| --- | --- |
| Uploaded packet before typing intake | Manual intake remains editable without a packet; file processing is separate. |
| Completed intake or packet review before opening questions | The preparation candidate opens the questionnaire without those prerequisites. |
| Scheduled appointment before entering answers | Removed from the questionnaire controls. Preparation does not fabricate an appointment. |
| Pressing Begin before entering answers | Removed. Begin marks the actual interview start; it does not enable typing. |
| Every required answer before saving any answer | Partial field saves are allowed. Completion guidance is not an ordinary-draft save prerequisite. |
| A pause while typing | Removed as a server-save trigger. A changed cell commits on leaving that cell; moving between controls in one compound question does not commit early. |
| Another cell being typed while an earlier save runs | Blur captures the departed field's value. Requests are serialized without taking later, still-focused input into that request. |
| Finishing a file upload before an existing referral field saves | Field commits and file transfers have separate queues. Field blur does not run the file-upload loop. |
| Live census/resident lookup for every assessment answer | Removed for ordinary draft PATCH. The already-confirmed record identity is retained. Explicit identity changes still use the resolver. |
| Successful extraction before manually entering answers | Not required. Extraction review is a separate action; its own review endpoint requires an extracted packet. |
| Complete contact/profile information before scheduling | Existing route treats these as alerts, not a hard requirement. An unexpected contact-read failure can still fail that scheduling request; see residuals. |
| Retrying an upload after a lost response | The same referral/file content/name/type/category/intent produces the same reservation identity. Concurrent calls share an in-flight transfer; server reservation creation serializes that identity. Completion retries reuse it. |

## Dependencies intentionally retained

| Dependency | Why it remains |
| --- | --- |
| Signed-in user, role, referral ownership/assignment, same-origin checks | Prevents unauthorized access or writes. “No workflow locks” does not mean cross-account access. |
| Existing referral identity for an assessment or uploaded file | Keeps records attached to the right person. Before creation, intake can retain a private recovery draft. |
| Duplicate-referral confirmation | A matching person/county must not silently create another referral; confirmed different people can be created deliberately. Creation mutation IDs protect retries. |
| Field types, allowed dates, lengths, and upload size/type validation | Invalid canonical data is rejected without treating a successful local recovery copy as a server save. |
| Version/conflict checks | Never silently overwrite another person's change. Inputs remain available; the conflicting field/section needs an explicit resolution before its canonical write. Unrelated intake fields can still save. |
| Signed assessment immutability | Protects the signed record; corrections belong in an addendum or a new governed revision. |
| Historical imported chart immutability | Existing product rule preserves imported charts rather than turning them into active intake. Changing that policy is separate from autosave. |
| Admission decision before recording actual admission | An admission is a lifecycle fact, not an ordinary intake note. |
| Explicit Save, exit, Begin, account-switch flushes | Deliberate actions may flush pending input. Blur-only autosave does not mean discarding the active field when leaving the workflow. |
| Pending uploads/unsynced answers before account switching | Prevents an in-flight operation being attributed to the wrong account. This is not a prerequisite for continuing to type. |
| Authenticated API/database for canonical server saves | An outage cannot truthfully be labelled “Saved.” Assessment committed-write retries and local recovery remain separate from typing-triggered saves. |
| Browser encryption/storage for local crash recovery | Local recovery can run while typing; it is explicitly local, not a server commit. Storage failure must remain visible and must not erase the open input. |
| File hashing, upload reservation, storage transfer, completion | Needed for integrity and an attached, downloadable document. Azure storage availability and valid signed URLs remain infrastructure dependencies. |

## Residuals: not silently claimed removed

1. Initial assessment creation, import, packet sync, and explicit resident reassignment still use confirmed resident-link/identity resolution. For linked residents, an unavailable census or an ambiguous/missing identity can block those operations. Ordinary answer PATCH no longer invokes that lookup.
2. Scheduling's optional contact-readiness query is not fully failure-isolated: a thrown read error can still fail scheduling, even though missing contacts only produce alerts. It does not gate questionnaire input.
3. Explicit lifecycle operations use short busy states; signed records and access-denied records remain read-only. This change is not a blanket removal of those controls.
4. Intake's explicit full Save still requires resolving its known conflicts and finishing pending file operations. Ordinary field blur no longer depends on those unrelated file transfers; failed fields retain recovery rather than being silently discarded.
5. Assessment conflict enforcement is still section-versioned, not a general cross-user field-merge algorithm. A conflict in that section can defer that section's canonical write; local input is retained.
6. This audit does not certify contact-directory forms, Note Lab, administrator settings, or every other app's autosave semantics. Those are separate canonical owners.
7. Existing duplicate production documents have not been deleted. This fix prevents new duplicate identities on replay; identifying old duplicates and deciding which record to retain is a separate data-recovery step.

## Verification and limits

- `scripts/assessment-draft-save-boundaries.test.mjs`: ordinary answer saves do not require census identity resolution; explicit identity/access/conflict boundaries remain.
- `scripts/referral-upload-idempotency.test.mjs`: eight concurrent callers, lost reservation/completion replies, reload/downstream retries, failed binary transfers, and same-ID durable reservation serialization. Azure transfer responses and the PostgreSQL transaction scheduler are simulated here, not live infrastructure.
- `tests/e2e/operational/field-blur-upload.spec.ts`: isolated browser + real application routes/local stores. Checks no server writes during a typing pause, unchanged blur, captured-field requests while another field is active, compound-question reasons, explicit exit, file selection, lost completion acknowledgement, download bytes, retry deduplication, and a field save while upload completion is held.
- `tests/e2e/operational/assessment-preparation.spec.ts`: preparation, scheduling, starting, resume, ownership, and last-answer retention.
- Live deployment and live Azure/PostgreSQL proof belong to the deployment handoff. No production PHI was used or modified by these tests.

Deduplication intentionally applies to the same referral and file role, not globally across clients. Renaming a file, changing its content/category/processing intent, or uploading it to another referral can create a distinct document. A later completed retry can retransmit bytes to the same reserved object; it must not create another document row. Server-side completed-upload short-circuiting is warranted only if measured retry bandwidth becomes a problem.
