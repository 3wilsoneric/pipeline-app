import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Filter,
  FolderOpen,
  RefreshCw,
  Search,
  UserRoundCheck,
  Video,
  X,
} from "lucide-react";

import type { AssessmentScheduleMethod } from "@/lib/assessment/assessment-records";
import type { PipelineCalendarEvent, PipelineCalendarEventKind, PipelineUnscheduledAssessment } from "@/lib/pipeline/calendar-types";
import {
  ageLabel,
  calendarClientName,
  calendarDays,
  calendarDrawerModel,
  calendarStatusText,
  dateKeys,
  eventTime,
  formatHour,
  groupEventsByDate,
  hourHeight,
  longDate,
  methodLabel,
  ownerKey,
  parseDate,
  rangeLabel,
  shiftAnchor,
  shortDate,
  showTeamWeek,
  timedEventPosition,
  todayKey,
  uniqueOwnerOptions,
  weekdays,
  weekEndHour,
  weekStartHour,
  type CalendarDisplayKind,
  type CalendarDrawerModel,
  type CalendarSelection,
  type CalendarView,
  type ScheduleTarget,
} from "@/components/pipeline/pipeline-calendar-model";

const eventColors: Record<PipelineCalendarEventKind, string> = {
  referral_assigned: "border-l-[#0f8b73] bg-[#e8f5f1] text-[#0c705f]",
  assessment: "border-l-[#4b68ad] bg-[#eef1ff] text-[#354b85]",
  follow_up: "border-l-[#a16a16] bg-[#fff8ed] text-[#6f4b13]",
};
const kindLabels: Record<CalendarDisplayKind, string> = { assessment: "Assessments", follow_up: "Follow-ups" };
const calendarDisplayKinds: CalendarDisplayKind[] = ["assessment", "follow_up"];
const workflowLabels: Record<PipelineUnscheduledAssessment["workflowStatus"], string> = {
  intake_unassigned: "Needs an assessor",
  intake_documents_needed: "Documents needed",
  profile_incomplete: "Intake incomplete",
  ready_to_schedule: "Ready to schedule",
  assessment_scheduled: "Assessment scheduled",
  assessment_in_progress: "Assessment in progress",
  waiting_for_information: "Waiting for information",
  assessment_ready_to_sign: "Ready to sign",
  assessment_signed: "Assessment signed",
  recommendation_submitted: "Recommendation submitted",
  decision_pending: "Decision pending",
  accepted: "Accepted",
  declined: "Declined",
  closed: "Closed",
};

export type CalendarHeaderProps = {
  view: CalendarView;
  anchor: string;
  range: { from: string; to: string };
  scope: "personal" | "team";
  community: string;
  communityOptions: string[];
  owner: string;
  ownerOptions: { value: string; label: string }[];
  kind: CalendarDisplayKind | "";
  mySchedule: boolean;
  showFilters: boolean;
  hasFilters: boolean;
  loading: boolean;
  refreshing: boolean;
  message: string;
  queueCount: number;
  scheduledCount: number;
  overdueCount: number;
  onView: (value: CalendarView) => void;
  onAnchor: (value: string) => void;
  onCommunity: (value: string) => void;
  onOwner: (value: string) => void;
  onKind: (value: CalendarDisplayKind | "") => void;
  onMySchedule: (value: boolean) => void;
  onShowFilters: (value: boolean) => void;
  onOpenQueue: () => void;
  onRefresh: () => void;
};

export function CalendarHeader(props: CalendarHeaderProps) {
  const status = calendarStatusText(props.loading, props.refreshing, props.message);
  const clearFilters = () => {
    props.onCommunity("");
    props.onOwner("");
    props.onKind("");
    props.onMySchedule(false);
  };
  const toggleMine = () => {
    props.onMySchedule(!props.mySchedule);
    props.onOwner("");
  };
  return (
    <header className="sticky top-0 z-20 bg-white/95 py-3 backdrop-blur">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <IconButton label="Previous calendar range" onClick={() => props.onAnchor(shiftAnchor(props.view, props.anchor, -1))}><ChevronLeft size={17} /></IconButton>
          <IconButton label="Next calendar range" onClick={() => props.onAnchor(shiftAnchor(props.view, props.anchor, 1))}><ChevronRight size={17} /></IconButton>
          <h1 className="ml-1 truncate text-[19px] font-extrabold text-[#202522] sm:text-[22px]">{rangeLabel(props.view, props.range)}</h1>
          <button type="button" onClick={() => props.onAnchor(todayKey())} className="ml-1 h-9 border border-[#bfc7c3] px-3 text-[12px] font-bold text-[#3f4743] hover:border-[#167f6b] hover:text-[#116b5a]">Today</button>
        </div>
        <div className="flex items-center gap-1.5">
          <span role="status" aria-live="polite" className="hidden text-[11px] text-[#747b77] lg:inline">{status}</span>
          <button type="button" onClick={props.onOpenQueue} className="flex h-9 items-center gap-2 border border-[#bfc7c3] bg-white px-3 text-[11px] font-extrabold text-[#343a36] hover:border-[#167f6b] hover:text-[#116b5a]">
            <ClipboardList size={15} />
            <span>Ready to schedule</span>
            <span className="tabular-nums text-[#167f6b]">{props.queueCount.toLocaleString()}</span>
          </button>
          <IconButton label="Refresh calendar" onClick={props.onRefresh}><RefreshCw size={14} className={props.refreshing ? "animate-spin" : ""} /></IconButton>
          <button type="button" aria-label="Show calendar filters" aria-expanded={props.showFilters} onClick={() => props.onShowFilters(!props.showFilters)} className={`flex h-9 w-9 items-center justify-center border md:hidden ${props.hasFilters ? "border-[#167f6b] text-[#116b5a]" : "border-[#cfd5d2] text-[#626a66]"}`}><Filter size={15} /></button>
          <CalendarViewSwitch view={props.view} onView={props.onView} />
        </div>
      </div>
      <CalendarFilters {...props} onClear={clearFilters} onToggleMine={toggleMine} />
      <div className="mt-2 flex items-center gap-4 text-[11px] font-bold text-[#747b77]">
        <span><strong className="text-[#2c332f]">{props.scheduledCount.toLocaleString()}</strong> scheduled</span>
        {props.overdueCount > 0 ? <span className="text-[#9c3d32]"><strong>{props.overdueCount.toLocaleString()}</strong> overdue</span> : null}
        <span className="hidden sm:inline">Pacific Time</span>
      </div>
    </header>
  );
}

function CalendarViewSwitch({ view, onView }: { view: CalendarView; onView: (value: CalendarView) => void }) {
  return <div data-guide-target="calendar-view" role="group" aria-label="Calendar view" className="flex border border-[#cfd5d2] bg-[#f4f6f5] p-0.5">{(["month", "week", "agenda"] as const).map((option) => <button key={option} type="button" aria-pressed={view === option} onClick={() => onView(option)} className={`h-8 px-2.5 text-[11px] font-bold capitalize sm:h-9 sm:px-3.5 ${view === option ? "bg-white text-[#202522] shadow-sm" : "text-[#69706c] hover:text-[#202522]"}`}>{option}</button>)}</div>;
}

function CalendarFilters(props: CalendarHeaderProps & { onClear: () => void; onToggleMine: () => void }) {
  return (
    <div data-guide-target="calendar-filters" className={`${props.showFilters ? "flex" : "hidden"} mt-1 flex-wrap items-center gap-2 pt-1 md:flex`}>
      <span className="flex h-9 shrink-0 items-center bg-[#eaf5f1] px-3 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#176f5e]">{props.scope === "personal" ? "My schedule" : "Team schedule"}</span>
      <CalendarFilter label="community" value={props.community} onChange={props.onCommunity} options={props.communityOptions} />
      {props.scope === "team" ? <OwnerFilter value={props.owner} onChange={props.onOwner} options={props.ownerOptions} /> : null}
      <select aria-label="Filter calendar by event type" value={props.kind} onChange={(event) => props.onKind(event.target.value as CalendarDisplayKind | "")} className="h-9 min-w-0 border border-[#cfd5d2] bg-white px-2.5 text-[12px] font-semibold text-[#303632] outline-none focus:border-[#167f6b]">
        <option value="">Assessments and follow-ups</option>
        {calendarDisplayKinds.map((value) => <option key={value} value={value}>{kindLabels[value]}</option>)}
      </select>
      {props.scope === "team" ? <button type="button" aria-pressed={props.mySchedule} onClick={props.onToggleMine} className={`flex h-9 shrink-0 items-center gap-1.5 border px-3 text-[11px] font-bold ${props.mySchedule ? "border-[#4b68ad] bg-[#eef1ff] text-[#354b85]" : "border-[#cfd5d2] text-[#525a56] hover:border-[#4b68ad]"}`}><UserRoundCheck size={14} /> Mine</button> : null}
      {props.hasFilters ? <button type="button" onClick={props.onClear} className="flex h-8 items-center gap-1 px-2 text-[10px] font-bold text-[#6d7470] hover:text-[#9c3d32]"><X size={12} /> Clear</button> : null}
    </div>
  );
}

export function CalendarNotices({ error, mutationError, scheduleOpen, onRetry }: { error: string; mutationError: string; scheduleOpen: boolean; onRetry: () => void }) {
  return <>{error ? <div role="alert" className="mt-3 flex items-center justify-between gap-4 border-l-2 border-[#a16a16] bg-[#fff8ed] px-4 py-3 text-[12px] text-[#6f4b13]"><span>{error}</span><button type="button" onClick={onRetry} className="shrink-0 font-bold">Try again</button></div> : null}{mutationError && !scheduleOpen ? <div role="alert" className="mt-3 border-l-2 border-[#a9473d] bg-[#fff3f1] px-4 py-3 text-[12px] text-[#7c3229]">{mutationError}</div> : null}</>;
}

export function SchedulingQueue({ items, total, hasMore, search, loading, onSearch, onClose, onLoadMore, onOpenWorkspace, onSchedule }: {
  items: PipelineUnscheduledAssessment[];
  total: number;
  hasMore: boolean;
  search: string;
  loading: boolean;
  onSearch: (value: string) => void;
  onClose: () => void;
  onLoadMore: () => void;
  onOpenWorkspace: (item: PipelineUnscheduledAssessment) => void;
  onSchedule: (item: PipelineUnscheduledAssessment) => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] bg-[#18201d]/30" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside role="dialog" aria-modal="true" aria-label="Scheduling queue" className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[#d8dedb] px-5 py-5 sm:px-6">
          <div><h2 className="flex items-center gap-2 text-[22px] font-extrabold text-[#202522]"><ClipboardList size={18} className="text-[#167f6b]" /> Ready to schedule</h2><p className="mt-1 text-[11px] text-[#737a76]">{total.toLocaleString()} referral{total === 1 ? "" : "s"} ready for an appointment</p></div>
          <IconButton label="Close scheduling queue" onClick={onClose}><X size={16} /></IconButton>
        </header>
        <label className="mx-5 mt-4 flex h-10 items-center gap-2 border-b border-[#aeb7b2] sm:mx-6">
          <Search size={16} className="shrink-0 text-[#167f6b]" />
          <span className="sr-only">Search scheduling queue</span>
          <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search client, community, or assessor" className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-[#252a27] outline-none placeholder:text-[#959b98]" />
          {loading ? <RefreshCw size={13} className="animate-spin text-[#7b827e]" /> : null}
        </label>
        <div className="flex-1 overflow-y-auto px-5 py-3 sm:px-6">
          {items.length === 0 ? <div className="py-16 text-center"><CalendarClock size={21} className="mx-auto text-[#89918d]" /><div className="mt-3 text-[13px] font-extrabold text-[#343a36]">{search ? "No ready referrals match that search." : "No referrals are waiting to be scheduled."}</div></div> : (
            <ol>{items.map((item) => <li key={item.referralId} className="border-b border-[#e1e5e3] py-4 last:border-b-0"><div className="flex items-start justify-between gap-3"><button type="button" onClick={() => onOpenWorkspace(item)} className="min-w-0 text-left"><span className="block truncate text-[15px] font-extrabold text-[#252a27] hover:text-[#116b5a]">{calendarClientName(item.clientName, item.community)}</span><span className="mt-1 block truncate text-[12px] text-[#69706c]">{item.community} · {item.owner}</span></button><span className="shrink-0 text-[10px] font-bold text-[#7b827e]">{ageLabel(item.receivedDate)}</span></div><div className="mt-3 flex items-center justify-between gap-3"><span className="text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#176f5e]">{workflowLabels[item.workflowStatus]}</span><button type="button" onClick={() => onSchedule(item)} className="h-8 bg-[#167f6b] px-3 text-[10px] font-extrabold text-white hover:bg-[#116b5a]">Schedule</button></div></li>)}</ol>
          )}
        </div>
        {hasMore ? <div className="border-t border-[#d8dedb] p-4 sm:px-6"><button type="button" onClick={onLoadMore} disabled={loading} className="h-9 w-full border border-[#bfc7c3] text-[11px] font-extrabold text-[#343a36] hover:border-[#167f6b] hover:text-[#116b5a] disabled:opacity-50">{loading ? "Loading..." : "Load more"}</button></div> : null}
      </aside>
    </div>
  );
}

export function CalendarPortal({ children }: { children: ReactNode }) {
  return typeof document === "undefined" ? null : createPortal(children, document.body);
}

type CalendarViewsProps = {
  loading: boolean;
  view: CalendarView;
  anchor: string;
  scope: "personal" | "team";
  owner: string;
  mySchedule: boolean;
  range: { from: string; to: string };
  events: PipelineCalendarEvent[];
  unscheduled: PipelineUnscheduledAssessment[];
  assessors: Array<{ id?: string; name: string }>;
  eventsByDate: Map<string, PipelineCalendarEvent[]>;
  conflicts: Set<string>;
  hasFilters: boolean;
  onOpen: (event: PipelineCalendarEvent) => void;
  onFocusOwner: (owner: string) => void;
};

export function CalendarViews(props: CalendarViewsProps) {
  if (props.loading) return <CalendarSkeleton />;
  if (props.view === "month") return <MonthView month={props.anchor.slice(0, 7)} eventsByDate={props.eventsByDate} onOpen={props.onOpen} />;
  if (props.view === "agenda") return <AgendaView events={props.events} hasFilters={props.hasFilters} onOpen={props.onOpen} />;
  if (showTeamWeek(props.scope, props.owner, props.mySchedule)) return <TeamWeekView range={props.range} events={props.events} unscheduled={props.unscheduled} assessors={props.assessors} conflicts={props.conflicts} onOpen={props.onOpen} onFocusOwner={props.onFocusOwner} />;
  return <TimedWeekView range={props.range} eventsByDate={props.eventsByDate} onOpen={props.onOpen} />;
}

function MonthView({ month, eventsByDate, onOpen }: { month: string; eventsByDate: Map<string, PipelineCalendarEvent[]>; onOpen: (event: PipelineCalendarEvent) => void }) {
  const days = calendarDays(month);
  return (
    <div className="mt-3 overflow-x-auto border border-[#d8dedb]"><div className="grid min-w-[760px] grid-cols-7">
      {weekdays.map((day) => <div key={day} className="border-b border-r border-[#d8dedb] bg-[#f7f9f8] px-3 py-2 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#69706c] last:border-r-0">{day}</div>)}
      {days.map((day) => {
        const dayEvents = eventsByDate.get(day.date) ?? [];
        const scheduled = dayEvents.filter((event) => event.kind === "assessment");
        const followUps = dayEvents.length - scheduled.length;
        return <div key={day.date} className={`min-h-[112px] border-b border-r border-[#e1e5e3] p-2 last:border-r-0 ${day.inMonth ? "bg-white" : "bg-[#fafbfa]"}`}><div className={`mb-2 text-[11px] font-extrabold ${day.today ? "text-[#0f8b73]" : day.inMonth ? "text-[#515854]" : "text-[#a0a6a2]"}`}>{day.day}</div><div className="space-y-1.5">{scheduled.slice(0, 2).map((event) => <CalendarEventButton key={event.id} event={event} onOpen={onOpen} compact />)}{followUps > 0 ? <div className="px-1 text-[10px] font-bold text-[#8a5c14]">{followUps} follow-up{followUps === 1 ? "" : "s"}</div> : null}{scheduled.length > 2 ? <div className="px-1 text-[10px] font-bold text-[#526a63]">+{scheduled.length - 2} assessments</div> : null}</div></div>;
      })}
    </div></div>
  );
}

function TimedWeekView({ range, eventsByDate, onOpen }: { range: { from: string; to: string }; eventsByDate: Map<string, PipelineCalendarEvent[]>; onOpen: (event: PipelineCalendarEvent) => void }) {
  const dates = dateKeys(range.from, range.to);
  const hours = Array.from({ length: weekEndHour - weekStartHour }, (_, index) => weekStartHour + index);
  return (
    <section aria-label="Timed assessment week" className="mt-3 overflow-auto border border-[#d8dedb]"><div className="min-w-[980px]">
      <div className="grid grid-cols-[62px_repeat(7,minmax(125px,1fr))] border-b border-[#d8dedb] bg-[#f7f9f8]"><div />{dates.map((date) => <div key={date} className={`border-l border-[#d8dedb] px-3 py-2.5 ${date === todayKey() ? "bg-[#eaf5f1]" : ""}`}><span className="block text-[9px] font-extrabold uppercase tracking-[0.07em] text-[#737a76]">{weekdays[parseDate(date).getUTCDay()]}</span><span className="mt-0.5 block text-[13px] font-extrabold text-[#252a27]">{shortDate(date)}</span></div>)}</div>
      <div className="grid grid-cols-[62px_repeat(7,minmax(125px,1fr))] border-b border-[#d8dedb] bg-white"><div className="px-2 py-2 text-right text-[9px] font-bold uppercase text-[#8a918d]">All day</div>{dates.map((date) => { const allDay = (eventsByDate.get(date) ?? []).filter((event) => !event.startsAt || event.kind !== "assessment"); return <div key={date} className="min-h-12 border-l border-[#e1e5e3] p-1.5">{allDay.slice(0, 2).map((event) => <CalendarEventButton key={event.id} event={event} onOpen={onOpen} compact />)}{allDay.length > 2 ? <button type="button" onClick={() => onOpen(allDay[2])} className="mt-1 text-[9px] font-bold text-[#526a63]">+{allDay.length - 2} more</button> : null}</div>; })}</div>
      <div className="grid grid-cols-[62px_repeat(7,minmax(125px,1fr))]"><div className="relative" style={{ height: hours.length * hourHeight }}>{hours.map((hour, index) => <span key={hour} className="absolute right-2 -translate-y-1/2 text-[10px] font-semibold text-[#7b827e]" style={{ top: index * hourHeight }}>{formatHour(hour)}</span>)}</div>{dates.map((date) => { const timed = (eventsByDate.get(date) ?? []).filter((event) => event.kind === "assessment" && event.startsAt); return <div key={date} className={`relative border-l border-[#d8dedb] ${date === todayKey() ? "bg-[#fbfefd]" : "bg-white"}`} style={{ height: hours.length * hourHeight }}>{hours.map((hour, index) => <div key={hour} className="absolute inset-x-0 border-t border-[#edf0ee]" style={{ top: index * hourHeight }} />)}{timed.map((event) => { const position = timedEventPosition(event, timed); if (!position) return null; return <button key={event.id} type="button" onClick={() => onOpen(event)} title={`${calendarClientName(event.clientName, event.community)} - ${event.title}`} className={`absolute z-10 overflow-hidden border-l-[3px] px-2 py-1.5 text-left shadow-sm hover:z-20 hover:ring-1 hover:ring-[#4b68ad] ${event.status === "overdue" ? "border-l-[#a9473d] bg-[#fff3f1] text-[#7c3229]" : eventColors.assessment}`} style={position}><span className="block truncate text-[10px] font-extrabold">{eventTime(event.startsAt)}</span><span className="mt-0.5 block truncate text-[11px] font-extrabold">{calendarClientName(event.clientName, event.community)}</span><span className="mt-0.5 block truncate text-[9px] opacity-75">{methodLabel(event.method)} - {event.durationMinutes ?? 60} min</span></button>; })}</div>; })}</div>
    </div></section>
  );
}

function TeamWeekView({ range, events, unscheduled, assessors, conflicts, onOpen, onFocusOwner }: { range: { from: string; to: string }; events: PipelineCalendarEvent[]; unscheduled: PipelineUnscheduledAssessment[]; assessors: Array<{ id?: string; name: string }>; conflicts: Set<string>; onOpen: (event: PipelineCalendarEvent) => void; onFocusOwner: (owner: string) => void }) {
  const dates = dateKeys(range.from, range.to);
  const owners = uniqueOwnerOptions([...assessors, ...events.map((event) => ({ id: event.ownerId, name: event.owner })), ...unscheduled.map((item) => ({ id: item.ownerId, name: item.owner }))]).filter((item) => item.label !== "Unassigned");
  if (owners.length === 0) return <EmptyCalendar title="No team work is scheduled in this week." />;
  return (
    <section aria-label="Supervisor team week" className="mt-3 overflow-auto border border-[#d8dedb]"><div className="min-w-[1080px]">
      <div className="sticky top-0 z-10 grid grid-cols-[190px_repeat(7,minmax(118px,1fr))] border-b border-[#d8dedb] bg-[#f7f9f8]"><div className="sticky left-0 z-20 bg-[#f7f9f8] px-3 py-3 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#69706c]">Assessor</div>{dates.map((date) => <div key={date} className={`border-l border-[#d8dedb] px-2 py-2.5 ${date === todayKey() ? "bg-[#eaf5f1]" : ""}`}><span className="block text-[9px] font-extrabold uppercase text-[#737a76]">{weekdays[parseDate(date).getUTCDay()]}</span><span className="block text-[12px] font-extrabold text-[#252a27]">{shortDate(date)}</span></div>)}</div>
      {owners.map((assessor) => { const ownerEvents = events.filter((event) => ownerKey(event.ownerId, event.owner) === assessor.value); const ownerQueue = unscheduled.filter((item) => ownerKey(item.ownerId, item.owner) === assessor.value); const conflictCount = ownerEvents.filter((event) => conflicts.has(event.id)).length; const scheduledCount = ownerEvents.filter((event) => event.kind === "assessment").length; return <div key={assessor.value} className="grid grid-cols-[190px_repeat(7,minmax(118px,1fr))] border-b border-[#e1e5e3] last:border-b-0"><button type="button" onClick={() => onFocusOwner(assessor.value)} className="sticky left-0 z-[5] bg-white px-3 py-3 text-left hover:bg-[#f4f8f6]"><span className="block truncate text-[12px] font-extrabold text-[#252a27]">{assessor.label}</span><span className="mt-1 block text-[10px] text-[#737a76]">{scheduledCount} scheduled · {ownerQueue.length} waiting</span>{conflictCount > 0 ? <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-extrabold text-[#9c3d32]"><AlertTriangle size={11} /> {Math.ceil(conflictCount / 2)} conflict{conflictCount > 2 ? "s" : ""}</span> : null}</button>{dates.map((date) => { const dayEvents = ownerEvents.filter((event) => event.date === date); const appointments = dayEvents.filter((event) => event.kind === "assessment"); const followUps = dayEvents.length - appointments.length; return <div key={date} className={`min-h-[118px] border-l border-[#e1e5e3] p-1.5 ${appointments.length >= 5 ? "bg-[#fff9ef]" : "bg-white"}`}>{appointments.slice(0, 3).map((event) => <CalendarEventButton key={event.id} event={event} onOpen={onOpen} compact conflict={conflicts.has(event.id)} />)}{appointments.length > 3 ? <button type="button" onClick={() => onOpen(appointments[3])} className="mt-1 text-[9px] font-bold text-[#526a63]">+{appointments.length - 3} more</button> : null}{followUps > 0 ? <div className="mt-1 text-[9px] font-semibold text-[#8a5c14]">{followUps} follow-up{followUps === 1 ? "" : "s"}</div> : null}</div>; })}</div>; })}
    </div></section>
  );
}

function AgendaView({ events, hasFilters, onOpen }: { events: PipelineCalendarEvent[]; hasFilters: boolean; onOpen: (event: PipelineCalendarEvent) => void }) {
  const groups = groupEventsByDate(events);
  if (events.length === 0) return <EmptyCalendar title={hasFilters ? "No work matches these filters." : "No calendar work falls in this range."} />;
  return <div className="mt-3 border border-[#d8dedb]">{[...groups.entries()].map(([date, dayEvents]) => <section key={date} className="border-b border-[#e1e5e3] last:border-b-0 md:grid md:grid-cols-[150px_minmax(0,1fr)]"><div className="bg-[#f7f9f8] px-3 py-3 md:px-4"><div className="text-[12px] font-extrabold text-[#252a27]">{longDate(date)}</div><div className="mt-0.5 text-[10px] font-bold text-[#69706c]">{dayEvents.length} item{dayEvents.length === 1 ? "" : "s"}</div></div><div className="divide-y divide-[#e5e8e6]">{dayEvents.map((event) => <button key={event.id} type="button" onClick={() => onOpen(event)} className="grid w-full gap-1 px-3 py-3 text-left hover:bg-[#f7faf9] sm:grid-cols-[minmax(0,1fr)_130px] sm:px-4 lg:grid-cols-[minmax(0,1fr)_150px_150px]"><span className="min-w-0"><span className="block truncate text-[13px] font-extrabold text-[#252a27]">{calendarClientName(event.clientName, event.community)}</span><span className="mt-1 block truncate text-[11px] text-[#69706c]">{event.startsAt ? `${eventTime(event.startsAt)} - ` : ""}{event.title}</span></span><span className="truncate text-[11px] font-semibold text-[#59615d]">{event.community}</span><span className="hidden truncate text-[11px] text-[#737a76] lg:block">{event.owner}</span></button>)}</div></section>)}</div>;
}

type CalendarOverlaysProps = {
  selected: CalendarSelection | null;
  scheduleTarget: ScheduleTarget | null;
  scheduleStart: string;
  scheduleDuration: string;
  scheduleMethod: AssessmentScheduleMethod;
  scheduleLocation: string;
  mutationState: { busy: boolean; error: string; message: string; canOverride: boolean };
  scope: "personal" | "team";
  onCloseSelection: () => void;
  onCloseSchedule: () => void;
  onOpenWorkspace: () => void;
  onScheduleSelection: () => void;
  onStatus: (status: "cancelled" | "no_show") => void;
  onStart: (value: string) => void;
  onDuration: (value: string) => void;
  onMethod: (value: AssessmentScheduleMethod) => void;
  onLocation: (value: string) => void;
  onSave: () => void;
  onOverride: () => void;
};

export function CalendarOverlays(props: CalendarOverlaysProps) {
  return <>{props.selected ? <CalendarDrawer selection={props.selected} busy={props.mutationState.busy} scope={props.scope} onClose={props.onCloseSelection} onOpenWorkspace={props.onOpenWorkspace} onSchedule={props.onScheduleSelection} onStatus={props.onStatus} /> : null}{props.scheduleTarget ? <ScheduleDialog target={props.scheduleTarget} start={props.scheduleStart} duration={props.scheduleDuration} method={props.scheduleMethod} location={props.scheduleLocation} state={props.mutationState} onStart={props.onStart} onDuration={props.onDuration} onMethod={props.onMethod} onLocation={props.onLocation} onClose={props.onCloseSchedule} onSave={props.onSave} onOverride={props.onOverride} /> : null}</>;
}

function CalendarDrawer({ selection, busy, scope, onClose, onOpenWorkspace, onSchedule, onStatus }: { selection: CalendarSelection; busy: boolean; scope: "personal" | "team"; onClose: () => void; onOpenWorkspace: () => void; onSchedule: () => void; onStatus: (status: "cancelled" | "no_show") => void }) {
  const model = calendarDrawerModel(selection, scope);
  return (
    <div className="fixed inset-0 z-[100] bg-[#18201d]/30" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside role="dialog" aria-modal="true" aria-label="Calendar item" className="absolute inset-y-0 right-0 flex w-full max-w-[430px] flex-col border-l border-[#cfd5d2] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#d8dedb] p-5">
          <div className="min-w-0"><span className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#167f6b]">{model.kicker}</span><h2 className="mt-1.5 truncate text-[20px] font-extrabold tracking-[-0.025em] text-[#202522]">{model.clientName}</h2></div>
          <IconButton label="Close calendar item" onClick={onClose}><X size={16} /></IconButton>
        </div>
        <CalendarDrawerDetails model={model} />
        <CalendarDrawerActions model={model} busy={busy} onOpenWorkspace={onOpenWorkspace} onSchedule={onSchedule} onStatus={onStatus} />
      </aside>
    </div>
  );
}

function CalendarDrawerDetails({ model }: { model: CalendarDrawerModel }) {
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-3 text-[12px]">
        <dt className="font-bold text-[#777e7a]">Community</dt><dd className="font-semibold text-[#2d332f]">{model.community}</dd>
        <dt className="font-bold text-[#777e7a]">Assessor</dt><dd className="font-semibold text-[#2d332f]">{model.owner}</dd>
        {model.dateLabel ? <><dt className="font-bold text-[#777e7a]">Date</dt><dd className="font-semibold text-[#2d332f]">{model.dateLabel}</dd></> : null}
        {model.isAppointment ? <><dt className="font-bold text-[#777e7a]">Method</dt><dd className="font-semibold text-[#2d332f]">{model.methodLabel}</dd><dt className="font-bold text-[#777e7a]">Duration</dt><dd className="font-semibold text-[#2d332f]">{model.durationLabel}</dd></> : null}
        {model.receivedLabel ? <><dt className="font-bold text-[#777e7a]">Received</dt><dd className="font-semibold text-[#2d332f]">{model.receivedLabel}</dd></> : null}
      </dl>
      {model.followUps.length > 0 ? <div className="mt-5 border-l-2 border-[#a16a16] bg-[#fff8ed] p-3"><div className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-[#8a5c14]">Follow-ups</div>{model.followUps.map((label) => <div key={label} className="mt-1.5 text-[12px] text-[#4b4030]">{label}</div>)}</div> : null}
      {model.needsAssignment ? <div className="mt-5 border-l-2 border-[#a9473d] bg-[#fff3f1] p-3 text-[12px] text-[#7c3229]">Assign this referral before an assessment can be scheduled.</div> : null}
    </div>
  );
}

function CalendarDrawerActions({ model, busy, onOpenWorkspace, onSchedule, onStatus }: { model: CalendarDrawerModel; busy: boolean; onOpenWorkspace: () => void; onSchedule: () => void; onStatus: (status: "cancelled" | "no_show") => void }) {
  return (
    <div className="space-y-2 border-t border-[#d8dedb] p-4">
      {model.zoomUrl ? <a href={model.zoomUrl} target="_blank" rel="noreferrer" className="flex h-10 w-full items-center justify-center gap-2 bg-[#4b68ad] text-[12px] font-extrabold text-white hover:bg-[#3d578f]"><Video size={15} /> Join Zoom <ExternalLink size={13} /></a> : null}
      {model.canSchedule ? <button type="button" onClick={onSchedule} className="flex h-10 w-full items-center justify-center gap-2 bg-[#167f6b] text-[12px] font-extrabold text-white hover:bg-[#116b5a]"><CalendarClock size={15} /> {model.isAppointment ? "Reschedule" : "Schedule assessment"}</button> : null}
      <button type="button" onClick={onOpenWorkspace} className="flex h-10 w-full items-center justify-center gap-2 border border-[#cfd5d2] text-[12px] font-extrabold text-[#343a36] hover:border-[#167f6b] hover:text-[#116b5a]"><FolderOpen size={15} /> Open workspace</button>
      {model.showStatusActions ? <div className="grid grid-cols-2 gap-2 pt-2"><button type="button" disabled={busy} onClick={() => onStatus("no_show")} className="h-9 border border-[#d8dedb] text-[11px] font-bold text-[#8a5c14] hover:bg-[#fff8ed] disabled:opacity-50">Mark no-show</button><button type="button" disabled={busy} onClick={() => onStatus("cancelled")} className="h-9 border border-[#d8dedb] text-[11px] font-bold text-[#9c3d32] hover:bg-[#fff3f1] disabled:opacity-50">Cancel appointment</button></div> : null}
    </div>
  );
}

function ScheduleDialog({ target, start, duration, method, location, state, onStart, onDuration, onMethod, onLocation, onClose, onSave, onOverride }: { target: ScheduleTarget; start: string; duration: string; method: AssessmentScheduleMethod; location: string; state: { busy: boolean; error: string; message: string; canOverride: boolean }; onStart: (value: string) => void; onDuration: (value: string) => void; onMethod: (value: AssessmentScheduleMethod) => void; onLocation: (value: string) => void; onClose: () => void; onSave: () => void; onOverride: () => void }) {
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#18201d]/35 p-3" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !state.busy) onClose(); }}><section role="dialog" aria-modal="true" aria-labelledby="schedule-title" className="w-full max-w-[520px] border border-[#cfd5d2] bg-white shadow-2xl"><div className="flex items-start justify-between border-b border-[#d8dedb] p-5"><div><span className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#167f6b]">{target.reschedule ? "Reschedule assessment" : "Schedule assessment"}</span><h2 id="schedule-title" className="mt-1 text-[20px] font-extrabold text-[#202522]">{calendarClientName(target.clientName, target.community)}</h2><p className="mt-1 text-[11px] text-[#737a76]">Times shown in Pacific Time.</p></div><IconButton label="Close scheduling" onClick={onClose} disabled={state.busy}><X size={16} /></IconButton></div><div className="grid gap-4 p-5 sm:grid-cols-2"><label className="sm:col-span-2"><span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#626a66]">Date and time</span><input type="datetime-local" value={start} onChange={(event) => onStart(event.target.value)} className="h-10 w-full border border-[#cfd5d2] bg-white px-3 text-[12px] text-[#252a27] outline-none focus:border-[#167f6b]" /></label><label><span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#626a66]">Duration</span><select value={duration} onChange={(event) => onDuration(event.target.value)} className="h-10 w-full border border-[#cfd5d2] bg-white px-3 text-[12px] text-[#252a27] outline-none focus:border-[#167f6b]"><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option><option value="120">2 hours</option></select></label><label><span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#626a66]">Method</span><select value={method} onChange={(event) => onMethod(event.target.value as AssessmentScheduleMethod)} className="h-10 w-full border border-[#cfd5d2] bg-white px-3 text-[12px] text-[#252a27] outline-none focus:border-[#167f6b]"><option value="zoom">Zoom</option><option value="in_person">In person</option><option value="phone">Phone</option><option value="record_review">Record review</option></select></label><label className="sm:col-span-2"><span className="mb-1.5 block text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#626a66]">{method === "zoom" ? "Zoom link" : method === "in_person" ? "Location" : "Details"}</span><input type={method === "zoom" ? "url" : "text"} value={location} onChange={(event) => onLocation(event.target.value)} placeholder={method === "zoom" ? "https://zoom.us/j/..." : "Optional"} className="h-10 w-full border border-[#cfd5d2] bg-white px-3 text-[12px] text-[#252a27] outline-none focus:border-[#167f6b]" /></label>{state.error ? <div role="alert" className="sm:col-span-2 border-l-2 border-[#a9473d] bg-[#fff3f1] px-3 py-2.5 text-[12px] text-[#7c3229]">{state.error}</div> : null}</div><div className="flex flex-wrap justify-end gap-2 border-t border-[#d8dedb] p-4"><button type="button" disabled={state.busy} onClick={onClose} className="h-9 px-4 text-[11px] font-bold text-[#606763] hover:text-[#202522] disabled:opacity-50">Cancel</button>{state.canOverride ? <button type="button" disabled={state.busy} onClick={onOverride} className="h-9 border border-[#a9473d] px-4 text-[11px] font-extrabold text-[#9c3d32] hover:bg-[#fff3f1] disabled:opacity-50">Schedule anyway</button> : null}<button type="button" disabled={state.busy || !start} onClick={onSave} className="h-9 bg-[#167f6b] px-5 text-[11px] font-extrabold text-white hover:bg-[#116b5a] disabled:opacity-50">{state.busy ? "Saving..." : target.reschedule ? "Save new time" : "Schedule"}</button></div></section></div>;
}

function CalendarEventButton({ event, onOpen, compact = false, conflict = false }: { event: PipelineCalendarEvent; onOpen: (event: PipelineCalendarEvent) => void; compact?: boolean; conflict?: boolean }) {
  const color = event.status === "overdue" ? "border-l-[#a9473d] bg-[#fff3f1] text-[#7c3229]" : eventColors[event.kind];
  return <button type="button" onClick={() => onOpen(event)} title={`${calendarClientName(event.clientName, event.community)} - ${event.title} - ${event.owner}`} className={`block w-full border-l-2 px-2 text-left ${compact ? "py-1.5" : "py-2"} ${color} ${conflict ? "ring-1 ring-[#a9473d]" : ""}`}><span className={`block truncate font-extrabold ${compact ? "text-[10px]" : "text-[12px]"}`}>{event.startsAt && compact ? `${eventTime(event.startsAt)} ` : ""}{calendarClientName(event.clientName, event.community)}</span><span className={`mt-0.5 block truncate opacity-80 ${compact ? "text-[9px]" : "text-[10px]"}`}>{conflict ? "Conflict - " : ""}{event.title}</span></button>;
}

function CalendarFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <select aria-label={`Filter calendar by ${label}`} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 min-w-0 border border-[#cfd5d2] bg-white px-2.5 text-[12px] font-semibold text-[#303632] outline-none focus:border-[#167f6b]"><option value="">All {label === "community" ? "communities" : "owners"}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
}

function OwnerFilter({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <select aria-label="Filter calendar by assessor" value={value} onChange={(event) => onChange(event.target.value)} className="h-9 min-w-0 border border-[#cfd5d2] bg-white px-2.5 text-[12px] font-semibold text-[#303632] outline-none focus:border-[#167f6b]"><option value="">All assessors</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}

function IconButton({ label, onClick, disabled = false, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#cfd5d2] text-[#626a66] hover:border-[#167f6b] hover:text-[#116b5a] disabled:opacity-50">{children}</button>;
}

function CalendarSkeleton() {
  return <div className="mt-3 animate-pulse border border-[#d8dedb] p-4"><div className="h-10 bg-[#eef1ef]" /><div className="mt-3 grid grid-cols-3 gap-3"><div className="h-52 bg-[#f4f6f5]" /><div className="h-52 bg-[#f4f6f5]" /><div className="h-52 bg-[#f4f6f5]" /></div></div>;
}

function EmptyCalendar({ title }: { title: string }) {
  return <div className="mt-3 border border-[#d8dedb] px-4 py-16 text-center"><CalendarClock size={22} className="mx-auto text-[#8a918d]" /><div className="mt-3 text-[13px] font-extrabold text-[#343a36]">{title}</div></div>;
}
