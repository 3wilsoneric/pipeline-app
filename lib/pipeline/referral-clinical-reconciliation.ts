import "server-only";

import { getClinicalRoster, type ClinicalResident } from "@/lib/clinical/clinical-data";
import { pipelineCommunityFromClinicalName } from "@/lib/pipeline/community-config";
import type { Referral } from "@/lib/pipeline/referral-types";

export type ReferralClinicalReconciliation =
  | {
      status: "matched";
      resident: ClinicalResident;
      community: NonNullable<ReturnType<typeof pipelineCommunityFromClinicalName>>;
      confidence: number;
      method: "exact_name_dob" | "compatible_name_dob";
      dataAsOf: string;
    }
  | {
      status: "no_match" | "stale_source";
      dataAsOf: string | null;
    };

export type ReferralClinicalResidentMatch = {
  resident: ClinicalResident;
  confidence: number;
  method: "exact_name_dob" | "compatible_name_dob";
};

export async function reconcileReferralToClinicalRoster(
  request: Request,
  referral: Pick<Referral, "name" | "dob">,
): Promise<ReferralClinicalReconciliation> {
  const nameTokens = normalizedNameTokens(referral.name);
  const dateOfBirth = normalizedDate(referral.dob);
  if (nameTokens.length < 2 || !dateOfBirth) return { status: "no_match", dataAsOf: null };

  const roster = await getClinicalRoster(request, {
    query: nameTokens.at(-1),
    limit: 100,
  });
  if (roster.freshness.status !== "fresh") {
    return { status: "stale_source", dataAsOf: roster.data_as_of };
  }

  const candidate = findClinicalResidentMatch(referral, roster.residents);
  if (!candidate) {
    return { status: "no_match", dataAsOf: roster.data_as_of };
  }

  const community = pipelineCommunityFromClinicalName(candidate.resident.community_name);
  if (!community) return { status: "no_match", dataAsOf: roster.data_as_of };

  return {
    status: "matched",
    resident: candidate.resident,
    community,
    confidence: candidate.confidence,
    method: candidate.method,
    dataAsOf: roster.data_as_of,
  };
}

export function findClinicalResidentMatch(
  referral: Pick<Referral, "name" | "dob">,
  residents: ClinicalResident[],
): ReferralClinicalResidentMatch | null {
  const nameTokens = normalizedNameTokens(referral.name);
  const dateOfBirth = normalizedDate(referral.dob);
  if (nameTokens.length < 2 || !dateOfBirth) return null;

  const candidates = residents
    .filter((resident) => normalizedDate(resident.date_of_birth) === dateOfBirth)
    .map((resident) => ({ resident, match: compareNames(nameTokens, normalizedNameTokens(resident.display_name)) }))
    .filter((candidate) => candidate.match.compatible);
  if (candidates.length !== 1) return null;

  const candidate = candidates[0];
  return {
    resident: candidate.resident,
    confidence: candidate.match.exact ? 1 : 0.95,
    method: candidate.match.exact ? "exact_name_dob" : "compatible_name_dob",
  };
}

function compareNames(left: string[], right: string[]) {
  if (left.length < 2 || right.length < 2) return { compatible: false, exact: false };
  const exact = left.join(" ") === right.join(" ");
  if (exact) return { compatible: true, exact: true };

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const shared = [...leftSet].filter((token) => rightSet.has(token)).length;
  const shorter = Math.min(leftSet.size, rightSet.size);
  const endpointsAgree = left[0] === right[0] && left.at(-1) === right.at(-1);
  return {
    compatible: endpointsAgree && shared === shorter,
    exact: false,
  };
}

function normalizedNameTokens(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
}

function normalizedDate(value: string | null | undefined) {
  const normalized = value?.trim().slice(0, 10) ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : "";
}
