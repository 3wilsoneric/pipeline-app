# Prior admissions on imported charts

Owner request, 2026-09-28: record an admission that predates Pipeline without restarting intake; use current Alamo data as possible supporting evidence.

## Read-only production comparison

Compared the existing production database with the fresh Alamo roster dated 2026-09-28. Database queries ran in a read-only transaction inside the existing app environment. Only aggregate results were printed; no client data was exported or changed.

- 2,604 historical ALLO workspaces; 874 already have imported admission dates.
- 541 current roster residents, all with admission dates.
- 472 historical workspaces have an exact normalized-name overlap with the roster. These are workspaces, not distinct people or verified matches.
- 1,724 historical workspaces lack DOB. The roster list supplies no DOB for any of its 541 residents. Three matching detailed resident records were checked; none supplied DOB either.
- No confirmed resident links to current roster entries were found for these historical workspaces. Therefore no automatic admission updates or identity joins are justified by this comparison.

## Local implementation

The historical Chart offers **Record prior admission**, or **Correct prior admission** when an admission date is already recorded. Existing imported dates are retained until an operator explicitly confirms a change. The operator enters the actual date and community and confirms the admission. A unique, fresh, exact-name roster suggestion can be explicitly copied, but is labeled as possible evidence—not a verified identity or the same admission episode. Duplicate names and conflicting DOBs produce no suggestion. Missing/stale/paginated/unavailable roster data never blocks manual confirmation.

The canonical referral store receives only `admissionDate` and `community` through the dedicated historical command. It preserves the historical status, stage, workflow, assessments, notes, documents, and person identity. Ordinary historical updates/uploads/trash remain disallowed. The existing outcome projection displays **Historical · Admitted**. Historical workspaces remain excluded from active referral queues and new-intake reporting; no current census count is changed.

Both adapters retain version checks, idempotent command retry, and the existing audit write. Field provenance explicitly identifies operator confirmation rather than a governed census match. Audit before/after values retain the original admission evidence. There are no migrations, assessment signatures, identity-link writes, packet/email sends, or new referrals.

Known ceiling: one admission per historical workspace; it does not resolve duplicate charts, reconcile all admission episodes, or assert current residency. If staff need several distinct admissions on one historical chart, review episode modeling separately rather than overwriting one date with the next stay. Strengthen automatic matching only after the upstream provides a verified identity key/DOB and admission-episode evidence.

## Evidence

- Focused policy, API, local-store and real PostgreSQL tests cover input scope, dates, access/origin, explicit consent, retry deduplication, stale versions, competing writes, audit rollback, and exclusion from active queues.
- Browser tests cover desktop/phone entry, roster unavailability, retained input and same-command retry after failed save, reload, accessible controls and close without mutation.
- Production was only inspected. No bulk admissions, push, merge, or deployment is part of this change.
