import type { PipelineDelegation, PipelineRole, PipelineUser } from "@/lib/auth/pipeline-auth";
import type { WorkspaceMember } from "@/lib/pipeline/workspace-members";

const godModeRoles: PipelineRole[] = ["admin", "assessment_coordinator", "reviewer", "viewer"];

export function isEligibleGodModeTarget(member: WorkspaceMember, administratorId: string) {
  return member.active
    && member.principal_id !== administratorId
    && member.identity_status !== "merged"
    && !member.merged_into_principal_id;
}

export function delegatedUserFromSession(
  authenticatedUser: PipelineUser,
  delegation: PipelineDelegation,
): PipelineUser | null {
  if (!authenticatedUser.roles.includes("admin")) return null;
  if (delegation.initiatedBy.id !== authenticatedUser.id) return null;
  if (delegation.target.id === authenticatedUser.id) return null;
  if (delegation.target.identityStatus === "merged") return null;

  return {
    id: delegation.target.id,
    email: delegation.target.email,
    name: delegation.target.name,
    roles: godModeRoles,
    accessScope: "pipeline",
    delegation,
  };
}

export function pipelineAuditActor(user: PipelineUser) {
  return {
    id: user.id,
    name: user.delegation
      ? `${user.name} (God mode by ${user.delegation.initiatedBy.name})`
      : user.name,
    email: user.delegation?.initiatedBy.email ?? user.email,
  };
}

export function pipelineAccountableActor(user: PipelineUser) {
  return user.delegation ? user.delegation.initiatedBy : { id: user.id, name: user.name, email: user.email };
}
