import type { AssessmentToolData } from "@/lib/assessment/assessment-tool-schema";

const dayMs = 86_400_000;
const maxCases = 500;

const settingLabels = {
  state_hospital: "State hospital",
  acute_psychiatric_hospital: "Acute psychiatric hospital",
  imd_mhrc: "IMD / MHRC",
  skilled_nursing_facility: "Skilled nursing facility",
  board_and_care: "Board and care",
  residential_program: "Residential program",
  jail_forensic: "Jail / forensic setting",
  independent_family_home: "Independent or family home",
  unhoused: "Unhoused",
  other: "Other",
  not_recorded: "Not recorded",
} as const;

export type PlatformClientBriefingCase = {
  referralId: number;
  clientName: string;
  community: string;
  referringCounty: string | null;
  /** Assigned referral owner, retained for workload context. */
  assessor: string;
  /** Assessor of record on the assessment, independent of referral ownership. */
  assessmentAssessor: string | null;
  receivedAt: string | null;
  assessmentCreatedAt: string | null;
  assessmentStartedAt: string | null;
  assessmentCompletedAt: string | null;
  assessmentSignedAt: string | null;
  acceptedAt: string | null;
  admittedAt: string | null;
  handoffSentAt: string | null;
  dateOfBirth: string | null;
  assessment: AssessmentToolData | null;
  pipelinePath: string;
};

function day(value: string | null | undefined) {
  const key = value?.slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const parsed = Date.parse(`${key}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === key ? key : null;
}

function elapsed(start: string | null, end: string | null) {
  if (!start || !end || end < start) return null;
  return Math.round((Date.parse(end) - Date.parse(start)) / dayMs);
}

function elapsedMinutes(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const from = Date.parse(start);
  const through = Date.parse(end);
  return Number.isFinite(from) && Number.isFinite(through) && through >= from
    ? Math.round((through - from) / 60_000)
    : null;
}

function median(values: Array<number | null>) {
  const sorted = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function ageOn(dob: string | null, admitted: string) {
  if (!dob || dob > admitted) return null;
  const birth = new Date(`${dob}T00:00:00.000Z`);
  const arrival = new Date(`${admitted}T00:00:00.000Z`);
  const age = arrival.getUTCFullYear() - birth.getUTCFullYear() -
    (arrival.getUTCMonth() < birth.getUTCMonth() ||
      (arrival.getUTCMonth() === birth.getUTCMonth() && arrival.getUTCDate() < birth.getUTCDate()) ? 1 : 0);
  return age >= 0 && age <= 120 ? age : null;
}

function bounded(value: string | null | undefined, length: number) {
  return value?.trim().slice(0, length) || null;
}

function setting(value: string | null | undefined): keyof typeof settingLabels {
  return value && Object.hasOwn(settingLabels, value)
    ? value as keyof typeof settingLabels
    : "not_recorded";
}

function yes(value: string | null | undefined) {
  return value === "yes" ? true : value === "no" ? false : null;
}

export function buildPlatformClientBriefing(input: {
  start: string;
  end: string;
  generatedAt: string;
  cases: PlatformClientBriefingCase[];
}) {
  const rows = input.cases.flatMap((item) => {
    const admitted = day(item.admittedAt);
    if (!admitted || admitted < input.start || admitted > input.end) return [];
    const assessment = item.assessment;
    const received = day(item.receivedAt);
    const created = day(item.assessmentCreatedAt);
    const started = item.assessmentStartedAt;
    const completed = item.assessmentCompletedAt;
    const completedDay = day(completed);
    const signed = day(item.assessmentSignedAt);
    const accepted = day(item.acceptedAt);
    const completedBeforeAdmission = completedDay && completedDay <= admitted ? completedDay : null;
    const acceptedBeforeAdmission = accepted && accepted <= admitted ? accepted : null;
    const signedBeforeAdmission = signed && signed <= admitted ? signed : null;
    const priorSetting = setting(assessment?.prior_setting_bucket);
    const diagnosisCategories = (assessment?.diagnosis_categories ?? [])
      .filter((value): value is string => typeof value === "string")
      .slice(0, 8);
    return [{
      referral_id: item.referralId,
      client_name: bounded(item.clientName, 120) ?? "Name not recorded",
      community: bounded(item.community, 80) ?? "Unassigned",
      referring_county: bounded(item.referringCounty, 80) ?? "Not recorded",
      assessor: bounded(item.assessor, 100) ?? "Unassigned",
      assessment_assessor: bounded(item.assessmentAssessor, 100) ?? "Not recorded",
      received_at: received,
      assessment_created_at: created,
      assessment_started_at: started,
      assessment_completed_at: completed,
      assessment_signed_at: signed,
      accepted_at: accepted,
      admitted_at: admitted,
      age_at_admission: ageOn(day(item.dateOfBirth), admitted),
      prior_setting: priorSetting,
      current_location: bounded(assessment?.current_location, 160),
      conservatorship: bounded(assessment?.conservatorship_type, 40),
      diagnosis_categories: diagnosisCategories,
      substance_history: yes(assessment?.substance_abuse_history),
      im_injections: yes(assessment?.im_injections),
      ambulatory: yes(assessment?.ambulatory),
      bathing_assistance: bounded(assessment?.bathing_assistance_level, 40),
      dressing_assistance: bounded(assessment?.dress_assistance_level, 40),
      structured_medications_recorded: Boolean(assessment?.medications_at_intake?.length),
      handoff_sent: Boolean(item.handoffSentAt),
      days_referral_to_signed: elapsed(received, signedBeforeAdmission),
      days_assessment_to_signed: elapsed(created, signedBeforeAdmission),
      minutes_assessment_start_to_complete: elapsedMinutes(started, completed),
      days_referral_to_assessment_complete: elapsed(received, completedBeforeAdmission),
      days_accepted_to_admit: elapsed(acceptedBeforeAdmission, admitted),
      days_referral_to_admit: elapsed(received, admitted),
      days_assessment_to_admit: elapsed(created, admitted),
      days_signed_to_admit: elapsed(signed, admitted),
      signed_after_admit: Boolean(signed && signed > admitted),
      pipeline_path: item.pipelinePath,
    }];
  }).sort((a, b) => b.admitted_at.localeCompare(a.admitted_at) || a.client_name.localeCompare(b.client_name));
  if (rows.length > maxCases) throw new Error("Client briefing exceeds its 500-case safe limit.");

  return {
    contract_version: "1.0",
    generated_at: input.generatedAt,
    source: "pipeline_recorded",
    timezone: "America/Los_Angeles",
    period: { start: input.start, end: input.end },
    summary: {
      admissions: rows.length,
      prior_settings: Object.entries(settingLabels).map(([key, label]) => ({
        key,
        label,
        count: rows.filter((row) => row.prior_setting === key).length,
      })),
      referring_counties: Array.from(new Set(rows.map((row) => row.referring_county)))
        .map((label) => ({ label, count: rows.filter((row) => row.referring_county === label).length }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      median_days_referral_to_signed: median(rows.map((row) => row.days_referral_to_signed)),
      median_days_assessment_to_signed: median(rows.map((row) => row.days_assessment_to_signed)),
      median_days_referral_to_admit: median(rows.map((row) => row.days_referral_to_admit)),
      median_days_assessment_to_admit: median(rows.map((row) => row.days_assessment_to_admit)),
      median_days_signed_to_admit: median(rows.map((row) => row.days_signed_to_admit)),
      signed_assessments: rows.filter((row) => row.assessment_signed_at).length,
      handoffs_logged: rows.filter((row) => row.handoff_sent).length,
      signed_after_admit: rows.filter((row) => row.signed_after_admit).length,
      age_recorded: rows.filter((row) => row.age_at_admission !== null).length,
      median_age: median(rows.map((row) => row.age_at_admission)),
      conserved_or_temporary: rows.filter((row) => ["lps", "temporary"].includes(row.conservatorship ?? "")).length,
      substance_history_yes: rows.filter((row) => row.substance_history === true).length,
      im_injections_yes: rows.filter((row) => row.im_injections === true).length,
      structured_medications_recorded: rows.filter((row) => row.structured_medications_recorded).length,
    },
    rows,
  };
}
