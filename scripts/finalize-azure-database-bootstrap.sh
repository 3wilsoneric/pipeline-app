#!/usr/bin/env bash

set -euo pipefail

resource_group="${PIPELINE_AZURE_RESOURCE_GROUP:-}"
[[ -n "$resource_group" ]] || {
  read -r -p 'Azure resource group: ' resource_group
}

for command_name in az jq; do
  command -v "$command_name" >/dev/null || {
    printf 'Required command is not installed: %s\n' "$command_name" >&2
    exit 2
  }
done

foundation_outputs="$(az deployment group show \
  --resource-group "$resource_group" \
  --name pipeline-foundation \
  --query properties.outputs \
  --output json)"
runtime_outputs="$(az deployment group show \
  --resource-group "$resource_group" \
  --name pipeline-runtime \
  --query properties.outputs \
  --output json)"

key_vault_name="$(jq -r '.keyVaultName.value' <<<"$foundation_outputs")"
bootstrap_job="$(jq -r '.databaseBootstrapJobName.value' <<<"$runtime_outputs")"
latest_status="$(az containerapp job execution list \
  --resource-group "$resource_group" \
  --name "$bootstrap_job" \
  --query 'sort_by(@,&properties.startTime)[-1].properties.status' \
  --output tsv)"

if [[ "$latest_status" != "Succeeded" ]]; then
  printf 'Refusing cleanup because the latest database bootstrap execution is %s.\n' "${latest_status:-missing}" >&2
  exit 1
fi

printf 'The bootstrap already invalidated its PostgreSQL administrator password.\n'
printf 'This removes the stale Key Vault URL and the one-time bootstrap job.\n'
printf 'Type REMOVE-BOOTSTRAP: '
read -r confirmation
[[ "$confirmation" == "REMOVE-BOOTSTRAP" ]] || {
  printf 'No changes were made.\n'
  exit 0
}

az keyvault secret delete \
  --vault-name "$key_vault_name" \
  --name pipeline-database-admin-url \
  --output none
az containerapp job delete \
  --resource-group "$resource_group" \
  --name "$bootstrap_job" \
  --yes \
  --output none

printf 'The administrator URL and one-time bootstrap job were removed.\n'
printf 'Future deployments must leave Initial database bootstrap unchecked.\n'
