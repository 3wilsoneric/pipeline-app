# Pipeline production acceptance

Create one copy of this checklist for each release candidate. Attach command
output and operator identity to the controlled release record; never attach
credentials, URLs containing secrets, client data, or packet contents.

## Release identity

- [ ] The release revision is reviewed and the worktree used to build it is clean.
- [ ] `npm ci` completed from the committed lockfile.
- [ ] `npm run check:platform` passed.
- [ ] `npm run test:e2e`, `npm run test:e2e:desktop`, and `npm run test:e2e:cross-browser` passed.
- [ ] `npm run test:e2e:visual` passed without updating reviewed baselines.
- [ ] `npm run check:route-policy`, `npm run check:supply-chain`, and `npm run check:alerts` passed.
- [ ] `npm audit --audit-level=high` passed or an approved, time-bounded exception is attached.
- [ ] The verified release-evidence directory is attached and its manifest's `source_dirty` field is `false`.

## Database and recovery

- [ ] Azure PostgreSQL point-in-time recovery is enabled and its recovery window is recorded.
- [ ] A pre-migration logical backup and SHA-256 manifest exist in the approved recovery account.
- [ ] `npm run database:migrate:plan` shows only reviewed append-only migrations.
- [ ] `npm run database:migrate` and `npm run check:database:live` passed.
- [ ] The quarterly disposable restore drill is current.
- [ ] Expired workspace-state retention ran successfully.
- [ ] The per-user workspace-state purge procedure was dry-run against a synthetic principal.

## Identity and permissions

- [ ] The production Entra redirect is the exact HTTPS `/sign-in` URL.
- [ ] Delegated API scope and app-role assignments received administrator consent.
- [ ] Pilot users resolve to the intended Pipeline roles.
- [ ] A blocked user receives 403 and an unauthenticated user receives 401/sign-in recovery.
- [ ] No client secret, database URL, Blob key, worker secret, or Alamo credential appears in browser configuration.

## Clinical and packet processing

- [ ] `/api/clinical/health` reports the current governed Alamo snapshot as ready and not stale.
- [ ] Census totals and a small sample of resident-number joins reconcile to the governed source.
- [ ] Blob containers are private and malware/preview processing is operational.
- [ ] One synthetic packet completes upload, extraction, evidence review, correction, and assessment handoff.
- [ ] Duplicate packet detection rejects an exact duplicate.
- [ ] Extraction timeout, provider failure, and dead-letter recovery were observed without exposing source data in logs.

## Core workflow and collaboration

- [ ] Referral creation, manual chart entry, document attachment, assessment, decision, and EHR handoff pass.
- [ ] Lists, search, pagination, month/community filters, profiles, recents, and queues pass with representative volume.
- [ ] Ten simultaneous users produce distinct presence leases.
- [ ] Disjoint section edits both save; same-section edits produce one winner and explicit conflicts.
- [ ] Per-user recents and drafts never cross identity boundaries.
- [ ] Refresh recovery and stale-delete protection preserve the newest draft.
- [ ] A signed-in user can refresh, open a second tab, and return after an idle
  period without a false session-ended error; explicit sign-out still clears
  both the Pipeline cookie and the MSAL account cache.

## Desktop pilot

- [ ] Web deployment passed before either desktop flag was enabled.
- [ ] Both desktop flags were enabled together after migration `0006_user_workspace_state`.
- [ ] Install manifest, icons, standalone launch, offline fallback, upgrade, and kill switch passed.
- [ ] Browser Cache Storage contains only Pipeline static assets and no API response.
- [ ] The MSIX publisher identity matches its signing certificate and Intune assignment.
- [ ] The pilot uninstall and hosted kill-switch procedures were tested on a managed device.

## Observability and go/no-go

- [ ] API error rate, p95 latency, database saturation, queue age, extraction failures, save conflicts, stale leases, Blob growth, and cron history are visible.
- [ ] Alerts identify an owner and recovery action without including PHI or high-cardinality record identifiers.
- [ ] Distributed edge limits are enabled and the application overload drill returns bounded `429` recovery responses.
- [ ] Azure Monitor action groups receive a synthetic notification from every production rule.
- [ ] `/api/health` and `/api/clinical/health` pass after deployment.
- [ ] The prior application revision remains promotable during the pilot window.
- [ ] The release owner records an explicit go/no-go decision.
