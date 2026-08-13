#!/usr/bin/env bash

set -euo pipefail

outputs_file="${1:-${TMPDIR:-/tmp}/pipeline-foundation-outputs.json}"
[[ -f "$outputs_file" ]] || {
  printf 'Foundation output file not found: %s\n' "$outputs_file" >&2
  exit 2
}

for command_name in az gh jq openssl; do
  command -v "$command_name" >/dev/null || {
    printf 'Required command is not installed: %s\n' "$command_name" >&2
    exit 2
  }
done

repository="${PIPELINE_GITHUB_REPOSITORY:-3wilsoneric/pipeline-app}"
resource_group="${PIPELINE_AZURE_RESOURCE_GROUP:-}"
[[ -n "$resource_group" ]] || {
  read -r -p 'Azure resource group: ' resource_group
}

if ! [[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  printf 'PIPELINE_GITHUB_REPOSITORY must use owner/repository format.\n' >&2
  exit 2
fi

tenant_id="$(jq -r '.tenantId.value' "$outputs_file")"
subscription_id="$(jq -r '.subscriptionId.value' "$outputs_file")"
deployment_client_id="$(jq -r '.githubDeploymentClientId.value' "$outputs_file")"
key_vault_name="$(jq -r '.keyVaultName.value' "$outputs_file")"
postgres_host="$(jq -r '.postgresHost.value' "$outputs_file")"
postgres_admin="$(jq -r '.postgresAdministratorLogin.value' "$outputs_file")"

for value in "$tenant_id" "$subscription_id" "$deployment_client_id" "$key_vault_name" "$postgres_host" "$postgres_admin"; do
  [[ -n "$value" && "$value" != "null" ]] || {
    printf 'The foundation output file is incomplete.\n' >&2
    exit 2
  }
done

if ! az account show >/dev/null 2>&1; then
  az login --use-device-code >/dev/null
fi
az account set --subscription "$subscription_id"
gh auth status >/dev/null

signed_in_object_id="$(az ad signed-in-user show --query id --output tsv)"
key_vault_id="$(az keyvault show --name "$key_vault_name" --resource-group "$resource_group" --query id --output tsv)"
existing_secret_role="$(az role assignment list \
  --assignee "$signed_in_object_id" \
  --scope "$key_vault_id" \
  --query "[?roleDefinitionName=='Key Vault Secrets Officer'].id | [0]" \
  --output tsv)"
if [[ -z "$existing_secret_role" ]]; then
  az role assignment create \
    --assignee-object-id "$signed_in_object_id" \
    --assignee-principal-type User \
    --role 'Key Vault Secrets Officer' \
    --scope "$key_vault_id" \
    --output none
fi

if az keyvault secret show --vault-name "$key_vault_name" --name pipeline-database-url --output none 2>/dev/null \
  && ! az keyvault secret show --vault-name "$key_vault_name" --name pipeline-database-admin-url --output none 2>/dev/null; then
  printf 'Initial database setup is already finalized. Refusing to rotate database URLs outside a coordinated role rotation.\n' >&2
  printf 'Use scripts/configure-azure-clinical.sh for a later Alamo connection.\n' >&2
  exit 1
fi

if [[ -n "${PIPELINE_POSTGRES_ADMIN_PASSWORD_FILE:-}" ]]; then
  [[ -f "$PIPELINE_POSTGRES_ADMIN_PASSWORD_FILE" ]] || {
    printf 'PostgreSQL password file not found.\n' >&2
    exit 2
  }
  postgres_admin_password="$(<"$PIPELINE_POSTGRES_ADMIN_PASSWORD_FILE")"
else
  printf 'Enter the PostgreSQL administrator password used during foundation deployment.\n'
  read -r -s -p 'PostgreSQL administrator password: ' postgres_admin_password
  printf '\n'
fi
extraction_backend="${PIPELINE_EXTRACTION_BACKEND:-manual}"
if [[ "$extraction_backend" != "manual" && "$extraction_backend" != "azure_databricks" ]]; then
  printf 'PIPELINE_EXTRACTION_BACKEND must be manual or azure_databricks.\n' >&2
  exit 2
fi

allowed_emails="${PIPELINE_ALLOWED_EMAILS_INPUT:-}"
if [[ -z "$allowed_emails" ]]; then
  read -r -p 'Comma-separated authorized Pipeline user emails: ' allowed_emails
fi
pipeline_entra_client_id="${PIPELINE_ENTRA_CLIENT_ID:-}"
if [[ -z "$pipeline_entra_client_id" ]]; then
  read -r -p 'Pipeline Entra application client ID: ' pipeline_entra_client_id
fi

databricks_host=""
databricks_job_id=""
databricks_client_id=""
databricks_client_secret=""
if [[ "$extraction_backend" == "azure_databricks" ]]; then
  read -r -p 'Databricks workspace URL (https://...azuredatabricks.net): ' databricks_host
  read -r -p 'Databricks extraction job ID: ' databricks_job_id
  read -r -p 'Databricks OAuth service principal client ID: ' databricks_client_id
  read -r -s -p 'Databricks OAuth service principal secret: ' databricks_client_secret
  printf '\n'
fi

required_values=(postgres_admin_password allowed_emails pipeline_entra_client_id)
if [[ "$extraction_backend" == "azure_databricks" ]]; then
  required_values+=(databricks_host databricks_job_id databricks_client_id databricks_client_secret)
fi
for name in "${required_values[@]}"; do
  [[ -n "${!name}" ]] || {
    printf 'A required value was left empty: %s\n' "$name" >&2
    exit 2
  }
done

if ! [[ "$pipeline_entra_client_id" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  printf 'Pipeline Entra application client ID must be a UUID.\n' >&2
  exit 2
fi
if [[ "$extraction_backend" == "azure_databricks" ]] && ! [[ "$databricks_host" =~ ^https://[A-Za-z0-9.-]+\.azuredatabricks\.net/?$ ]]; then
  printf 'Databricks workspace URL must be an Azure Databricks HTTPS hostname with no path.\n' >&2
  exit 2
fi
if [[ "$extraction_backend" == "azure_databricks" ]] && ! [[ "$databricks_job_id" =~ ^[0-9]+$ ]]; then
  printf 'Databricks extraction job ID must be numeric.\n' >&2
  exit 2
fi
if [[ "$extraction_backend" == "azure_databricks" ]] && ! [[ "$databricks_client_id" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  printf 'Databricks OAuth service principal client ID must be a UUID.\n' >&2
  exit 2
fi

migration_password="$(openssl rand -base64 36 | tr -d '\n')"
runtime_password="$(openssl rand -base64 36 | tr -d '\n')"
session_secret="$(openssl rand -base64 48 | tr -d '\n')"
worker_secret="$(openssl rand -base64 48 | tr -d '\n')"

encode() {
  jq -nr --arg value "$1" '$value | @uri'
}

admin_url="postgresql://$(encode "$postgres_admin"):$(encode "$postgres_admin_password")@${postgres_host}:5432/pipeline?sslmode=require"
migration_url="postgresql://pipeline_migrator:$(encode "$migration_password")@${postgres_host}:5432/pipeline?sslmode=require"
runtime_url="postgresql://pipeline_runtime:$(encode "$runtime_password")@${postgres_host}:5432/pipeline?sslmode=require"

secret_file="$(mktemp -t pipeline-secret.XXXXXX)"
trap 'rm -f "$secret_file"' EXIT
chmod 600 "$secret_file"
set_secret() {
  local name="$1"
  local value="$2"
  printf '%s' "$value" > "$secret_file"
  for attempt in {1..12}; do
    if az keyvault secret set --vault-name "$key_vault_name" --name "$name" --file "$secret_file" --output none 2>/dev/null; then
      : > "$secret_file"
      return 0
    fi
    if [[ "$attempt" == 12 ]]; then
      printf 'Could not write Key Vault secret %s. Check RBAC and retry.\n' "$name" >&2
      return 1
    fi
    sleep 10
  done
  : > "$secret_file"
}

set_secret pipeline-database-admin-url "$admin_url"
set_secret pipeline-database-migration-url "$migration_url"
set_secret pipeline-database-url "$runtime_url"
set_secret pipeline-entra-session-secret "$session_secret"
set_secret pipeline-allowed-emails "$allowed_emails"
if [[ "$extraction_backend" == "azure_databricks" ]]; then
  set_secret pipeline-databricks-client-secret "$databricks_client_secret"
fi
set_secret pipeline-worker-shared-secret "$worker_secret"

if [[ "${PIPELINE_CLINICAL_DATA_MODE:-disconnected}" == "alamo_api" ]]; then
  read -r -s -p 'Alamo Pipeline service application client secret: ' alamo_client_secret
  printf '\n'
  [[ -n "$alamo_client_secret" ]] || {
    printf 'The Alamo client secret cannot be empty in alamo_api mode.\n' >&2
    exit 2
  }
  set_secret pipeline-alamo-client-secret "$alamo_client_secret"
  unset alamo_client_secret
fi

set_github_variable() {
  printf '%s' "$2" | gh variable set "$1" --repo "$repository"
}

set_github_variable AZURE_CLIENT_ID "$deployment_client_id"
set_github_variable AZURE_TENANT_ID "$tenant_id"
set_github_variable AZURE_SUBSCRIPTION_ID "$subscription_id"
set_github_variable AZURE_RESOURCE_GROUP "$resource_group"
set_github_variable PIPELINE_ENTRA_TENANT_ID "$tenant_id"
set_github_variable PIPELINE_ENTRA_CLIENT_ID "$pipeline_entra_client_id"
set_github_variable PIPELINE_EXTRACTION_BACKEND "$extraction_backend"
if [[ "$extraction_backend" == "azure_databricks" ]]; then
  set_github_variable PIPELINE_DATABRICKS_HOST "$databricks_host"
  set_github_variable PIPELINE_DATABRICKS_JOB_ID "$databricks_job_id"
  set_github_variable PIPELINE_DATABRICKS_CLIENT_ID "$databricks_client_id"
fi
set_github_variable PIPELINE_ALAMO_API_BASE_URL "${PIPELINE_ALAMO_API_BASE_URL:-https://www.alamoplatform.com}"
if [[ -n "${PIPELINE_ALAMO_TENANT_ID:-}" ]]; then set_github_variable PIPELINE_ALAMO_TENANT_ID "$PIPELINE_ALAMO_TENANT_ID"; fi
if [[ -n "${PIPELINE_ALAMO_CLIENT_ID:-}" ]]; then set_github_variable PIPELINE_ALAMO_CLIENT_ID "$PIPELINE_ALAMO_CLIENT_ID"; fi
if [[ -n "${PIPELINE_ALAMO_API_SCOPE:-}" ]]; then set_github_variable PIPELINE_ALAMO_API_SCOPE "$PIPELINE_ALAMO_API_SCOPE"; fi
unset postgres_admin_password migration_password runtime_password session_secret worker_secret
unset admin_url migration_url runtime_url databricks_client_secret
unset allowed_emails pipeline_entra_client_id databricks_host databricks_job_id databricks_client_id

printf '\nAzure Key Vault and the main-branch-bound GitHub deployment variables are configured.\n'
printf 'Next: configure Entra redirect URIs and app-role assignments, then run the Deploy Pipeline to Azure workflow.\n'
