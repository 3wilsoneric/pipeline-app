#!/usr/bin/env bash

set -euo pipefail

custom_hostname="${1:-}"
record_mode="${2:-auto}"
if ! [[ "$custom_hostname" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] ||
  [[ "$custom_hostname" != *.* ]]; then
  printf 'Usage: %s example.com [apex|subdomain]\n' "$0" >&2
  exit 2
fi
case "$record_mode" in
  auto)
    label_count="$(awk -F. '{ print NF }' <<<"$custom_hostname")"
    if [[ "$label_count" -eq 2 ]]; then
      record_mode="apex"
    else
      record_mode="subdomain"
    fi
    ;;
  apex | subdomain) ;;
  *)
    printf 'Domain mode must be apex or subdomain.\n' >&2
    exit 2
    ;;
esac

resource_group="${PIPELINE_AZURE_RESOURCE_GROUP:-}"
[[ -n "$resource_group" ]] || {
  read -r -p 'Azure resource group: ' resource_group
}

for command_name in az dig jq; do
  command -v "$command_name" >/dev/null || {
    printf 'Required command is not installed: %s\n' "$command_name" >&2
    exit 2
  }
done

runtime_outputs="$(az deployment group show \
  --resource-group "$resource_group" \
  --name pipeline-runtime \
  --query properties.outputs \
  --output json)"
foundation_outputs="$(az deployment group show \
  --resource-group "$resource_group" \
  --name pipeline-foundation \
  --query properties.outputs \
  --output json)"

app_name="$(jq -r '.containerAppName.value' <<<"$runtime_outputs")"
generated_fqdn="$(jq -r '.containerAppFqdn.value' <<<"$runtime_outputs")"
environment_name="$(jq -r '.containerAppsEnvironmentName.value' <<<"$foundation_outputs")"
storage_account="$(jq -r '.storageAccountName.value' <<<"$foundation_outputs")"
verification_id="$(az containerapp show \
  --resource-group "$resource_group" \
  --name "$app_name" \
  --query properties.customDomainVerificationId \
  --output tsv)"

caa_records="$(dig +short CAA "$custom_hostname")"
if [[ -n "$caa_records" ]] && ! grep -qi 'digicert\.com' <<<"$caa_records"; then
  printf 'The domain has CAA records but does not authorize DigiCert.\n' >&2
  printf 'Add: CAA  @  0 issue "digicert.com"\n' >&2
  printf 'Current CAA records:\n%s\n' "$caa_records" >&2
  exit 1
fi

printf '\nCreate these records at the authoritative DNS provider:\n\n'
if [[ "$record_mode" == "apex" ]]; then
  environment_ip="$(az containerapp env show \
    --resource-group "$resource_group" \
    --name "$environment_name" \
    --query properties.staticIp \
    --output tsv)"
  printf 'A      @      %s\n' "$environment_ip"
  printf 'TXT    asuid  %s\n\n' "$verification_id"
  validation_method="HTTP"
else
  host_label="${custom_hostname%%.*}"
  printf 'CNAME  %s        %s\n' "$host_label" "$generated_fqdn"
  printf 'TXT    asuid.%s  %s\n\n' "$host_label" "$verification_id"
  validation_method="CNAME"
fi
printf 'Keep the TXT record permanently for certificate renewal and ownership validation.\n'
printf 'After DNS is saved, type CONTINUE: '
read -r confirmation
[[ "$confirmation" == "CONTINUE" ]] || {
  printf 'No Azure domain or CORS changes were made.\n'
  exit 0
}

if [[ "$record_mode" == "apex" ]]; then
  resolved_addresses="$(dig +short A "$custom_hostname")"
  if ! grep -Fxq "$environment_ip" <<<"$resolved_addresses"; then
    printf 'DNS has not propagated to the expected A record yet. Expected %s.\n' "$environment_ip" >&2
    exit 1
  fi
else
  resolved_cname="$(dig +short CNAME "$custom_hostname" | sed 's/\.$//' | head -n 1)"
  if [[ "$resolved_cname" != "$generated_fqdn" ]]; then
    printf 'DNS has not propagated to the expected CNAME yet. Expected %s, received %s.\n' "$generated_fqdn" "${resolved_cname:-nothing}" >&2
    exit 1
  fi
fi

az containerapp hostname add \
  --resource-group "$resource_group" \
  --name "$app_name" \
  --hostname "$custom_hostname" \
  >/dev/null
az containerapp hostname bind \
  --resource-group "$resource_group" \
  --name "$app_name" \
  --environment "$environment_name" \
  --hostname "$custom_hostname" \
  --validation-method "$validation_method" \
  >/dev/null

storage_id="$(az storage account show \
  --resource-group "$resource_group" \
  --name "$storage_account" \
  --query id \
  --output tsv)"
cors_body="$(jq -n \
  --arg productionOrigin "https://${custom_hostname}" \
  --arg generatedOrigin "https://${generated_fqdn}" \
  '{
    properties: {
      cors: {
        corsRules: [{
          allowedOrigins: [$productionOrigin, $generatedOrigin],
          allowedMethods: ["PUT", "OPTIONS"],
          allowedHeaders: ["content-type", "x-ms-blob-type"],
          exposedHeaders: ["etag", "x-ms-request-id"],
          maxAgeInSeconds: 3600
        }]
      }
    }
  }')"
az rest \
  --method PATCH \
  --url "https://management.azure.com${storage_id}/blobServices/default?api-version=2025-01-01" \
  --body "$cors_body" \
  --output none

printf '\nDomain and exact-origin Blob CORS configured:\nhttps://%s\n' "$custom_hostname"
entra_client_id="${PIPELINE_ENTRA_CLIENT_ID:-}"
if [[ -n "$entra_client_id" ]]; then
  app_object_id="$(az ad app show --id "$entra_client_id" --query id --output tsv)"
  app_json="$(az rest \
    --method GET \
    --url "https://graph.microsoft.com/v1.0/applications/${app_object_id}?\$select=spa" \
    --output json)"
  redirect_uri="https://${custom_hostname}/sign-in"
  redirect_uris="$(jq -c --arg redirect "$redirect_uri" \
    '[(.spa.redirectUris // [])[], $redirect] | unique' <<<"$app_json")"
  redirect_body="$(jq -n --argjson redirectUris "$redirect_uris" \
    '{ spa: { redirectUris: $redirectUris } }')"
  az rest \
    --method PATCH \
    --url "https://graph.microsoft.com/v1.0/applications/${app_object_id}" \
    --body "$redirect_body" \
    --output none
  printf 'Entra SPA redirect configured: %s\n' "$redirect_uri"
else
  printf 'Set PIPELINE_ENTRA_CLIENT_ID and rerun, or add https://%s/sign-in to the Entra SPA redirects before sign-in testing.\n' "$custom_hostname"
fi
