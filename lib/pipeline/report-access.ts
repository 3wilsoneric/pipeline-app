import { canEditWorkspace } from "./referral-ownership";

export const operationsReportRoles = ["admin", "assessment_coordinator"] as const;

const operationsReportEmails = new Set([
  "andrew@aaahealthservices.com",
  "ericwilsonalamo@outlook.com",
  "sandeep@aaahealthservices.com",
]);

// Tenant object IDs remain stable when Microsoft presents a guest UPN or email alias.
const operationsReportPrincipalIds = new Set([
  "e9f39185-d751-45c0-bcf5-c24d3565bdd9", // Andrew
  "f73371d5-d2b4-48b4-a32b-1edc7c88869f", // Eric
  "b72c34f0-0ee8-4ab4-8359-81c8f7b0d3b2", // Sandeep
]);

type OperationsReportPrincipal = {
  id?: string | null;
  email?: string | null;
  roles: readonly string[];
  accessScope?: string;
  demoPersona?: string;
};

export function canAccessSupervisorOperations(roles: readonly string[]) {
  return canEditWorkspace({ roles });
}

export function canAccessOperationsReports(principal: OperationsReportPrincipal | null | undefined) {
  if (!principal || !canEditWorkspace(principal)
    || !operationsReportRoles.some((role) => principal.roles.includes(role))) return false;
  if (operationsReportPrincipalIds.has(principal.id?.trim().toLowerCase() ?? "")) return true;
  const email = principal.email?.trim().toLowerCase();
  if (!email) return false;
  // Retain the reserved local/demo identity contract; real accounts require the named allowlist.
  return operationsReportEmails.has(email) || Boolean(principal.id && email.endsWith("@pipeline.local"));
}

export function canManageCommunityContactLists(principal: OperationsReportPrincipal | null | undefined) {
  return canAccessOperationsReports(principal) || Boolean(principal?.demoPersona === "supervisor"
    && operationsReportRoles.some((role) => principal.roles.includes(role)));
}
