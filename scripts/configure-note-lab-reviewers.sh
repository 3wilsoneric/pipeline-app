#!/usr/bin/env bash

set -euo pipefail

tenant_id="${PIPELINE_AZURE_TENANT_ID:?PIPELINE_AZURE_TENANT_ID is required}"
pipeline_app_id="${PIPELINE_ENTRA_CLIENT_ID:?PIPELINE_ENTRA_CLIENT_ID is required}"
reviewer_object_ids="${PIPELINE_NOTE_LAB_REVIEWER_OBJECT_IDS:?PIPELINE_NOTE_LAB_REVIEWER_OBJECT_IDS is required}"

for command_name in az jq uuidgen; do
  command -v "$command_name" >/dev/null || {
    printf 'Required command is not installed: %s\n' "$command_name" >&2
    exit 2
  }
done

actual_tenant="$(az account show --query tenantId --output tsv)"
if [[ "$actual_tenant" != "$tenant_id" ]]; then
  printf 'Azure CLI is signed into tenant %s, expected %s.\n' "$actual_tenant" "$tenant_id" >&2
  exit 2
fi

pipeline_app="$(az ad app show --id "$pipeline_app_id" --output json)"
pipeline_object_id="$(jq -r '.id' <<<"$pipeline_app")"
pipeline_sp_object_id="$(az ad sp show --id "$pipeline_app_id" --query id --output tsv)"
note_lab_role_id="$(jq -r '.appRoles[]? | select(.value == "Pipeline.NoteLabReviewer" and .isEnabled == true) | .id' <<<"$pipeline_app" | head -n 1)"

if [[ -z "$note_lab_role_id" ]]; then
  note_lab_role_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
  role_body="$(mktemp -t pipeline-note-lab-reviewer-role.XXXXXX.json)"
  trap 'rm -f "${role_body:-}" "${assignment_body:-}"' EXIT
  jq \
    --arg role_id "$note_lab_role_id" \
    '.appRoles += [{
      id: $role_id,
      value: "Pipeline.NoteLabReviewer",
      displayName: "Pipeline Note Lab Reviewer",
      description: "Use the standalone assessment notes lab without access to Pipeline clinical workflows.",
      isEnabled: true,
      allowedMemberTypes: ["User"]
    }] | {appRoles: .appRoles}' <<<"$pipeline_app" > "$role_body"
  az rest \
    --method PATCH \
    --url "https://graph.microsoft.com/v1.0/applications/${pipeline_object_id}" \
    --headers Content-Type=application/json \
    --body "@$role_body" \
    --output none
fi

IFS=',' read -r -a reviewer_ids <<<"$reviewer_object_ids"
for raw_object_id in "${reviewer_ids[@]}"; do
  object_id="$(tr -d '[:space:]' <<<"$raw_object_id")"
  if [[ ! "$object_id" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
    printf 'Invalid reviewer object ID: %s\n' "$object_id" >&2
    exit 2
  fi

  display_name="$(az ad user show --id "$object_id" --query displayName --output tsv)"
  assignments="$(az rest \
    --method GET \
    --url "https://graph.microsoft.com/v1.0/users/${object_id}/appRoleAssignments" \
    --output json)"

  while IFS=$'\t' read -r assignment_id assigned_role_id; do
    [[ -z "$assignment_id" ]] && continue
    if [[ "$assigned_role_id" != "$note_lab_role_id" ]]; then
      az rest \
        --method DELETE \
        --url "https://graph.microsoft.com/v1.0/users/${object_id}/appRoleAssignments/${assignment_id}" \
        --output none
    fi
  done < <(jq -r \
    --arg resource_id "$pipeline_sp_object_id" \
    '.value[]? | select(.resourceId == $resource_id) | [.id, .appRoleId] | @tsv' <<<"$assignments")

  if ! jq -e \
    --arg resource_id "$pipeline_sp_object_id" \
    --arg role_id "$note_lab_role_id" \
    '.value[]? | select(.resourceId == $resource_id and .appRoleId == $role_id)' \
    <<<"$assignments" >/dev/null; then
    assignment_body="$(mktemp -t pipeline-note-lab-reviewer-assignment.XXXXXX.json)"
    jq -n \
      --arg principal_id "$object_id" \
      --arg resource_id "$pipeline_sp_object_id" \
      --arg role_id "$note_lab_role_id" \
      '{principalId: $principal_id, resourceId: $resource_id, appRoleId: $role_id}' > "$assignment_body"
    az rest \
      --method POST \
      --url "https://graph.microsoft.com/v1.0/users/${object_id}/appRoleAssignments" \
      --headers Content-Type=application/json \
      --body "@$assignment_body" \
      --output none
    rm -f "$assignment_body"
  fi

  printf 'Assigned lab-only access to %s (%s).\n' "$display_name" "$object_id"
done

printf 'No invitation or notification was sent.\n'
