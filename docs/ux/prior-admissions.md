# Prior admissions on imported charts

Owner request, 2026-09-28: record an admission that predates Pipeline without restarting intake; use current Alamo data as possible supporting evidence.

## Read-only production comparison

Compared the existing production database with the fresh Alamo roster dated 2026-09-28. Database queries ran in a read-only transaction inside the existing app environment. Only aggregate results were printed; no client data was exported or changed.

- 2,604 historical ALLO workspaces; 874 already have imported admission dates.
- 541 current roster residents, all with admission dates.
- 472 historical workspaces have an exact normalized-name overlap with the roster. These are workspaces, not distinct people or verified matches.
- 1,724 historical workspaces lack DOB. The roster list supplies no DOB for any of its 541 residents. Three matching detailed resident records were checked; none supplied DOB either.
- No confirmed resident links to current roster entries were found for these historical workspaces. Therefore no automatic admission updates or identity joins are justified by this comparison.

## Implementation

The historical Chart offers **Record prior admission**, or **Correct prior admission** when an admission date is already recorded. Existing imported dates are retained until an operator explicitly confirms a change. The operator enters the actual date and community and confirms the admission.

The lookup now uses the full governed Alamo client directory and client record, not the DOB-free roster. It requires a fresh, complete, unique exact-name directory match and fresh matching client detail. It displays the source DOB and recorded date/community pairs for explicit selection; matching recorded DOB is distinguished from name-only possible evidence. Duplicate names, inconsistent source DOBs, and conflicting chart DOBs produce no suggestion. Date-valued timestamps preserve their calendar day. Separate stays retain their own community/date; an earliest admission is never paired with a later community. Selecting a stay resets confirmation. A slow lookup never replaces typed input or blocks manual recording, and unavailable/stale/paginated data leaves manual entry available.

The canonical referral store receives only `admissionDate` and `community` through the dedicated historical command. It preserves the historical status, stage, workflow, assessments, notes, documents, and person identity. Ordinary historical updates/uploads/trash remain disallowed. The existing outcome projection displays **Historical · Admitted**. Historical workspaces remain excluded from active referral queues and new-intake reporting; no current census count is changed.

Both adapters retain version checks, idempotent command retry, and the existing audit write. Field provenance explicitly identifies operator confirmation rather than a governed census match. Audit before/after values retain the original admission evidence. There are no migrations, assessment signatures, identity-link writes, packet/email sends, or new referrals.

Known ceiling: one confirmed admission per historical workspace; it does not resolve duplicate charts, join identities, copy a possible match's DOB into the chart, or assert current residency. Staff confirm the person and relevant stay. If staff need several distinct admissions on one historical chart, review episode modeling separately rather than overwriting one date with the next stay. Bulk identity linking or DOB backfill requires independently reviewed identity evidence; the lookup is not that operation.

The roster comparison above did not establish missing DOB in the full client database: subsequent read-only checks found DOB in 8/8 sampled full client records. The new lookup was exercised against four full records found through roster-name searches; all four yielded source DOB and admission evidence. Only aggregate counts were printed, with no writes or exports of client details.

## Evidence

- Focused policy, API, local-store and real PostgreSQL tests cover input scope, dates, access/origin, explicit consent, retry deduplication, stale versions, competing writes, audit rollback, and exclusion from active queues.
- Browser tests cover desktop/phone entry, full-record DOB, choosing between stays, late-lookup input preservation, lookup unavailability, retained input and same-command retry after failed save, reload, accessible controls and close without mutation. Four tests pass in each design.
- Focused policy/API/local-store/real PostgreSQL tests pass 7/7; historical-profile contracts pass 21/21. Production build and focused ESLint pass.
- The manual command shipped in PR #217 / `dd391e79` and Azure run 36508710509. This follow-up replaces only the optional lookup/presentation, not the saving command. No client records were changed by these checks.
