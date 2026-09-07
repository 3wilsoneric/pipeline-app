import "server-only";

import provisionalMemberManifest from "@/config/provisional-workspace-members.json";
import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { getPipelineSql } from "@/lib/database/pipeline-database";
import { getReferralStoreReadiness } from "@/lib/pipeline/referral-store";
import {
  emptyStaffProfile,
  type StaffProfile,
  type StaffProfilePreferences,
} from "@/lib/pipeline/staff-profile";
import { isAssignableAssessorMember } from "@/lib/pipeline/workspace-member-eligibility";

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
  profile: StaffProfile;
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
  preferred_name: string | null;
  job_title: string | null;
  team: string | null;
  work_phone: string | null;
  time_zone: string | null;
  status_message: string | null;
  profile_version: number | string;
  profile_updated_at: Date | string | null;
};

const localMembers = new Map<string, WorkspaceMember>();

export async function touchWorkspaceMember(user: PipelineUser) {
  if (user.delegation) return getActiveWorkspaceMember(user.id);
  const member = memberFromUser(user);
  if (getReferralStoreReadiness().mode !== "postgres") {
    ensureLocalProvisionalMembers();
    const existing = localMembers.get(member.principal_id);
    const current = existing ? { ...member, profile: existing.profile } : member;
    localMembers.set(member.principal_id, current);
    return current;
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
      to_jsonb(workspace_members)->>'merged_into_principal_id' as merged_into_principal_id,
      preferred_name, job_title, team, work_phone, time_zone, status_message,
      profile_version, profile_updated_at
  `;
  return mapMember(rows[0]);
}

export async function listWorkspaceMembers(currentUser?: PipelineUser) {
  if (currentUser) await touchWorkspaceMember(currentUser);
  if (getReferralStoreReadiness().mode !== "postgres") {
    ensureLocalProvisionalMembers();
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
      to_jsonb(workspace_members)->>'merged_into_principal_id' as merged_into_principal_id,
      preferred_name, job_title, team, work_phone, time_zone, status_message,
      profile_version, profile_updated_at
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
    ensureLocalProvisionalMembers();
    const member = localMembers.get(normalized);
    return member?.active ? member : null;
  }

  const sql = getPipelineSql();
  const rows = await sql<WorkspaceMemberRow[]>`
    select principal_id, display_name, email, roles, active, last_seen_at,
      coalesce(to_jsonb(workspace_members)->>'identity_status', 'entra_linked') as identity_status,
      to_jsonb(workspace_members)->>'source_system' as source_system,
      to_jsonb(workspace_members)->>'source_identity' as source_identity,
      to_jsonb(workspace_members)->>'merged_into_principal_id' as merged_into_principal_id,
      preferred_name, job_title, team, work_phone, time_zone, status_message,
      profile_version, profile_updated_at
    from pipeline.workspace_members
    where principal_id = ${normalized} and active
    limit 1
  `;
  return rows[0] ? mapMember(rows[0]) : null;
}

export async function getAssignableWorkspaceAssessor(principalId: string) {
  const member = await getActiveWorkspaceMember(principalId);
  return member && isAssignableAssessorMember(member) ? member : null;
}

export async function listAssignableWorkspaceAssessors(currentUser?: PipelineUser) {
  return (await listWorkspaceMembers(currentUser)).filter(isAssignableAssessorMember);
}

export async function findActiveWorkspaceMemberByName(name: string) {
  const normalized = name.trim();
  if (!normalized) return null;
  const matches = (await listWorkspaceMembers()).filter(
    (member) => member.display_name.localeCompare(normalized, undefined, { sensitivity: "accent" }) === 0,
  );
  return matches.length === 1 ? matches[0] : null;
}

export async function findAssignableWorkspaceAssessorByName(name: string) {
  const member = await findActiveWorkspaceMemberByName(name);
  return member && isAssignableAssessorMember(member) ? member : null;
}

export async function updateOwnWorkspaceMemberProfile(input: {
  user: PipelineUser;
  expectedVersion: number;
  profile: StaffProfilePreferences;
}) {
  if (input.user.delegation) return { ok: false as const, reason: "delegated_session" as const };
  await touchWorkspaceMember(input.user);
  if (getReferralStoreReadiness().mode !== "postgres") {
    ensureLocalProvisionalMembers();
    const current = localMembers.get(input.user.id);
    if (!current) return { ok: false as const, reason: "not_found" as const };
    if (current.profile.version !== input.expectedVersion) {
      return { ok: false as const, reason: "version_conflict" as const, current };
    }
    const changedFields = changedProfileFields(current.profile, input.profile);
    if (changedFields.length === 0) return { ok: true as const, member: current, changedFields };
    const next: WorkspaceMember = {
      ...current,
      profile: {
        ...input.profile,
        version: current.profile.version + 1,
        updated_at: new Date().toISOString(),
      },
    };
    localMembers.set(input.user.id, next);
    return { ok: true as const, member: next, changedFields };
  }

  const sql = getPipelineSql();
  return sql.begin(async (transaction) => {
    const currentRows = await transaction<WorkspaceMemberRow[]>`
      select principal_id, display_name, email, roles, active, last_seen_at,
        identity_status, source_system, source_identity, merged_into_principal_id,
        preferred_name, job_title, team, work_phone, time_zone, status_message,
        profile_version, profile_updated_at
      from pipeline.workspace_members
      where principal_id = ${input.user.id} and active and identity_status = 'entra_linked'
      for update
    `;
    if (!currentRows[0]) return { ok: false as const, reason: "not_found" as const };
    const current = mapMember(currentRows[0]);
    if (current.profile.version !== input.expectedVersion) {
      return { ok: false as const, reason: "version_conflict" as const, current };
    }
    const changedFields = changedProfileFields(current.profile, input.profile);
    if (changedFields.length === 0) return { ok: true as const, member: current, changedFields };

    const rows = await transaction<WorkspaceMemberRow[]>`
      update pipeline.workspace_members set
        preferred_name = ${input.profile.preferred_name},
        job_title = ${input.profile.job_title},
        team = ${input.profile.team},
        work_phone = ${input.profile.work_phone},
        time_zone = ${input.profile.time_zone},
        status_message = ${input.profile.status_message},
        profile_version = profile_version + 1,
        profile_updated_at = now(),
        updated_at = now()
      where principal_id = ${input.user.id}
      returning principal_id, display_name, email, roles, active, last_seen_at,
        identity_status, source_system, source_identity, merged_into_principal_id,
        preferred_name, job_title, team, work_phone, time_zone, status_message,
        profile_version, profile_updated_at
    `;
    const member = mapMember(rows[0]);
    await transaction`
      insert into pipeline.audit_events (
        entity_type, entity_id, action, actor_id, actor_name,
        from_version, to_version, changed_fields, before_values, after_values, metadata
      ) values (
        'workspace_member_profile', ${input.user.id}, 'profile_updated',
        ${input.user.id}, ${input.user.name}, ${current.profile.version}, ${member.profile.version},
        ${changedFields}, ${transaction.json(profilePreferences(current.profile))},
        ${transaction.json(profilePreferences(member.profile))},
        ${transaction.json({ source: "self_service" })}
      )
    `;
    return { ok: true as const, member, changedFields };
  });
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
    profile: { ...emptyStaffProfile },
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
    profile: {
      preferred_name: row.preferred_name,
      job_title: row.job_title,
      team: row.team,
      work_phone: row.work_phone,
      time_zone: row.time_zone,
      status_message: row.status_message,
      version: Number.isSafeInteger(Number(row.profile_version)) ? Number(row.profile_version) : 1,
      updated_at: row.profile_updated_at ? new Date(row.profile_updated_at).toISOString() : null,
    },
  };
}

function compareMembers(left: WorkspaceMember, right: WorkspaceMember) {
  return left.display_name.localeCompare(right.display_name) || left.principal_id.localeCompare(right.principal_id);
}

function ensureLocalProvisionalMembers() {
  for (const member of provisionalMemberManifest.members) {
    if (localMembers.has(member.principal_id)) continue;
    localMembers.set(member.principal_id, {
      principal_id: member.principal_id,
      display_name: member.display_name,
      email: null,
      roles: member.roles,
      active: true,
      last_seen_at: null,
      identity_status: "provisional",
      source_system: provisionalMemberManifest.source_system,
      source_identity: member.source_identity,
      merged_into_principal_id: null,
      profile: { ...emptyStaffProfile },
    });
  }
}

function changedProfileFields(current: StaffProfile, next: StaffProfilePreferences) {
  return (Object.keys(next) as Array<keyof StaffProfilePreferences>)
    .filter((key) => current[key] !== next[key]);
}

function profilePreferences(profile: StaffProfile): StaffProfilePreferences {
  return {
    preferred_name: profile.preferred_name,
    job_title: profile.job_title,
    team: profile.team,
    work_phone: profile.work_phone,
    time_zone: profile.time_zone,
    status_message: profile.status_message,
  };
}
