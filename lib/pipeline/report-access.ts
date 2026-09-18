import { canEditWorkspace } from "./referral-ownership";

export const operationsReportRoles = ["admin", "assessment_coordinator", "reviewer", "viewer"] as const;

type OperationsReportPrincipal = {
  id?: string | null;
  email?: string | null;
  roles: readonly string[];
};

export function canAccessSupervisorOperations(roles: readonly string[]) {
  return canEditWorkspace({ roles });
}

export function canAccessOperationsReports(principal: OperationsReportPrincipal | null | undefined) {
  return canEditWorkspace(principal);
}
