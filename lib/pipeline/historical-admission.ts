import { actualAdmissionDateError } from "./admission-lifecycle";
import { normalizeCalendarDate, normalizeSourceCalendarDate as sourceDate } from "./calendar-date";
import { pipelineCommunities, pipelineCommunityFromClinicalName } from "./community-config";
import type { ClinicalClientDetail, ClinicalClientDirectoryItem } from "@/lib/clinical/clinical-contracts";
import { clientProfileBirthDates, clientProfileSourceValues } from "./client-profile-presentation";
import type { Referral, ReferralPatch } from "./referral-types";

export const historicalAdmissionSource = "Prior admission confirmed in Pipeline";

/** A historical outcome, never a new referral or an assertion of current residency. */
export function canRecordHistoricalAdmission(referral: Referral) {
  return referral.workspaceStatus === "historical"
    && ["allo", "import"].includes(referral.workspaceOrigin ?? "")
    && !referral.deletedAt;
}

export function historicalAdmissionInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (actualAdmissionDateError(input.admissionDate)
    || !pipelineCommunities.some((community) => community !== "Unassigned" && community === input.community)) return null;
  return { admissionDate: normalizeCalendarDate(input.admissionDate as string)!, community: input.community as Referral["community"] };
}

export function isHistoricalAdmissionPatch(referral: Referral, patch: ReferralPatch) {
  return canRecordHistoricalAdmission(referral)
    && Object.keys(patch).length === 2
    && Object.keys(patch).every((key) => key === "admissionDate" || key === "community")
    && historicalAdmissionInput(patch) !== null;
}

export type HistoricalAdmissionSuggestion = {
  name: string;
  dob: string | null;
  identityMatched: boolean;
  admissions: { admissionDate: string; community: Referral["community"] }[];
  /** Retained for an already-open pre-deployment browser; staff still confirm explicitly. */
  admissionDate: string;
  community: Referral["community"];
};

const normalizedName = (value: string) => value.normalize("NFKD").toLowerCase().match(/[a-z0-9]+/g)?.join(" ") ?? "";

export function historicalAdmissionClient(referral: Referral, clients: ClinicalClientDirectoryItem[]) {
  const name = normalizedName(referral.name);
  if (name.split(" ").length < 2) return null;
  const candidates = clients.filter((client) => normalizedName(client.display_name) === name);
  return candidates.length === 1 ? candidates[0] : null;
}

/** Supporting evidence only: neither name/DOB matching nor selecting a stay joins identities. */
export function historicalAdmissionSuggestion(referral: Referral, client: ClinicalClientDetail): HistoricalAdmissionSuggestion | null {
  if (!historicalAdmissionClient(referral, [client])) return null;
  const records = [client.enrichment, ...client.resident_profiles, ...(client.resident_profile ? [client.resident_profile] : [])];
  const dobs = clientProfileBirthDates(client);
  if (dobs.length > 1 || (dobs.length && !dobs[0])) return null;
  const dob = dobs[0] ?? null;
  const recordedDob = sourceDate(referral.dob);
  if ((referral.dob?.trim() && !recordedDob) || (recordedDob && dob && recordedDob !== dob)) return null;
  const stays = [...client.resident_episode_history, ...records];
  const admissions = stays.map((stay) => historicalAdmissionInput({
    admissionDate: sourceDate(clientProfileSourceValues(stay, ["admit_date", "admission_date", "episode_start_date", "latest_structured_admit_date", "latest_admit_date"])[0]),
    community: pipelineCommunityFromClinicalName(clientProfileSourceValues(stay, ["facility_name", "community_name", "facility_canonical", "community"])[0] ?? ""),
  }));
  // Directory admission and a single recorded community are supporting evidence, not current census.
  admissions.push(historicalAdmissionInput({ admissionDate: client.admit_date,
    community: pipelineCommunityFromClinicalName(client.current_community ?? (client.community_names.length === 1 ? client.community_names[0] : "")),
  }));
  const unique = new Map(admissions.filter((stay) => stay !== null).map((stay) => [`${stay.admissionDate}:${stay.community}`, stay]));
  const ordered = [...unique.values()].sort((a, b) => b.admissionDate.localeCompare(a.admissionDate));
  return { name: client.display_name, dob, identityMatched: Boolean(dob && recordedDob === dob), admissions: ordered,
    admissionDate: ordered[0]?.admissionDate ?? "", community: ordered[0]?.community ?? "Unassigned" };
}
