import "server-only";

import { getClinicalAuthMode, getClinicalDataMode, getClinicalDataReadiness } from "@/lib/clinical/clinical-data";
import { assumedAdmissionDate } from "./admission-lifecycle";
import { explainAssumedAdmissionBlockers } from "./admission-confirmation-explain";
import { admissionConfirmationBlocker, type AdmissionConfirmationBlocker } from "./admission-confirmation";
import {
  applyVerifiedBirthDate, identityBirthDateAlreadyVerified, loadClinicalRoster, loadReferrals, loadResidentLinks,
  verifyIdentityCandidateBirthDate,
} from "./clinical-backlog-reconciliation";
import { selectAdmissionIdentityCandidates } from "./clinical-admission-selection";
import type { ClinicalResident } from "@/lib/clinical/clinical-contracts";
import type { Referral } from "./referral-types";

type Blockers = Map<number, AdmissionConfirmationBlocker>;
const memoMs = 60_000;
let memo: { expiresAt: number; promise: Promise<Blockers> } | null = null;
// Governed DOB lookups share the same 60s window; failures are not cached.
const birthDateLookups = new Map<string, { expiresAt: number; promise: Promise<string | null> }>();

/**
 * Read-time explanation of why each assumed (due, unconfirmed) referral has not
 * been confirmed by the daily census reconciliation. Uses the same inputs the
 * reconciliation reads (active referrals, resident links, governed roster) and
 * the same selection checks. Persists nothing; never throws.
 *
 * Pass `referrals` when the caller already holds every workspace (the summary);
 * otherwise the reconciliation's own referral loader is used, memoized briefly
 * so paged readers (Ally) do not reload the population per page.
 */
export async function loadAdmissionConfirmationBlockers(now: Date, referrals?: Referral[]): Promise<Blockers> {
  if (referrals) return computeBlockers(referrals, now);
  if (!memo || memo.expiresAt <= Date.now()) {
    const promise = loadReferrals().then((rows) => computeBlockers(rows, now), () => new Map() as Blockers);
    memo = { expiresAt: Date.now() + memoMs, promise };
  }
  return memo.promise;
}

async function computeBlockers(referrals: Referral[], now: Date): Promise<Blockers> {
  const assumedIds = referrals.filter((referral) => assumedAdmissionDate(referral, now)).map((referral) => referral.id);
  if (!assumedIds.length) return new Map();
  const unavailable = () => new Map(assumedIds.map((id) => [id, admissionConfirmationBlocker("census_unavailable")]));
  const readiness = getClinicalDataReadiness();
  if (!readiness.ready || (getClinicalDataMode() !== "demo_snapshot" && getClinicalAuthMode() !== "client_credentials")) return unavailable();
  try {
    const [links, roster] = await Promise.all([loadResidentLinks(), loadClinicalRoster(undefined)]);
    // The reconciliation lists active workspaces only (listReferrals default).
    const reconciled = referrals.filter((referral) => (referral.workspaceStatus ?? "active") === "active");
    if (!roster.fresh) return explainAssumedAdmissionBlockers(assumedIds, reconciled, links, roster.residents, roster.dataAsOf, false);
    // Same governed DOB verification the job applies before selecting admissions.
    const verified = [...roster.residents];
    const lookupFailed = new Set<number>();
    for (const { referral, resident } of selectAdmissionIdentityCandidates(reconciled, links, roster.residents, roster.dataAsOf)) {
      if (identityBirthDateAlreadyVerified(referral, resident, links)) continue;
      try {
        const dob = await cachedBirthDate(referral, resident, roster.snapshotId, roster.dataAsOf);
        if (dob) applyVerifiedBirthDate(verified, resident, dob);
      } catch {
        lookupFailed.add(referral.id);
      }
    }
    return explainAssumedAdmissionBlockers(assumedIds, reconciled, links, verified, roster.dataAsOf, true, lookupFailed);
  } catch {
    return unavailable();
  }
}

function cachedBirthDate(referral: Referral, resident: ClinicalResident, snapshotId: string | null, dataAsOf: string | null) {
  const now = Date.now();
  for (const [key, entry] of birthDateLookups) if (entry.expiresAt <= now) birthDateLookups.delete(key);
  const key = JSON.stringify([snapshotId, dataAsOf, referral.id, referral.dob, referral.name, referral.community, resident.resident_key]);
  const cached = birthDateLookups.get(key);
  if (cached) return cached.promise;
  const promise = verifyIdentityCandidateBirthDate(undefined, referral, resident, snapshotId, dataAsOf);
  birthDateLookups.set(key, { expiresAt: now + memoMs, promise });
  promise.catch(() => birthDateLookups.delete(key));
  return promise;
}
