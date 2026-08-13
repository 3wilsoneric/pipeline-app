#!/usr/bin/env bash

set -euo pipefail

required=(
  PIPELINE_AZURE_SUBSCRIPTION_ID
  PIPELINE_AZURE_RESOURCE_GROUP
  PIPELINE_AZURE_LOCATION
  PIPELINE_AZURE_CAPACITY_PROFILE
  PIPELINE_GITHUB_REPOSITORY
)

for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    printf 'Missing required environment variable: %s\n' "$name" >&2
    exit 2
  fi
done

for command_name in az jq openssl; do
  command -v "$command_name" >/dev/null || {
    printf 'Required command is not installed: %s\n' "$command_name" >&2
    exit 2
  }
done

if ! [[ "$PIPELINE_GITHUB_REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  printf 'PIPELINE_GITHUB_REPOSITORY must use owner/repository format.\n' >&2
  exit 2
fi

if [[ "$PIPELINE_AZURE_CAPACITY_PROFILE" != "pilot" && "$PIPELINE_AZURE_CAPACITY_PROFILE" != "production_ha" ]]; then
  printf 'PIPELINE_AZURE_CAPACITY_PROFILE must be pilot or production_ha.\n' >&2
  exit 2
fi

name_prefix="${PIPELINE_AZURE_NAME_PREFIX:-pipeline}"
environment="${PIPELINE_AZURE_ENVIRONMENT:-prod}"
github_branch="${PIPELINE_GITHUB_BRANCH:-main}"
postgres_admin="${PIPELINE_POSTGRES_ADMIN_LOGIN:-pipelineadmin}"
parameters_file="$(mktemp -t pipeline-foundation.XXXXXX.json)"
outputs_file="${TMPDIR:-/tmp}/pipeline-foundation-outputs.json"
alert_action_group_ids="${PIPELINE_ALERT_ACTION_GROUP_IDS_JSON:-[]}"
trap 'rm -f "$parameters_file"' EXIT
chmod 600 "$parameters_file"

if ! jq -e 'type == "array" and all(.[]; type == "string" and startswith("/subscriptions/"))' \
  <<<"$alert_action_group_ids" >/dev/null; then
  printf 'PIPELINE_ALERT_ACTION_GROUP_IDS_JSON must be a JSON array of Azure resource IDs.\n' >&2
  exit 2
fi

if ! az account show >/dev/null 2>&1; then
  az login --use-device-code >/dev/null
fi
az account set --subscription "$PIPELINE_AZURE_SUBSCRIPTION_ID"

if [[ -n "${PIPELINE_POSTGRES_ADMIN_PASSWORD_FILE:-}" ]]; then
  [[ -f "$PIPELINE_POSTGRES_ADMIN_PASSWORD_FILE" ]] || {
    printf 'PostgreSQL password file not found.\n' >&2
    exit 2
  }
  postgres_password="$(<"$PIPELINE_POSTGRES_ADMIN_PASSWORD_FILE")"
else
  printf 'Enter a new PostgreSQL administrator password. It is used only for the initial role bootstrap.\n'
  read -r -s -p 'PostgreSQL administrator password: ' postgres_password
  printf '\n'
fi
if [[ ${#postgres_password} -lt 16 ]]; then
  printf 'Use a password of at least 16 characters.\n' >&2
  exit 2
fi

jq -n \
  --arg prefix "$name_prefix" \
  --arg environment "$environment" \
  --arg databaseServiceLevel "$PIPELINE_AZURE_CAPACITY_PROFILE" \
  --arg location "$PIPELINE_AZURE_LOCATION" \
  --arg admin "$postgres_admin" \
  --arg password "$postgres_password" \
  --arg repository "$PIPELINE_GITHUB_REPOSITORY" \
  --arg githubBranch "$github_branch" \
  --argjson alertActionGroupResourceIds "$alert_action_group_ids" \
  '{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    contentVersion: "1.0.0.0",
    parameters: {
      namePrefix: { value: $prefix },
      environment: { value: $environment },
      databaseServiceLevel: { value: $databaseServiceLevel },
      location: { value: $location },
      postgresAdministratorLogin: { value: $admin },
      postgresAdministratorPassword: { value: $password },
      githubRepository: { value: $repository },
      githubBranch: { value: $githubBranch },
      alertActionGroupResourceIds: { value: $alertActionGroupResourceIds },
      enableOperationalAlerts: { value: true }
    }
  }' > "$parameters_file"
unset postgres_password

providers=(
  Microsoft.App \
  Microsoft.Authorization \
  Microsoft.CognitiveServices \
  Microsoft.ContainerRegistry \
  Microsoft.DBforPostgreSQL \
  Microsoft.Databricks \
  Microsoft.Insights \
  Microsoft.KeyVault \
  Microsoft.ManagedIdentity \
  Microsoft.Network \
  Microsoft.OperationalInsights \
  Microsoft.Storage
)
for provider in "${providers[@]}"; do
  if [[ "$(az provider show --namespace "$provider" --query registrationState --output tsv)" != "Registered" ]]; then
    az provider register --namespace "$provider" --output none
  fi
done

for attempt in {1..60}; do
  pending=()
  for provider in "${providers[@]}"; do
    if [[ "$(az provider show --namespace "$provider" --query registrationState --output tsv)" != "Registered" ]]; then
      pending+=("$provider")
    fi
  done
  if (( ${#pending[@]} == 0 )); then break; fi
  if [[ "$attempt" == 60 ]]; then
    printf 'Azure providers did not finish registration: %s\n' "${pending[*]}" >&2
    exit 1
  fi
  sleep 5
done

az group create \
  --name "$PIPELINE_AZURE_RESOURCE_GROUP" \
  --location "$PIPELINE_AZURE_LOCATION" \
  --tags application=pipeline environment="$environment" dataClassification=phi \
  >/dev/null

az deployment group what-if \
  --resource-group "$PIPELINE_AZURE_RESOURCE_GROUP" \
  --name pipeline-foundation-preview \
  --template-file infra/azure/main.bicep \
  --parameters "@$parameters_file"

printf '\nReview the what-if output above. Type DEPLOY to create the foundation: '
read -r confirmation
if [[ "$confirmation" != "DEPLOY" ]]; then
  printf 'No Azure resources were deployed.\n'
  exit 0
fi

az deployment group create \
  --resource-group "$PIPELINE_AZURE_RESOURCE_GROUP" \
  --name pipeline-foundation \
  --template-file infra/azure/main.bicep \
  --parameters "@$parameters_file" \
  --query properties.outputs \
  --output json > "$outputs_file"

az deployment group create \
  --resource-group "$PIPELINE_AZURE_RESOURCE_GROUP" \
  --name pipeline-foundation-state \
  --template-file infra/azure/foundation-state.bicep \
  --parameters \
    namePrefix="$name_prefix" \
    environment="$environment" \
    databaseServiceLevel="$PIPELINE_AZURE_CAPACITY_PROFILE" \
    location="$PIPELINE_AZURE_LOCATION" \
    postgresAdministratorLogin="$postgres_admin" \
    githubRepository="$PIPELINE_GITHUB_REPOSITORY" \
    githubBranch="$github_branch" \
  --query properties.outputs \
  --output json > "$outputs_file"

printf '\nFoundation deployed. Non-secret outputs were written to:\n%s\n\n' "$outputs_file"
jq '{
  tenantId: .tenantId.value,
  subscriptionId: .subscriptionId.value,
  resourceGroup: $resourceGroup,
  githubDeploymentClientId: .githubDeploymentClientId.value,
  runtimeIdentityClientId: .runtimeIdentityClientId.value,
  keyVaultName: .keyVaultName.value,
  postgresHost: .postgresHost.value,
  databaseServiceLevel: .databaseServiceLevel.value,
  containerRegistryName: .containerRegistryName.value,
  databricksAccessConnectorId: .databricksAccessConnectorId.value,
  documentIntelligenceEndpoint: .documentIntelligenceEndpoint.value,
  containerAppsEnvironmentName: .containerAppsEnvironmentName.value
}' --arg resourceGroup "$PIPELINE_AZURE_RESOURCE_GROUP" "$outputs_file"

printf '\nNext: follow docs/AZURE_PRODUCTION_SETUP.md starting at Step 4.\n'
