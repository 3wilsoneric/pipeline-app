import type { ClinicalClientResponse, ClinicalResident } from "@/lib/clinical/clinical-contracts";
import { actualAdmissionDateError, getPlannedAdmissionDate } from "./admission-lifecycle";
import { normalizeSourceCalendarDate } from "./calendar-date";
import { pipelineCommunityFromClinicalName } from "./community-config";
import { findGovernedIdentityConflict } from "./master-record-matching";
import { clientProfileBirthDates } from "./client-profile-presentation";
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
    const plannedDate = normalizeSourceCalendarDate(getPlannedAdmissionDate(referral));
    if (!plannedDate || plannedDate > (dataAsOf ?? "")) return [];
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
    if (!admissionNamesMatch(referral.name, resident.display_name)) return [];
    const dob = normalizeSourceCalendarDate(referral.dob);
    if (!dob || normalizeSourceCalendarDate(resident.date_of_birth) !== dob) return [];
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

/** Narrow census candidates before fetching governed client details; a name alone never joins identities. */
export function selectAdmissionIdentityCandidates(
  referrals: Referral[],
  links: PipelineResidentLink[],
  residents: ClinicalResident[],
  dataAsOf: string | null,
) {
  if (!dataAsOf) return [];
  const active = referrals.filter((referral) => !referral.deletedAt
    && referral.workspaceStatus !== "historical" && !referral.placementCancellation
    && referral.stage !== "Accepted / Admitted" && referral.stage !== "Declined"
    && !referral.actualAdmissionDate);
  const clientCounts = new Map<string, number>();
  const identityCounts = new Map<string, number>();
  for (const referral of active) {
    if (referral.clientId) clientCounts.set(referral.clientId, (clientCounts.get(referral.clientId) ?? 0) + 1);
    const identity = `${admissionNameKey(referral.name)}\0${normalizeSourceCalendarDate(referral.dob)}\0${referral.community}`;
    identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
  }
  const residentsByNameCommunity = new Map<string, ClinicalResident[]>();
  for (const resident of residents) {
    const key = `${admissionNameKey(resident.display_name)}\0${pipelineCommunityFromClinicalName(resident.community_name)}`;
    const group = residentsByNameCommunity.get(key) ?? [];
    group.push(resident);
    residentsByNameCommunity.set(key, group);
  }
  const linksByClient = new Map<string, PipelineResidentLink[]>();
  for (const link of links) {
    const group = linksByClient.get(link.pipeline_client_id) ?? [];
    group.push(link);
    linksByClient.set(link.pipeline_client_id, group);
  }
  return active.flatMap((referral) => {
    if (!referral.clientId || referral.admissionDecision?.outcome !== "accepted"
      || !Number.isInteger(referral.version) || !Number.isInteger(referral.sectionVersions?.workflow)
      || clientCounts.get(referral.clientId) !== 1) return [];
    const name = admissionNameKey(referral.name);
    const dob = normalizeSourceCalendarDate(referral.dob);
    const plannedDate = normalizeSourceCalendarDate(getPlannedAdmissionDate(referral));
    const decisionDate = normalizeSourceCalendarDate(referral.admissionDecision?.decidedAt);
    if (!name || !dob || !plannedDate || plannedDate > dataAsOf || !decisionDate) return [];
    if (identityCounts.get(`${name}\0${dob}\0${referral.community}`) !== 1) return [];
    const clientLinks = linksByClient.get(referral.clientId) ?? [];
    const matches = residentsByNameCommunity.get(`${name}\0${referral.community}`) ?? [];
    if (matches.length !== 1) return [];
    const resident = matches[0];
    if (!admissionNamesMatch(referral.name, resident.display_name)) return [];
    const actualDate = normalizeSourceCalendarDate(resident.admit_date);
    const residentDob = normalizeSourceCalendarDate(resident.date_of_birth);
    if ((resident.date_of_birth && residentDob !== dob)
      || (!resident.canonical_client_id && residentDob !== dob)
      || !resident.resident_number || !actualDate
      || actualDate < decisionDate || actualDate > dataAsOf || actualAdmissionDateError(actualDate)) return [];
    if (clientLinks.some((link) => (link.status === "confirmed" && link.resident_key !== resident.resident_key)
      || (link.status === "candidate" && link.resident_key !== resident.resident_key)
      || (link.status === "rejected" && link.resident_key === resident.resident_key))) return [];
    return [{ referral, resident }];
  });
}

function normalizedName(value: string) {
  return value.normalize("NFKD").toLowerCase().match(/[a-z0-9]+/g)?.join(" ") ?? "";
}

/** A single middle initial is optional; all other name parts must match. */
function admissionNameKey(value: string) {
  const parts = normalizedName(value).split(" ").filter(Boolean);
  return parts.length === 3 && parts[1].length === 1
    ? `${parts[0]} ${parts[2]}`
    : parts.join(" ");
}

function admissionNamesMatch(left: string, right: string) {
  const key = admissionNameKey(left);
  if (!key || key !== admissionNameKey(right)) return false;
  const leftParts = normalizedName(left).split(" ");
  const rightParts = normalizedName(right).split(" ");
  return leftParts.length !== 3 || rightParts.length !== 3
    || leftParts[1].length !== 1 || rightParts[1].length !== 1
    || leftParts[1] === rightParts[1];
}

export function verifiedAdmissionBirthDate(
  referral: Referral,
  resident: ClinicalResident,
  detail: ClinicalClientResponse,
  snapshotId: string | null,
  dataAsOf: string | null,
) {
  const client = detail.client;
  const dates = clientProfileBirthDates(client);
  const dob = normalizeSourceCalendarDate(referral.dob);
  if (!snapshotId || !dataAsOf || detail.snapshot_id !== snapshotId || detail.data_as_of !== dataAsOf
    || detail.freshness.status !== "fresh" || !client.current_resident
    || client.canonical_client_id !== resident.canonical_client_id
    || !resident.resident_number || !client.resident_numbers.includes(resident.resident_number)
    || normalizedName(client.display_name) !== normalizedName(resident.display_name)
    || pipelineCommunityFromClinicalName(client.current_community ?? "") !== referral.community
    || normalizeSourceCalendarDate(client.admit_date) !== normalizeSourceCalendarDate(resident.admit_date)
    || dates.length !== 1 || !dob || dates[0] !== dob
    || (resident.date_of_birth && normalizeSourceCalendarDate(resident.date_of_birth) !== dob)) return null;
  return dob;
}
