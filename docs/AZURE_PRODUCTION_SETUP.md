# Pipeline Azure production setup

This is the only supported production path:

```text
GitHub -> Azure Container Registry -> Azure Container Apps
                                      |-> Entra user sign-in
                                      |-> private Azure PostgreSQL
                                      |-> private Blob containers via managed identity
                                      |-> Key Vault
                                      |-> Container Apps Jobs
                                      `-> Alamo clinical API (server-to-server only)
```

Vercel is not used for hosting, DNS, jobs, secrets, previews, or PHI. Pipeline
does not call ElderMark, Databricks tables, or Alamo storage directly for
clinical data. It calls only the governed Alamo clinical API.

## 1. Information to collect

Send Codex only the following non-secret values:

```text
Azure subscription ID:
Azure subscription display name:
Azure production region:
Azure resource group (recommended: rg-pipeline-prod):
Initial database service level (`pilot` or `production_ha`):
Desired hostname (recommended: pipeline.<your-domain>):
Domain registrar/DNS provider:
Entra tenant ID:
Pipeline Entra app client ID, or "not created":
Authorized Entra group names and intended Pipeline roles:
Databricks workspace URL:
Databricks extraction job ID, or "not created":
Databricks OAuth service principal client ID, or "not created":
Alamo API application client ID, or "not created":
Alamo API application ID URI/scope, or "not created":
Operational alert recipient names and addresses:
Person responsible for approving retention/deletion policy:
Person responsible for confirming the Microsoft agreement/BAA coverage:
```

Do **not** send passwords, database URLs, client secrets, storage keys,
Databricks OAuth secrets, access tokens, packet data, resident data, or PHI. The local
configuration script prompts for secrets and writes them directly to Key Vault.

### Where to find each value

1. **Subscription ID and name:** Azure portal -> search `Subscriptions` -> open
   the subscription -> copy **Subscription ID** and the displayed name.
2. **Region:** open the existing Alamo production resource group -> open its
   PostgreSQL or Storage resource -> copy **Location**. Prefer the same region
   unless the security/network owner requires another one.
3. **Tenant ID:** Azure portal -> `Microsoft Entra ID` -> `Overview` -> copy
   **Tenant ID**.
4. **Pipeline client ID:** `Microsoft Entra ID` -> `App registrations` -> open
   `Alamo Pipeline` -> copy **Application (client) ID**. Write `not created` if
   the registration does not exist.
5. **Authorized groups:** `Microsoft Entra ID` -> `Groups` -> copy the display
   names of groups that should be Admin, Assessment Coordinator, Reviewer, or
   Viewer. Individual pilot emails can be used initially, but groups are the
   maintainable production boundary.
6. **Databricks URL, job, and client ID:** Azure Databricks -> open the Pipeline
   packet extraction job -> copy the workspace URL and numeric job ID. Under
   workspace admin settings -> Service principals, open the dedicated Pipeline
   service principal and copy its UUID client ID. Write `not created` for either
   missing item. Do not copy its OAuth secret into chat.
7. **Alamo API IDs:** Entra -> `App registrations` -> open the service
   application used by Pipeline -> copy its client ID. Open `Alamo Platform API`
   -> `Expose an API` -> copy its Application ID URI. Do not copy the service
   client secret into chat.
8. **Domain provider:** identify the company whose portal contains the DNS
   records for the root domain. This can be different from the registrar.

## 2. Cost and authority checkpoint

Before deploying, confirm that the signed-in Azure user has:

- Owner, or Contributor plus User Access Administrator, on the target resource
  group/subscription.
- permission to register Azure resource providers;
- permission to create Entra app registrations or access to the person who can;
- permission to grant tenant-wide admin consent;
- admin access to configure GitHub repository variables and Actions policy.

Review these billable resources in the Azure Pricing Calculator before typing
`DEPLOY`: PostgreSQL Flexible Server (and a standby only for `production_ha`),
Container Apps, Blob Storage, Log Analytics retention, Document Intelligence,
approved Databricks job compute, and Container Registry. The foundation does
not create a Databricks workspace; it reuses the explicitly selected governed
workspace and job. The bootstrap always displays Azure `what-if` first and
requires the literal confirmation `DEPLOY`. It does not purchase a support or
compliance add-on.

## 3. Install and authenticate the operator tools

On the Mac running this repository:

```bash
brew install azure-cli gh
az login
gh auth login
```

Choose the GitHub.com account that owns `3wilsoneric/pipeline-app`. Use HTTPS
and authenticate in the browser. Confirm both sessions:

```bash
az account show --output table
gh auth status
```

## 4. Deploy the durable Azure foundation

From `/Users/eric/pipeline-app`, substitute the collected non-secret values:

```bash
export PIPELINE_AZURE_SUBSCRIPTION_ID="00000000-0000-0000-0000-000000000000"
export PIPELINE_AZURE_RESOURCE_GROUP="rg-pipeline-prod"
export PIPELINE_AZURE_LOCATION="westus2"
export PIPELINE_AZURE_CAPACITY_PROFILE="pilot"
export PIPELINE_GITHUB_REPOSITORY="3wilsoneric/pipeline-app"
export PIPELINE_GITHUB_BRANCH="main"
# Optional: existing Azure Monitor action-group resource IDs as a JSON array.
export PIPELINE_ALERT_ACTION_GROUP_IDS_JSON='[]'

./scripts/bootstrap-azure-foundation.sh
```

The script registers providers, creates the resource group, asks for a new
PostgreSQL administrator password without echoing it, and displays `what-if`.
Stop if the region, SKU, networking, or resource count is wrong. Type `DEPLOY`
only after review. `pilot` uses a private General Purpose database without a
standby; `production_ha` adds a larger primary, zone-redundant standby,
35-day backups, and geo-redundant backup. The choice is explicit so a database
standby is never purchased by accident, and `pilot` can be upgraded in place
after the pilot. The script writes non-secret outputs to
`/tmp/pipeline-foundation-outputs.json`.

The foundation intentionally creates no public PostgreSQL endpoint, no storage
account key, no ACR password, and no GitHub/Azure client secret.

For an automated operator session, `PIPELINE_POSTGRES_ADMIN_PASSWORD_FILE` may
point to an owner-readable temporary file containing the generated bootstrap
password. Use the same file for Step 6, then delete it immediately after the
one-time bootstrap is finalized. The scripts never place that password in a
command argument or output.

It creates an Azure Databricks Access Connector with managed-identity access to
the dedicated ADLS Gen2 account and Document Intelligence. It deliberately does
not create a second Databricks workspace. In the approved existing workspace,
use the emitted connector resource ID to create the Unity Catalog storage
credential/external location for Pipeline. Do not mount the account with a
storage key or SAS token. The extraction job should receive only the opaque
packet/blob prefix supplied by Pipeline and report results through the
authenticated worker callback.

### Configure the existing Databricks workspace

1. Open the approved Alamo Azure Databricks workspace. Do not create another
   workspace for Pipeline unless architecture and cost owners approve it.
2. Workspace -> `Settings` -> `Identity and access` -> `Service principals` ->
   add a dedicated principal named `Pipeline Packet Extractor`.
3. Copy its application/client ID. Generate its OAuth secret only when running
   `configure-azure-production.sh`; enter that secret at the hidden local
   prompt, never in chat or GitHub.
4. Open `Workflows` -> create or select the packet-extraction job. Grant the
   principal only the job permission needed to run and inspect that job. Copy
   the numeric job ID from the job URL.
5. In Unity Catalog, create a storage credential backed by the
   `databricksAccessConnectorId` emitted by the foundation. Create an external
   location restricted to the Pipeline storage account and containers.
6. Grant the extraction principal only the external-location/catalog access
   required by that job. Do not grant access to clinical tables, ElderMark, or
   unrelated Alamo storage.
7. Run one synthetic packet and verify that the job can read its opaque Blob
   prefix, write governed artifacts, and call the authenticated Pipeline worker
   endpoint without logging PHI.

## 5. Configure the Pipeline Entra application

If `Alamo Pipeline` does not exist:

1. Entra -> `App registrations` -> `New registration`.
2. Name: `Alamo Pipeline`.
3. Supported accounts: **Accounts in this organizational directory only**.
4. Do not add a redirect during creation.
5. Copy the Application (client) ID.

Then configure it:

1. `Authentication` -> `Add a platform` -> `Single-page application`.
2. Add `http://localhost:3000/sign-in`.
3. Add `https://pipeline.<your-domain>/sign-in`.
4. Later, temporarily add the generated Azure Container Apps
   `https://...azurecontainerapps.io/sign-in` URI for pre-domain testing, then
   remove it after cutover.
5. Under `Expose an API`, set the Application ID URI to
   `api://<PIPELINE_CLIENT_ID>`.
6. Add delegated scope `access_as_user` for admins and users.
7. Under `API permissions`, add that delegated scope to this application and
   select **Grant admin consent**.
8. Add app roles with allowed member type `Users/Groups`:
   `Pipeline.Admin`, `Pipeline.AssessmentCoordinator`, `Pipeline.Reviewer`, and
   `Pipeline.Viewer`.
9. Entra -> `Enterprise applications` -> `Alamo Pipeline` -> `Users and groups`
   -> assign each approved group to one role.

Do not create a browser client secret. Pipeline uses Authorization Code + PKCE
for humans. The separate Alamo service client secret goes only to Key Vault.

## 6. Configure Key Vault and GitHub without exposing secrets

Run:

```bash
export PIPELINE_AZURE_RESOURCE_GROUP="rg-pipeline-prod"
export PIPELINE_GITHUB_REPOSITORY="3wilsoneric/pipeline-app"

./scripts/configure-azure-production.sh
```

The script prompts locally for:

- the PostgreSQL administrator password used in Step 4;
- allowed pilot email addresses;
- the Pipeline Entra client ID;
- Databricks workspace URL, job ID, OAuth service-principal client ID, and
  OAuth secret. The secret is entered locally and written only to Key Vault.

It creates independent `pipeline_migrator` and `pipeline_runtime` credentials,
stores only server secrets in Key Vault, and configures GitHub's non-secret
Azure identifiers as repository variables. The GitHub workflow authenticates
to Azure using OIDC bound to this repository's `main` branch; there is no
deployment client secret or stored GitHub application secret.

Leave clinical mode disconnected until the Alamo API service permission exists.
The initial configuration script is deliberately not reusable after database
bootstrap because the administrator credential has been revoked. When the
Alamo permission exists, use the clinical-only script:

```bash
export PIPELINE_CLINICAL_DATA_MODE="alamo_api"
export PIPELINE_ALAMO_TENANT_ID="<tenant-id>"
export PIPELINE_ALAMO_CLIENT_ID="<pipeline-service-client-id>"
export PIPELINE_ALAMO_API_SCOPE="api://<ALAMO_API_APP_ID>/.default"
export PIPELINE_AZURE_RESOURCE_GROUP="rg-pipeline-prod"
./scripts/configure-azure-clinical.sh
```

The clinical script prompts for the service client secret and sends it directly
to Key Vault without touching database credentials. Pipeline needs the Alamo application permission for the five
`/api/integrations/pipeline/clinical/*` endpoints; it must not receive broad
ElderMark, storage, or Databricks permissions.

## 7. Verify the GitHub deployment boundary

GitHub -> repository `pipeline-app` -> `Settings`:

1. Keep the repository private.
2. Under `Actions` -> `General`, allow only GitHub-owned actions plus the
   explicitly selected `azure/login` and Docker build actions.
3. Keep the workflow token at read-only permissions.
4. Under `Secrets and variables` -> `Actions`, confirm Azure and Pipeline IDs
   appear only as repository **variables** and that no database, Alamo,
   Databricks, Blob, worker, or server-action secret is stored in GitHub.
5. Confirm the Azure federated subject emitted by the foundation is exactly
   `repo:3wilsoneric/pipeline-app:ref:refs/heads/main`.

This branch-bound OIDC design does not depend on paid GitHub environment or
branch-protection features. The deploy job also checks `refs/heads/main`, while
Azure independently refuses OIDC tokens from every other ref. Renaming the
repository or production branch requires a reviewed foundation update.

## 8. Deploy the application

GitHub -> `Actions` -> `Deploy Pipeline to Azure` -> `Run workflow`:

1. Select `disconnected` until the Alamo service permission is complete.
2. Leave **Enable retention job** unchecked.
3. Check **Initial database bootstrap** only on the very first deployment.
4. Run the workflow.

The workflow builds an immutable image tagged by Git commit, pushes it to ACR,
runs `runtime.bicep` `what-if`, deploys the revision, executes the manual
database role/migration job inside the VNet, and checks both health endpoints.
It does not run destructive retention.

The one-time bootstrap creates least-privilege migrator/runtime roles and then
immediately rotates the administrator password to an unknown random value. When
the first deployment succeeds, remove the stale administrator URL and bootstrap
job:

```bash
export PIPELINE_AZURE_RESOURCE_GROUP="rg-pipeline-prod"
./scripts/finalize-azure-database-bootstrap.sh
```

Leave **Initial database bootstrap** unchecked on every later deployment. Later
releases use only `pipeline_migrator`; the web app always uses
`pipeline_runtime`. An Azure administrator can reset the server administrator
credential explicitly in a break-glass event.

## 9. Bind the custom domain

After the first successful deployment, run:

```bash
export PIPELINE_AZURE_RESOURCE_GROUP="rg-pipeline-prod"
export PIPELINE_ENTRA_CLIENT_ID="<Alamo-Pipeline-client-id>"
./scripts/configure-azure-domain.sh pipeline.<your-domain> subdomain
```

The script prints the exact DNS records and permanent ownership TXT record and
stops until you create them at your DNS provider. After DNS resolves, it binds
the managed certificate, configures Blob CORS for only the generated Azure
origin and final production HTTPS origin, and adds the exact Entra SPA redirect
when `PIPELINE_ENTRA_CLIENT_ID` is set. It does not use wildcard origins or
headers.

For an apex domain, use `./scripts/configure-azure-domain.sh example.com apex`.
The apex path uses an `A` record and HTTP certificate validation; a subdomain
uses a direct `CNAME`. The script refuses managed-certificate setup when an
existing CAA policy does not authorize DigiCert.

## 10. Production acceptance and cutover

Use synthetic data first:

1. Verify liveness at `/api/health/live` and dependency readiness at
   `/api/health`.
2. Verify allowed, unauthorized, expired, and signed-out Entra sessions.
3. Apply and verify migrations; confirm the web app connects as
   `pipeline_runtime`, not the administrator or migrator.
4. Upload one synthetic packet and verify original, preview, evidence,
   extraction, correction history, and audit events.
5. Run the ten-user collaboration/load suite against the Azure URL.
6. Verify extraction dispatch/reconcile history and the dead-letter queue.
7. Verify logs contain no PHI, filenames, resident IDs, tokens, URLs with query
   strings, or response bodies.
8. Complete a disposable restore drill.
9. Connect alert action groups and test notification delivery.
10. Approve the written retention schedule before enabling retention.
11. Confirm the organization's Microsoft agreement/BAA coverage and shared
    responsibility controls with the responsible compliance/legal owner.
12. Only then enable a small staff pilot and upload real packets.

After Azure has served the accepted production deployment, repoint/remove any
old Vercel domain, downgrade/cancel Vercel, remove its project variables, and
delete its deployment. Vercel is not needed for the domain after DNS points to
Azure.

## Rollback

- Application rollback: activate the previous Container Apps revision or
  redeploy its immutable image tag.
- Database rollback: never edit migration history or automatically reverse an
  applied migration; ship a reviewed forward migration.
- Job rollback: disable scheduled jobs before changing worker contracts.
- Document rollback: never delete immutable originals or review audit history.
- Foundation changes: run a separate `main.bicep` what-if and obtain explicit
  network/database approval; do not piggyback them on an app release.
