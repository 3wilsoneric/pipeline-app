import { admissionFlowToday } from "./admission-flow-day";
import { admissionFlowStartDate } from "./admission-flow-cohort";
import { normalizeCalendarDate } from "./calendar-date";
import type { ScorecardPeriod } from "./assessor-scorecard-types";

export class ScorecardPeriodError extends Error {}

export const scorecardPeriods: ScorecardPeriod[] = ["4w", "last_week", "custom", "launch", "30d", "week"];
export type ScorecardDates = { start?: string; end?: string };
export type ScorecardRange = { since: string; through: string; endExclusive?: string; complete: boolean };
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// Pacific DST changes at 02:00. The offset before local midnight applies.
function midnight(day: string) {
  const utc = Date.parse(`${day}T00:00:00Z`);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "shortOffset" })
    .formatToParts(new Date(utc)).find(part => part.type === "timeZoneName")!.value;
  return new Date(utc - Number(offset.replace("GMT", "")) * 3600_000).toISOString();
}
function closed(start: string, end: string): ScorecardRange {
  const endExclusive = midnight(end);
  return { since: midnight(start), through: new Date(Date.parse(endExclusive) - 1).toISOString(), endExclusive, complete: true };
}

export function scorecardRange(period: ScorecardPeriod, now = new Date(), dates: ScorecardDates = {}): ScorecardRange {
  const today = admissionFlowToday(now);
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monday = shift(today, -weekday);
  if (period === "4w" || period === "last_week") return closed([admissionFlowStartDate, shift(monday, period === "4w" ? -28 : -7)].sort().at(-1)!, monday);
  if (period === "custom") {
    const { start, end } = dates;
    if (!start || !end || normalizeCalendarDate(start) !== start || normalizeCalendarDate(end) !== end || start < admissionFlowStartDate || end < start || end > today)
      throw new ScorecardPeriodError(`Choose dates from ${admissionFlowStartDate} through ${today}, with the start before or on the end.`);
    return end < today ? closed(start, shift(end, 1)) : { since: midnight(start), through: now.toISOString(), complete: false };
  }
  const start = period === "launch" ? admissionFlowStartDate : period === "week" ? monday : shift(today, -29);
  return { since: midnight([admissionFlowStartDate, start].sort().at(-1)!), through: now.toISOString(), complete: false };
}

export function scorecardPreviousRange(range: ScorecardRange): ScorecardRange | null {
  if (!range.complete || !range.endExclusive) return null;
  const start = admissionFlowToday(new Date(range.since));
  const end = admissionFlowToday(new Date(range.endExclusive));
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
  const previous = shift(start, -days);
  // Missing pre-launch history is not a zero-activity comparison.
  return previous >= admissionFlowStartDate ? closed(previous, start) : null;
}
