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
const clinicalConfiguration = read("scripts/configure-azure-clinical.sh");
const entraConfiguration = read("scripts/configure-entra-identities.sh");
const databaseFinalization = read("scripts/finalize-azure-database-bootstrap.sh");
const domainConfiguration = read("scripts/configure-azure-domain.sh");
const blobAdapter = read("lib/extraction/azure-blob.ts");
const azureDatabaseBackup = read("scripts/database-backup-to-azure-blob.mjs");
const dockerfile = read("Dockerfile");
const runtimeOpsDependencies = read("scripts/build-runtime-ops-dependencies.mjs");
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
check("Blob and container soft delete are enabled", bicep.includes("deleteRetentionPolicy:") && bicep.includes("containerDeleteRetentionPolicy:"));
check("HNS storage does not claim unsupported Blob versioning", !bicep.includes("isVersioningEnabled: true"));
check("Databricks has managed-identity Blob access", bicep.includes("storageDatabricksRole") && bicep.includes("databricksAccessConnector.identity.principalId"));
check("IaC does not silently buy a duplicate Databricks workspace", !bicep.includes("Microsoft.Databricks/workspaces@"));
check("Document Intelligence local keys are disabled", bicep.includes("disableLocalAuth: true") && bicep.includes("documentIntelligenceDatabricksRole"));
check("PostgreSQL public access is disabled", bicep.includes("publicNetworkAccess: 'Disabled'"));
check("PostgreSQL allows only required application extensions", bicep.includes("name: 'azure.extensions'") && bicep.includes("value: 'PGCRYPTO,PG_TRGM'"));
check("Container Apps uses a dedicated VNet", bicep.includes("infrastructureSubnetId: containerAppsSubnet.id"));
check("Container Apps peer traffic is encrypted", bicep.includes("peerTrafficConfiguration") && bicep.includes("mtls"));
check("GitHub deployment uses main-branch-bound OIDC", bicep.includes("token.actions.githubusercontent.com") && bicep.includes("ref:refs/heads/${githubBranch}") && deployment.includes("id-token: write") && deployment.includes("github.ref == 'refs/heads/main'"));
check("image build receives an ephemeral server-action key through BuildKit secrets", dockerfile.includes("--mount=type=secret,id=next_server_actions_encryption_key") && deployment.includes("next_server_actions_encryption_key=${{ steps.build-key.outputs.value }}") && deployment.includes("openssl rand -base64 32") && !dockerfile.includes("ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"));
check(
  "runtime image carries the transitive operational dependency closure",
  runtimeOpsDependencies.includes('const roots = ["@azure/identity", "@azure/storage-blob", "postgres"]')
    && dockerfile.includes("node scripts/build-runtime-ops-dependencies.mjs /app/node_modules /app/runtime-ops-node_modules")
    && dockerfile.includes("/runtime-ops-node_modules ./node_modules"),
);
check("runtime image can create PostgreSQL logical backups", dockerfile.includes("postgresql16-client") && azureDatabaseBackup.includes("pg_advisory_lock") && azureDatabaseBackup.includes("IDENTITY_ENDPOINT") && !azureDatabaseBackup.includes("AZURE_STORAGE_ACCOUNT_KEY"));
check("worker uses constant-time bearer authentication", workerAuth.includes("timingSafeEqual") && workerAuth.includes("CRON_SECRET"));
check("Azure web runtime exists", runtime.includes("Microsoft.App/containerApps@2025-01-01"));
check("Azure scheduled jobs exist", runtime.includes("Microsoft.App/jobs@2025-01-01"));
check("dispatch schedule exists", runtime.includes("'/api/internal/extraction/dispatch'") && runtime.includes("schedule: '* * * * *'"));
check("reconciliation schedule exists", runtime.includes("'/api/internal/extraction/reconcile'") && runtime.includes("schedule: '*/5 * * * *'"));
check("clinical backlog reconciliation schedule exists", runtime.includes("'/api/internal/clinical/reconcile'"));
check(
  "clinical reconciliation is opt-in to prevent unapproved metered executions",
  runtime.includes("param enableClinicalReconcileJob bool = false")
    && runtime.includes("clinicalDataMode == 'alamo_api' && enableClinicalReconcileJob")
    && deployment.includes("enable_clinical_reconcile_job:")
    && (deployment.match(/enableClinicalReconcileJob='\$\{\{ inputs\.enable_clinical_reconcile_job \}\}'/g) ?? []).length === 2,
);
check("retention is fail-closed by default", runtime.includes("param enableRetentionJob bool = false") && runtime.includes("enabled: enableRetentionJob"));
check(
  "the supervisor Note Lab is fail-closed and deployment controlled",
  runtime.includes("param enableNoteLab bool = false")
    && runtime.includes("{ name: 'PIPELINE_NOTE_LAB_ENABLED', value: enableNoteLab ? 'true' : 'false' }")
    && deployment.includes("enable_note_lab:")
    && (deployment.match(/enableNoteLab='\$\{\{ inputs\.enable_note_lab \}\}'/g) ?? []).length === 2,
);
check("runtime uses managed identity for Blob", runtime.includes("PIPELINE_AZURE_BLOB_AUTH_MODE") && runtime.includes("managed_identity"));
check("runtime preserves browser-safe Entra readiness configuration", [
  "NEXT_PUBLIC_ENTRA_TENANT_ID",
  "NEXT_PUBLIC_ENTRA_CLIENT_ID",
  "NEXT_PUBLIC_PIPELINE_API_SCOPE",
  "NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED",
  "NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED",
].every((name) => runtime.includes(`name: '${name}'`)));
check(
  "runtime validates the v2 token audience separately from the delegated scope URI",
  runtime.includes("var pipelineApiAudience = pipelineEntraClientId")
    && runtime.includes("var pipelineApiScope = 'api://${pipelineEntraClientId}/access_as_user'")
    && runtime.includes("{ name: 'PIPELINE_ENTRA_API_AUDIENCE', value: pipelineApiAudience }")
    && runtime.includes("{ name: 'NEXT_PUBLIC_PIPELINE_API_SCOPE', value: pipelineApiScope }"),
);
check(
  "runtime explicitly trusts preserved custom domains for browser mutations",
  runtime.includes("PIPELINE_ALLOWED_MUTATION_ORIGINS")
    && runtime.includes("join(map(customDomains, domain => 'https://${domain.name}'), ',')"),
);
check(
  "immutable runtime deployments preserve custom hostname bindings",
  runtime.includes("param customDomains array = []")
    && runtime.includes("customDomains: customDomains")
    && deployment.includes("Preserve existing custom hostname bindings")
    && (deployment.match(/customDomains='\$\{\{ steps\.custom-domains\.outputs\.json \}\}'/g) ?? []).length === 2,
);
check(
  "Entra setup grants and verifies delegated Pipeline consent",
  entraConfiguration.includes('az ad app permission admin-consent --id "$pipeline_app_id"')
    && entraConfiguration.includes('and .consentType == "AllPrincipals"')
    && entraConfiguration.includes('index("access_as_user") != null'),
);
check("clinical readiness is explicit for connected and disconnected deployments", runtime.includes("name: 'PIPELINE_CLINICAL_DATA_REQUIRED'") && runtime.includes("clinicalDataMode == 'alamo_api' ? 'true' : 'false'"));
check("Databricks API uses OAuth M2M rather than a PAT", runtime.includes("PIPELINE_DATABRICKS_AUTH_MODE") && runtime.includes("oauth_m2m") && !runtime.includes("DATABRICKS_TOKEN"));
check("Blob adapter has no shared-key credential path", blobAdapter.includes("DefaultAzureCredential") && !blobAdapter.includes("StorageSharedKeyCredential") && !blobAdapter.includes("AZURE_STORAGE_ACCOUNT_KEY"));
check("runtime reads secrets from Key Vault", runtime.includes("keyVaultUrl") && runtime.includes("identity: keyVaultSecretIdentity"));
check("database bootstrap is one-time and explicit", runtime.includes("param initialDatabaseBootstrap bool = false") && runtime.includes("if (initialDatabaseBootstrap)"));
check("routine database migrations use the migrator-only job", runtime.includes("databaseMigrationJob") && runtime.includes("pipeline-database-migration-url"));
check("bootstrap revokes the administrator credential", databaseBootstrap.includes("administrator_credential_revoked: true") && databaseBootstrap.includes("alter role"));
check("initial setup cannot rotate database URLs after finalization", initialConfiguration.includes("Initial database setup is already finalized"));
check("database finalization reads stable output-only foundation state", databaseFinalization.includes("--name pipeline-foundation-state"));
check(
  "clinical configuration reads stable output-only foundation state",
  clinicalConfiguration.includes("PIPELINE_FOUNDATION_DEPLOYMENT_NAME:-pipeline-foundation-state")
    && clinicalConfiguration.includes('--name "$foundation_deployment_name"'),
);
check("operational alert module is deployed", bicep.includes("operational-alerts.bicep"));
check("operational alert recipients are explicit parameters", bicep.includes("alertActionGroupResourceIds") && alerts.includes("actionGroups: actionGroupResourceIds"));
check(
  "PHI-safe operational and native capacity alerts are declared",
  (alerts.match(/key:\s*'/g) ?? []).length >= 10
    && alerts.includes("dataClassification: 'phi-safe-metrics-only'")
    && alerts.includes("active_connections")
    && alerts.includes("storage_percent")
    && alerts.includes("UsedCapacity")
    && runtime.includes("RestartCount")
    && runtime.includes("ResiliencyRequestTimeouts"),
);
check("custom-domain automation distinguishes apex and subdomain records", domainConfiguration.includes('record_mode="apex"') && domainConfiguration.includes("validation_method=\"HTTP\"") && domainConfiguration.includes("validation_method=\"CNAME\""));
check("custom-domain automation reads stable output-only foundation state", domainConfiguration.includes("--name pipeline-foundation-state"));
check("custom-domain Blob CORS preserves existing service properties and origins", domainConfiguration.includes("blob_service=\"$(az rest --method GET") && domainConfiguration.includes("existing_origins=") && domainConfiguration.includes("$existingOrigins + [$productionOrigin, $generatedOrigin] | unique") && domainConfiguration.includes("--method PUT") && domainConfiguration.includes(".properties.cors = $cors"));
check("custom-domain automation preserves CAA and exact Entra redirect safety", domainConfiguration.includes("digicert\\.com") && domainConfiguration.includes('redirect_uri="https://${custom_hostname}/sign-in"') && domainConfiguration.indexOf("az containerapp hostname bind") < domainConfiguration.indexOf("redirect_uri="));

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, checks, note: "This is a static scaffold check. Run Azure what-if before deployment." }, null, 2));
if (failed.length) process.exit(1);
