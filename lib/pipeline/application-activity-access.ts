import { canAccessExecutiveAdmissionFlow } from "./report-access";

type ActivityPrincipal = {
  id?: string;
  email: string;
  roles: readonly string[];
  delegation?: unknown;
  demoPersona?: string;
};

// Session validity and administrator authority are checked by requirePipelineUser.
// This exception only mirrors Andrew's shared reports while Eric previews him.
export function isAndrewSupervisorPreview(user: { id?: string; delegation?: unknown } | null | undefined) {
  const delegation = user?.delegation;
  if (!delegation || typeof delegation !== "object"
    || !("initiatedBy" in delegation) || !("target" in delegation)) return false;
  const { initiatedBy, target } = delegation;
  return Boolean(initiatedBy && typeof initiatedBy === "object" && "id" in initiatedBy
    && initiatedBy.id === "f73371d5-d2b4-48b4-a32b-1edc7c88869f"
    && target && typeof target === "object" && "id" in target
    && target.id === "e9f39185-d751-45c0-bcf5-c24d3565bdd9"
    && user?.id === target.id);
}

// This is Eric's private dashboard, not a capability granted to every admin.
// The stable Entra ID also covers Microsoft's guest UPN/email aliases.
export function canAccessApplicationActivity(user: ActivityPrincipal | null | undefined) {
  return Boolean(user && !user.delegation && !user.demoPersona && user.roles.includes("admin") && (
    user.id?.toLowerCase() === "f73371d5-d2b4-48b4-a32b-1edc7c88869f"
    || user.email.trim().toLowerCase() === "ericwilsonalamo@outlook.com"
  ));
}

// The Home status names/dots are shared with Andrew; detailed activity and
// infrastructure monitoring retain their separate owner-only access.
export function canAccessAssessorStatus(user: ActivityPrincipal | null | undefined) {
  return Boolean(user && (!user.delegation || isAndrewSupervisorPreview(user))
    && !user.demoPersona && canAccessExecutiveAdmissionFlow(user));
}

// The executive scorecard has the same named audience as the Home assessor status.
export const canAccessAssessorScorecard = canAccessAssessorStatus;
