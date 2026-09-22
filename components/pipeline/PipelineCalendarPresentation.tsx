import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import FeedbackCue from "@/components/pipeline/FeedbackCue";
import { AssessmentScheduleLayout } from "@/components/pipeline/AssessmentSchedulingDialogs";
import type { ReactNode } from "react";
import calendarStyles from "./CalendarWork.module.css";
import { usePhoneAssessment as usePhoneLayout } from "./use-phone-layout";
const CalendarWorkDetails = dynamic(() => import("./CalendarWorkDetails"), { loading: () => <p className="p-5 text-sm text-[#626b65]">Loading workspace details…</p> });
import {
  AlertTriangle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  Filter,
  FilePenLine,
  FolderOpen,
  RefreshCw,
  Search,
  Video,
  X,
} from "lucide-react";

import type { AssessmentScheduleMethod } from "@/lib/assessment/assessment-records";
import type { PipelineCalendarEvent, PipelineCalendarEventKind, PipelineUnscheduledAssessment } from "@/lib/pipeline/calendar-types";
import { workflowStatusLabels } from "@/lib/pipeline/workflow-status";
import { assessmentEventNextStep, unscheduledNextStep } from "@/lib/pipeline/assessment-calendar";
import {
  ageLabel,
  appointmentLocationLabel,
  appointmentStatusLabel,
  calendarClientName,
  calendarDays,
  calendarDrawerModel,
  calendarEmptyState,
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
const workflowLabels: Record<PipelineUnscheduledAssessment["workflowStatus"], string> = {
  intake_unassigned: "Needs an assessor",
  intake_documents_needed: "Documents needed",
  profile_incomplete: "Intake incomplete",
  ready_to_schedule: workflowStatusLabels.ready_to_schedule,
  assessment_scheduled: "Assessment scheduled",
  assessment_in_progress: "Assessment in progress",
  waiting_for_information: "Waiting for information",
  assessment_ready_to_sign: "Ready to sign",
  assessment_signed: "Assessment signed",
  recommendation_submitted: "Recommendation submitted",
  decision_pending: "Decision pending",
  changes_requested: "Changes requested",
  approved_for_placement: "Approved for placement",
  accepted: "Accepted",
  admitted: "Admitted",
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
  mySchedule: boolean;
  showFilters: boolean;
  hasFilters: boolean;
  loading: boolean;
  refreshing: boolean;
  busy: boolean;
  message: string;
  queueCount: number;
  queueOpen: boolean;
  scheduledCount: number;
  overdueCount: number;
  onView: (value: CalendarView) => void;
  onAnchor: (value: string) => void;
  onCommunity: (value: string) => void;
  onOwner: (value: string) => void;
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
  };
  const chooseScope = (mine: boolean) => {
    props.onMySchedule(mine);
    props.onOwner("");
  };
  return (
    <header aria-label="Calendar controls" className={`pipeline-commands ${calendarStyles.header}`}>
      <div className={calendarStyles.toolbar}>
        <div className={calendarStyles.rangeControls}>
          <div className={calendarStyles.rangeSummary}>
            <h1 className={calendarStyles.rangeTitle}>{rangeLabel(props.view, props.range)}<FeedbackCue value={`${props.view}:${props.anchor}`} /></h1>
            <div className={calendarStyles.summary}>
              <span>{props.scope === "personal" || props.mySchedule ? "My schedule" : "Team schedule"}</span>
              <span>{props.scheduledCount.toLocaleString()} scheduled</span>
              <abbr title="Pacific Time">PT</abbr>
            </div>
          </div>
          <div role="group" aria-label="Calendar dates" className={calendarStyles.dateNavigation}>
          <IconButton label="Previous calendar range" onClick={() => props.onAnchor(shiftAnchor(props.view, props.anchor, -1))}><ChevronLeft size={17} /></IconButton>
          <IconButton label="Next calendar range" onClick={() => props.onAnchor(shiftAnchor(props.view, props.anchor, 1))}><ChevronRight size={17} /></IconButton>
          <button type="button" onClick={() => props.onAnchor(todayKey())} className={calendarStyles.today}>Today</button>
          </div>
        </div>
        <div className={calendarStyles.headerActions}>
          {props.scope === "team" ? <CalendarScopeSwitch className={calendarStyles.headerScope} mine={props.mySchedule} onChoose={chooseScope} /> : null}
          <CalendarViewSwitch view={props.view} onView={props.onView} />
          <button type="button" aria-label={`Scheduling queue ${props.queueCount.toLocaleString()}`} aria-haspopup="dialog" aria-expanded={props.queueOpen} onClick={props.onOpenQueue} className={calendarStyles.queueButton}>
            <ClipboardList size={15} />
            <span><span className={calendarStyles.queueDetail}>Scheduling </span>queue</span>
            <span className="tabular-nums text-[#116b5a]">{props.queueCount.toLocaleString()}</span>
          </button>
          <button type="button" aria-label="Show calendar filters" aria-expanded={props.showFilters} onClick={() => props.onShowFilters(!props.showFilters)} className={`${calendarStyles.filterToggle} ${props.hasFilters ? "text-[#116b5a]" : "text-[#626a66]"}`}><Filter size={16} /></button>
        </div>
      </div>
      <CalendarFilters {...props} onClear={clearFilters} />
      <div className={calendarStyles.statusStrip} data-visible={Boolean(status) || props.overdueCount > 0}>
        {props.overdueCount > 0 ? <span className="text-[#9c3d32]"><strong>{props.overdueCount.toLocaleString()}</strong> need{props.overdueCount === 1 ? "s" : ""} completion</span> : null}
        <span role="status" aria-live="polite" className="relative ml-auto min-w-0 text-right font-normal">{status}<FeedbackCue value={props.message} enabled={Boolean(props.message) && !props.busy && !props.loading && !props.refreshing} /></span>
      </div>
    </header>
  );
}

function CalendarViewSwitch({ view, onView }: { view: CalendarView; onView: (value: CalendarView) => void }) {
  return <div data-guide-target="calendar-view" className={calendarStyles.viewControl}>
    <div role="group" aria-label="Calendar view" className={calendarStyles.viewSwitch}>{(["week", "month"] as const).map((option) => <button key={option} type="button" aria-pressed={view === option} onClick={() => onView(option)}>{option}</button>)}</div>
    <select aria-label="Calendar view" value={view} onChange={(event) => onView(event.target.value as CalendarView)} className={calendarStyles.viewSelect}>
      <option value="week">Week</option><option value="month">Month</option>
    </select>
  </div>;
}

// Viewing Team only changes what is shown; ownership and access stay server-enforced.
function CalendarScopeSwitch({ mine, onChoose, className }: { mine: boolean; onChoose: (mine: boolean) => void; className: string }) {
  return <div role="group" aria-label="Whose schedule" className={`${calendarStyles.scopeSwitch} ${className}`}>
    <button type="button" aria-pressed={mine} onClick={() => onChoose(true)}>Mine</button>
    <button type="button" aria-pressed={!mine} onClick={() => onChoose(false)}>Team</button>
  </div>;
}

function CalendarFilters(props: CalendarHeaderProps & { onClear: () => void }) {
  return (
    <div data-guide-target="calendar-filters" data-expanded={props.showFilters} className={calendarStyles.filters}>
      {props.scope === "team" ? <CalendarScopeSwitch className={calendarStyles.filterScope} mine={props.mySchedule} onChoose={(mine) => { props.onMySchedule(mine); props.onOwner(""); }} /> : null}
      <CalendarFilter label="community" value={props.community} onChange={props.onCommunity} options={props.communityOptions} />
      {props.scope === "team" && !props.mySchedule ? <OwnerFilter value={props.owner} onChange={props.onOwner} options={props.ownerOptions} /> : null}
      {props.hasFilters ? <button type="button" onClick={props.onClear} className="flex h-8 items-center gap-1 px-2 text-[10px] font-bold text-[#6d7470] hover:text-[#9c3d32]"><X size={12} /> Clear</button> : null}
      <IconButton label="Refresh calendar" onClick={props.onRefresh}><RefreshCw size={14} className={props.refreshing ? "animate-spin" : ""} /></IconButton>
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
      <aside role="dialog" aria-modal="true" aria-label="Scheduling queue" className="pipeline-panel-enter absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-[#d8dedb] px-5 py-5 sm:px-6">
          <div><h2 className="flex items-center gap-2 text-[22px] font-extrabold text-[#202522]"><ClipboardList size={18} className="text-[#167f6b]" /> Scheduling queue</h2><p className="mt-1 text-[13px] text-[#737a76]">{total.toLocaleString()} referral{total === 1 ? "" : "s"}</p></div>
          <IconButton label="Close scheduling queue" onClick={onClose}><X size={16} /></IconButton>
        </header>
        <label className="mx-5 mt-4 flex h-10 items-center gap-2 border-b border-[#aeb7b2] sm:mx-6">
          <Search size={16} className="shrink-0 text-[#167f6b]" />
          <span className="sr-only">Search scheduling queue</span>
          <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search client, community, or assessor" className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-[#252a27] outline-none placeholder:text-[#959b98]" />
          {loading ? <RefreshCw size={13} className="animate-spin text-[#7b827e]" /> : null}
        </label>
        <div className="flex-1 overflow-y-auto px-5 py-3 sm:px-6">
          {items.length === 0 ? <div className="py-16 text-center"><CalendarClock size={21} className="mx-auto text-[#89918d]" /><div className="mt-3 text-[14px] font-extrabold text-[#343a36]">{loading ? "Loading referrals..." : search ? "No referrals match that search." : "No referrals are waiting to be scheduled."}</div></div> : (
            <ol>{items.map((item) => <li key={item.referralId} className="border-b border-[#e1e5e3] py-5 last:border-b-0">
              <div className="flex items-start justify-between gap-3"><button type="button" onClick={() => onOpenWorkspace(item)} className="min-w-0 text-left"><span className="block break-words text-[17px] font-extrabold text-[#252a27] hover:text-[#116b5a]">{calendarClientName(item.clientName, item.community)}</span><span className="mt-1 block text-[13px] text-[#69706c]">{[item.community, item.owner].filter(Boolean).join(" · ")}</span></button><span className="shrink-0 text-[11px] font-bold text-[#7b827e]">{ageLabel(item.receivedDate)}</span></div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className="text-[12px] font-bold text-[#176f5e]">{preparationLabel(item)}</span><div className="flex flex-wrap gap-2">
                {item.nextAction !== "schedule" ? <button type="button" onClick={() => onOpenWorkspace(item)} className="min-h-11 px-3 text-[12px] font-bold text-[#176f5e]">{unscheduledNextStep(item.nextAction).label}</button> : null}
                <button type="button" onClick={() => onSchedule(item)} className="min-h-11 rounded-md bg-[#167f6b] px-3 text-[12px] font-extrabold text-white hover:bg-[#116b5a]">{unscheduledNextStep("schedule").label}</button>
              </div></div>
            </li>)}</ol>
          )}
        </div>
        {hasMore ? <div className="border-t border-[#d8dedb] p-4 sm:px-6"><button type="button" onClick={onLoadMore} disabled={loading} className="h-9 w-full border border-[#bfc7c3] text-[11px] font-extrabold text-[#343a36] hover:border-[#167f6b] hover:text-[#116b5a] disabled:opacity-50">{loading ? "Loading..." : "Load more"}</button></div> : null}
      </aside>
    </div>
  );
}

function preparationLabel(item: PipelineUnscheduledAssessment) {
  if (item.nextAction === "complete_contact") return "Contact needed";
  return workflowLabels[item.workflowStatus];
}

export function CalendarPortal({ children }: { children: ReactNode }) {
  return typeof document === "undefined" ? null : createPortal(children, document.body);
}

type CalendarViewsProps = {
  loading: boolean;
  failed: boolean;
  view: CalendarView;
  anchor: string;
  scope: "personal" | "team";
  owner: string;
  ownerLabel?: string;
  community: string;
  mySchedule: boolean;
  range: { from: string; to: string };
  events: PipelineCalendarEvent[];
  unscheduled: PipelineUnscheduledAssessment[];
  assessors: Array<{ id?: string; name: string }>;
  eventsByDate: Map<string, PipelineCalendarEvent[]>;
  conflicts: Set<string>;
  onOpen: (event: PipelineCalendarEvent) => void;
  onAssessment: (event: PipelineCalendarEvent) => void;
  onFocusOwner: (owner: string) => void;
  onViewTeam: () => void;
  onAllAssessors: () => void;
  onAllCommunities: () => void;
  onDate: (date: string) => void;
};

export function CalendarViews(props: CalendarViewsProps) {
  const phone = usePhoneLayout();
  if (props.loading) return <CalendarSkeleton />;
  // A failed first load is not an empty schedule; the alert above offers Try again.
  if (props.failed) return <EmptyCalendar title="Appointments could not be loaded." detail="Nothing is shown until the calendar loads. Use Try again above." />;
  const empty = props.events.length === 0 ? <CalendarEmptyNotice {...props} /> : null;
  if (props.view === "month") return <>{empty}<MonthView month={props.anchor.slice(0, 7)} eventsByDate={props.eventsByDate} onOpen={props.onOpen} onDate={props.onDate} phone={phone} /></>;
  if (phone) return empty ?? <WeekList events={props.events} scope={props.scope} onOpen={props.onOpen} onAssessment={props.onAssessment} onDate={props.onDate} />;
  if (showTeamWeek(props.scope, props.owner, props.mySchedule)) return <>{empty}<TeamWeekView range={props.range} events={props.events} unscheduled={props.unscheduled} assessors={props.assessors} conflicts={props.conflicts} onOpen={props.onOpen} onFocusOwner={props.onFocusOwner} onDate={props.onDate} /></>;
  const outsideGrid = props.events.filter((event) => !timedEventPosition(event, [event]));
  return <>
    {empty}
    {outsideGrid.length ? <section aria-label="Other appointment times" className={calendarStyles.dateDetails}><h2>Other appointment times</h2><ol className="divide-y divide-[#e5e8e6]">{outsideGrid.map((event) => <li key={event.id}><span className="text-[12px] text-[#626b65]">{longDate(event.date)}</span><ol><AppointmentRow event={event} scope={props.scope} onOpen={props.onOpen} onAssessment={props.onAssessment} /></ol></li>)}</ol></section> : null}
    <TimedWeekView range={props.range} eventsByDate={props.eventsByDate} onOpen={props.onOpen} onDate={props.onDate} />
  </>;
}

function MonthView({ month, eventsByDate, onOpen, onDate, phone }: { month: string; eventsByDate: Map<string, PipelineCalendarEvent[]>; onOpen: (event: PipelineCalendarEvent) => void; onDate: (date: string) => void; phone: boolean }) {
  const days = calendarDays(month);
  return (
    <div className={calendarStyles.monthGrid} data-phone={phone}><div className="grid min-w-[760px] grid-cols-7">
      {weekdays.map((day) => <div key={day} className="border-b border-r border-[#d8dedb] bg-[#f7f9f8] px-3 py-2 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#69706c] last:border-r-0">{day}</div>)}
      {days.map((day) => {
        const dayEvents = eventsByDate.get(day.date) ?? [];
        const scheduled = dayEvents.filter((event) => event.kind === "assessment");
        return <div key={day.date} data-month-day className={`min-h-[112px] border-b border-r border-[#e1e5e3] p-2 last:border-r-0 ${day.inMonth ? "bg-white" : "bg-[#fafbfa]"}`}>
          <button type="button" className={calendarStyles.monthDate} data-today={day.today} data-in-month={day.inMonth} aria-current={day.today ? "date" : undefined} aria-label={`Show appointments for ${longDate(day.date)}`} onClick={() => onDate(day.date)}>
            <span>{day.day}</span>{phone && scheduled.length > 0 ? <span className={calendarStyles.monthCount} aria-label={`${scheduled.length} appointments`}>{scheduled.length}</span> : null}
          </button>
          {!phone ? <div className="space-y-1.5">{scheduled.slice(0, 2).map((event) => <CalendarEventButton key={event.id} event={event} onOpen={onOpen} compact />)}{scheduled.length > 2 ? <details><summary className="cursor-pointer py-1 text-[12px] font-bold text-[#526a63]">{scheduled.length - 2} more</summary><div className="space-y-1.5 pt-1">{scheduled.slice(2).map((event) => <CalendarEventButton key={event.id} event={event} onOpen={onOpen} compact />)}</div></details> : null}</div> : null}
        </div>;
      })}
    </div></div>
  );
}

function TimedWeekView({ range, eventsByDate, onOpen, onDate }: { range: { from: string; to: string }; eventsByDate: Map<string, PipelineCalendarEvent[]>; onOpen: (event: PipelineCalendarEvent) => void; onDate: (date: string) => void }) {
  const dates = dateKeys(range.from, range.to);
  const hours = Array.from({ length: weekEndHour - weekStartHour }, (_, index) => weekStartHour + index);
  return (
    <section aria-label="Timed assessment week" className={calendarStyles.weekGrid}><div className="min-w-[980px]">
      <div data-calendar-week-heading className={`grid grid-cols-[62px_repeat(7,minmax(125px,1fr))] ${calendarStyles.weekHeading}`}><div className={calendarStyles.timeCorner}>PT</div>{dates.map((date) => <CalendarDateHeading key={date} date={date} onDate={onDate} />)}</div>
      <div className="grid grid-cols-[62px_repeat(7,minmax(125px,1fr))]"><div className="relative" style={{ height: hours.length * hourHeight }}>{hours.map((hour, index) => <span key={hour} className="absolute right-2 -translate-y-1/2 text-[10px] font-semibold text-[#7b827e]" style={{ top: index * hourHeight }}>{formatHour(hour)}</span>)}</div>{dates.map((date) => { const timed = (eventsByDate.get(date) ?? []).filter((event) => event.kind === "assessment" && event.startsAt); return <div key={date} className={`relative border-l border-[#d8dedb] ${date === todayKey() ? "bg-[#fbfefd]" : "bg-white"}`} style={{ height: hours.length * hourHeight }}>{hours.map((hour, index) => <div key={hour} className="absolute inset-x-0 border-t border-[#edf0ee]" style={{ top: index * hourHeight }} />)}{timed.map((event) => { const position = timedEventPosition(event, timed); if (!position) return null; return <button key={event.id} type="button" onClick={() => onOpen(event)} title={`${calendarClientName(event.clientName, event.community)} - ${event.title}`} className={`absolute z-10 overflow-hidden border-l-[3px] px-2 py-1.5 text-left shadow-sm hover:z-20 hover:ring-1 hover:ring-[#4b68ad] ${event.status === "overdue" ? "border-l-[#a9473d] bg-[#fff3f1] text-[#7c3229]" : eventColors.assessment}`} style={position}><span className="block truncate text-[10px] font-extrabold">{eventTime(event.startsAt)}</span><span className="mt-0.5 block truncate text-[11px] font-extrabold">{calendarClientName(event.clientName, event.community)}</span><span className="mt-0.5 block truncate text-[9px] opacity-75">{methodLabel(event.method)} - {event.durationMinutes ?? 60} min</span></button>; })}</div>; })}</div>
    </div></section>
  );
}

function TeamWeekView({ range, events, unscheduled, assessors, conflicts, onOpen, onFocusOwner, onDate }: { range: { from: string; to: string }; events: PipelineCalendarEvent[]; unscheduled: PipelineUnscheduledAssessment[]; assessors: Array<{ id?: string; name: string }>; conflicts: Set<string>; onOpen: (event: PipelineCalendarEvent) => void; onFocusOwner: (owner: string) => void; onDate: (date: string) => void }) {
  const dates = dateKeys(range.from, range.to);
  const owners = uniqueOwnerOptions([...assessors, ...events.map((event) => ({ id: event.ownerId, name: event.owner })), ...unscheduled.map((item) => ({ id: item.ownerId, name: item.owner }))]).filter((item) => item.label !== "Unassigned");
  if (owners.length === 0) return null;
  return (
    <section aria-label="Supervisor team week" className={calendarStyles.teamGrid}><div className="min-w-[1080px]">
      <div data-calendar-week-heading className={`grid grid-cols-[190px_repeat(7,minmax(118px,1fr))] ${calendarStyles.weekHeading}`}><div className="sticky left-0 z-20 bg-[#f7f9f8] px-3 py-3 text-[11px] font-bold text-[#69706c]">Assessor</div>{dates.map((date) => <CalendarDateHeading key={date} date={date} onDate={onDate} />)}</div>
      {owners.map((assessor) => {
        const ownerEvents = events.filter((event) => ownerKey(event.ownerId, event.owner) === assessor.value);
        const conflictCount = ownerEvents.filter((event) => conflicts.has(event.id)).length;
        return <div key={assessor.value} className="grid grid-cols-[190px_repeat(7,minmax(118px,1fr))] border-b border-[#e1e5e3] last:border-b-0">
          <button type="button" onClick={() => onFocusOwner(assessor.value)} className="sticky left-0 z-[5] bg-white px-3 py-4 text-left hover:bg-[#f4f8f6]">
            <span className="block break-words text-[14px] font-extrabold text-[#252a27]">{assessor.label}</span>
            <span className="mt-1 block text-[12px] text-[#737a76]">{ownerEvents.length.toLocaleString()} assessments</span>
            {conflictCount > 0 ? <span className="mt-2 inline-flex items-start gap-1 text-[12px] font-extrabold text-[#9c3d32]"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{conflictCount.toLocaleString()} overlapping appointments</span> : null}
          </button>
          {dates.map((date) => {
            const appointments = ownerEvents.filter((event) => event.date === date);
            return <div key={date} className="min-h-[118px] border-l border-[#e1e5e3] bg-white p-2">
              <div className="space-y-1.5">{appointments.slice(0, 3).map((event) => <CalendarEventButton key={event.id} event={event} onOpen={onOpen} compact conflict={conflicts.has(event.id)} />)}</div>
              {appointments.length > 3 ? <details className="mt-2"><summary className="cursor-pointer text-[12px] font-bold text-[#526a63]">{appointments.length - 3} more</summary><div className="space-y-1.5 pt-2">{appointments.slice(3).map((event) => <CalendarEventButton key={event.id} event={event} onOpen={onOpen} compact conflict={conflicts.has(event.id)} />)}</div></details> : null}
            </div>;
          })}
        </div>;
      })}
    </div></section>
  );
}

function CalendarDateHeading({ date, onDate }: { date: string; onDate: (date: string) => void }) {
  return <button type="button" className={calendarStyles.dateHeading} data-today={date === todayKey()} aria-label={`Show appointments for ${longDate(date)}`} onClick={() => onDate(date)}>
    <span>{weekdays[parseDate(date).getUTCDay()]}</span><strong>{shortDate(date)}</strong>
  </button>;
}

function WeekList({ events, scope, onOpen, onAssessment, onDate }: { events: PipelineCalendarEvent[]; scope: "personal" | "team"; onOpen: (event: PipelineCalendarEvent) => void; onAssessment: (event: PipelineCalendarEvent) => void; onDate: (date: string) => void }) {
  const groups = groupEventsByDate(events);
  return <section aria-label="Week appointments">{[...groups.entries()].map(([date, dayEvents]) => <section key={date} aria-label={longDate(date)} className="py-3"><h2 className="text-[15px] font-extrabold text-[#343c37]"><button type="button" className={calendarStyles.listDate} aria-label={`Show appointments for ${longDate(date)}`} onClick={() => onDate(date)}>{longDate(date)}</button></h2><ol className="divide-y divide-[#e5e8e6]">{dayEvents.map((event) => <AppointmentRow key={event.id} event={event} scope={scope} onOpen={onOpen} onAssessment={onAssessment} />)}</ol></section>)}</section>;
}

export function CalendarDateDetails({ date, events, scope, scopeText, loading, error, onOpen, onAssessment, onClose }: { date: string; events: PipelineCalendarEvent[]; scope: "personal" | "team"; scopeText: string; loading: boolean; error: string; onOpen: (event: PipelineCalendarEvent) => void; onAssessment: (event: PipelineCalendarEvent) => void; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: "nearest" });
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [date]);
  return <section ref={panel} tabIndex={-1} aria-label={`Appointments on ${longDate(date)}`} className={calendarStyles.dateDetails} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header><h2>{longDate(date)}</h2><button type="button" aria-label="Close day details" onClick={onClose}><X size={18} /></button></header>
    {loading ? <p role="status">Loading appointments…</p> : error && !events.length ? <p>Appointments could not be loaded. Use Try again above.</p> : events.length ? <ol className="divide-y divide-[#e5e8e6]">{events.map((event) => <AppointmentRow key={event.id} event={event} scope={scope} onOpen={onOpen} onAssessment={onAssessment} />)}</ol> : <p>No appointments on {scopeText} for this date.</p>}
  </section>;
}

export function CalendarContinuing({ events, onOpen, onContinue }: { events: PipelineCalendarEvent[]; onOpen: (event: PipelineCalendarEvent) => void; onContinue: (event: PipelineCalendarEvent) => void }) {
  if (!events.length) return null;
  return <section aria-label="Continue working" className={calendarStyles.continuing}><details>
    <summary><FilePenLine size={17} />Continue working <span>{events.length}</span><ChevronRight size={16} className={calendarStyles.disclosureIcon} /></summary>
    <div className={calendarStyles.cards}>{events.map((event) => <article className={calendarStyles.work} key={event.id}>
      <button type="button" className={calendarStyles.identity} onClick={() => onOpen(event)}><strong>{calendarClientName(event.clientName, event.community)}</strong><span>{appointmentStatusLabel(event)}</span><span>{event.owner}</span></button>
      <button type="button" className={calendarStyles.action} onClick={() => onContinue(event)} aria-label={`${assessmentEventNextStep(event).label} for ${event.clientName}`}>{assessmentEventNextStep(event).label}</button>
    </article>)}</div>
  </details></section>;
}

function AppointmentRow({ event, scope, onOpen, onAssessment }: { event: PipelineCalendarEvent; scope: "personal" | "team"; onOpen: (event: PipelineCalendarEvent) => void; onAssessment: (event: PipelineCalendarEvent) => void }) {
  const model = calendarDrawerModel({ type: "event", event }, scope);
  const next = assessmentEventNextStep(event);
  return (
    <li className="grid gap-3 py-5 sm:grid-cols-[90px_minmax(0,1fr)] xl:grid-cols-[90px_minmax(0,1fr)_auto]">
      <div className="flex items-baseline gap-3 sm:block"><div className="text-[16px] font-extrabold tabular-nums text-[#252a27]">{event.startsAt ? eventTime(event.startsAt) : "Unscheduled"}</div><div className="mt-1 text-[12px] font-semibold text-[#626b65]">{event.durationMinutes ?? 60} min</div></div>
      <div className="min-w-0">
        <button type="button" title={`${model.clientName} - ${event.title}`} onClick={() => onOpen(event)} className="text-left text-[#252a27] hover:text-[#116b5a]"><span className="break-words text-[20px] font-extrabold">{model.clientName}</span></button>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-[#626b65]"><span>{methodLabel(event.method)}</span>{event.community ? <span>{event.community}</span> : null}{scope === "team" ? <span>{event.owner}</span> : null}</div>
        {event.location ? <div className="mt-2 break-words text-[13px] text-[#434c46]"><span className="font-bold">{appointmentLocationLabel(event.method)}: </span>{event.location}</div> : null}
        <div className={`mt-2 text-[12px] font-bold ${event.status === "overdue" ? "text-[#9c3d32]" : "text-[#69706c]"}`}>{appointmentStatusLabel(event)}</div>
      </div>
      <div className="flex flex-wrap items-start gap-2 sm:col-start-2 xl:col-start-auto">
        {event.assessmentId ? <button type="button" aria-label={`${next.label} for ${model.clientName}`} onClick={() => onAssessment(event)} className="flex min-h-10 items-center gap-2 bg-[#167f6b] px-3 text-[12px] font-extrabold text-white hover:bg-[#116b5a]"><ClipboardList size={15} />{next.label}</button> : null}
        {model.zoomUrl ? <a href={model.zoomUrl} target="_blank" rel="noreferrer" aria-label={`Join Zoom for ${model.clientName}`} className="flex min-h-10 items-center gap-2 px-3 text-[12px] font-bold text-[#354b85] hover:bg-[#eef1ff]"><Video size={15} />Join Zoom<ExternalLink size={12} /></a> : null}
        <button type="button" aria-label={`Appointment details for ${model.clientName}`} onClick={() => onOpen(event)} className="min-h-10 px-2 text-[12px] font-bold text-[#626b65] hover:text-[#116b5a]">Details</button>
      </div>
    </li>
  );
}

export function CalendarFollowUps({ events, onOpen }: { events: PipelineCalendarEvent[]; onOpen: (event: PipelineCalendarEvent) => void }) {
  if (events.length === 0) return null;
  return (
    <details className="group mt-6 bg-[#faf8f2] px-4 py-3 sm:px-5">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-[14px] font-extrabold text-[#765620]"><ChevronRight size={16} className="shrink-0 transition-transform group-open:rotate-90" />Dated follow-ups<span className="ml-auto tabular-nums">{events.length.toLocaleString()}</span></summary>
      <ol className="mt-2 divide-y divide-[#e9e3d6]">{events.map((event) => <li key={event.id}><button type="button" onClick={() => onOpen(event)} className="grid w-full gap-1 py-3 text-left sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-3"><span className="text-[12px] font-bold text-[#806635]">{shortDate(event.date)}</span><span className="min-w-0"><span className="block text-[14px] font-extrabold text-[#343c37]">{calendarClientName(event.clientName, event.community)}</span><span className="mt-1 block text-[13px] text-[#6d6658]">{event.title}</span></span></button></li>)}</ol>
    </details>
  );
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
  onOpenChart: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onScheduleSelection: () => void;
  onStatus: (status: "cancelled" | "no_show" | "completed") => void;
  onStart: (value: string) => void;
  onDuration: (value: string) => void;
  onMethod: (value: AssessmentScheduleMethod) => void;
  onLocation: (value: string) => void;
  onSave: () => void;
  onOverride: () => void;
};

export function CalendarOverlays(props: CalendarOverlaysProps) {
  return <>{props.selected ? <CalendarDrawer selection={props.selected} busy={props.mutationState.busy} error={props.mutationState.error} scope={props.scope} onClose={props.onCloseSelection} onOpenWorkspace={props.onOpenWorkspace} onOpenChart={props.onOpenChart} onDirtyChange={props.onDirtyChange} onSchedule={props.onScheduleSelection} onStatus={props.onStatus} /> : null}{props.scheduleTarget ? <ScheduleDialog target={props.scheduleTarget} start={props.scheduleStart} duration={props.scheduleDuration} method={props.scheduleMethod} location={props.scheduleLocation} state={props.mutationState} onStart={props.onStart} onDuration={props.onDuration} onMethod={props.onMethod} onLocation={props.onLocation} onClose={props.onCloseSchedule} onSave={props.onSave} onOverride={props.onOverride} /> : null}</>;
}

function CalendarDrawer({ selection, busy, error, scope, onClose, onOpenWorkspace, onOpenChart, onDirtyChange, onSchedule, onStatus }: { selection: CalendarSelection; busy: boolean; error: string; scope: "personal" | "team"; onClose: () => void; onOpenWorkspace: () => void; onOpenChart: () => void; onDirtyChange: (dirty: boolean) => void; onSchedule: () => void; onStatus: (status: "cancelled" | "no_show" | "completed") => void }) {
  const model = calendarDrawerModel(selection, scope);
  const drawer = useRef<HTMLElement>(null);
  const referralId = selection.type === "event" ? selection.event.referralId : selection.item.referralId;
  useEffect(() => {
    const previous = document.activeElement;
    drawer.current?.querySelector<HTMLElement>("button")?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return (
    <div className="fixed inset-0 z-[100] bg-[#18201d]/30" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside ref={drawer} role="dialog" aria-modal="true" aria-label="Calendar item" onKeyDown={(event) => {
        if (event.key !== "Tab" || !drawer.current?.contains(event.target as Node)) return;
        const controls = [...drawer.current.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, a[href], summary')].filter((item) => item.getClientRects().length > 0);
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }} className="pipeline-panel-enter absolute inset-y-0 right-0 flex w-full max-w-[620px] flex-col border-l border-[#cfd5d2] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#d8dedb] p-5">
          <div className="min-w-0"><span className="text-[12px] font-extrabold text-[#167f6b]">{model.kicker}</span><h2 className="mt-1.5 break-words text-[22px] font-extrabold text-[#202522]">{model.clientName}</h2></div>
          <IconButton label="Close calendar item" onClick={onClose}><X size={16} /></IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <CalendarDrawerDetails model={model} />
          <CalendarWorkDetails key={referralId} referralId={referralId} onOpenChart={onOpenChart} onDirtyChange={onDirtyChange} />
        </div>
        {error ? <p role="alert" className="px-5 py-2 text-sm text-[#973c30]">{error}</p> : null}
        <CalendarDrawerActions model={model} busy={busy} onOpenWorkspace={onOpenWorkspace} onOpenChart={onOpenChart} onSchedule={onSchedule} onStatus={onStatus} />
      </aside>
    </div>
  );
}

function CalendarDrawerDetails({ model }: { model: CalendarDrawerModel }) {
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <dl className="grid grid-cols-[100px_minmax(0,1fr)] gap-x-3 gap-y-4 break-words text-[14px]">
        <dt className="font-bold text-[#777e7a]">Community</dt><dd className="font-semibold text-[#2d332f]">{model.community}</dd>
        <dt className="font-bold text-[#777e7a]">Assessor</dt><dd className="font-semibold text-[#2d332f]">{model.owner}</dd>
        {model.workspaceOwner ? <><dt className="font-bold text-[#777e7a]">Workspace owner</dt><dd>{model.workspaceOwner}</dd></> : null}
        {model.workLabel ? <><dt className="font-bold text-[#777e7a]">Work</dt><dd className="font-semibold text-[#326550]">{model.workLabel}</dd></> : null}
        {model.dateLabel ? <><dt className="font-bold text-[#777e7a]">Date</dt><dd className="font-semibold text-[#2d332f]">{model.dateLabel}</dd></> : null}
        {model.hasScheduledTime ? <><dt className="font-bold text-[#777e7a]">Method</dt><dd className="font-semibold text-[#2d332f]">{model.methodLabel}</dd><dt className="font-bold text-[#777e7a]">Duration</dt><dd className="font-semibold text-[#2d332f]">{model.durationLabel}</dd></> : null}
        {model.location ? <><dt className="font-bold text-[#777e7a]">{model.locationLabel}</dt><dd className="font-semibold text-[#2d332f]">{model.location}</dd></> : null}
        {model.receivedLabel ? <><dt className="font-bold text-[#777e7a]">Received</dt><dd className="font-semibold text-[#2d332f]">{model.receivedLabel}</dd></> : null}
      </dl>
      {model.followUps.length > 0 ? <div className="mt-5 border-l-2 border-[#a16a16] bg-[#fff8ed] p-3"><div className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-[#8a5c14]">Follow-ups</div>{model.followUps.map((label) => <div key={label} className="mt-1.5 text-[12px] text-[#4b4030]">{label}</div>)}</div> : null}
      {model.needsAssignment ? <p className="mt-5 text-[13px] text-[#6d7470]">An assessor has not been assigned yet. You can still schedule and work on the referral.</p> : null}
    </div>
  );
}

function CalendarDrawerActions({ model, busy, onOpenWorkspace, onOpenChart, onSchedule, onStatus }: { model: CalendarDrawerModel; busy: boolean; onOpenWorkspace: () => void; onOpenChart: () => void; onSchedule: () => void; onStatus: (status: "cancelled" | "no_show" | "completed") => void }) {
  return (
    <div className="pipeline-commands grid shrink-0 grid-cols-2 gap-2 border-t border-[#d8dedb] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] [&_button]:rounded-md">
      {model.zoomUrl ? <a href={model.zoomUrl} target="_blank" rel="noreferrer" className="flex h-10 w-full items-center justify-center gap-2 bg-[#4b68ad] text-[12px] font-extrabold text-white hover:bg-[#3d578f]"><Video size={15} /> Join Zoom <ExternalLink size={13} /></a> : null}
      {model.canSchedule ? <button type="button" disabled={busy} onClick={onSchedule} className="flex min-h-11 w-full items-center justify-center gap-2 bg-[#167f6b] text-[12px] font-extrabold text-white hover:bg-[#116b5a] disabled:opacity-50"><CalendarClock size={15} /> {model.hasScheduledTime ? "Reschedule" : "Schedule interview"}</button> : null}
      <button type="button" onClick={onOpenWorkspace} className="flex h-11 w-full items-center justify-center gap-2 border border-[#cfd5d2] text-[13px] font-extrabold text-[#343a36] hover:border-[#167f6b] hover:text-[#116b5a]"><FolderOpen size={15} /> {model.nextStepLabel ?? "Open workspace"}</button>
      <button type="button" onClick={onOpenChart} className="min-h-11 border border-[#cfd5d2] px-3 text-[13px] font-bold text-[#326550]">Open chart</button>
      {model.showStatusActions && model.dateLabel ? <button type="button" disabled={busy} onClick={() => onStatus("completed")} className="min-h-11 bg-[#eef6f2] px-3 text-[13px] font-bold text-[#126b54] disabled:opacity-50">Interview completed</button> : null}
      {model.showStatusActions ? <div className="col-span-2 grid grid-cols-2 gap-2 pt-2"><button type="button" disabled={busy} onClick={() => onStatus("no_show")} className="min-h-11 border border-[#d8dedb] text-[12px] font-bold text-[#8a5c14] hover:bg-[#fff8ed] disabled:opacity-50">Mark no-show</button><button type="button" disabled={busy} onClick={() => onStatus("cancelled")} className="min-h-11 border border-[#d8dedb] text-[12px] font-bold text-[#9c3d32] hover:bg-[#fff3f1] disabled:opacity-50">Cancel appointment</button></div> : null}
    </div>
  );
}

function ScheduleDialog({ target, start, duration, method, location, state, onStart, onDuration, onMethod, onLocation, onClose, onSave, onOverride }: { target: ScheduleTarget; start: string; duration: string; method: AssessmentScheduleMethod; location: string; state: { busy: boolean; error: string; message: string; canOverride: boolean }; onStart: (value: string) => void; onDuration: (value: string) => void; onMethod: (value: AssessmentScheduleMethod) => void; onLocation: (value: string) => void; onClose: () => void; onSave: () => void; onOverride: () => void }) {
  const clientName = calendarClientName(target.clientName, target.community);
  return (
    <AssessmentScheduleLayout
      label={clientName}
      title={target.reschedule ? "Change appointment" : "Schedule interview"}
      context={<>{clientName}{target.community ? <span className="text-[#626a66]">{target.community}</span> : null}</>}
      closeLabel="Close scheduling"
      isBusy={state.busy}
      error={state.error}
      onClose={onClose}
      footer={<>
        <button type="button" disabled={state.busy} onClick={onClose} className="min-h-12 px-4 font-bold text-[#59635d] hover:bg-[#f1f4f2] hover:text-[#0f7664] disabled:opacity-50">Cancel</button>
        {state.canOverride ? <button type="button" disabled={state.busy} onClick={onOverride} className="min-h-12 border border-[#a9473d] px-4 font-bold text-[#9c3d32] hover:bg-[#fff3f1] disabled:opacity-50">Schedule anyway</button> : null}
        <button type="button" disabled={state.busy || !start} onClick={onSave} className="min-h-12 bg-[#111111] px-6 font-bold text-white hover:bg-[#0f8b73] disabled:cursor-not-allowed disabled:bg-[#c9ceca]">{state.busy ? "Saving..." : target.reschedule ? "Save new time" : "Schedule"}</button>
      </>}
    >
      <div className="space-y-7">
        {target.reschedule && target.startsAt ? <p className="border-l-2 border-[#0f8b73] bg-[#f4f8f6] px-4 py-3 text-[14px] leading-6 text-[#315e50]">Currently scheduled for <strong>{new Date(target.startsAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "short" })}</strong>.</p> : null}
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_200px]">
          <label className="min-w-0"><span className="mb-2 block text-[14px] font-bold text-[#303a34]">Date and time <span className="font-normal text-[#626a66]">(Pacific)</span></span><input aria-label="Date and time" data-schedule-autofocus type="datetime-local" value={start} onChange={(event) => onStart(event.target.value)} /></label>
          <label className="min-w-0"><span className="mb-2 block text-[14px] font-bold text-[#303a34]">Duration</span><select value={duration} onChange={(event) => onDuration(event.target.value)}><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option><option value="120">2 hours</option></select></label>
        </div>
        <label className="block"><span className="mb-2 block text-[14px] font-bold text-[#303a34]">Method</span><select value={method} onChange={(event) => onMethod(event.target.value as AssessmentScheduleMethod)}><option value="zoom">Zoom</option><option value="in_person">In person</option><option value="phone">Phone</option><option value="record_review">Record review</option></select></label>
        <label className="block"><span className="mb-2 block text-[14px] font-bold text-[#303a34]">{method === "zoom" ? "Zoom link" : method === "in_person" ? "Location" : "Details"}</span><input type={method === "zoom" ? "url" : "text"} value={location} onChange={(event) => onLocation(event.target.value)} placeholder={method === "zoom" ? "https://zoom.us/j/..." : "Optional"} /></label>
      </div>
    </AssessmentScheduleLayout>
  );
}

function CalendarEventButton({ event, onOpen, compact = false, conflict = false }: { event: PipelineCalendarEvent; onOpen: (event: PipelineCalendarEvent) => void; compact?: boolean; conflict?: boolean }) {
  const color = event.status === "overdue" ? "border-l-[#a9473d] bg-[#fff3f1] text-[#7c3229]" : eventColors[event.kind];
  return <button type="button" onClick={() => onOpen(event)} title={`${calendarClientName(event.clientName, event.community)} - ${event.title} - ${event.owner}`} className={`block w-full rounded-lg border border-[#dce3df] border-l-[3px] px-3 text-left shadow-sm transition-shadow hover:shadow-md ${compact ? "py-3" : "py-3.5"} ${color} ${conflict ? "ring-1 ring-[#a9473d]" : ""}`}><span className="block text-[11px] font-bold">{eventTime(event.startsAt)}</span><span className="mt-1 block break-words text-[13px] font-extrabold">{calendarClientName(event.clientName, event.community)}</span><span className="mt-1 block text-[11px]">{conflict ? "Overlap · " : ""}{event.kind === "assessment" ? methodLabel(event.method) : event.title}</span></button>;
}

function CalendarFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <select aria-label={`Filter calendar by ${label}`} value={value} onChange={(event) => onChange(event.target.value)} className="h-9 min-w-0 border border-[#cfd5d2] bg-white px-2.5 text-[12px] font-semibold text-[#303632] outline-none focus:border-[#167f6b]"><option value="">All {label === "community" ? "communities" : "owners"}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
}

function OwnerFilter({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <select aria-label="Filter calendar by assessor" value={value} onChange={(event) => onChange(event.target.value)} className="h-9 min-w-0 border border-[#cfd5d2] bg-white px-2.5 text-[12px] font-semibold text-[#303632] outline-none focus:border-[#167f6b]"><option value="">All assessors</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}

function IconButton({ label, onClick, disabled = false, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className="pipeline-command flex h-9 w-9 shrink-0 items-center justify-center border border-[#cfd5d2] text-[#626a66] hover:border-[#167f6b] hover:text-[#116b5a] disabled:opacity-50">{children}</button>;
}

function CalendarSkeleton() {
  return <div className="mt-3 animate-pulse border border-[#d8dedb] p-4"><div className="h-10 bg-[#eef1ef]" /><div className="mt-3 grid grid-cols-3 gap-3"><div className="h-52 bg-[#f4f6f5]" /><div className="h-52 bg-[#f4f6f5]" /><div className="h-52 bg-[#f4f6f5]" /></div></div>;
}

function EmptyCalendar({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return <div className="mt-3 border border-[#d8dedb] px-4 py-10 text-center"><CalendarClock size={22} className="mx-auto text-[#8a918d]" /><div className="mt-3 text-[14px] font-extrabold text-[#343a36]">{title}</div>{detail ? <p className="mt-1 text-[14px] text-[#5d6661]">{detail}</p> : null}{children ? <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div> : null}</div>;
}

const emptyActionLabels = { view_team: "View team schedule", all_assessors: "Show all assessors", all_communities: "Show all communities" } as const;

function CalendarEmptyNotice(props: CalendarViewsProps) {
  const state = calendarEmptyState(props, rangeLabel(props.view, props.range));
  const handlers = { view_team: props.onViewTeam, all_assessors: props.onAllAssessors, all_communities: props.onAllCommunities };
  return <section aria-label="No matching appointments"><EmptyCalendar title={state.title} detail={state.detail}>
    {state.actions.map((action) => <button key={action} type="button" onClick={handlers[action]} className="min-h-11 rounded-md border border-[#bfc7c3] bg-white px-4 text-[14px] font-bold text-[#176f5e] hover:border-[#167f6b]">{emptyActionLabels[action]}</button>)}
  </EmptyCalendar></section>;
}
