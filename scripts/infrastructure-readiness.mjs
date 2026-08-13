#!/usr/bin/env node

import { readFileSync } from "node:fs";

const read = (file) => readFileSync(file, "utf8");
const bicep = read("infra/azure/main.bicep");
const foundationState = read("infra/azure/foundation-state.bicep");
const runtime = read("infra/azure/runtime.bicep");
const deployment = read(".github/workflows/deploy-azure.yml");
const workerAuth = read("lib/auth/internal-worker-auth.ts");
const alerts = read("infra/azure/operational-alerts.bicep");
const databaseBootstrap = read("scripts/bootstrap-production-database.mjs");
const initialConfiguration = read("scripts/configure-azure-production.sh");
const domainConfiguration = read("scripts/configure-azure-domain.sh");
const blobAdapter = read("lib/extraction/azure-blob.ts");
const dockerfile = read("Dockerfile");
const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });

for (const resource of [
  "Microsoft.Storage/storageAccounts@2025-01-01",
  "Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01",
  "Microsoft.KeyVault/vaults@2024-11-01",
  "Microsoft.CognitiveServices/accounts@2024-10-01",
  "Microsoft.OperationalInsights/workspaces@2023-09-01",
  "Microsoft.Insights/components@2020-02-02",
  "Microsoft.ContainerRegistry/registries@2023-07-01",
  "Microsoft.App/managedEnvironments@2025-01-01",
  "Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31",
  "Microsoft.Databricks/accessConnectors@2023-05-01",
]) check(`IaC declares ${resource.split("@")[0]}`, bicep.includes(resource));

for (const container of ["raw", "normalized", "ocr", "evidence", "artifacts"]) {
  check(`IaC declares private ${container} container`, bicep.includes(`'${container}'`));
}
check("database password is a secure parameter", bicep.includes("@secure()\nparam postgresAdministratorPassword"));
check("deployment reads recoverable non-secret foundation state", deployment.includes("FOUNDATION_DEPLOYMENT_NAME: pipeline-foundation-state") && foundationState.includes("existing =") && !/password|secret/i.test(foundationState));
check("database cost and HA level must be selected explicitly", bicep.includes("param databaseServiceLevel string") && !/param databaseServiceLevel string\s*=/.test(bicep));
check("IaC contains no credential literals", !/(?:clientSecret|accountKey|token)\s*:\s*'[^']+'/i.test(bicep));
check("Blob public access is disabled", bicep.includes("allowBlobPublicAccess: false"));
check("storage shared-key access is disabled", bicep.includes("allowSharedKeyAccess: false"));
check("storage uses ADLS Gen2 for governed Databricks access", bicep.includes("isHnsEnabled: true"));
check("Databricks has managed-identity Blob access", bicep.includes("storageDatabricksRole") && bicep.includes("databricksAccessConnector.identity.principalId"));
check("IaC does not silently buy a duplicate Databricks workspace", !bicep.includes("Microsoft.Databricks/workspaces@"));
check("Document Intelligence local keys are disabled", bicep.includes("disableLocalAuth: true") && bicep.includes("documentIntelligenceDatabricksRole"));
check("PostgreSQL public access is disabled", bicep.includes("publicNetworkAccess: 'Disabled'"));
check("Container Apps uses a dedicated VNet", bicep.includes("infrastructureSubnetId: containerAppsSubnet.id"));
check("Container Apps peer traffic is encrypted", bicep.includes("peerTrafficConfiguration") && bicep.includes("mtls"));
check("GitHub deployment uses main-branch-bound OIDC", bicep.includes("token.actions.githubusercontent.com") && bicep.includes("ref:refs/heads/${githubBranch}") && deployment.includes("id-token: write") && deployment.includes("github.ref == 'refs/heads/main'"));
check("image build receives an ephemeral server-action key through BuildKit secrets", dockerfile.includes("--mount=type=secret,id=next_server_actions_encryption_key") && deployment.includes("next_server_actions_encryption_key=${{ steps.build-key.outputs.value }}") && deployment.includes("openssl rand -base64 32") && !dockerfile.includes("ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"));
check("worker uses constant-time bearer authentication", workerAuth.includes("timingSafeEqual") && workerAuth.includes("CRON_SECRET"));
check("Azure web runtime exists", runtime.includes("Microsoft.App/containerApps@2025-01-01"));
check("Azure scheduled jobs exist", runtime.includes("Microsoft.App/jobs@2025-01-01"));
check("dispatch schedule exists", runtime.includes("'/api/internal/extraction/dispatch'") && runtime.includes("schedule: '* * * * *'"));
check("reconciliation schedule exists", runtime.includes("'/api/internal/extraction/reconcile'") && runtime.includes("schedule: '*/5 * * * *'"));
check("clinical backlog reconciliation schedule exists", runtime.includes("'/api/internal/clinical/reconcile'"));
check("retention is fail-closed by default", runtime.includes("param enableRetentionJob bool = false") && runtime.includes("enabled: enableRetentionJob"));
check("runtime uses managed identity for Blob", runtime.includes("PIPELINE_AZURE_BLOB_AUTH_MODE") && runtime.includes("managed_identity"));
check("Databricks API uses OAuth M2M rather than a PAT", runtime.includes("PIPELINE_DATABRICKS_AUTH_MODE") && runtime.includes("oauth_m2m") && !runtime.includes("DATABRICKS_TOKEN"));
check("Blob adapter has no shared-key credential path", blobAdapter.includes("DefaultAzureCredential") && !blobAdapter.includes("StorageSharedKeyCredential") && !blobAdapter.includes("AZURE_STORAGE_ACCOUNT_KEY"));
check("runtime reads secrets from Key Vault", runtime.includes("keyVaultUrl") && runtime.includes("identity: keyVaultSecretIdentity"));
check("database bootstrap is one-time and explicit", runtime.includes("param initialDatabaseBootstrap bool = false") && runtime.includes("if (initialDatabaseBootstrap)"));
check("routine database migrations use the migrator-only job", runtime.includes("databaseMigrationJob") && runtime.includes("pipeline-database-migration-url"));
check("bootstrap revokes the administrator credential", databaseBootstrap.includes("administrator_credential_revoked: true") && databaseBootstrap.includes("alter role"));
check("initial setup cannot rotate database URLs after finalization", initialConfiguration.includes("Initial database setup is already finalized"));
check("operational alert module is deployed", bicep.includes("operational-alerts.bicep"));
check("operational alert recipients are explicit parameters", bicep.includes("alertActionGroupResourceIds") && alerts.includes("actionGroups: actionGroupResourceIds"));
check("seven PHI-safe alert rules are declared", (alerts.match(/key:\s*'/g) ?? []).length === 7 && alerts.includes("dataClassification: 'phi-safe-metrics-only'"));
check("custom-domain automation distinguishes apex and subdomain records", domainConfiguration.includes('record_mode="apex"') && domainConfiguration.includes("validation_method=\"HTTP\"") && domainConfiguration.includes("validation_method=\"CNAME\""));
check("custom-domain automation preserves CAA and exact Entra redirect safety", domainConfiguration.includes("digicert\\.com") && domainConfiguration.includes('redirect_uri="https://${custom_hostname}/sign-in"') && domainConfiguration.indexOf("az containerapp hostname bind") < domainConfiguration.indexOf("redirect_uri="));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks, note: "This is a static scaffold check. Run Azure what-if before deployment." }, null, 2));
if (failed.length) process.exit(1);
