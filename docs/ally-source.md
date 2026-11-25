# Workspace investigation — November 24 local candidate

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
with the largest record 8,410 bytes. Model interpretation and live deployment are
separate proof obligations; neither is claimed by that replay.

# Ally assessment reads

## Assessment semantics — November 24 local candidate

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
