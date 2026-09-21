import { canEditWorkspace } from "./referral-ownership";

export const operationsReportRoles = ["admin", "assessment_coordinator"] as const;

const operationsReportEmails = new Set([
  "andrew@aaahealthservices.com",
  "ericwilsonalamo@outlook.com",
  "sandeep@aaahealthservices.com",
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
  const email = principal.email?.trim().toLowerCase();
  if (!email) return false;
  // Retain the reserved local/demo identity contract; real accounts require the named allowlist.
  return operationsReportEmails.has(email) || Boolean(principal.id && email.endsWith("@pipeline.local"));
}

export function canManageCommunityContactLists(principal: OperationsReportPrincipal | null | undefined) {
  return canAccessOperationsReports(principal) || Boolean(principal?.demoPersona === "supervisor"
    && operationsReportRoles.some((role) => principal.roles.includes(role)));
}
