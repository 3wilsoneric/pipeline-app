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
};

export function canAccessSupervisorOperations(roles: readonly string[]) {
  return operationsReportRoles.some((role) => roles.includes(role));
}

export function canAccessOperationsReports(principal: OperationsReportPrincipal | null | undefined) {
  if (!principal || !canAccessSupervisorOperations(principal.roles)) return false;
  const email = principal.email?.trim().toLowerCase();
  if (!email) return false;
  return operationsReportEmails.has(email) || isSyntheticLocalPrincipal(principal, email);
}

function isSyntheticLocalPrincipal(principal: OperationsReportPrincipal, email: string) {
  // Local and automated fixtures use a reserved, non-production identity domain.
  return Boolean(principal.id && email.endsWith("@pipeline.local"));
}
