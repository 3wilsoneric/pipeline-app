export const operationsReportRoles = ["admin", "assessment_coordinator"] as const;

export function canAccessOperationsReports(roles: readonly string[]) {
  return operationsReportRoles.some((role) => roles.includes(role));
}
