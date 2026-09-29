import { actualAdmissionDateError } from "./admission-lifecycle";
import { normalizeCalendarDate } from "./calendar-date";
import { pipelineCommunities, pipelineCommunityFromClinicalName } from "./community-config";
import type { ClinicalResident } from "@/lib/clinical/clinical-contracts";
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

export type HistoricalAdmissionSuggestion = { name: string; admissionDate: string; community: Referral["community"] };

/** Name-only evidence is displayed for human review; it NEVER joins identities. */
export function historicalAdmissionSuggestion(referral: Referral, residents: ClinicalResident[]): HistoricalAdmissionSuggestion | null {
  const normalize = (value: string) => value.normalize("NFKD").toLowerCase().match(/[a-z0-9]+/g)?.join(" ") ?? "";
  const name = normalize(referral.name);
  if (name.split(" ").length < 2) return null;
  const candidates = residents.filter((resident) => normalize(resident.display_name) === name);
  if (candidates.length !== 1) return null;
  const resident = candidates[0];
  // Missing DOB is not a verified match; conflicting DOB is not even a suggestion.
  const dob = normalizeCalendarDate(referral.dob ?? "");
  if (dob && resident.date_of_birth && dob !== resident.date_of_birth) return null;
  const input = historicalAdmissionInput({ admissionDate: resident.admit_date, community: pipelineCommunityFromClinicalName(resident.community_name) });
  return input ? { name: resident.display_name, ...input } : null;
}
