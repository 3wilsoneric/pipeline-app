# Admission lifecycle evidence — November 25 candidate

Directory, workspace and batch review reads now expose the same admission
projection used by the operating summary: planned date, confirmed arrival,
due-plan assumption, recorded decision and cancellation. They reuse the canonical
admission helpers. An active workspace is a storage state, not proof that the
client is still awaiting admission; an assumed date is not census confirmation.
This lets the analyst reconcile detailed records against the operational cohort
without inventing a second admission rule. No records or workflow actions change.

A focused regression covers due and future plans, cancelled placements and
confirmed arrivals across all three readers, preserving the original records.
The source/summary suite passes 19 tests and TypeScript passes. Real delegated
cohort verification and deployment remain outstanding for this candidate.

# Exact source pagination — November 25 candidate

Canonical referral, assessment and file readers now retain PostgreSQL's
microsecond cursor precision. Cursor parameters bind as text before the database
timestamp cast; the default driver timestamp serializer otherwise converts them
through millisecond-only JavaScript dates. Assessments also retain the database's
exact timestamp when constructing the cursor. No records or migrations change.

A disposable PostgreSQL instance with every existing migration reproduced
duplicate ascending referrals and skipped descending referrals, assessments and
files. The same regression passes for all five paths after the fix, including
equal-timestamp ID ties, multiple pages and finite termination. The reads execute
in a read-only transaction. Local/cohort parity and source checks also pass.
This is a local candidate pending source release and real cohort verification.

# Workspace investigation — November 24 source release

`workspace-review` accepts one to six explicit referral IDs and composes their
canonical workflow snapshots with the existing note-block store. It retains
identity, requirements, decisions/reviews/recommendations, assessment state and
unaltered referral/assessment note fields and note blocks with their identities
and versions. It does not copy each checklist three times. Missing workspaces
fail explicitly; partial batches cannot silently omit a client.

This is a reusable record projection, not a delay classifier or new database.
Clinical question answers, documents, communications and imported history keep
their existing source readers. Response completeness means the requested records
were returned; it does not prove the requested IDs are a complete population or
create an atomic historical snapshot. Platform binds response continuations to
the exact content hash, rejecting any changed batch. No clinical records or
workflow actions change.

Focused source tests and TypeScript checks pass. A private deterministic replay
of thirteen real accepted workspaces preserves every requirement and note block,
with the largest record 8,410 bytes. Model interpretation is a separate proof
obligation; it is not claimed by that replay. Source commit `8ba03860` passed the
native Linux packaged OCR/PDF and read-only source check and is deployed as
`pipeline-prod-web--ally-invest-v12`. Live delegated reads preserved both requested
record identities across revision-bound response pages. Existing environment,
identity and application configuration were unchanged. Image and conditional
rollback receipts are private in
`/Users/eric/suite-deploy/.state/ally-system-repair-20261124/investigation-v12/`.

# Ally assessment reads

## Assessment semantics — included in the November 24 source release

The canonical assessment context now names its product type: Pipeline intake
assessment. The catalog, individual record and cohort reader reuse that same
definition. Cohort rows retain workflow status and the separately named planned
interview method. They do not invent clinical instrument types or standardized
scores; all Pipeline intake records use the same questionnaire family. Source
identity and question-definition hashes still travel with the answers. Focused
source tests cover identical semantics across individual and cohort reads.


The organizational read-only connector now supports `assessment-review`. It pages
through the canonical assessment store and joins each result to its current,
non-deleted referral. Select question keys or a question-label search, community,
owner and an explicit timestamp field/range. It returns source answer states,
visibility, requirement and provenance together with each assessment identity.

Both assessment and referral revisions bind continuation. A changed source asks
the agent to restart; an empty filtered page is not proof of an empty cohort.
Follow every cursor. No assessment, decision, signature or admission is changed.

The focused source tests cover both owner revisions, missing/unknown answers,
drafts, deleted referrals, source authentication, API read-only methods and source
rechecking before returning data. Deployment and real-data evidence are tracked
in the Ally engine build spec; this is candidate source until that receipt exists.
# November 24: cohort filtering candidate

Assessment review applies its requested timestamp range in the canonical list
reader before pagination, in both local and PostgreSQL adapters. This avoids
making Ally scan unrelated recent pages to reach an older cohort. Missing dates
remain excluded from a dated cohort; unfiltered callers retain their behavior.
Community/owner and trash checks remain at the source, and continuation still
checks both source revisions. Read-only adapter parity tests cover inclusive
boundaries, timezone equivalents, missing dates and multiple pages.
