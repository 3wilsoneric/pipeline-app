# Assessor workflow review — September 17, 2026

This product change allows incomplete work to progress and separates acceptance, signing, and packet delivery. It is based on held commit `3df42b1314184fb8753b6816fad575d18dbec046`. It does not deploy or remove the production maintenance cover.

| Assessor action | Result and owner |
| --- | --- |
| Create an empty referral | Create referral is enabled without a name, DOB, source, or attachment. Existing server defaults and assessor assignment remain authoritative. |
| Open the questionnaire during an upload | The intake completion rail allows it. Uploads and extraction conflicts do not disable questionnaire navigation. |
| Start a new questionnaire when census identity is unavailable | New drafts remain attached to the authorized referral with null census identifiers. Verified identifiers are retained when available. No identity is guessed. |
| Schedule with missing contacts | Contact readiness is advisory, including a failed contact lookup. Real appointment dates still need valid syntax; the existing unscheduled path remains available. |
| Leave assessment answers blank | Existing draft, start, section navigation, and explicit signature paths accept omitted clinical answers. Completion guidance does not require every answer. |
| Return to intake or files | Closing the editor and choosing Intake returns to the same workspace. Acceptance does not close access to intake, documents, or questionnaire editing. |
| Save a recommendation before signing | Assigned assessor can save and revise the recommendation. It creates no signed assessment, submitted review, or final decision. Local and PostgreSQL stores retain the recommendation ID and increment its version. |
| Record acceptance before signing or before a questionnaire exists | Existing supervisor authority can record the decision independently. A matching submitted review is acknowledged only when it actually exists at the recorded assessment version. |
| Sign later | Signing remains an explicit action. It does not accept the referral, submit a supervisor review, or send mail. Signed originals remain frozen; the existing correction/addendum paths remain. |
| Prepare and send later | Summary selection uses the referenced signed assessment, even when signing happened after acceptance. A blank admission date is allowed. Delivery separately audits the actual signed version and requires an explicit send. |
| Report accepted work | Early acceptance without an assessment ID is attributed to the referral's first assessment revision family, in both adapters. Later unrelated assessments are not all counted as new accepted clients. |
| Recover unfinished work | Existing encrypted browser/server recovery remains. Late recovery responses no longer overwrite a newer edit or a completed server/file save, and local-only recovery is never labeled Saved to Pipeline. |

## Boundaries retained

Authentication, assignment visibility, supervisor decision authority, same-origin checks, optimistic concurrency, mutation replay, signed-record integrity, and delivery authorization are preserved. Storage failures are not reported as successful saves. Navigation retains the only copy when neither browser nor server can preserve it.

Packet delivery still requires a signed assessment, acceptance, an actual safe packet, an authorized recipient, and configured mail delivery. These conditions apply to the explicit external send, not referral creation, questionnaire work, or acceptance. No email was sent during this review; provider calls were stubbed in delivery tests.

Draft identity enrichment is deliberately optional. When it cannot be verified, the draft remains accessible through its referral but is not added to census-linked history until an explicit verified identity update succeeds. Census import, explicit identity changes, and downstream EHR transfer retain their existing validation. If automatic reconciliation becomes necessary, add a separately audited identity-resolution operation; do not silently attach an unverified client.

Acceptance and a signed submission remain distinct even when they happen in either order. The accepted decision preserves the evidence available at that time. A later packet's delivery audit preserves the actual signed version sent.

## Focused evidence

Validation results are recorded in the exact-commit handoff under `.data/releases/assessor-workflow-review-handoff.json` and the deployment queue. Evidence includes empty-intake navigation, early acceptance, editing after acceptance, later signing and summary preparation, unsigned recommendation followed by signed submission, local/PostgreSQL parity, acceptance counts, authority/conflict/replay checks, recovery, and upload independence.

The four earlier desktop recovery failures included stale field selectors, expectations that typing commits before blur, and a test that assumed the optional Recent work Home module was enabled. The checks now exercise real field blur, the current labels, and explicit Home module configuration. Original failure artifacts were retained; no baseline waiver was used.

No production deployment or integration with the independently changing presentation branch is included. The earlier document-controls release still requires migration 0037 before application rollout; its recorded deployment-order issue remains separate. The separate Search Pipeline modal smoke finding is outside this bounded workflow review and remains queued.
