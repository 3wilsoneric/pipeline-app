import "server-only";

import { getCachedClinicalClientDirectoryIndex, getClinicalClientDirectoryIndex } from "@/lib/clinical/clinical-client-directory-index";
import { getConfirmedReferralClinicalIdentities } from "./client-workspace-store";
import type { Referral } from "./referral-types";

export async function applyReviewedClinicalIdentity(
  request: Request,
  accessKey: string,
  referrals: Referral[],
) {
  if (referrals.length === 0) return referrals;
  try {
    const links = await getConfirmedReferralClinicalIdentities(referrals);
    if (links.size === 0) return referrals;
    const clinicalClients = getCachedClinicalClientDirectoryIndex(accessKey);
    if (!clinicalClients) {
      // Recorded referral identity is usable immediately. Refresh the governed
      // directory once in the background instead of blocking on every page.
      void getClinicalClientDirectoryIndex(request, accessKey).catch(() => undefined);
      return referrals;
    }
    return referrals.map((referral) => {
      const identity = links.get(referral.id);
      const client = identity
        ? clinicalClients.byCanonicalClientId.get(identity.residentKey)
          ?? (identity.residentNumber ? clinicalClients.byResidentNumber.get(identity.residentNumber) : undefined)
        : undefined;
      if (!client) return referral;
      return {
        ...referral,
        name: client.display_name || referral.name,
        gender: client.gender || referral.gender,
        community: client.current_community || client.community_names[0] || referral.community,
        admissionDate: client.admit_date || referral.admissionDate,
      };
    });
  } catch {
    return referrals;
  }
}
