type ActivityPrincipal = {
  id?: string;
  email: string;
  roles: readonly string[];
  delegation?: unknown;
  demoPersona?: string;
};

// This is Eric's private dashboard, not a capability granted to every admin.
// The stable Entra ID also covers Microsoft's guest UPN/email aliases.
export function canAccessApplicationActivity(user: ActivityPrincipal | null | undefined) {
  return Boolean(user && !user.delegation && !user.demoPersona && user.roles.includes("admin") && (
    user.id?.toLowerCase() === "f73371d5-d2b4-48b4-a32b-1edc7c88869f"
    || user.email.trim().toLowerCase() === "ericwilsonalamo@outlook.com"
  ));
}
