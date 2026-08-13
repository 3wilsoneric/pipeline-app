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
7. Run the manual VNet-scoped database bootstrap/migration job.
8. Verify `/api/health/live`, then `/api/health`.
9. Run synthetic auth, packet, extraction, collaboration, and log checks.
10. Promote staff in small groups. Retention remains disabled until approved.

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
