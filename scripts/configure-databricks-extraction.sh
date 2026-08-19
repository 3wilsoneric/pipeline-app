#!/usr/bin/env bash

set -euo pipefail

mode="plan"
if [[ "${1:-}" == "--apply" ]]; then
  mode="apply"
elif [[ -n "${1:-}" && "${1:-}" != "--plan" ]]; then
  printf 'Usage: %s [--plan|--apply]\n' "$0" >&2
  exit 2
fi

for command_name in az databricks gh jq mktemp; do
  command -v "$command_name" >/dev/null || {
    printf 'Required command is not installed: %s\n' "$command_name" >&2
    exit 2
  }
done

resource_group="${PIPELINE_AZURE_RESOURCE_GROUP:-rg-pipeline-prod}"
databricks_host="${PIPELINE_DATABRICKS_HOST:-https://adb-7405608024417459.19.azuredatabricks.net}"
repository="${PIPELINE_GITHUB_REPOSITORY:-3wilsoneric/pipeline-app}"
principal_name="Alamo Pipeline Extraction"
service_credential="pipeline_extraction_service"
secret_scope="pipeline-extraction"
callback_url="${PIPELINE_DATABRICKS_CALLBACK_URL:-https://alamo-pipeline.com/api/internal/extraction/report}"

[[ "$databricks_host" =~ ^https://[A-Za-z0-9.-]+\.azuredatabricks\.net$ ]] || {
  printf 'PIPELINE_DATABRICKS_HOST is invalid.\n' >&2
  exit 2
}
[[ "$callback_url" =~ ^https://[A-Za-z0-9.-]+/api/internal/extraction/report$ ]] || {
  printf 'PIPELINE_DATABRICKS_CALLBACK_URL must be the exact HTTPS worker callback.\n' >&2
  exit 2
}

subscription_id="$(az account show --query id -o tsv)"
tenant_id="$(az account show --query tenantId -o tsv)"
storage_account="$(az storage account list --resource-group "$resource_group" --query "[?starts_with(name, 'pipelineprod')].name | [0]" -o tsv)"
key_vault_name="$(az keyvault list --resource-group "$resource_group" --query '[0].name' -o tsv)"
access_connector_id="$(az resource list --resource-group "$resource_group" --resource-type Microsoft.Databricks/accessConnectors --query '[0].id' -o tsv)"
document_endpoint="$(az cognitiveservices account list --resource-group "$resource_group" --query "[?kind=='FormRecognizer'].properties.endpoint | [0]" -o tsv)"

for value_name in subscription_id tenant_id storage_account key_vault_name access_connector_id document_endpoint; do
  [[ -n "${!value_name}" ]] || {
    printf 'Could not discover required existing Pipeline resource: %s\n' "$value_name" >&2
    exit 1
  }
done

export DATABRICKS_HOST="$databricks_host"
export DATABRICKS_TOKEN="$(az account get-access-token --resource 2ff814a6-3304-4ab8-85cb-cd0e6f879c1d --query accessToken -o tsv)"
trap 'unset DATABRICKS_TOKEN' EXIT

principal_json="$(databricks service-principals list --filter "displayName eq '$principal_name'" -o json)"
principal_count="$(jq 'length' <<<"$principal_json")"
if [[ "$principal_count" -gt 1 ]]; then
  printf 'Refusing to continue: multiple service principals use the Pipeline extraction name.\n' >&2
  exit 1
fi
principal_id="$(jq -r '.[0].id // empty' <<<"$principal_json")"
principal_application_id="$(jq -r '.[0].applicationId // empty' <<<"$principal_json")"

credential_json="$(databricks credentials get-credential "$service_credential" -o json 2>/dev/null || true)"
if [[ -n "$credential_json" ]]; then
  configured_connector="$(jq -r '.azure_managed_identity.access_connector_id // empty' <<<"$credential_json")"
  if [[ "${configured_connector,,}" != "${access_connector_id,,}" ]]; then
    printf 'Refusing to continue: the existing Pipeline service credential points to another connector.\n' >&2
    exit 1
  fi
fi

scope_exists="$(databricks secrets list-scopes -o json | jq --arg scope "$secret_scope" '[.[] | select(.name == $scope)] | length')"
printf '%s\n' "Pipeline extraction configuration plan"
printf '  resource group: %s\n' "$resource_group"
printf '  Databricks principal: %s\n' "${principal_application_id:-create new}"
printf '  service credential: %s\n' "$([[ -n "$credential_json" ]] && printf existing || printf 'create new')"
printf '  secret scope: %s\n' "$([[ "$scope_exists" == "1" ]] && printf existing || printf 'create new')"
printf '  bundle job: pipeline-referral-extraction\n'
printf '  existing non-Pipeline jobs modified: none\n'
printf '  deletions: none\n'

if [[ "$mode" == "plan" ]]; then
  printf 'Plan only. Re-run with --apply after review.\n'
  exit 0
fi

temporary_directory="$(mktemp -d -t pipeline-extraction.XXXXXX)"
trap 'rm -rf "$temporary_directory"; unset DATABRICKS_TOKEN' EXIT
chmod 700 "$temporary_directory"

if [[ -z "$principal_id" ]]; then
  created_principal="$(databricks service-principals create --display-name "$principal_name" --active -o json)"
  principal_id="$(jq -r '.id' <<<"$created_principal")"
  principal_application_id="$(jq -r '.applicationId' <<<"$created_principal")"
fi
[[ -n "$principal_id" && -n "$principal_application_id" ]] || {
  printf 'The Pipeline service principal could not be resolved.\n' >&2
  exit 1
}

if ! az keyvault secret show --vault-name "$key_vault_name" --name pipeline-databricks-client-secret --output none 2>/dev/null; then
  oauth_json="$(databricks service-principal-secrets-proxy create "$principal_id" --lifetime 31536000s -o json)"
  oauth_secret="$(jq -r '.secret // empty' <<<"$oauth_json")"
  [[ -n "$oauth_secret" ]] || {
    printf 'Databricks did not return a service-principal OAuth secret.\n' >&2
    exit 1
  }
  printf '%s' "$oauth_secret" > "$temporary_directory/oauth-secret"
  chmod 600 "$temporary_directory/oauth-secret"
  az keyvault secret set --vault-name "$key_vault_name" --name pipeline-databricks-client-secret --file "$temporary_directory/oauth-secret" --output none
  : > "$temporary_directory/oauth-secret"
  unset oauth_secret oauth_json
fi

if [[ "$scope_exists" != "1" ]]; then
  databricks secrets create-scope "$secret_scope" --scope-backend-type DATABRICKS >/dev/null
fi
az keyvault secret show --vault-name "$key_vault_name" --name pipeline-worker-shared-secret --query value -o tsv \
  | databricks secrets put-secret "$secret_scope" worker-shared-secret >/dev/null
databricks secrets put-acl "$secret_scope" "$principal_application_id" READ >/dev/null

if [[ -z "$credential_json" ]]; then
  jq -n \
    --arg connector "$access_connector_id" \
    '{purpose:"SERVICE", comment:"Pipeline-only access to existing Blob and Document Intelligence resources", azure_managed_identity:{access_connector_id:$connector}}' \
    > "$temporary_directory/service-credential.json"
  databricks credentials create-credential "$service_credential" \
    --purpose SERVICE \
    --json "@$temporary_directory/service-credential.json" \
    >/dev/null
fi
jq -n \
  --arg principal "$principal_application_id" \
  '{changes:[{principal:$principal,add:["ACCESS"]}]}' \
  > "$temporary_directory/credential-grant.json"
databricks grants update SERVICE_CREDENTIAL "$service_credential" \
  --json "@$temporary_directory/credential-grant.json" \
  >/dev/null

bundle_variables=(
  --var "pipeline_service_principal=$principal_application_id"
  --var "storage_account=$storage_account"
  --var "callback_url=$callback_url"
  --var "document_intelligence_endpoint=$document_endpoint"
)
databricks bundle validate -t prod "${bundle_variables[@]}" >/dev/null
databricks bundle deploy -t prod --auto-approve --fail-on-active-runs "${bundle_variables[@]}"
bundle_summary="$(databricks bundle summary -t prod -o json "${bundle_variables[@]}")"
job_id="$(jq -r '.resources.jobs.pipeline_extraction.id // empty' <<<"$bundle_summary")"
[[ "$job_id" =~ ^[0-9]+$ ]] || {
  printf 'The deployed Pipeline extraction job ID could not be resolved.\n' >&2
  exit 1
}

printf '%s' "$databricks_host" | gh variable set PIPELINE_DATABRICKS_HOST --repo "$repository"
printf '%s' "$job_id" | gh variable set PIPELINE_DATABRICKS_JOB_ID --repo "$repository"
printf '%s' "$principal_application_id" | gh variable set PIPELINE_DATABRICKS_CLIENT_ID --repo "$repository"

printf 'Pipeline extraction configuration applied.\n'
printf '  service principal application ID: %s\n' "$principal_application_id"
printf '  job ID: %s\n' "$job_id"
printf '  no job was run and no existing job was changed.\n'
printf '  production extraction mode was not changed.\n'
