"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Filter,
  FolderOpen,
  RefreshCw,
  UserRoundCheck,
  Video,
  X,
} from "lucide-react";

import type {
  AssessmentListResponse,
  AssessmentScheduleMethod,
  PipelineAssessmentRecord,
} from "@/lib/assessment/assessment-records";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { addCalendarDays, calendarToday } from "@/lib/pipeline/assessment-calendar";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import type {
  PipelineCalendarEvent,
  PipelineCalendarEventKind,
  PipelineCalendarResponse,
  PipelineUnscheduledAssessment,
} from "@/lib/pipeline/calendar-types";
import type { Referral } from "@/lib/pipeline/referral-types";

type CalendarView = "month" | "week" | "agenda";
type CalendarSelection =
  | { type: "event"; event: PipelineCalendarEvent }
  | { type: "unscheduled"; item: PipelineUnscheduledAssessment };
type ScheduleTarget = {
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
type CalendarSnapshot = Pick<PipelineCalendarResponse, "events" | "unscheduled" | "unscheduledTotal" | "scope" | "viewer" | "timezone">;

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const operationalTimeZone = "America/Los_Angeles";
const weekStartHour = 7;
const weekEndHour = 20;
const hourHeight = 64;
const emptyCalendarEvents: PipelineCalendarEvent[] = [];
const emptyUnscheduledAssessments: PipelineUnscheduledAssessment[] = [];
const eventColors: Record<PipelineCalendarEventKind, string> = {
  referral_assigned: "border-l-[#0f8b73] bg-[#e8f5f1] text-[#0c705f]",
  assessment: "border-l-[#4b68ad] bg-[#eef1ff] text-[#354b85]",
  follow_up: "border-l-[#a16a16] bg-[#fff8ed] text-[#6f4b13]",
};
const kindLabels: Record<PipelineCalendarEventKind, string> = {
  referral_assigned: "Referral assignments",
  assessment: "Assessments",
  follow_up: "Follow-ups",
};
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

export default function PipelineCalendar({ onOpenPacket }: { onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void }) {
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(todayKey);
  const [community, setCommunity] = useState("");
  const [owner, setOwner] = useState("");
  const [kind, setKind] = useState<PipelineCalendarEventKind | "">("");
  const [mySchedule, setMySchedule] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selected, setSelected] = useState<CalendarSelection | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget | null>(null);
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleDuration, setScheduleDuration] = useState("60");
  const [scheduleMethod, setScheduleMethod] = useState<AssessmentScheduleMethod>("zoom");
  const [scheduleLocation, setScheduleLocation] = useState("");
  const [mutationState, setMutationState] = useState({ busy: false, error: "", message: "", canOverride: false });
  const range = calendarRange(view, anchor);
  const requestKey = `${range.from}:${range.to}`;
  const [cache, setCache] = useState<Record<string, CalendarSnapshot>>({});
  const [requestState, setRequestState] = useState({ key: "", loading: false, error: "" });
  const calendarState = resolveCalendarState(cache[requestKey], requestState, requestKey);
  const { snapshot, loading, refreshing, error, events, unscheduled, scope, viewer } = calendarState;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 899px)");
    const applyResponsiveDefault = (matches: boolean) => {
      if (matches) setView((current) => current === "week" ? "agenda" : current);
    };
    if (media.matches) queueMicrotask(() => applyResponsiveDefault(true));
    const handleChange = (event: MediaQueryListEvent) => applyResponsiveDefault(event.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") setRefreshToken((value) => value + 1);
    }, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const refreshVisibleCalendar = () => {
      if (document.visibilityState === "visible") setRefreshToken((value) => value + 1);
    };
    window.addEventListener("focus", refreshVisibleCalendar);
    document.addEventListener("visibilitychange", refreshVisibleCalendar);
    return () => {
      window.removeEventListener("focus", refreshVisibleCalendar);
      document.removeEventListener("visibilitychange", refreshVisibleCalendar);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from: range.from, to: range.to });
    queueMicrotask(() => {
      if (!controller.signal.aborted) setRequestState({ key: requestKey, loading: true, error: "" });
    });
    fetchPipelineJson<PipelineCalendarResponse>(`/api/calendar/events?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    }, { cacheTtlMs: 15_000 }).then((payload) => {
      setCache((current) => ({
        ...current,
        [requestKey]: {
          events: payload.events ?? [],
          unscheduled: payload.unscheduled ?? [],
          unscheduledTotal: payload.unscheduledTotal ?? 0,
          scope: payload.scope ?? "team",
          viewer: payload.viewer,
          timezone: payload.timezone ?? operationalTimeZone,
        },
      }));
      setRequestState({ key: requestKey, loading: false, error: "" });
    }).catch((reason) => {
      if (controller.signal.aborted) return;
      setRequestState({ key: requestKey, loading: false, error: reason instanceof Error ? reason.message : "Calendar could not be loaded." });
    });
    return () => controller.abort();
  }, [range.from, range.to, refreshToken, requestKey]);

  const communityOptions = uniqueValues([
    ...events.map((event) => event.community),
    ...unscheduled.map((item) => item.community),
  ]);
  const ownerOptions = uniqueOwnerOptions([
    ...events.map((event) => ({ id: event.ownerId, name: event.owner })),
    ...unscheduled.map((item) => ({ id: item.ownerId, name: item.owner })),
  ]);
  const visibleEvents = events.filter((event) => (
    (!community || event.community === community)
    && (!owner || ownerKey(event.ownerId, event.owner) === owner)
    && (!mySchedule || (Boolean(viewer?.id) && event.ownerId === viewer?.id))
    && (!kind || event.kind === kind)
  ));
  const visibleUnscheduled = unscheduled.filter((item) => (
    (!community || item.community === community)
    && (!owner || ownerKey(item.ownerId, item.owner) === owner)
    && (!mySchedule || (Boolean(viewer?.id) && item.ownerId === viewer?.id))
  ));
  const eventsByDate = groupEventsByDate(visibleEvents);
  const hasFilters = hasCalendarFilters(community, owner, kind, mySchedule);
  const overdue = visibleEvents.filter((event) => event.status === "overdue");
  const conflicts = findScheduleConflicts(visibleEvents);

  const openWorkspace = (identity: { referralId: number; clientName: string; community: string }) => {
    onOpenPacket({ id: identity.referralId, name: calendarClientName(identity.clientName, identity.community), community: identity.community as Referral["community"] });
  };

  const beginScheduling = (target: ScheduleTarget) => {
    setSelected(null);
    setScheduleTarget(target);
    setScheduleStart(target.startsAt ? isoToOperationalInput(target.startsAt) : nextSchedulingInput());
    setScheduleDuration(String(target.durationMinutes ?? 60));
    setScheduleMethod(normalizeMethod(target.method));
    setScheduleLocation(target.location ?? "");
    setMutationState({ busy: false, error: "", message: "", canOverride: false });
  };

  const refreshCalendar = (message = "Calendar updated") => {
    setMutationState({ busy: false, error: "", message, canOverride: false });
    setRefreshToken((value) => value + 1);
  };

  const saveSchedule = async (allowConflict = false) => {
    if (!scheduleTarget || !scheduleStart) return;
    const startsAt = operationalInputToIso(scheduleStart);
    if (!startsAt) {
      setMutationState({ busy: false, error: "Choose a valid date and time.", message: "", canOverride: false });
      return;
    }
    setMutationState({ busy: true, error: "", message: "Saving schedule...", canOverride: false });
    try {
      const assessment = await assessmentForSchedule(scheduleTarget);
      await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(`/api/assessments/${encodeURIComponent(assessment.assessment_id)}/schedule`, {
        method: "POST",
        body: JSON.stringify({
          if_match: assessment.version,
          client_mutation_id: mutationId("calendar-schedule"),
          allow_conflict: allowConflict,
          schedule: {
            status: scheduleTarget.reschedule || ["scheduled", "rescheduled"].includes(assessment.schedule_status ?? "unscheduled") ? "rescheduled" : "scheduled",
            start_at: startsAt,
            duration_minutes: Number(scheduleDuration),
            method: scheduleMethod,
            location: scheduleLocation.trim(),
          },
        }),
      });
      const message = scheduleTarget.reschedule ? "Assessment rescheduled" : "Assessment scheduled";
      setScheduleTarget(null);
      refreshCalendar(message);
    } catch (reason) {
      const payload = reason instanceof PipelineApiError && reason.payload && typeof reason.payload === "object"
        ? reason.payload as { code?: string; can_override?: boolean }
        : null;
      setMutationState({
        busy: false,
        error: reason instanceof Error ? reason.message : "The assessment could not be scheduled.",
        message: "",
        canOverride: payload?.code === "assessment_schedule_conflict" && payload.can_override === true,
      });
    }
  };

  const updateAppointmentStatus = async (event: PipelineCalendarEvent, status: "cancelled" | "no_show") => {
    if (!event.assessmentId) return;
    const confirmation = status === "no_show"
      ? "Mark this assessment as a no-show? It will return to the scheduling queue."
      : "Cancel this assessment appointment? It will return to the scheduling queue.";
    if (!window.confirm(confirmation)) return;
    setMutationState({ busy: true, error: "", message: status === "no_show" ? "Recording no-show..." : "Cancelling appointment...", canOverride: false });
    try {
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(`/api/assessments/${encodeURIComponent(event.assessmentId)}`, { cache: "no-store" });
      const assessment = payload.assessment;
      await fetchPipelineJson(`/api/assessments/${encodeURIComponent(event.assessmentId)}/schedule`, {
        method: "POST",
        body: JSON.stringify({
          if_match: assessment.version,
          client_mutation_id: mutationId(`calendar-${status}`),
          schedule: {
            status,
            start_at: assessment.scheduled_start_at ?? null,
            duration_minutes: assessment.scheduled_duration_minutes ?? null,
            method: assessment.scheduled_method ?? null,
            location: assessment.scheduled_location ?? null,
          },
        }),
      });
      setSelected(null);
      refreshCalendar(status === "no_show" ? "No-show recorded" : "Appointment cancelled");
    } catch (reason) {
      setMutationState({ busy: false, error: reason instanceof Error ? reason.message : "The appointment could not be updated.", message: "", canOverride: false });
    }
  };

  return (
    <main data-guide-target="calendar-workspace" aria-busy={loading} className="h-full overflow-y-auto bg-white px-3 pb-8 sm:px-5 lg:px-7">
      <div className="mx-auto w-full max-w-[1540px]">
        <CalendarHeader
          view={view}
          anchor={anchor}
          range={range}
          scope={scope}
          community={community}
          communityOptions={communityOptions}
          owner={owner}
          ownerOptions={ownerOptions}
          kind={kind}
          mySchedule={mySchedule}
          showFilters={showFilters}
          hasFilters={hasFilters}
          loading={loading}
          refreshing={refreshing}
          message={mutationState.message}
          onView={setView}
          onAnchor={setAnchor}
          onCommunity={setCommunity}
          onOwner={setOwner}
          onKind={setKind}
          onMySchedule={setMySchedule}
          onShowFilters={setShowFilters}
          onRefresh={() => setRefreshToken((value) => value + 1)}
        />
        <CalendarNotices error={error} mutationError={mutationState.error} scheduleOpen={Boolean(scheduleTarget)} onRetry={() => setRefreshToken((value) => value + 1)} />
        <CalendarActionQueue
          kind={kind}
          scope={scope}
          items={visibleUnscheduled}
          total={calendarQueueTotal(snapshot, visibleUnscheduled, hasFilters)}
          overdue={overdue}
          onOpen={(item) => setSelected({ type: "unscheduled", item })}
          onSchedule={(item) => beginScheduling(scheduleTargetFromUnscheduled(item))}
          onSelectEvent={(event) => setSelected({ type: "event", event })}
        />
        <CalendarViews
          loading={loading}
          view={view}
          anchor={anchor}
          scope={scope}
          owner={owner}
          mySchedule={mySchedule}
          range={range}
          events={visibleEvents}
          unscheduled={visibleUnscheduled}
          eventsByDate={eventsByDate}
          conflicts={conflicts}
          hasFilters={hasFilters}
          onOpen={(event) => setSelected({ type: "event", event })}
          onFocusOwner={setOwner}
        />
      </div>
      <CalendarOverlays
        selected={selected}
        scheduleTarget={scheduleTarget}
        scheduleStart={scheduleStart}
        scheduleDuration={scheduleDuration}
        scheduleMethod={scheduleMethod}
        scheduleLocation={scheduleLocation}
        mutationState={mutationState}
        scope={scope}
        onCloseSelection={() => setSelected(null)}
        onCloseSchedule={() => setScheduleTarget(null)}
        onOpenWorkspace={() => selected && openWorkspace(selectionIdentity(selected))}
        onScheduleSelection={() => selected && beginScheduling(scheduleTargetFromSelection(selected))}
        onStatus={(status) => selected?.type === "event" && updateAppointmentStatus(selected.event, status)}
        onStart={setScheduleStart}
        onDuration={setScheduleDuration}
        onMethod={setScheduleMethod}
        onLocation={setScheduleLocation}
        onSave={() => saveSchedule(false)}
        onOverride={() => saveSchedule(true)}
      />
    </main>
  );
}

type CalendarHeaderProps = {
  view: CalendarView;
  anchor: string;
  range: { from: string; to: string };
  scope: "personal" | "team";
  community: string;
  communityOptions: string[];
  owner: string;
  ownerOptions: { value: string; label: string }[];
  kind: PipelineCalendarEventKind | "";
  mySchedule: boolean;
  showFilters: boolean;
  hasFilters: boolean;
  loading: boolean;
  refreshing: boolean;
  message: string;
  onView: (value: CalendarView) => void;
  onAnchor: (value: string) => void;
  onCommunity: (value: string) => void;
  onOwner: (value: string) => void;
  onKind: (value: PipelineCalendarEventKind | "") => void;
  onMySchedule: (value: boolean) => void;
  onShowFilters: (value: boolean) => void;
  onRefresh: () => void;
};

function CalendarHeader(props: CalendarHeaderProps) {
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
    <header className="sticky top-0 z-20 border-b border-[#d8dedb] bg-white/95 py-2 backdrop-blur">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <IconButton label="Previous calendar range" onClick={() => props.onAnchor(shiftAnchor(props.view, props.anchor, -1))}><ChevronLeft size={17} /></IconButton>
          <IconButton label="Next calendar range" onClick={() => props.onAnchor(shiftAnchor(props.view, props.anchor, 1))}><ChevronRight size={17} /></IconButton>
          <h1 className="ml-1 truncate text-[17px] font-extrabold tracking-[-0.025em] text-[#202522] sm:text-[20px]">{rangeLabel(props.view, props.range)}</h1>
          <button type="button" onClick={() => props.onAnchor(todayKey())} className="ml-1 h-8 border border-[#bfc7c3] px-2.5 text-[11px] font-bold text-[#3f4743] hover:border-[#167f6b] hover:text-[#116b5a]">Today</button>
        </div>
        <div className="flex items-center gap-1.5">
          <span role="status" aria-live="polite" className="hidden text-[11px] text-[#747b77] lg:inline">{status}</span>
          <IconButton label="Refresh calendar" onClick={props.onRefresh}><RefreshCw size={14} className={props.refreshing ? "animate-spin" : ""} /></IconButton>
          <button type="button" aria-label="Show calendar filters" aria-expanded={props.showFilters} onClick={() => props.onShowFilters(!props.showFilters)} className={`flex h-8 w-8 items-center justify-center border md:hidden ${props.hasFilters ? "border-[#167f6b] text-[#116b5a]" : "border-[#cfd5d2] text-[#626a66]"}`}><Filter size={15} /></button>
          <CalendarViewSwitch view={props.view} onView={props.onView} />
        </div>
      </div>
      <CalendarFilters {...props} onClear={clearFilters} onToggleMine={toggleMine} />
    </header>
  );
}

function CalendarViewSwitch({ view, onView }: { view: CalendarView; onView: (value: CalendarView) => void }) {
  return <div data-guide-target="calendar-view" role="group" aria-label="Calendar view" className="flex border border-[#cfd5d2] bg-[#f4f6f5] p-0.5">{(["month", "week", "agenda"] as const).map((option) => <button key={option} type="button" aria-pressed={view === option} onClick={() => onView(option)} className={`h-8 px-2.5 text-[10px] font-bold capitalize sm:px-3 ${view === option ? "bg-white text-[#202522] shadow-sm" : "text-[#69706c] hover:text-[#202522]"}`}>{option}</button>)}</div>;
}

function CalendarFilters(props: CalendarHeaderProps & { onClear: () => void; onToggleMine: () => void }) {
  return (
    <div data-guide-target="calendar-filters" className={`${props.showFilters ? "flex" : "hidden"} mt-2 flex-wrap items-center gap-2 border-t border-[#edf0ee] pt-2 md:flex`}>
      <span className="shrink-0 bg-[#eaf5f1] px-2.5 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#176f5e]">{props.scope === "personal" ? "My schedule" : "Team schedule"}</span>
      <CalendarFilter label="community" value={props.community} onChange={props.onCommunity} options={props.communityOptions} />
      {props.scope === "team" ? <OwnerFilter value={props.owner} onChange={props.onOwner} options={props.ownerOptions} /> : null}
      <select aria-label="Filter calendar by event type" value={props.kind} onChange={(event) => props.onKind(event.target.value as PipelineCalendarEventKind | "")} className="h-8 min-w-0 border border-[#cfd5d2] bg-white px-2 text-[11px] font-semibold text-[#303632] outline-none focus:border-[#167f6b]">
        <option value="">All work types</option>
        {(Object.keys(kindLabels) as PipelineCalendarEventKind[]).map((value) => <option key={value} value={value}>{kindLabels[value]}</option>)}
      </select>
      {props.scope === "team" ? <button type="button" aria-pressed={props.mySchedule} onClick={props.onToggleMine} className={`flex h-8 shrink-0 items-center gap-1.5 border px-2.5 text-[10px] font-bold ${props.mySchedule ? "border-[#4b68ad] bg-[#eef1ff] text-[#354b85]" : "border-[#cfd5d2] text-[#525a56] hover:border-[#4b68ad]"}`}><UserRoundCheck size={13} /> Mine</button> : null}
      {props.hasFilters ? <button type="button" onClick={props.onClear} className="flex h-8 items-center gap-1 px-2 text-[10px] font-bold text-[#6d7470] hover:text-[#9c3d32]"><X size={12} /> Clear</button> : null}
    </div>
  );
}

function CalendarNotices({ error, mutationError, scheduleOpen, onRetry }: { error: string; mutationError: string; scheduleOpen: boolean; onRetry: () => void }) {
  return <>{error ? <div role="alert" className="mt-3 flex items-center justify-between gap-4 border-l-2 border-[#a16a16] bg-[#fff8ed] px-4 py-3 text-[12px] text-[#6f4b13]"><span>{error}</span><button type="button" onClick={onRetry} className="shrink-0 font-bold">Try again</button></div> : null}{mutationError && !scheduleOpen ? <div role="alert" className="mt-3 border-l-2 border-[#a9473d] bg-[#fff3f1] px-4 py-3 text-[12px] text-[#7c3229]">{mutationError}</div> : null}</>;
}

function CalendarActionQueue({ kind, ...props }: Parameters<typeof ActionQueue>[0] & { kind: PipelineCalendarEventKind | "" }) {
  if (!shouldShowActionQueue(kind, props.items, props.overdue)) return null;
  return <ActionQueue {...props} />;
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
  eventsByDate: Map<string, PipelineCalendarEvent[]>;
  conflicts: Set<string>;
  hasFilters: boolean;
  onOpen: (event: PipelineCalendarEvent) => void;
  onFocusOwner: (owner: string) => void;
};

function CalendarViews(props: CalendarViewsProps) {
  if (props.loading) return <CalendarSkeleton />;
  if (props.view === "month") return <MonthView month={props.anchor.slice(0, 7)} eventsByDate={props.eventsByDate} onOpen={props.onOpen} />;
  if (props.view === "agenda") return <AgendaView events={props.events} hasFilters={props.hasFilters} onOpen={props.onOpen} />;
  if (showTeamWeek(props.scope, props.owner, props.mySchedule)) return <TeamWeekView range={props.range} events={props.events} unscheduled={props.unscheduled} conflicts={props.conflicts} onOpen={props.onOpen} onFocusOwner={props.onFocusOwner} />;
  return <TimedWeekView range={props.range} eventsByDate={props.eventsByDate} onOpen={props.onOpen} />;
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

function CalendarOverlays(props: CalendarOverlaysProps) {
  return <>{props.selected ? <CalendarDrawer selection={props.selected} busy={props.mutationState.busy} scope={props.scope} onClose={props.onCloseSelection} onOpenWorkspace={props.onOpenWorkspace} onSchedule={props.onScheduleSelection} onStatus={props.onStatus} /> : null}{props.scheduleTarget ? <ScheduleDialog target={props.scheduleTarget} start={props.scheduleStart} duration={props.scheduleDuration} method={props.scheduleMethod} location={props.scheduleLocation} state={props.mutationState} onStart={props.onStart} onDuration={props.onDuration} onMethod={props.onMethod} onLocation={props.onLocation} onClose={props.onCloseSchedule} onSave={props.onSave} onOverride={props.onOverride} /> : null}</>;
}

function ActionQueue({ scope, items, total, overdue, onOpen, onSchedule, onSelectEvent }: { scope: "personal" | "team"; items: PipelineUnscheduledAssessment[]; total: number; overdue: PipelineCalendarEvent[]; onOpen: (item: PipelineUnscheduledAssessment) => void; onSchedule: (item: PipelineUnscheduledAssessment) => void; onSelectEvent: (event: PipelineCalendarEvent) => void }) {
  return (
    <section aria-label="Calendar actions" className="mt-3 border border-[#d8dedb] bg-[#f7f9f8]">
      <div className="flex items-center justify-between border-b border-[#e3e7e5] px-3 py-2.5 sm:px-4"><div className="flex items-center gap-2"><AlertTriangle size={15} className="text-[#a16a16]" /><h2 className="text-[13px] font-extrabold text-[#252a27]">Needs attention</h2></div><span className="text-[10px] font-bold text-[#6d7470]">{total + overdue.length} item{total + overdue.length === 1 ? "" : "s"}</span></div>
      <div className="flex gap-2 overflow-x-auto p-2.5 sm:p-3">
        {overdue.map((event) => <button key={event.id} type="button" onClick={() => onSelectEvent(event)} className="w-[245px] shrink-0 border border-[#e4c7c2] bg-white p-3 text-left hover:border-[#a9473d]"><span className="block text-[10px] font-extrabold uppercase tracking-[0.07em] text-[#9c3d32]">Overdue assessment</span><span className="mt-1.5 block truncate text-[13px] font-extrabold text-[#252a27]">{calendarClientName(event.clientName, event.community)}</span><span className="mt-1 block truncate text-[11px] text-[#69706c]">{event.owner} - {shortDate(event.date)}</span></button>)}
        {items.map((item) => (
          <article key={item.referralId} className="w-[265px] shrink-0 border border-[#d8dedb] bg-white p-3">
            <div className="flex items-start justify-between gap-2"><span className={`text-[10px] font-extrabold uppercase tracking-[0.07em] ${item.nextAction === "schedule" ? "text-[#176f5e]" : item.nextAction === "assign" ? "text-[#9c3d32]" : "text-[#8a5c14]"}`}>{workflowLabels[item.workflowStatus]}</span><span className="shrink-0 text-[10px] text-[#7b827e]">{ageLabel(item.receivedDate)}</span></div>
            <button type="button" onClick={() => onOpen(item)} className="mt-1.5 block w-full truncate text-left text-[13px] font-extrabold text-[#252a27] hover:text-[#116b5a]">{calendarClientName(item.clientName, item.community)}</button>
            <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-[#69706c]"><span className="truncate">{item.community}</span><span className="truncate">{item.owner}</span></div>
            <button type="button" onClick={() => item.nextAction === "schedule" ? onSchedule(item) : onOpen(item)} className="mt-3 h-8 w-full bg-[#167f6b] px-3 text-[11px] font-extrabold text-white hover:bg-[#116b5a]">{item.nextAction === "schedule" ? "Schedule assessment" : item.nextAction === "assign" && scope === "team" ? "Assign referral" : "Finish intake"}</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function MonthView({ month, eventsByDate, onOpen }: { month: string; eventsByDate: Map<string, PipelineCalendarEvent[]>; onOpen: (event: PipelineCalendarEvent) => void }) {
  const days = calendarDays(month);
  return (
    <div className="mt-3 overflow-x-auto border border-[#d8dedb]"><div className="grid min-w-[760px] grid-cols-7">
      {weekdays.map((day) => <div key={day} className="border-b border-r border-[#d8dedb] bg-[#f7f9f8] px-3 py-2 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#69706c] last:border-r-0">{day}</div>)}
      {days.map((day) => {
        const dayEvents = eventsByDate.get(day.date) ?? [];
        const scheduled = dayEvents.filter((event) => event.kind === "assessment");
        const otherCount = dayEvents.length - scheduled.length;
        return <div key={day.date} className={`min-h-[112px] border-b border-r border-[#e1e5e3] p-2 last:border-r-0 ${day.inMonth ? "bg-white" : "bg-[#fafbfa]"}`}><div className={`mb-2 text-[11px] font-extrabold ${day.today ? "text-[#0f8b73]" : day.inMonth ? "text-[#515854]" : "text-[#a0a6a2]"}`}>{day.day}</div><div className="space-y-1.5">{scheduled.slice(0, 2).map((event) => <CalendarEventButton key={event.id} event={event} onOpen={onOpen} compact />)}{otherCount > 0 ? <div className="px-1 text-[10px] font-bold text-[#737a76]">{otherCount} assignment/follow-up{otherCount === 1 ? "" : "s"}</div> : null}{scheduled.length > 2 ? <div className="px-1 text-[10px] font-bold text-[#526a63]">+{scheduled.length - 2} assessments</div> : null}</div></div>;
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

function TeamWeekView({ range, events, unscheduled, conflicts, onOpen, onFocusOwner }: { range: { from: string; to: string }; events: PipelineCalendarEvent[]; unscheduled: PipelineUnscheduledAssessment[]; conflicts: Set<string>; onOpen: (event: PipelineCalendarEvent) => void; onFocusOwner: (owner: string) => void }) {
  const dates = dateKeys(range.from, range.to);
  const owners = uniqueOwnerOptions([...events.map((event) => ({ id: event.ownerId, name: event.owner })), ...unscheduled.map((item) => ({ id: item.ownerId, name: item.owner }))]).filter((item) => item.label !== "Unassigned");
  if (owners.length === 0) return <EmptyCalendar title="No team work is scheduled in this week." />;
  return (
    <section aria-label="Supervisor team week" className="mt-3 overflow-auto border border-[#d8dedb]"><div className="min-w-[1050px]">
      <div className="grid grid-cols-[190px_repeat(7,minmax(118px,1fr))] border-b border-[#d8dedb] bg-[#f7f9f8]"><div className="px-3 py-3 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#69706c]">Assessor</div>{dates.map((date) => <div key={date} className={`border-l border-[#d8dedb] px-2 py-2.5 ${date === todayKey() ? "bg-[#eaf5f1]" : ""}`}><span className="block text-[9px] font-extrabold uppercase text-[#737a76]">{weekdays[parseDate(date).getUTCDay()]}</span><span className="block text-[12px] font-extrabold text-[#252a27]">{shortDate(date)}</span></div>)}</div>
      {owners.map((assessor) => { const ownerEvents = events.filter((event) => ownerKey(event.ownerId, event.owner) === assessor.value); const ownerQueue = unscheduled.filter((item) => ownerKey(item.ownerId, item.owner) === assessor.value); const conflictCount = ownerEvents.filter((event) => conflicts.has(event.id)).length; const scheduledCount = ownerEvents.filter((event) => event.kind === "assessment").length; return <div key={assessor.value} className="grid grid-cols-[190px_repeat(7,minmax(118px,1fr))] border-b border-[#e1e5e3] last:border-b-0"><button type="button" onClick={() => onFocusOwner(assessor.value)} className="px-3 py-3 text-left hover:bg-[#f4f8f6]"><span className="block truncate text-[12px] font-extrabold text-[#252a27]">{assessor.label}</span><span className="mt-1 block text-[10px] text-[#737a76]">{scheduledCount} scheduled - {ownerQueue.length} waiting</span>{conflictCount > 0 ? <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-extrabold text-[#9c3d32]"><AlertTriangle size={11} /> {Math.ceil(conflictCount / 2)} conflict{conflictCount > 2 ? "s" : ""}</span> : null}</button>{dates.map((date) => { const dayEvents = ownerEvents.filter((event) => event.date === date); const appointments = dayEvents.filter((event) => event.kind === "assessment"); const other = dayEvents.length - appointments.length; return <div key={date} className={`min-h-[112px] border-l border-[#e1e5e3] p-1.5 ${appointments.length >= 5 ? "bg-[#fff9ef]" : "bg-white"}`}>{appointments.slice(0, 3).map((event) => <CalendarEventButton key={event.id} event={event} onOpen={onOpen} compact conflict={conflicts.has(event.id)} />)}{appointments.length > 3 ? <button type="button" onClick={() => onOpen(appointments[3])} className="mt-1 text-[9px] font-bold text-[#526a63]">+{appointments.length - 3} more</button> : null}{other > 0 ? <div className="mt-1 text-[9px] font-semibold text-[#7a817d]">{other} assignment/follow-up</div> : null}</div>; })}</div>; })}
    </div></section>
  );
}

function AgendaView({ events, hasFilters, onOpen }: { events: PipelineCalendarEvent[]; hasFilters: boolean; onOpen: (event: PipelineCalendarEvent) => void }) {
  const groups = groupEventsByDate(events);
  if (events.length === 0) return <EmptyCalendar title={hasFilters ? "No work matches these filters." : "No calendar work falls in this range."} />;
  return <div className="mt-3 border border-[#d8dedb]">{[...groups.entries()].map(([date, dayEvents]) => <section key={date} className="border-b border-[#e1e5e3] last:border-b-0 md:grid md:grid-cols-[150px_minmax(0,1fr)]"><div className="bg-[#f7f9f8] px-3 py-3 md:px-4"><div className="text-[12px] font-extrabold text-[#252a27]">{longDate(date)}</div><div className="mt-0.5 text-[10px] font-bold text-[#69706c]">{dayEvents.length} item{dayEvents.length === 1 ? "" : "s"}</div></div><div className="divide-y divide-[#e5e8e6]">{dayEvents.map((event) => <button key={event.id} type="button" onClick={() => onOpen(event)} className="grid w-full gap-1 px-3 py-3 text-left hover:bg-[#f7faf9] sm:grid-cols-[minmax(0,1fr)_130px] sm:px-4 lg:grid-cols-[minmax(0,1fr)_150px_150px]"><span className="min-w-0"><span className="block truncate text-[13px] font-extrabold text-[#252a27]">{calendarClientName(event.clientName, event.community)}</span><span className="mt-1 block truncate text-[11px] text-[#69706c]">{event.startsAt ? `${eventTime(event.startsAt)} - ` : ""}{event.title}</span></span><span className="truncate text-[11px] font-semibold text-[#59615d]">{event.community}</span><span className="hidden truncate text-[11px] text-[#737a76] lg:block">{event.owner}</span></button>)}</div></section>)}</div>;
}

function CalendarDrawer({ selection, busy, scope, onClose, onOpenWorkspace, onSchedule, onStatus }: { selection: CalendarSelection; busy: boolean; scope: "personal" | "team"; onClose: () => void; onOpenWorkspace: () => void; onSchedule: () => void; onStatus: (status: "cancelled" | "no_show") => void }) {
  const model = calendarDrawerModel(selection, scope);
  return (
    <div className="fixed inset-0 z-50 bg-[#18201d]/30" role="presentation" onMouseDown={(mouseEvent) => { if (mouseEvent.currentTarget === mouseEvent.target) onClose(); }}>
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

type CalendarDrawerModel = {
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
      <CalendarDrawerAlerts model={model} />
    </div>
  );
}

function CalendarDrawerAlerts({ model }: { model: CalendarDrawerModel }) {
  return <>{model.followUps.length > 0 ? <div className="mt-5 border-l-2 border-[#a16a16] bg-[#fff8ed] p-3"><div className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-[#8a5c14]">Follow-ups</div>{model.followUps.map((label) => <div key={label} className="mt-1.5 text-[12px] text-[#4b4030]">{label}</div>)}</div> : null}{model.needsAssignment ? <div className="mt-5 border-l-2 border-[#a9473d] bg-[#fff3f1] p-3 text-[12px] text-[#7c3229]">Assign this referral before an assessment can be scheduled.</div> : null}</>;
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
  return <select aria-label={`Filter calendar by ${label}`} value={value} onChange={(event) => onChange(event.target.value)} className="h-8 min-w-0 border border-[#cfd5d2] bg-white px-2 text-[11px] font-semibold text-[#303632] outline-none focus:border-[#167f6b]"><option value="">All {label === "community" ? "communities" : "owners"}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
}

function OwnerFilter({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <select aria-label="Filter calendar by assessor" value={value} onChange={(event) => onChange(event.target.value)} className="h-8 min-w-0 border border-[#cfd5d2] bg-white px-2 text-[11px] font-semibold text-[#303632] outline-none focus:border-[#167f6b]"><option value="">All assessors</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}

function IconButton({ label, onClick, disabled = false, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className="flex h-8 w-8 shrink-0 items-center justify-center border border-[#cfd5d2] text-[#626a66] hover:border-[#167f6b] hover:text-[#116b5a] disabled:opacity-50">{children}</button>;
}

function CalendarSkeleton() { return <div className="mt-3 animate-pulse border border-[#d8dedb] p-4"><div className="h-10 bg-[#eef1ef]" /><div className="mt-3 grid grid-cols-3 gap-3"><div className="h-52 bg-[#f4f6f5]" /><div className="h-52 bg-[#f4f6f5]" /><div className="h-52 bg-[#f4f6f5]" /></div></div>; }
function EmptyCalendar({ title }: { title: string }) { return <div className="mt-3 border border-[#d8dedb] px-4 py-16 text-center"><CalendarClock size={22} className="mx-auto text-[#8a918d]" /><div className="mt-3 text-[13px] font-extrabold text-[#343a36]">{title}</div></div>; }

async function assessmentForSchedule(target: ScheduleTarget) {
  if (target.assessmentId) {
    const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(`/api/assessments/${encodeURIComponent(target.assessmentId)}`, { cache: "no-store" });
    return payload.assessment;
  }
  const existing = await fetchPipelineJson<AssessmentListResponse>(`/api/referrals/${target.referralId}/assessments`, { cache: "no-store" });
  if (existing.assessments[0]) return existing.assessments[0];
  const created = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(`/api/referrals/${target.referralId}/assessments`, { method: "POST", body: JSON.stringify({ data: {}, client_mutation_id: mutationId("calendar-create-assessment") }) });
  return created.assessment;
}

function scheduleTargetFromUnscheduled(item: PipelineUnscheduledAssessment): ScheduleTarget { return { referralId: item.referralId, assessmentId: item.assessmentId, clientName: item.clientName, community: item.community, reschedule: false }; }
function scheduleTargetFromSelection(selection: CalendarSelection): ScheduleTarget { if (selection.type === "unscheduled") return scheduleTargetFromUnscheduled(selection.item); const event = selection.event; return { referralId: event.referralId, assessmentId: event.assessmentId, clientName: event.clientName, community: event.community, startsAt: event.startsAt, durationMinutes: event.durationMinutes, method: event.method, location: event.location, reschedule: event.kind === "assessment" }; }
function selectionIdentity(selection: CalendarSelection) { return selection.type === "event" ? { referralId: selection.event.referralId, clientName: selection.event.clientName, community: selection.event.community } : { referralId: selection.item.referralId, clientName: selection.item.clientName, community: selection.item.community }; }

function findScheduleConflicts(events: PipelineCalendarEvent[]) {
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
  if (event.kind !== "assessment") return false;
  if (!event.startsAt || !event.ownerId) return false;
  return ["scheduled", "rescheduled"].includes(event.scheduleStatus ?? "scheduled");
}

function addOwnerScheduleConflicts(ownerEvents: PipelineCalendarEvent[], conflicts: Set<string>) {
  const sorted = ownerEvents.sort((left, right) => calendarStart(left).localeCompare(calendarStart(right)));
  for (let index = 0; index < sorted.length; index += 1) {
    const left = sorted[index];
    const leftStart = Date.parse(calendarStart(left));
    const leftEnd = leftStart + calendarDuration(left) * 60_000;
    for (let candidateIndex = index + 1; candidateIndex < sorted.length; candidateIndex += 1) {
      const right = sorted[candidateIndex];
      const rightStart = Date.parse(calendarStart(right));
      if (rightStart >= leftEnd) break;
      const rightEnd = rightStart + calendarDuration(right) * 60_000;
      if (rightEnd <= leftStart) continue;
      conflicts.add(left.id);
      conflicts.add(right.id);
    }
  }
}

function calendarStart(event: PipelineCalendarEvent) { return event.startsAt ?? ""; }
function calendarDuration(event: PipelineCalendarEvent) { return event.durationMinutes ?? 60; }

function resolveCalendarState(snapshot: CalendarSnapshot | undefined, requestState: { key: string; loading: boolean; error: string }, requestKey: string) {
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

function hasCalendarFilters(community: string, owner: string, kind: string, mySchedule: boolean) {
  return Boolean(community || owner || kind || mySchedule);
}

function calendarQueueTotal(snapshot: CalendarSnapshot | undefined, visible: PipelineUnscheduledAssessment[], hasFilters: boolean) {
  if (hasFilters) return visible.length;
  return snapshot?.unscheduledTotal ?? visible.length;
}

function calendarStatusText(loading: boolean, refreshing: boolean, message: string) {
  if (loading) return "Loading...";
  if (refreshing) return "Refreshing...";
  return message;
}

function shouldShowActionQueue(kind: PipelineCalendarEventKind | "", items: PipelineUnscheduledAssessment[], overdue: PipelineCalendarEvent[]) {
  if (kind && kind !== "assessment") return false;
  return items.length > 0 || overdue.length > 0;
}

function showTeamWeek(scope: "personal" | "team", owner: string, mySchedule: boolean) {
  return scope === "team" && !owner && !mySchedule;
}

function calendarDrawerModel(selection: CalendarSelection, scope: "personal" | "team"): CalendarDrawerModel {
  if (selection.type === "unscheduled") return unscheduledDrawerModel(selection.item, scope);
  return eventDrawerModel(selection.event);
}

function unscheduledDrawerModel(item: PipelineUnscheduledAssessment, scope: "personal" | "team"): CalendarDrawerModel {
  return {
    kicker: workflowLabels[item.workflowStatus],
    clientName: calendarClientName(item.clientName, item.community),
    community: item.community,
    owner: item.owner,
    dateLabel: "",
    receivedLabel: `${longDate(item.receivedDate)} (${ageLabel(item.receivedDate)})`,
    methodLabel: "",
    durationLabel: "",
    followUps: [],
    needsAssignment: scope === "team" && item.nextAction === "assign",
    zoomUrl: "",
    canSchedule: item.nextAction === "schedule",
    isAppointment: false,
    showStatusActions: false,
  };
}

function eventDrawerModel(event: PipelineCalendarEvent): CalendarDrawerModel {
  const isAppointment = calendarEventIsAppointment(event);
  return {
    kicker: event.title,
    clientName: calendarClientName(event.clientName, event.community),
    community: event.community,
    owner: event.owner,
    dateLabel: calendarEventDateLabel(event),
    receivedLabel: "",
    methodLabel: methodLabel(event.method),
    durationLabel: `${calendarDuration(event)} minutes`,
    followUps: event.followUpLabels ?? [],
    needsAssignment: false,
    zoomUrl: calendarEventZoomUrl(event),
    canSchedule: isAppointment,
    isAppointment,
    showStatusActions: isAppointment && event.scheduleStatus !== "completed",
  };
}

function calendarEventIsAppointment(event: PipelineCalendarEvent) {
  return event.kind === "assessment" && Boolean(event.assessmentId);
}

function calendarEventDateLabel(event: PipelineCalendarEvent) {
  if (!event.startsAt) return longDate(event.date);
  return `${longDate(event.date)} at ${eventTime(event.startsAt)}`;
}

function calendarEventZoomUrl(event: PipelineCalendarEvent) {
  if (event.method !== "zoom") return "";
  if (!event.location || !isHttpUrl(event.location)) return "";
  return event.location;
}

function timedEventPosition(event: PipelineCalendarEvent, dayEvents: PipelineCalendarEvent[]) {
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
  const overlapping = dayEvents.filter((candidate) => { if (!candidate.startsAt) return false; const candidateParts = operationalTimeParts(candidate.startsAt); if (!candidateParts) return false; const candidateStart = candidateParts.hour * 60 + candidateParts.minute; return candidateStart < startMinutes + duration && candidateStart + (candidate.durationMinutes ?? 60) > startMinutes; });
  const slot = Math.max(0, overlapping.findIndex((candidate) => candidate.id === event.id));
  const columns = Math.min(3, Math.max(1, overlapping.length));
  return { top, height, left: `calc(${slot % columns * (100 / columns)}% + 2px)`, width: `calc(${100 / columns}% - 4px)` };
}

function calendarClientName(name: string, community: string) { return formatClientIdentityTitle({ name, community }); }
function calendarRange(view: CalendarView, anchor: string) { if (view === "week") { const date = parseDate(anchor); date.setUTCDate(date.getUTCDate() - date.getUTCDay()); const from = dateKey(date); return { from, to: addCalendarDays(from, 6) }; } if (view === "agenda") return { from: anchor, to: addCalendarDays(anchor, 29) }; const from = `${anchor.slice(0, 7)}-01`; const date = parseDate(from); date.setUTCMonth(date.getUTCMonth() + 1); date.setUTCDate(0); return { from, to: dateKey(date) }; }
function shiftAnchor(view: CalendarView, anchor: string, direction: number) { if (view === "month") { const date = parseDate(`${anchor.slice(0, 7)}-01`); date.setUTCMonth(date.getUTCMonth() + direction); return dateKey(date); } return addCalendarDays(anchor, direction * (view === "week" ? 7 : 30)); }
function rangeLabel(view: CalendarView, range: { from: string; to: string }) { if (view === "month") return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(parseDate(range.from)); return `${shortDate(range.from)} - ${shortDate(range.to)}`; }
function groupEventsByDate(events: PipelineCalendarEvent[]) { const grouped = new Map<string, PipelineCalendarEvent[]>(); for (const event of events) grouped.set(event.date, [...(grouped.get(event.date) ?? []), event]); return grouped; }
function uniqueValues(values: string[]) { return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right)); }
function uniqueOwnerOptions(values: { id?: string; name: string }[]) { const options = new Map<string, string>(); for (const value of values) { const name = value.name.trim() || "Unassigned"; options.set(ownerKey(value.id, name), name); } return [...options.entries()].map(([value, label]) => ({ value, label })).sort((left, right) => left.label.localeCompare(right.label)); }
function ownerKey(id: string | undefined, name: string) { return id ? `id:${id}` : `name:${name.trim().toLocaleLowerCase() || "unassigned"}`; }
function todayKey() { return calendarToday(); }
function parseDate(value: string) { return new Date(`${value}T00:00:00.000Z`); }
function dateKey(date: Date) { return date.toISOString().slice(0, 10); }
function dateKeys(from: string, to: string) { const values: string[] = []; for (let current = from; current <= to; current = addCalendarDays(current, 1)) values.push(current); return values; }
function shortDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(parseDate(value)); }
function longDate(value: string) { return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(parseDate(value)); }
function eventTime(value: string | undefined) { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: operationalTimeZone }).format(date); }
function formatHour(hour: number) { return new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 1, hour))); }
function methodLabel(method: string | undefined) { if (method === "zoom") return "Zoom"; if (method === "in_person") return "In person"; if (method === "phone") return "Phone"; if (method === "record_review") return "Record review"; return "Assessment"; }
function normalizeMethod(method: string | undefined): AssessmentScheduleMethod { return method === "in_person" || method === "phone" || method === "record_review" || method === "zoom" ? method : "zoom"; }
function ageLabel(receivedDate: string) { const days = Math.max(0, Math.floor((Date.parse(`${todayKey()}T00:00:00.000Z`) - Date.parse(`${receivedDate}T00:00:00.000Z`)) / 86_400_000)); return days === 0 ? "Today" : `${days}d waiting`; }
function calendarDays(month: string) { const first = parseDate(`${month}-01`); const start = new Date(first); start.setUTCDate(1 - first.getUTCDay()); const today = todayKey(); return Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setUTCDate(start.getUTCDate() + index); const key = dateKey(date); return { date: key, day: date.getUTCDate(), inMonth: key.startsWith(month), today: key === today }; }); }
function operationalTimeParts(value: string) { const date = new Date(value); if (Number.isNaN(date.getTime())) return null; const parts = new Intl.DateTimeFormat("en-US", { timeZone: operationalTimeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date); const record = Object.fromEntries(parts.map((part) => [part.type, part.value])); return { hour: Number(record.hour), minute: Number(record.minute) }; }
function isoToOperationalInput(value: string) { const date = new Date(value); if (Number.isNaN(date.getTime())) return ""; const parts = new Intl.DateTimeFormat("en-US", { timeZone: operationalTimeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date); const record = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${record.year}-${record.month}-${record.day}T${record.hour}:${record.minute}`; }
function operationalInputToIso(value: string) { const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value); if (!match) return null; const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])); let guess = desired; for (let index = 0; index < 3; index += 1) { const actualInput = isoToOperationalInput(new Date(guess).toISOString()); const actualMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(actualInput); if (!actualMatch) return null; const actual = Date.UTC(Number(actualMatch[1]), Number(actualMatch[2]) - 1, Number(actualMatch[3]), Number(actualMatch[4]), Number(actualMatch[5])); guess += desired - actual; } return isoToOperationalInput(new Date(guess).toISOString()) === value ? new Date(guess).toISOString() : null; }
function nextSchedulingInput() { const next = new Date(Date.now() + 60 * 60_000); next.setMinutes(0, 0, 0); return isoToOperationalInput(next.toISOString()); }
function mutationId(prefix: string) { return `${prefix}:${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}:${Math.random().toString(16).slice(2)}`}`; }
function isHttpUrl(value: string) { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; } }
