// Client-safe vocabulary for accepted referrals whose planned admit date has passed
// but which the governed census has not confirmed. These are never admissions.
// The blocker codes mirror, in order, the checks applied by
// selectAutomaticAdmissions in clinical-admission-selection.ts.

export const DUE_AWAITING_CENSUS_LABEL = "Due — awaiting census confirmation";

export const admissionConfirmationBlockerLabels = {
  not_eligible: "This referral is closed, cancelled or already has an outcome, so the census check does not apply.",
  no_client_record: "This referral is not linked to a Pipeline client record, so the census check cannot match it.",
  multiple_active_referrals: "This client has more than one open referral. Close the extra referral so the census check knows which one to confirm.",
  decision_not_accepted: "The referral does not have an accepted decision on record.",
  planned_date_missing: "The planned admit date is missing or is not a valid date.",
  planned_after_census_date: "The planned admit date is after the latest census update. It will be checked once the census catches up.",
  missing_version_info: "The referral record is missing the version details the census check needs. Ask support to refresh the record.",
  no_confirmed_resident_link: "No ElderMark resident is confirmed for this client yet. Confirm the resident match, or check that the client appears in the census.",
  multiple_confirmed_links: "More than one ElderMark resident is confirmed for this client. Keep only the correct resident match.",
  conflicting_candidate_link: "Another possible ElderMark resident is still waiting for review for this client. Resolve the pending match.",
  resident_not_in_census: "The matched resident is not in the current census (not yet admitted in ElderMark, or already discharged).",
  ambiguous_census_resident: "The matched resident appears more than once in the census, so the admission cannot be confirmed automatically.",
  community_mismatch: "The census shows this resident at a different community than the referral.",
  name_mismatch: "The name in the census does not match the referral name.",
  birth_date_missing: "The referral has no date of birth recorded to compare with the census.",
  census_birth_date_missing: "Neither the census nor the governed client record has a date of birth that verifies the referral's.",
  birth_date_lookup_failed: "The census record has no date of birth and the governed client record could not be read to verify it. It will be retried.",
  birth_date_mismatch: "The date of birth in the census does not match the referral.",
  governed_identity_conflict: "The census identity conflicts with the confirmed resident match (resident number, community or date of birth).",
  census_admit_date_missing: "The census does not show an admit date for this resident yet.",
  acceptance_date_missing: "The acceptance decision has no recorded date.",
  census_admit_before_acceptance: "The census admit date is before the acceptance decision, so it likely belongs to an earlier stay.",
  census_admit_date_invalid: "The census admit date is after the census update date or in the future.",
  ready_for_next_reconciliation: "The census matches this admission; the next daily census check will record it.",
  census_not_fresh: "The census data is out of date, so automatic confirmations are paused until it refreshes.",
  census_unavailable: "The census could not be read right now, so the reason is not known.",
} as const;

export type AdmissionConfirmationBlockerCode = keyof typeof admissionConfirmationBlockerLabels;

export type AdmissionConfirmationBlocker = {
  code: AdmissionConfirmationBlockerCode;
  label: string;
};

export function admissionConfirmationBlocker(code: AdmissionConfirmationBlockerCode): AdmissionConfirmationBlocker {
  return { code, label: admissionConfirmationBlockerLabels[code] };
}
