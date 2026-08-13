#!/usr/bin/env bash

set -euo pipefail

required=(
  PIPELINE_AZURE_RESOURCE_GROUP
  PIPELINE_ALAMO_TENANT_ID
  PIPELINE_ALAMO_CLIENT_ID
  PIPELINE_ALAMO_API_SCOPE
)
for name in "${required[@]}"; do
  [[ -n "${!name:-}" ]] || {
    printf 'Missing required environment variable: %s\n' "$name" >&2
    exit 2
  }
done

for command_name in az gh jq; do
  command -v "$command_name" >/dev/null || {
    printf 'Required command is not installed: %s\n' "$command_name" >&2
    exit 2
  }
done

for id in "$PIPELINE_ALAMO_TENANT_ID" "$PIPELINE_ALAMO_CLIENT_ID"; do
  [[ "$id" =~ ^[0-9a-fA-F-]{36}$ ]] || {
    printf 'Alamo tenant and client IDs must be UUIDs.\n' >&2
    exit 2
  }
done
if ! [[ "$PIPELINE_ALAMO_API_SCOPE" =~ ^api://[0-9a-fA-F-]{36}/\.default$ ]]; then
  printf 'PIPELINE_ALAMO_API_SCOPE must use api://<app-id>/.default.\n' >&2
  exit 2
fi

repository="${PIPELINE_GITHUB_REPOSITORY:-3wilsoneric/pipeline-app}"
api_base_url="${PIPELINE_ALAMO_API_BASE_URL:-https://www.alamoplatform.com}"
foundation_deployment_name="${PIPELINE_FOUNDATION_DEPLOYMENT_NAME:-pipeline-foundation-state}"
if ! [[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  printf 'PIPELINE_GITHUB_REPOSITORY must use owner/repository format.\n' >&2
  exit 2
fi
if ! [[ "$api_base_url" =~ ^https://[A-Za-z0-9.-]+/?$ ]]; then
  printf 'PIPELINE_ALAMO_API_BASE_URL must be an HTTPS origin with no path or query.\n' >&2
  exit 2
fi

foundation_outputs="$(az deployment group show \
  --resource-group "$PIPELINE_AZURE_RESOURCE_GROUP" \
  --name "$foundation_deployment_name" \
  --query properties.outputs \
  --output json)"
key_vault_name="$(jq -r '.keyVaultName.value' <<<"$foundation_outputs")"
[[ -n "$key_vault_name" && "$key_vault_name" != "null" ]] || {
  printf 'The foundation deployment does not expose a Key Vault name.\n' >&2
  exit 1
}

read -r -s -p 'Alamo Pipeline service application client secret: ' alamo_client_secret
printf '\n'
[[ -n "$alamo_client_secret" ]] || {
  printf 'The Alamo client secret cannot be empty.\n' >&2
  exit 2
}

secret_file="$(mktemp -t pipeline-clinical-secret.XXXXXX)"
trap 'rm -f "$secret_file"' EXIT
chmod 600 "$secret_file"
printf '%s' "$alamo_client_secret" > "$secret_file"
az keyvault secret set \
  --vault-name "$key_vault_name" \
  --name pipeline-alamo-client-secret \
  --file "$secret_file" \
  --output none
: > "$secret_file"
unset alamo_client_secret

set_github_variable() {
  printf '%s' "$2" | gh variable set "$1" --repo "$repository"
}
set_github_variable PIPELINE_ALAMO_API_BASE_URL "$api_base_url"
set_github_variable PIPELINE_ALAMO_TENANT_ID "$PIPELINE_ALAMO_TENANT_ID"
set_github_variable PIPELINE_ALAMO_CLIENT_ID "$PIPELINE_ALAMO_CLIENT_ID"
set_github_variable PIPELINE_ALAMO_API_SCOPE "$PIPELINE_ALAMO_API_SCOPE"

printf 'Alamo server-to-server settings are configured without changing database credentials.\n'
printf 'The next deployment may select clinical mode alamo_api after Entra admin consent is confirmed.\n'
