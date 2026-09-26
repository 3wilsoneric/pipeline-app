// Live snapshot of the referral board for Alamo Platform leadership. Rows
// carry process facts only (column, status, community, owner, ages, flags,
// and a link back into Pipeline); no client names, dates of birth, sources,
// or free text leave Pipeline through this contract. Platform documents the
// consumer side in alamo-platform-app/docs/platform/admissions-zone.md.

export const PLATFORM_ADMISSIONS_SUMMARY_VERSION = "2.0";

const DAY_MS = 86_400_000;
const TREND_MONTHS = 6;
const DECISION_TIMING_DAYS = 90;
const MAX_CARDS = 300;
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
  community: string;
  owner: string;
  priority: string;
  receivedDate: string | null;
  decisionOutcome: "accepted" | "declined" | null;
  decidedAt: string | null;
  plannedAdmissionDate: string | null;
  actualAdmissionDate: string | null;
  /** Current (not historical or archived) workspace. */
  currentWorkspace: boolean;
  /** Pipeline board column; null once the referral has left the board. */
  boardColumn: PlatformBoardColumn | null;
  boardStatus: string;
  nextAction: string;
  hoursSinceUpdate: number;
  stale: boolean;
  unassigned: boolean;
  /** Relative Pipeline path that opens this referral where the work is. */
  pipelinePath: string;
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

export function buildPlatformAdmissionsSummary(input: PlatformAdmissionsSummaryInput) {
  const today = input.now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const timingStart = addDays(today, -DECISION_TIMING_DAYS);
  const monthly = new Map<string, MonthCounts>(recentMonths(today, TREND_MONTHS)
    .map((key) => [key, { month: key, received: 0, accepted: 0, declined: 0, admitted: 0 }]));
  const decisionDays: number[] = [];

  for (const referral of input.referrals) {
    const received = dayKey(referral.receivedDate);
    const decided = dayKey(referral.decidedAt);
    const admitted = dayKey(referral.actualAdmissionDate);
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

  const onBoard = input.referrals.filter((referral) => referral.currentWorkspace && referral.boardColumn);
  const cards = onBoard
    .map((referral) => {
      const received = dayKey(referral.receivedDate);
      const planned = dayKey(referral.plannedAdmissionDate);
      const awaiting = awaitingArrival(referral, today);
      return {
        referral_id: referral.referralId,
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
      stale: cards.filter((card) => card.flags.stale).length,
      unassigned: cards.filter((card) => card.flags.unassigned).length,
      awaiting_admission: awaiting.length,
    },
    upcoming_admissions: upcoming,
    history: {
      month_outcomes: { ...monthly.get(month)! },
      monthly: [...monthly.values()],
      decision_timing: {
        window_days: DECISION_TIMING_DAYS,
        median_days_to_decision: median(decisionDays),
        decisions_counted: decisionDays.length,
      },
    },
  };
}

export type PlatformAdmissionsSummary = ReturnType<typeof buildPlatformAdmissionsSummary>;
