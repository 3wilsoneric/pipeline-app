import "server-only";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { getPipelineSql } from "@/lib/database/pipeline-database";
import { getReferralStoreReadiness } from "@/lib/pipeline/referral-store";

export type WorkspaceMember = {
  principal_id: string;
  display_name: string;
  email: string | null;
  roles: string[];
  active: boolean;
  last_seen_at: string | null;
  identity_status: "entra_linked" | "provisional" | "merged";
  source_system: string | null;
  source_identity: string | null;
  merged_into_principal_id: string | null;
};

type WorkspaceMemberRow = {
  principal_id: string;
  display_name: string;
  email: string | null;
  roles: string[];
  active: boolean;
  last_seen_at: Date | string | null;
  identity_status: "entra_linked" | "provisional" | "merged";
  source_system: string | null;
  source_identity: string | null;
  merged_into_principal_id: string | null;
};

const localMembers = new Map<string, WorkspaceMember>();

export async function touchWorkspaceMember(user: PipelineUser) {
  const member = memberFromUser(user);
  if (getReferralStoreReadiness().mode !== "postgres") {
    localMembers.set(member.principal_id, member);
    return member;
  }

  const sql = getPipelineSql();
  const rows = await sql<WorkspaceMemberRow[]>`
    insert into pipeline.workspace_members (
      principal_id, display_name, email, roles, active, last_seen_at, updated_at
    ) values (
      ${member.principal_id}, ${member.display_name}, ${member.email}, ${member.roles}, true, now(), now()
    )
    on conflict (principal_id) do update set
      display_name = excluded.display_name,
      email = excluded.email,
      roles = excluded.roles,
      active = true,
      last_seen_at = now(),
      updated_at = now()
    returning principal_id, display_name, email, roles, active, last_seen_at,
      coalesce(to_jsonb(workspace_members)->>'identity_status', 'entra_linked') as identity_status,
      to_jsonb(workspace_members)->>'source_system' as source_system,
      to_jsonb(workspace_members)->>'source_identity' as source_identity,
      to_jsonb(workspace_members)->>'merged_into_principal_id' as merged_into_principal_id
  `;
  return mapMember(rows[0]);
}

export async function listWorkspaceMembers(currentUser?: PipelineUser) {
  if (currentUser) await touchWorkspaceMember(currentUser);
  if (getReferralStoreReadiness().mode !== "postgres") {
    return [...localMembers.values()]
      .filter((member) => member.active)
      .sort(compareMembers);
  }

  const sql = getPipelineSql();
  const rows = await sql<WorkspaceMemberRow[]>`
    select principal_id, display_name, email, roles, active, last_seen_at,
      coalesce(to_jsonb(workspace_members)->>'identity_status', 'entra_linked') as identity_status,
      to_jsonb(workspace_members)->>'source_system' as source_system,
      to_jsonb(workspace_members)->>'source_identity' as source_identity,
      to_jsonb(workspace_members)->>'merged_into_principal_id' as merged_into_principal_id
    from pipeline.workspace_members
    where active
    order by lower(display_name), principal_id
    limit 500
  `;
  return rows.map(mapMember);
}

export async function getActiveWorkspaceMember(principalId: string) {
  const normalized = principalId.trim();
  if (!normalized) return null;
  if (getReferralStoreReadiness().mode !== "postgres") {
    const member = localMembers.get(normalized);
    return member?.active ? member : null;
  }

  const sql = getPipelineSql();
  const rows = await sql<WorkspaceMemberRow[]>`
    select principal_id, display_name, email, roles, active, last_seen_at,
      coalesce(to_jsonb(workspace_members)->>'identity_status', 'entra_linked') as identity_status,
      to_jsonb(workspace_members)->>'source_system' as source_system,
      to_jsonb(workspace_members)->>'source_identity' as source_identity,
      to_jsonb(workspace_members)->>'merged_into_principal_id' as merged_into_principal_id
    from pipeline.workspace_members
    where principal_id = ${normalized} and active
    limit 1
  `;
  return rows[0] ? mapMember(rows[0]) : null;
}

export async function findActiveWorkspaceMemberByName(name: string) {
  const normalized = name.trim();
  if (!normalized) return null;
  const matches = (await listWorkspaceMembers()).filter(
    (member) => member.display_name.localeCompare(normalized, undefined, { sensitivity: "accent" }) === 0,
  );
  return matches.length === 1 ? matches[0] : null;
}

function memberFromUser(user: PipelineUser): WorkspaceMember {
  return {
    principal_id: user.id.trim(),
    display_name: user.name.trim() || user.email.trim(),
    email: user.email.trim(),
    roles: [...new Set(user.roles)],
    active: true,
    last_seen_at: new Date().toISOString(),
    identity_status: "entra_linked",
    source_system: null,
    source_identity: null,
    merged_into_principal_id: null,
  };
}

function mapMember(row: WorkspaceMemberRow): WorkspaceMember {
  return {
    principal_id: row.principal_id,
    display_name: row.display_name,
    email: row.email,
    roles: Array.isArray(row.roles) ? row.roles : [],
    active: Boolean(row.active),
    last_seen_at: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
    identity_status: row.identity_status,
    source_system: row.source_system,
    source_identity: row.source_identity,
    merged_into_principal_id: row.merged_into_principal_id,
  };
}

function compareMembers(left: WorkspaceMember, right: WorkspaceMember) {
  return left.display_name.localeCompare(right.display_name) || left.principal_id.localeCompare(right.principal_id);
}
