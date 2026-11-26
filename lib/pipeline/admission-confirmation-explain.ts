import type { ClinicalResident } from "@/lib/clinical/clinical-contracts";
import { admissionConfirmationBlocker, type AdmissionConfirmationBlocker } from "./admission-confirmation";
import { evaluateAutomaticAdmissions } from "./clinical-admission-selection";
import type { Referral } from "./referral-types";
import type { PipelineResidentLink } from "./resident-link-records";

/** Pure mapping from reconciliation inputs to one blocker per assumed referral id. */
export function explainAssumedAdmissionBlockers(
  assumedIds: number[],
  referrals: Referral[],
  links: PipelineResidentLink[],
  residents: ClinicalResident[],
  dataAsOf: string | null,
  fresh: boolean,
  /** Referral ids whose governed client-record DOB lookup failed (read-time only). */
  lookupFailed: ReadonlySet<number> = new Set(),
): Map<number, AdmissionConfirmationBlocker> {
  if (!fresh) return new Map(assumedIds.map((id) => [id, admissionConfirmationBlocker("census_not_fresh")]));
  const { selected, blocked } = evaluateAutomaticAdmissions(referrals, links, residents, dataAsOf);
  const ready = new Set(selected.map(({ referral }) => referral.id));
  return new Map(assumedIds.map((id) => {
    if (ready.has(id)) return [id, admissionConfirmationBlocker("ready_for_next_reconciliation")];
    // A referral absent from the reconciled list (e.g. not an active workspace) is outside the job.
    const code = blocked.get(id) ?? "not_eligible";
    return [id, admissionConfirmationBlocker(code === "census_birth_date_missing" && lookupFailed.has(id) ? "birth_date_lookup_failed" : code)];
  }));
}
