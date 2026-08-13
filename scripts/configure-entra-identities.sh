#!/usr/bin/env bash

set -euo pipefail

tenant_id="${PIPELINE_AZURE_TENANT_ID:?PIPELINE_AZURE_TENANT_ID is required}"
subscription_id="${PIPELINE_AZURE_SUBSCRIPTION_ID:?PIPELINE_AZURE_SUBSCRIPTION_ID is required}"
alamo_api_app_id="${PIPELINE_ALAMO_API_APP_ID:-40283155-592b-4565-bd3c-c730a34feaaa}"
pipeline_display_name="Alamo Pipeline"
service_display_name="Alamo Pipeline Clinical Client"
output_file="${TMPDIR:-/tmp}/pipeline-entra-identities.json"

for command_name in az jq uuidgen; do
  command -v "$command_name" >/dev/null || {
    printf 'Required command is not installed: %s\n' "$command_name" >&2
    exit 2
  }
done

az account set --subscription "$subscription_id"
actual_tenant="$(az account show --query tenantId --output tsv)"
if [[ "$actual_tenant" != "$tenant_id" ]]; then
  printf 'Azure CLI is signed into tenant %s, expected %s.\n' "$actual_tenant" "$tenant_id" >&2
  exit 2
fi

find_exact_app() {
  local display_name="$1"
  local apps count
  apps="$(az ad app list --filter "displayName eq '$display_name'" --output json)"
  count="$(jq 'length' <<<"$apps")"
  if (( count > 1 )); then
    printf 'Multiple Entra applications are named %s; refusing to guess.\n' "$display_name" >&2
    exit 2
  fi
  jq -c '.[0] // empty' <<<"$apps"
}

ensure_service_principal() {
  local app_id="$1"
  if ! az ad sp show --id "$app_id" --output none 2>/dev/null; then
    az ad sp create --id "$app_id" --output none
  fi
  az ad sp show --id "$app_id" --query id --output tsv
}

pipeline_app="$(find_exact_app "$pipeline_display_name")"
if [[ -z "$pipeline_app" ]]; then
  pipeline_app="$(az ad app create \
    --display-name "$pipeline_display_name" \
    --sign-in-audience AzureADMyOrg \
    --query '{id:id,appId:appId,displayName:displayName}' \
    --output json)"
  pipeline_created=true
else
  pipeline_created=false
fi

pipeline_object_id="$(jq -r '.id' <<<"$pipeline_app")"
pipeline_app_id="$(jq -r '.appId' <<<"$pipeline_app")"

if [[ "$pipeline_created" == true ]]; then
  access_scope_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  admin_role_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  coordinator_role_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  reviewer_role_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  viewer_role_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  body_file="$(mktemp -t pipeline-entra-app.XXXXXX.json)"
  trap 'rm -f "${body_file:-}"' EXIT
  jq -n \
    --arg app_id "$pipeline_app_id" \
    --arg scope_id "$access_scope_id" \
    --arg admin_id "$admin_role_id" \
    --arg coordinator_id "$coordinator_role_id" \
    --arg reviewer_id "$reviewer_role_id" \
    --arg viewer_id "$viewer_role_id" \
    '{
      identifierUris: ["api://" + $app_id],
      spa: { redirectUris: ["http://localhost:3000/sign-in"] },
      api: {
        requestedAccessTokenVersion: 2,
        oauth2PermissionScopes: [{
          id: $scope_id,
          value: "access_as_user",
          type: "User",
          isEnabled: true,
          adminConsentDisplayName: "Access Pipeline",
          adminConsentDescription: "Allow signed-in staff to access Pipeline.",
          userConsentDisplayName: "Access Pipeline",
          userConsentDescription: "Allow this application to access Pipeline on your behalf."
        }]
      },
      appRoles: [
        { id: $admin_id, value: "Pipeline.Admin", displayName: "Pipeline Admin", description: "Administer Pipeline.", isEnabled: true, allowedMemberTypes: ["User"] },
        { id: $coordinator_id, value: "Pipeline.AssessmentCoordinator", displayName: "Pipeline Assessment Coordinator", description: "Coordinate referrals and assessments.", isEnabled: true, allowedMemberTypes: ["User"] },
        { id: $reviewer_id, value: "Pipeline.Reviewer", displayName: "Pipeline Reviewer", description: "Review referral and assessment data.", isEnabled: true, allowedMemberTypes: ["User"] },
        { id: $viewer_id, value: "Pipeline.Viewer", displayName: "Pipeline Viewer", description: "View authorized Pipeline records.", isEnabled: true, allowedMemberTypes: ["User"] }
      ],
      requiredResourceAccess: [{
        resourceAppId: $app_id,
        resourceAccess: [{ id: $scope_id, type: "Scope" }]
      }]
    }' > "$body_file"
  az rest \
    --method PATCH \
    --url "https://graph.microsoft.com/v1.0/applications/${pipeline_object_id}" \
    --headers Content-Type=application/json \
    --body "@$body_file" \
    --output none
else
  required_values='["Pipeline.Admin","Pipeline.AssessmentCoordinator","Pipeline.Reviewer","Pipeline.Viewer"]'
  current_app="$(az ad app show --id "$pipeline_app_id" --output json)"
  if ! jq -e \
    --argjson required "$required_values" \
    '. as $app
      | ([.appRoles[]?.value] as $actual | all($required[]; . as $value | $actual | index($value) != null))
      and ([.api.oauth2PermissionScopes[]?.value] | index("access_as_user") != null)
      and (.identifierUris | index("api://" + $app.appId) != null)' \
    <<<"$current_app" >/dev/null; then
    printf 'Existing Alamo Pipeline app does not match the governed contract; refusing to overwrite it.\n' >&2
    exit 2
  fi
fi

pipeline_sp_object_id="$(ensure_service_principal "$pipeline_app_id")"

pipeline_manifest="$(az ad app show --id "$pipeline_app_id" --output json)"
access_scope_id="$(jq -r '.api.oauth2PermissionScopes[]? | select(.value == "access_as_user" and .isEnabled == true) | .id' <<<"$pipeline_manifest" | head -n 1)"
admin_role_id="$(jq -r '.appRoles[]? | select(.value == "Pipeline.Admin" and .isEnabled == true) | .id' <<<"$pipeline_manifest" | head -n 1)"
if [[ -z "$access_scope_id" || -z "$admin_role_id" ]]; then
  printf 'The Pipeline Entra app is missing its governed scope or admin role.\n' >&2
  exit 2
fi

api_body="$(mktemp -t pipeline-entra-api.XXXXXX.json)"
trap 'rm -f "${body_file:-}" "${api_body:-}"' EXIT
jq \
  --arg client_id "$pipeline_app_id" \
  --arg scope_id "$access_scope_id" \
  '.api
    | .preAuthorizedApplications = ((.preAuthorizedApplications // [])
      + [{appId: $client_id, delegatedPermissionIds: [$scope_id]}]
      | unique_by(.appId))
    | {api: .}' <<<"$pipeline_manifest" > "$api_body"
az rest \
  --method PATCH \
  --url "https://graph.microsoft.com/v1.0/applications/${pipeline_object_id}" \
  --headers Content-Type=application/json \
  --body "@$api_body" \
  --output none

# Pre-authorization suppresses an interactive consent prompt, but the tenant
# still needs the delegated grant before an assigned user can receive a token.
az ad app permission admin-consent --id "$pipeline_app_id"
delegated_grants="$(az rest \
  --method GET \
  --url "https://graph.microsoft.com/v1.0/oauth2PermissionGrants" \
  --output json)"
if ! jq -e \
  --arg client_id "$pipeline_sp_object_id" \
  --arg resource_id "$pipeline_sp_object_id" \
  '.value[]?
    | select(
        .clientId == $client_id
        and .resourceId == $resource_id
        and .consentType == "AllPrincipals"
        and ((.scope // "") | split(" ") | index("access_as_user") != null)
      )' \
  <<<"$delegated_grants" >/dev/null; then
  printf 'Tenant-wide admin consent for Pipeline access_as_user was not created.\n' >&2
  exit 2
fi

az rest \
  --method PATCH \
  --url "https://graph.microsoft.com/v1.0/servicePrincipals/${pipeline_sp_object_id}" \
  --headers Content-Type=application/json \
  --body '{"appRoleAssignmentRequired":true}' \
  --output none

initial_admin_object_id="$(az ad signed-in-user show --query id --output tsv)"
initial_admin_upn="$(az ad signed-in-user show --query userPrincipalName --output tsv)"
admin_assignments="$(az rest \
  --method GET \
  --url "https://graph.microsoft.com/v1.0/users/${initial_admin_object_id}/appRoleAssignments" \
  --output json)"
if ! jq -e \
  --arg resource_id "$pipeline_sp_object_id" \
  --arg role_id "$admin_role_id" \
  '.value[]? | select(.resourceId == $resource_id and .appRoleId == $role_id)' \
  <<<"$admin_assignments" >/dev/null; then
  admin_assignment_body="$(mktemp -t pipeline-admin-assignment.XXXXXX.json)"
  trap 'rm -f "${body_file:-}" "${api_body:-}" "${admin_assignment_body:-}"' EXIT
  jq -n \
    --arg principal_id "$initial_admin_object_id" \
    --arg resource_id "$pipeline_sp_object_id" \
    --arg role_id "$admin_role_id" \
    '{principalId: $principal_id, resourceId: $resource_id, appRoleId: $role_id}' > "$admin_assignment_body"
  az rest \
    --method POST \
    --url "https://graph.microsoft.com/v1.0/users/${initial_admin_object_id}/appRoleAssignments" \
    --headers Content-Type=application/json \
    --body "@$admin_assignment_body" \
    --output none
fi

service_app="$(find_exact_app "$service_display_name")"
if [[ -z "$service_app" ]]; then
  service_app="$(az ad app create \
    --display-name "$service_display_name" \
    --sign-in-audience AzureADMyOrg \
    --query '{id:id,appId:appId,displayName:displayName}' \
    --output json)"
fi
service_app_id="$(jq -r '.appId' <<<"$service_app")"
service_sp_object_id="$(ensure_service_principal "$service_app_id")"

alamo_api_app="$(az ad app show --id "$alamo_api_app_id" --output json)"
alamo_api_object_id="$(jq -r '.id' <<<"$alamo_api_app")"
clinical_role_id="$(jq -r '.appRoles[]? | select(.value == "Pipeline.Clinical.Read.All") | .id' <<<"$alamo_api_app" | head -n 1)"
if [[ -z "$clinical_role_id" ]]; then
  clinical_role_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  role_body="$(mktemp -t pipeline-alamo-role.XXXXXX.json)"
  trap 'rm -f "${body_file:-}" "${role_body:-}"' EXIT
  jq \
    --arg role_id "$clinical_role_id" \
    '.appRoles += [{
      id: $role_id,
      value: "Pipeline.Clinical.Read.All",
      displayName: "Pipeline clinical read",
      description: "Allow the Pipeline server to read the governed clinical API.",
      isEnabled: true,
      allowedMemberTypes: ["Application"]
    }] | {appRoles: .appRoles}' <<<"$alamo_api_app" > "$role_body"
  az rest \
    --method PATCH \
    --url "https://graph.microsoft.com/v1.0/applications/${alamo_api_object_id}" \
    --headers Content-Type=application/json \
    --body "@$role_body" \
    --output none
fi

alamo_api_sp_object_id="$(ensure_service_principal "$alamo_api_app_id")"
assignments="$(az rest \
  --method GET \
  --url "https://graph.microsoft.com/v1.0/servicePrincipals/${service_sp_object_id}/appRoleAssignments" \
  --output json)"
if ! jq -e \
  --arg resource_id "$alamo_api_sp_object_id" \
  --arg role_id "$clinical_role_id" \
  '.value[]? | select(.resourceId == $resource_id and .appRoleId == $role_id)' \
  <<<"$assignments" >/dev/null; then
  assignment_body="$(mktemp -t pipeline-role-assignment.XXXXXX.json)"
  trap 'rm -f "${body_file:-}" "${role_body:-}" "${assignment_body:-}"' EXIT
  jq -n \
    --arg principal_id "$service_sp_object_id" \
    --arg resource_id "$alamo_api_sp_object_id" \
    --arg role_id "$clinical_role_id" \
    '{principalId: $principal_id, resourceId: $resource_id, appRoleId: $role_id}' > "$assignment_body"
  az rest \
    --method POST \
    --url "https://graph.microsoft.com/v1.0/servicePrincipals/${service_sp_object_id}/appRoleAssignments" \
    --headers Content-Type=application/json \
    --body "@$assignment_body" \
    --output none
fi

jq -n \
  --arg tenant_id "$tenant_id" \
  --arg pipeline_app_id "$pipeline_app_id" \
  --arg pipeline_sp_object_id "$pipeline_sp_object_id" \
  --arg service_app_id "$service_app_id" \
  --arg service_sp_object_id "$service_sp_object_id" \
  --arg alamo_api_app_id "$alamo_api_app_id" \
  --arg clinical_role_id "$clinical_role_id" \
  --arg initial_admin_upn "$initial_admin_upn" \
  '{
    tenantId: $tenant_id,
    pipelineHumanAppClientId: $pipeline_app_id,
    pipelineHumanServicePrincipalObjectId: $pipeline_sp_object_id,
    pipelineClinicalClientId: $service_app_id,
    pipelineClinicalServicePrincipalObjectId: $service_sp_object_id,
    alamoApiAppId: $alamo_api_app_id,
    alamoApiScope: ("api://" + $alamo_api_app_id + "/.default"),
    alamoClinicalRoleId: $clinical_role_id,
    initialAdminPrincipal: $initial_admin_upn,
    secretsCreated: false
  }' > "$output_file"
chmod 600 "$output_file"

printf 'Entra identities configured. No client secret was created.\n'
printf 'Non-secret output: %s\n' "$output_file"
jq '{tenantId,pipelineHumanAppClientId,pipelineClinicalClientId,alamoApiAppId,alamoApiScope,initialAdminPrincipal,secretsCreated}' "$output_file"
