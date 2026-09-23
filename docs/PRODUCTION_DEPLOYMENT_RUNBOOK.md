# Pipeline production deployment runbook

The authoritative operator guide is `docs/AZURE_PRODUCTION_SETUP.md`.

## Release order

1. CI must pass on the exact commit.
2. A required reviewer approves the GitHub `production` environment.
3. GitHub exchanges an OIDC token for the Azure deployment identity.
4. Build one standalone Next.js image with a stable deployment ID and Server
   Action encryption key.
5. Push the immutable commit tag to private ACR.
6. Run `runtime.bicep` what-if, then deploy the web revision and jobs.
7. Run the VNet-scoped backup job and require its encrypted Blob verification to succeed.
8. Run the manual VNet-scoped database bootstrap/migration job.
9. Verify `/api/health/live`, then `/api/health`.
10. Run synthetic auth, packet, extraction, collaboration, and log checks.
11. Promote staff in small groups. Retention remains disabled until approved.

## Web-only fast lane

For a visual or client-side UI change, run **Deploy Pipeline web fast lane** on
the current `main` commit. For eligible web-only pushes, CI publishes a separate
`fast-<commit>` image in parallel with its required `verify` check. The fast
lane waits for both to pass, compares the commit with the image currently
serving production, and refuses changes outside `app/(pipeline)`,
`components/pipeline`, supported static image
assets, generated Academy source mapping, and documentation/tests. It never changes environment settings,
scheduled jobs, infrastructure, or database schema. It updates only the web
image, waits for the new revision and live/readiness checks, and restores the
previous image if the new revision fails health checks.
After the fast-lane workflow itself is merged, use one full deployment to align
the production baseline; the workflow change is intentionally ineligible for
fast promotion. Eligible main pushes use CI build minutes and additional
private ACR image storage.

Use the full **Deploy Pipeline to Azure** workflow for API, shared-library,
authentication, database, extraction, dependency, infrastructure, deployment,
or worker changes. The fast lane deliberately cannot classify those changes as
safe merely because the diff is small. Its speed ceiling is the prebuilt-image
wait plus the Azure revision rollout; the deep browser/load suites continue in
CI but are not the required `verify` gate. If a fast deployment is healthy but
functionally wrong, activate the prior revision or redeploy its recorded image
tag as described below.

## Boundaries

- Routine releases do not redeploy `main.bicep`.
- The web container does not run migrations at startup.
- GitHub holds no Azure deployment secret and no PHI-bearing service secret.
- Runtime secrets are Key Vault references resolved through managed identity.
- Blob signing uses user-delegation SAS. Storage shared-key access is disabled.
- PostgreSQL is private and the web uses the least-privilege runtime role.
- Clinical data comes only from the governed Alamo API. Before that connection
  is configured, the adapter is explicitly optional, reports disconnected, and
  every clinical route fails closed.

## Rollback

- Activate the last known-good Container Apps revision or redeploy its immutable
  image tag.
- Stop scheduled jobs before changing worker contracts.
- Use forward database migrations. Never rewrite checksums or migration history.
- Preserve uploaded originals, correction history, and audit events.
