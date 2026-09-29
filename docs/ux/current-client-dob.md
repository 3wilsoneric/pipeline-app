# Current-client date of birth

Current census entries can omit DOB even when Alamo's full client record contains it. Client profiles now fill that display gap using the existing, complete client directory's unique resident-number index. Both directory and full record must also have the same normalized name. This is a read-only demographic projection: no workspace backfill, patient merge, admission change, identity-link write, or database migration.

Existing census DOBs are preserved. Missing/ambiguous resident numbers, stale or mixed-snapshot directories, changed full-record identity, invalid/future/conflicting dates, and source failures leave the census chart unchanged. Date-valued timestamps retain their calendar day. Optional lookup adds at most 1.5 seconds; the chart remains available on failure. Directory reuse is session-bound. Current-client list loading does not fan out into hundreds of detail requests; DOB supplementation happens when the chart is opened.

Evidence: the real owner was exercised read-only against all 541 current residents: 465 verified DOBs, 76 unresolved, all 541 canonical identities unchanged; maximum measured lookup 880 ms. No clinical values or identifiers were exported. Unit coverage includes duplicate resident numbers, name-only rejection, full-record revalidation, source conflicts, caching/session separation, and a hanging source. Launch projection contracts verify DOB reaches the census chart without synthesizing a canonical identity.

Local checks: production build, TypeScript, focused ESLint, clinical contracts, launch projection contracts, and DOB/prior-admission unit tests passed (the optional PostgreSQL unit variant was not selected). Desktop and phone browser tests passed against the production artifact, including reload, no clinical writes, and an unavailable DOB source retaining a usable chart. The browser fixture uses a context-level delegated header for both API and page requests. The older launch renderer fixture explicitly supplies the legacy design context; its existing assertions remain intact.

Known ceiling: clients without a unique, consistent source record retain a blank DOB. Revisit those records when Alamo supplies a corrected resident-number link/DOB or staff provide reviewed identity evidence; do not substitute a name-only join. Directory-card DOBs remain census-provided; this change targets the client chart, not a new bulk synchronization system.

Rollback uses the previous application image. No stored data changes need reversal.
