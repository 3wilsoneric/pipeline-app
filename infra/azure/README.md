# Pipeline Azure deployment

Pipeline is hosted entirely in Azure. Vercel is not part of the production
request, data, job, domain, or deployment path.

## Deployment layers

- `main.bicep` creates the durable foundation: VNet, private PostgreSQL,
  private Blob containers, Key Vault, Document Intelligence, Databricks,
  Container Registry, Container Apps environment, managed identities, GitHub
  OIDC trust, Log Analytics, Application Insights, and PHI-safe alert rules.
- `runtime.bicep` deploys an immutable web revision, a manual database bootstrap
  job, and the scheduled extraction/reconciliation jobs. Retention remains off
  until an approved policy explicitly enables it.
- `.github/workflows/deploy-azure.yml` builds one immutable image, pushes it to
  ACR through GitHub OIDC, applies `runtime.bicep`, runs checksum-guarded
  migrations inside the VNet, and verifies liveness and readiness.

Routine releases never redeploy `main.bicep`. This prevents an application
release from silently replacing the database or network.

## Security defaults

- PostgreSQL has no public endpoint.
- Blob containers are private and shared-key authorization is disabled.
- Pipeline uses a managed identity and user-delegation SAS URLs.
- Runtime secrets are versionless Key Vault references.
- ACR admin credentials are disabled; image pull and push use identities.
- GitHub has no Azure client secret. Only the exact repository's `main` branch
  can exchange an OIDC token for the narrowly assigned deployment identity.
- Production auth is Entra JWT validation. Mock auth and mock extraction fail
  closed.

Use `scripts/bootstrap-azure-foundation.sh` only after reviewing
`docs/AZURE_PRODUCTION_SETUP.md`. Always run the generated `what-if` and review
cost, region, networking, and role assignments before typing `DEPLOY`.
