import type { Referral } from "./referral-types";
import { admissionFlowToday } from "./admission-flow-day";
import { normalizeCalendarDate } from "./calendar-date";

// Reporting cutoff inferred from the first nonhistorical Pipeline workspace.
// Audited November 5, 2026: 93 native workspaces from September 18 onward;
// the earlier native charts and later legacy imports are historical records.
export const admissionFlowStartDate = "2026-09-18";

export function admissionFlowCohort(referrals: Referral[], receivedMonth: string) {
  return referrals.filter((referral) => {
    if (referral.workspaceOrigin !== "pipeline" || referral.workspaceStatus === "historical" || referral.deletedAt) return false;
    const created = new Date(referral.createdAt);
    if (!Number.isFinite(created.getTime()) || admissionFlowToday(created) < admissionFlowStartDate) return false;
    return !receivedMonth || Boolean(normalizeCalendarDate(referral.date)?.startsWith(receivedMonth));
  });
}
