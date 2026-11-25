# Ally assessment reads

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
