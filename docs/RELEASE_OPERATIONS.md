# Pipeline Release Operations

Use `docs/PRODUCTION_ACCEPTANCE_CHECKLIST.md` for release evidence and
`docs/PRODUCTION_READINESS.md` as the canonical runbook index.

## Deployment order

1. Confirm Azure PostgreSQL point-in-time recovery and create the pre-migration logical backup.
2. Run `npm ci`, `npm audit --audit-level=high`, and `npm run check:platform` against the release revision.
3. Run `npm run database:migrate:plan` and review only newly appended migrations.
4. Apply migrations from the controlled deployment environment with `npm run database:migrate`.
5. Deploy the application revision.
6. Test `/api/health`, `/api/clinical/health`, the signed-in application shell, referral read/write, extraction queueing, and operations exceptions.
7. Generate `npm run release:evidence -- --out-dir <release-evidence>` and run
   `npm run release:evidence:verify -- --dir <release-evidence>`. Record the
   checksum index, manifest, CycloneDX SBOM, smoke result, and operator identity
   in the release record.

For desktop distribution, keep both desktop flags off through the migration and
normal web smoke. Enable them together only after migration
`0006_user_workspace_state` is present, then follow
`docs/DESKTOP_DISTRIBUTION.md`. The hosted kill switch is deployed before any
Intune package is withdrawn.

## Compatibility rules

- Applied migration files are immutable. Add a new migration instead of editing history.
- The latest migration must include a rollback drill before release.
- Browser code never receives database, Blob, Databricks, ElderMark, Alamo service, or client-secret credentials.
- Runtime fixtures remain disabled in production.
- GitHub Actions remain pinned to reviewed immutable commit SHAs.
- Release evidence derives its timestamp from `SOURCE_DATE_EPOCH` when set, or
  from the source commit, so rebuilding the same revision produces stable
  metadata.
- A deployment is not marked connected until its live health checks pass.

## Rollback decision

Stop the rollout when migrations fail, error rates materially increase, save conflicts depart from the expected concurrency profile, or core signed-in journeys fail. Prefer rolling the application revision back when the schema remains backward compatible. Use the reviewed migration rollback only when its drill passed and the incident owner confirms that no accepted writes depend on the new schema. Restore from backup only through the database recovery runbook.

## Feature release

Incomplete external integrations remain fail-closed behind server-side configuration. Do not use a UI-only flag to expose a workflow whose storage or authorization contract is absent.
