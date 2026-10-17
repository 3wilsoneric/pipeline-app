import type { ClinicalResident } from "@/lib/clinical/clinical-contracts";
import { actualAdmissionDateError } from "./admission-lifecycle";
import { normalizeSourceCalendarDate } from "./calendar-date";
import { pipelineCommunityFromClinicalName } from "./community-config";
import { findGovernedIdentityConflict } from "./master-record-matching";
import type { Referral } from "./referral-types";
import type { PipelineResidentLink } from "./resident-link-records";

export function selectAutomaticAdmissions(
  referrals: Referral[],
  links: PipelineResidentLink[],
  residents: ClinicalResident[],
  dataAsOf: string | null,
) {
  const activeByClient = new Map<string, Referral[]>();
  for (const referral of referrals) {
    if (!referral.clientId || referral.deletedAt || referral.workspaceStatus === "historical"
      || referral.placementCancellation || referral.stage === "Accepted / Admitted" || referral.stage === "Declined"
      || referral.actualAdmissionDate) continue;
    activeByClient.set(referral.clientId, [...(activeByClient.get(referral.clientId) ?? []), referral]);
  }

  return [...activeByClient.entries()].flatMap(([clientId, active]) => {
    if (active.length !== 1) return [];
    const referral = active[0];
    if (referral.admissionDecision?.outcome !== "accepted") return [];
    if (!Number.isInteger(referral.version) || !Number.isInteger(referral.sectionVersions?.workflow)) return [];
    const clientLinks = links.filter((link) => link.pipeline_client_id === clientId);
    const confirmed = clientLinks.filter((link) => link.status === "confirmed");
    if (confirmed.length !== 1) return [];
    const link = confirmed[0];
    if (clientLinks.some((candidate) => candidate.status === "candidate" && candidate.resident_key !== link.resident_key)) return [];
    const matches = residents.filter((resident) => resident.resident_key === link.resident_key);
    if (matches.length !== 1) return [];
    const resident = matches[0];
    if (pipelineCommunityFromClinicalName(resident.community_name) !== referral.community) return [];
    if (findGovernedIdentityConflict({
      community_id: link.community_id,
      resident_number: link.resident_number,
      date_of_birth: referral.dob,
    }, resident)) return [];

    const actualDate = normalizeSourceCalendarDate(resident.admit_date);
    const decisionDate = normalizeSourceCalendarDate(referral.admissionDecision?.decidedAt);
    if (!actualDate || !decisionDate || actualDate < decisionDate || actualDate > (dataAsOf ?? "")
      || actualAdmissionDateError(actualDate)) return [];
    return [{ referral, actualDate }];
  });
}
