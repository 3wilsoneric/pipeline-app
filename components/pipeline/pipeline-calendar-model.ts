import type { AssessmentScheduleMethod } from "@/lib/assessment/assessment-records";
import { addCalendarDays, calendarToday } from "@/lib/pipeline/assessment-calendar";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import type {
  PipelineCalendarEvent,
  PipelineCalendarEventKind,
  PipelineCalendarResponse,
  PipelineUnscheduledAssessment,
} from "@/lib/pipeline/calendar-types";

export type CalendarView = "month" | "week" | "agenda";
export type CalendarDisplayKind = Exclude<PipelineCalendarEventKind, "referral_assigned">;
export type CalendarSelection =
  | { type: "event"; event: PipelineCalendarEvent }
  | { type: "unscheduled"; item: PipelineUnscheduledAssessment };
export type ScheduleTarget = {
  referralId: number;
  assessmentId?: string;
  clientName: string;
  community: string;
  startsAt?: string;
  durationMinutes?: number;
  method?: string;
  location?: string;
  reschedule: boolean;
};
export type CalendarSnapshot = Pick<PipelineCalendarResponse, "events" | "unscheduled" | "unscheduledTotal" | "unscheduledHasMore" | "assessors" | "scope" | "viewer" | "timezone">;
export type CalendarDrawerModel = {
  kicker: string;
  clientName: string;
  community: string;
  owner: string;
  dateLabel: string;
  receivedLabel: string;
  methodLabel: string;
  durationLabel: string;
  followUps: string[];
  needsAssignment: boolean;
  zoomUrl: string;
  canSchedule: boolean;
  isAppointment: boolean;
  showStatusActions: boolean;
};

export const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const operationalTimeZone = "America/Los_Angeles";
export const weekStartHour = 7;
export const weekEndHour = 20;
export const hourHeight = 64;

const emptyCalendarEvents: PipelineCalendarEvent[] = [];
const emptyUnscheduledAssessments: PipelineUnscheduledAssessment[] = [];

export function scheduleTargetFromUnscheduled(item: PipelineUnscheduledAssessment): ScheduleTarget {
  return { referralId: item.referralId, assessmentId: item.assessmentId, clientName: item.clientName, community: item.community, reschedule: false };
}

export function scheduleTargetFromSelection(selection: CalendarSelection): ScheduleTarget {
  if (selection.type === "unscheduled") return scheduleTargetFromUnscheduled(selection.item);
  const event = selection.event;
  return { referralId: event.referralId, assessmentId: event.assessmentId, clientName: event.clientName, community: event.community, startsAt: event.startsAt, durationMinutes: event.durationMinutes, method: event.method, location: event.location, reschedule: event.kind === "assessment" };
}

export function selectionIdentity(selection: CalendarSelection) {
  return selection.type === "event"
    ? { referralId: selection.event.referralId, clientName: selection.event.clientName, community: selection.event.community }
    : { referralId: selection.item.referralId, clientName: selection.item.clientName, community: selection.item.community };
}

export function findScheduleConflicts(events: PipelineCalendarEvent[]) {
  const conflicts = new Set<string>();
  const byOwner = new Map<string, PipelineCalendarEvent[]>();
  for (const event of events) {
    if (!isScheduledCalendarAssessment(event)) continue;
    const key = ownerKey(event.ownerId, event.owner);
    byOwner.set(key, [...(byOwner.get(key) ?? []), event]);
  }
  for (const ownerEvents of byOwner.values()) addOwnerScheduleConflicts(ownerEvents, conflicts);
  return conflicts;
}

function isScheduledCalendarAssessment(event: PipelineCalendarEvent) {
  return event.kind === "assessment"
    && Boolean(event.startsAt)
    && Boolean(event.ownerId)
    && ["scheduled", "rescheduled"].includes(event.scheduleStatus ?? "scheduled");
}

function addOwnerScheduleConflicts(ownerEvents: PipelineCalendarEvent[], conflicts: Set<string>) {
  const sorted = ownerEvents.sort((left, right) => (left.startsAt ?? "").localeCompare(right.startsAt ?? ""));
  for (let index = 0; index < sorted.length; index += 1) {
    const left = sorted[index];
    const leftStart = Date.parse(left.startsAt ?? "");
    const leftEnd = leftStart + calendarDuration(left) * 60_000;
    for (let candidateIndex = index + 1; candidateIndex < sorted.length; candidateIndex += 1) {
      const right = sorted[candidateIndex];
      const rightStart = Date.parse(right.startsAt ?? "");
      if (rightStart >= leftEnd) break;
      const rightEnd = rightStart + calendarDuration(right) * 60_000;
      if (rightEnd <= leftStart) continue;
      conflicts.add(left.id);
      conflicts.add(right.id);
    }
  }
}

export function calendarDuration(event: PipelineCalendarEvent) {
  return event.durationMinutes ?? 60;
}

export function resolveCalendarState(snapshot: CalendarSnapshot | undefined, requestState: { key: string; loading: boolean; error: string }, requestKey: string) {
  const requestIsCurrent = requestState.key === requestKey;
  if (!snapshot) {
    return {
      snapshot,
      loading: requestState.loading,
      refreshing: false,
      error: requestIsCurrent ? requestState.error : "",
      events: emptyCalendarEvents,
      unscheduled: emptyUnscheduledAssessments,
      scope: "team" as const,
      viewer: null,
    };
  }
  return {
    snapshot,
    loading: false,
    refreshing: requestState.loading && requestIsCurrent,
    error: requestIsCurrent ? requestState.error : "",
    events: snapshot.events,
    unscheduled: snapshot.unscheduled,
    scope: snapshot.scope,
    viewer: snapshot.viewer,
  };
}

export function hasCalendarFilters(community: string, owner: string, kind: string, mySchedule: boolean) {
  return Boolean(community || owner || kind || mySchedule);
}

export function calendarStatusText(loading: boolean, refreshing: boolean, message: string) {
  if (loading) return "Loading...";
  if (refreshing) return "Refreshing...";
  return message;
}

export function showTeamWeek(scope: "personal" | "team", owner: string, mySchedule: boolean) {
  return scope === "team" && !owner && !mySchedule;
}

export function calendarDrawerModel(selection: CalendarSelection, scope: "personal" | "team"): CalendarDrawerModel {
  if (selection.type === "unscheduled") {
    const item = selection.item;
    return {
      kicker: "Ready to schedule",
      clientName: calendarClientName(item.clientName, item.community),
      community: item.community,
      owner: item.owner,
      dateLabel: "",
      receivedLabel: longDate(item.receivedDate),
      methodLabel: "",
      durationLabel: "",
      followUps: [],
      needsAssignment: scope === "team" && !item.ownerId,
      zoomUrl: "",
      canSchedule: Boolean(item.ownerId) || scope === "personal",
      isAppointment: false,
      showStatusActions: false,
    };
  }
  const event = selection.event;
  const isAppointment = event.kind === "assessment" && Boolean(event.assessmentId);
  return {
    kicker: event.title,
    clientName: calendarClientName(event.clientName, event.community),
    community: event.community,
    owner: event.owner,
    dateLabel: event.startsAt ? `${longDate(event.date)} at ${eventTime(event.startsAt)}` : longDate(event.date),
    receivedLabel: "",
    methodLabel: methodLabel(event.method),
    durationLabel: `${calendarDuration(event)} minutes`,
    followUps: event.followUpLabels ?? [],
    needsAssignment: false,
    zoomUrl: event.method === "zoom" && event.location && isHttpUrl(event.location) ? event.location : "",
    canSchedule: isAppointment,
    isAppointment,
    showStatusActions: isAppointment && event.scheduleStatus !== "completed",
  };
}

export function timedEventPosition(event: PipelineCalendarEvent, dayEvents: PipelineCalendarEvent[]) {
  if (!event.startsAt) return null;
  const parts = operationalTimeParts(event.startsAt);
  if (!parts) return null;
  const startMinutes = parts.hour * 60 + parts.minute;
  const visibleStart = weekStartHour * 60;
  const visibleEnd = weekEndHour * 60;
  const duration = event.durationMinutes ?? 60;
  if (startMinutes + duration <= visibleStart || startMinutes >= visibleEnd) return null;
  const top = Math.max(0, startMinutes - visibleStart) / 60 * hourHeight;
  const height = Math.max(32, (Math.min(visibleEnd, startMinutes + duration) - Math.max(visibleStart, startMinutes)) / 60 * hourHeight);
  const overlapping = dayEvents.filter((candidate) => {
    if (!candidate.startsAt) return false;
    const candidateParts = operationalTimeParts(candidate.startsAt);
    if (!candidateParts) return false;
    const candidateStart = candidateParts.hour * 60 + candidateParts.minute;
    return candidateStart < startMinutes + duration && candidateStart + (candidate.durationMinutes ?? 60) > startMinutes;
  });
  const slot = Math.max(0, overlapping.findIndex((candidate) => candidate.id === event.id));
  const columns = Math.min(3, Math.max(1, overlapping.length));
  return { top, height, left: `calc(${slot % columns * (100 / columns)}% + 2px)`, width: `calc(${100 / columns}% - 4px)` };
}

export function calendarClientName(name: string, community: string) {
  return formatClientIdentityTitle({ name, community });
}

export function calendarRange(view: CalendarView, anchor: string) {
  if (view === "week") {
    const date = parseDate(anchor);
    date.setUTCDate(date.getUTCDate() - date.getUTCDay());
    const from = dateKey(date);
    return { from, to: addCalendarDays(from, 6) };
  }
  if (view === "agenda") return { from: anchor, to: addCalendarDays(anchor, 29) };
  const from = `${anchor.slice(0, 7)}-01`;
  const date = parseDate(from);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return { from, to: dateKey(date) };
}

export function shiftAnchor(view: CalendarView, anchor: string, direction: number) {
  if (view === "month") {
    const date = parseDate(`${anchor.slice(0, 7)}-01`);
    date.setUTCMonth(date.getUTCMonth() + direction);
    return dateKey(date);
  }
  return addCalendarDays(anchor, direction * (view === "week" ? 7 : 30));
}

export function rangeLabel(view: CalendarView, range: { from: string; to: string }) {
  if (view === "month") return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(parseDate(range.from));
  return `${shortDate(range.from)} - ${shortDate(range.to)}`;
}

export function groupEventsByDate(events: PipelineCalendarEvent[]) {
  const grouped = new Map<string, PipelineCalendarEvent[]>();
  for (const event of events) grouped.set(event.date, [...(grouped.get(event.date) ?? []), event]);
  return grouped;
}

export function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function uniqueOwnerOptions(values: { id?: string; name: string }[]) {
  const options = new Map<string, string>();
  for (const value of values) {
    const name = value.name.trim() || "Unassigned";
    options.set(ownerKey(value.id, name), name);
  }
  return [...options.entries()].map(([value, label]) => ({ value, label })).sort((left, right) => left.label.localeCompare(right.label));
}

export function ownerKey(id: string | undefined, name: string) {
  return id ? `id:${id}` : `name:${name.trim().toLocaleLowerCase() || "unassigned"}`;
}

export function todayKey() {
  return calendarToday();
}

export function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function dateKeys(from: string, to: string) {
  const values: string[] = [];
  for (let current = from; current <= to; current = addCalendarDays(current, 1)) values.push(current);
  return values;
}

export function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(parseDate(value));
}

export function longDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(parseDate(value));
}

export function eventTime(value: string | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: operationalTimeZone }).format(date);
}

export function formatHour(hour: number) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 1, hour)));
}

export function methodLabel(method: string | undefined) {
  if (method === "zoom") return "Zoom";
  if (method === "in_person") return "In person";
  if (method === "phone") return "Phone";
  if (method === "record_review") return "Record review";
  return "Assessment";
}

export function normalizeMethod(method: string | undefined): AssessmentScheduleMethod {
  return method === "in_person" || method === "phone" || method === "record_review" || method === "zoom" ? method : "zoom";
}

export function ageLabel(receivedDate: string) {
  const days = Math.max(0, Math.floor((Date.parse(`${todayKey()}T00:00:00.000Z`) - Date.parse(`${receivedDate}T00:00:00.000Z`)) / 86_400_000));
  return days === 0 ? "Today" : `${days}d waiting`;
}

export function calendarDays(month: string) {
  const first = parseDate(`${month}-01`);
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const today = todayKey();
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const key = dateKey(date);
    return { date: key, day: date.getUTCDate(), inMonth: key.startsWith(month), today: key === today };
  });
}

function operationalTimeParts(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: operationalTimeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const record = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { hour: Number(record.hour), minute: Number(record.minute) };
}

export function isoToOperationalInput(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: operationalTimeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const record = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${record.year}-${record.month}-${record.day}T${record.hour}:${record.minute}`;
}

export function operationalInputToIso(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let guess = desired;
  for (let index = 0; index < 3; index += 1) {
    const actualInput = isoToOperationalInput(new Date(guess).toISOString());
    const actualMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(actualInput);
    if (!actualMatch) return null;
    const actual = Date.UTC(Number(actualMatch[1]), Number(actualMatch[2]) - 1, Number(actualMatch[3]), Number(actualMatch[4]), Number(actualMatch[5]));
    guess += desired - actual;
  }
  return isoToOperationalInput(new Date(guess).toISOString()) === value ? new Date(guess).toISOString() : null;
}

export function nextSchedulingInput() {
  const next = new Date(Date.now() + 60 * 60_000);
  next.setMinutes(0, 0, 0);
  return isoToOperationalInput(next.toISOString());
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
