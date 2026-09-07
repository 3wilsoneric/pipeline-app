export type WorkspaceMemberEligibility = {
  principal_id: string;
  active: boolean;
  roles: readonly string[];
  identity_status: "entra_linked" | "provisional" | "merged";
  merged_into_principal_id: string | null;
};

const nonAssessingPrincipalIds = new Set([
  "e9f39185-d751-45c0-bcf5-c24d3565bdd9",
  "provisional:allo:andrew-dominici",
]);

export function isAssignableAssessorMember(member: WorkspaceMemberEligibility) {
  return member.active
    && member.identity_status !== "merged"
    && !member.merged_into_principal_id
    && member.roles.includes("reviewer")
    && !member.roles.includes("admin")
    && !nonAssessingPrincipalIds.has(member.principal_id);
}
