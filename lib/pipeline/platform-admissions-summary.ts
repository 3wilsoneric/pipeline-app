// Live snapshot of the referral board for the authenticated Alamo Platform.
// Rows include the identity, bounded management chart, and workflow fields
// needed to identify and manage the referral. Raw notes, documents, contacts,
// extraction evidence, and unsigned assessment narrative stay in Pipeline.
// Platform documents the consumer side in
// alamo-platform-app/docs/platform/admissions-zone.md.

export const PLATFORM_ADMISSIONS_SUMMARY_VERSION = "3.2";

const DAY_MS = 86_400_000;
const TREND_MONTHS = 6;
const DECISION_TIMING_DAYS = 90;
const MAX_CARDS = 300;
const MAX_BRIEFING_REFERRALS = 500;
const MAX_BRIEFING_SCHEDULE = 100;
const BRIEFING_TREND_WEEKS = 12;
// Accepted clients whose planned date passed more than this long ago without a
// recorded arrival are treated as stale records rather than pending arrivals.
const PAST_PLANNED_LOOKBACK_DAYS = 30;

export const platformBoardColumns = [
  { key: "received", label: "Referral received", statuses: ["Referral received"] },
  { key: "in_progress", label: "In progress", statuses: ["Preparation", "Assessment scheduled", "Assessment underway", "Ready to sign"] },
  { key: "decision", label: "Decision", statuses: ["Under review", "Accepted, requirements open", "Awaiting admit", "Meet the Client not sent", "Declined"] },
] as const;

export type PlatformBoardColumn = (typeof platformBoardColumns)[number]["key"];

// Board details are written for assessors; leadership reads the plainer form.
const leadershipStatus: Record<string, string> = {
  Accept: "Accepted, requirements open",
  "Email not sent": "Meet the Client not sent",
  Denied: "Declined",
};

export type PlatformSummaryReferral = {
  referralId: number;
  clientName: string;
  community: string;
  owner: string;
  priority: string;
  receivedDate: string | null;
  decisionOutcome: "accepted" | "declined" | null;
  decidedAt: string | null;
  plannedAdmissionDate: string | null;
  actualAdmissionDate: string | null;
  assessmentScheduledDate: string | null;
  assessmentScheduledDurationMinutes: number | null;
  assessmentComplete: boolean;
  /** Current (not historical or archived) workspace. */
  currentWorkspace: boolean;
  /** Pipeline board column; null once the referral has left the board. */
  boardColumn: PlatformBoardColumn | null;
  boardStatus: string;
  nextAction: string;
  hoursSinceUpdate: number;
  stale: boolean;
  unassigned: boolean;
  managementProfile: PlatformManagementProfile;
  /** Relative Pipeline path that opens this referral where the work is. */
  pipelinePath: string;
};

export type PlatformManagementItem = {
  label: string;
  value: string;
};

export type PlatformManagementProfile = {
  dateOfBirth: string | null;
  referralSource: string | null;
  referringCounty: string | null;
  payer: string | null;
  responsiblePerson: string | null;
  conservedStatus: string | null;
  documentStatus: string | null;
  assessmentStatus: string | null;
  assessmentSigned: boolean;
  assessmentDate: string | null;
  openRequirements: number;
  blockingRequirements: number;
  overview: string[];
  supportSnapshot: PlatformManagementItem[];
  medications: string[];
  medicationSource: "signed_assessment" | "referral" | null;
};

export type PlatformAdmissionsSummaryInput = {
  now: Date;
  referrals: PlatformSummaryReferral[];
};

type MonthCounts = { month: string; received: number; accepted: number; declined: number; admitted: number };

function dayKey(value: string | null | undefined) {
  const text = value?.slice(0, 10) ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function addDays(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string) {
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS));
}

function recentMonths(today: string, count: number) {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1)).toISOString().slice(0, 7));
}

function localDay(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function mondayFor(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return addDays(day, -offset);
}

function recentWeekStarts(today: string, count: number) {
  const current = mondayFor(today);
  return Array.from({ length: count }, (_, index) => addDays(current, -7 * (count - 1 - index)));
}

function inWindow(value: string | null | undefined, start: string, end: string) {
  const day = dayKey(value);
  return Boolean(day && day >= start && day <= end);
}

function appointmentIsUpcoming(referral: PlatformSummaryReferral, now: Date, start: string, end: string) {
  const scheduled = referral.assessmentScheduledDate;
  if (!inWindow(scheduled, start, end)) return false;
  if (!scheduled?.includes("T")) return true;
  const startsAt = Date.parse(scheduled);
  if (!Number.isFinite(startsAt)) return false;
  return startsAt + Math.max(0, referral.assessmentScheduledDurationMinutes ?? 0) * 60_000 > now.getTime();
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10) / 10;
}

function awaitingArrival(referral: PlatformSummaryReferral, today: string) {
  if (!referral.currentWorkspace || referral.decisionOutcome !== "accepted" || referral.actualAdmissionDate) return false;
  const planned = dayKey(referral.plannedAdmissionDate);
  return !planned || planned >= addDays(today, -PAST_PLANNED_LOOKBACK_DAYS);
}

function isActiveReferral(referral: PlatformSummaryReferral) {
  const status = leadershipStatus[referral.boardStatus] ?? referral.boardStatus.trim();
  return referral.decisionOutcome !== "declined" && status.toLowerCase() !== "declined";
}

export function buildPlatformAdmissionsSummary(input: PlatformAdmissionsSummaryInput) {
  const today = localDay(input.now);
  const month = today.slice(0, 7);
  const timingStart = addDays(today, -DECISION_TIMING_DAYS);
  const monthly = new Map<string, MonthCounts>(recentMonths(today, TREND_MONTHS)
    .map((key) => [key, { month: key, received: 0, accepted: 0, declined: 0, admitted: 0 }]));
  const decisionDays: number[] = [];
  const observedMonths = new Set<string>();

  for (const referral of input.referrals) {
    const received = dayKey(referral.receivedDate);
    const decided = dayKey(referral.decidedAt);
    const admitted = dayKey(referral.actualAdmissionDate);
    if (received) observedMonths.add(received.slice(0, 7));
    if (decided) observedMonths.add(decided.slice(0, 7));
    if (admitted) observedMonths.add(admitted.slice(0, 7));
    const receivedMonth = received ? monthly.get(received.slice(0, 7)) : undefined;
    if (receivedMonth) receivedMonth.received += 1;
    const decidedMonth = decided ? monthly.get(decided.slice(0, 7)) : undefined;
    if (decidedMonth && referral.decisionOutcome) decidedMonth[referral.decisionOutcome] += 1;
    const admittedMonth = admitted ? monthly.get(admitted.slice(0, 7)) : undefined;
    if (admittedMonth) admittedMonth.admitted += 1;
    if (received && decided && decided >= timingStart && decided >= received) {
      decisionDays.push(daysBetween(received, decided));
    }
  }

  const coverageStartMonth = [...observedMonths].sort()[0] ?? null;

  const onBoard = input.referrals.filter((referral) => referral.currentWorkspace && referral.boardColumn);
  const cards = onBoard
    .map((referral) => {
      const received = dayKey(referral.receivedDate);
      const planned = dayKey(referral.plannedAdmissionDate);
      const awaiting = awaitingArrival(referral, today);
      return {
        referral_id: referral.referralId,
        client_name: referral.clientName.trim() || "Name not recorded",
        column: referral.boardColumn as PlatformBoardColumn,
        status: leadershipStatus[referral.boardStatus] ?? referral.boardStatus,
        next_action: referral.nextAction,
        community: referral.community.trim() || "Unassigned",
        owner: referral.unassigned ? "Unassigned" : referral.owner,
        priority: referral.priority,
        days_open: received ? daysBetween(received, today) : null,
        days_since_update: Math.floor(referral.hoursSinceUpdate / 24),
        planned_admission_date: awaiting ? planned : null,
        flags: {
          stale: referral.stale,
          unassigned: referral.unassigned,
          move_in_overdue: awaiting && Boolean(planned && planned < today),
        },
        management_profile: normalizeManagementProfile(referral.managementProfile),
        pipeline_path: referral.pipelinePath,
      };
    })
    .sort((left, right) => (right.days_open ?? -1) - (left.days_open ?? -1));

  const columns = platformBoardColumns.map((column) => {
    const columnCards = cards.filter((card) => card.column === column.key);
    const known = new Set<string>(column.statuses);
    const statuses = [
      ...column.statuses,
      ...new Set(columnCards.map((card) => card.status).filter((status) => !known.has(status))),
    ].map((status) => ({ status, count: columnCards.filter((card) => card.status === status).length }));
    return { key: column.key, label: column.label, count: columnCards.length, statuses };
  });
  const activeReferralIds = new Set(onBoard.filter(isActiveReferral).map((referral) => referral.referralId));
  const activeCards = cards.filter((card) => activeReferralIds.has(card.referral_id));

  const awaiting = input.referrals.filter((referral) => awaitingArrival(referral, today));
  const upcoming = { next_7_days: 0, next_30_days: 0, past_planned_date: 0, no_planned_date: 0 };
  for (const referral of awaiting) {
    const planned = dayKey(referral.plannedAdmissionDate);
    if (!planned) upcoming.no_planned_date += 1;
    else if (planned < today) upcoming.past_planned_date += 1;
    else {
      if (planned <= addDays(today, 7)) upcoming.next_7_days += 1;
      if (planned <= addDays(today, 30)) upcoming.next_30_days += 1;
    }
  }

  const weekStart = mondayFor(today);
  const weekEnd = addDays(weekStart, 6);
  const recentStart = addDays(today, -13);
  const briefingStatus = (referral: PlatformSummaryReferral) =>
    (leadershipStatus[referral.boardStatus] ?? referral.boardStatus.trim()) ||
    (referral.actualAdmissionDate ? "Admitted" : referral.decisionOutcome === "accepted" ? "Accepted" : referral.decisionOutcome === "declined" ? "Declined" : "Closed");
  const recentReferrals = input.referrals
    .filter((referral) => inWindow(referral.receivedDate, recentStart, today))
    .map((referral) => ({
      referral_id: referral.referralId,
      client_name: referral.clientName.trim() || "Name not recorded",
      received_at: referral.receivedDate!,
      source_name: boundedText(referral.managementProfile.referralSource, 160),
      source_category: null,
      referring_county: boundedText(referral.managementProfile.referringCounty, 120),
      community: referral.community.trim() || "Unassigned",
      owner: referral.unassigned ? "Unassigned" : referral.owner,
      status: briefingStatus(referral),
      pipeline_path: referral.pipelinePath,
    }))
    .sort((left, right) => right.received_at.localeCompare(left.received_at) || left.client_name.localeCompare(right.client_name));
  const upcomingAssessments = input.referrals
    .filter((referral) =>
      referral.currentWorkspace &&
      !referral.assessmentComplete &&
      appointmentIsUpcoming(referral, input.now, today, weekEnd))
    .map((referral) => ({
      referral_id: referral.referralId,
      client_name: referral.clientName.trim() || "Name not recorded",
      scheduled_at: referral.assessmentScheduledDate!,
      community: referral.community.trim() || "Unassigned",
      owner: referral.unassigned ? "Unassigned" : referral.owner,
      status: briefingStatus(referral),
      pipeline_path: referral.pipelinePath,
    }))
    .sort((left, right) => left.scheduled_at.localeCompare(right.scheduled_at) || left.client_name.localeCompare(right.client_name));
  const plannedMoveIns = awaiting
    .filter((referral) => inWindow(referral.plannedAdmissionDate, weekStart, weekEnd))
    .map((referral) => ({
      referral_id: referral.referralId,
      client_name: referral.clientName.trim() || "Name not recorded",
      planned_at: referral.plannedAdmissionDate!,
      community: referral.community.trim() || "Unassigned",
      owner: referral.unassigned ? "Unassigned" : referral.owner,
      status: briefingStatus(referral),
      readiness: referral.managementProfile.blockingRequirements > 0
        ? "blocked"
        : referral.managementProfile.openRequirements > 0 ? "watch" : "ready",
      pipeline_path: referral.pipelinePath,
    }))
    .sort((left, right) => left.planned_at.localeCompare(right.planned_at) || left.client_name.localeCompare(right.client_name));
  const weeklyTrend = recentWeekStarts(today, BRIEFING_TREND_WEEKS).map((start) => ({
    week_start: start,
    received: input.referrals.filter((referral) => inWindow(referral.receivedDate, start, addDays(start, 6))).length,
    accepted: input.referrals.filter((referral) => referral.decisionOutcome === "accepted" && inWindow(referral.decidedAt, start, addDays(start, 6))).length,
  }));

  return {
    contract_version: PLATFORM_ADMISSIONS_SUMMARY_VERSION,
    generated_at: input.now.toISOString(),
    board: {
      total: cards.length,
      columns,
      cards: cards.slice(0, MAX_CARDS),
      cards_truncated: cards.length > MAX_CARDS,
    },
    metrics: {
      on_board: cards.length,
      active_referrals: activeCards.length,
      stale: activeCards.filter((card) => card.flags.stale).length,
      unassigned: activeCards.filter((card) => card.flags.unassigned).length,
      awaiting_admission: awaiting.length,
    },
    upcoming_admissions: upcoming,
    briefing: {
      timezone: "America/Los_Angeles",
      window_end: today,
      coverage: {
        recent_referrals_complete: recentReferrals.length <= MAX_BRIEFING_REFERRALS,
        assessments_complete: upcomingAssessments.length <= MAX_BRIEFING_SCHEDULE,
        move_ins_complete: plannedMoveIns.length <= MAX_BRIEFING_SCHEDULE,
        weekly_trend_complete: true,
      },
      recent_referrals: recentReferrals.slice(0, MAX_BRIEFING_REFERRALS),
      upcoming_assessments: upcomingAssessments.slice(0, MAX_BRIEFING_SCHEDULE),
      planned_move_ins: plannedMoveIns.slice(0, MAX_BRIEFING_SCHEDULE),
      weekly_trend: weeklyTrend,
    },
    history: {
      coverage_start_month: coverageStartMonth,
      month_outcomes: { ...monthly.get(month)! },
      monthly: coverageStartMonth
        ? [...monthly.values()].filter((row) => row.month >= coverageStartMonth)
        : [],
      decision_timing: {
        window_days: DECISION_TIMING_DAYS,
        median_days_to_decision: median(decisionDays),
        decisions_counted: decisionDays.length,
      },
    },
  };
}

function normalizeManagementProfile(profile: PlatformManagementProfile) {
  return {
    date_of_birth: boundedText(profile.dateOfBirth, 40),
    referral_source: boundedText(profile.referralSource, 160),
    referring_county: boundedText(profile.referringCounty, 120),
    payer: boundedText(profile.payer, 160),
    responsible_person: boundedText(profile.responsiblePerson, 160),
    conserved_status: boundedText(profile.conservedStatus, 80),
    document_status: boundedText(profile.documentStatus, 80),
    assessment_status: boundedText(profile.assessmentStatus, 80),
    assessment_signed: profile.assessmentSigned,
    assessment_date: boundedText(profile.assessmentDate, 40),
    open_requirements: safeCount(profile.openRequirements),
    blocking_requirements: safeCount(profile.blockingRequirements),
    overview: profile.overview
      .map((value) => boundedText(value, 320))
      .filter((value): value is string => Boolean(value))
      .slice(0, 4),
    support_snapshot: profile.supportSnapshot
      .map((item) => ({ label: boundedText(item.label, 80), value: boundedText(item.value, 320) }))
      .filter((item): item is { label: string; value: string } => Boolean(item.label && item.value))
      .slice(0, 8),
    medications: profile.medications
      .map((value) => boundedText(value, 160))
      .filter((value): value is string => Boolean(value))
      .slice(0, 16),
    medication_source: profile.medicationSource,
  };
}

function boundedText(value: string | null | undefined, maximumLength: number) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maximumLength) : null;
}

function safeCount(value: number) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export type PlatformAdmissionsSummary = ReturnType<typeof buildPlatformAdmissionsSummary>;
