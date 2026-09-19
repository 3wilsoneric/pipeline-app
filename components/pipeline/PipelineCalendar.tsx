"use client";
import { pipelineSurfaceReady } from "@/lib/observability/browser-performance-contract";

import { useEffect, useRef, useState } from "react";

import {
  CalendarHeader,
  CalendarNotices,
  CalendarOverlays,
  CalendarPortal,
  CalendarViews,
  CalendarFollowUps,
  SchedulingQueue,
} from "@/components/pipeline/PipelineCalendarPresentation";
import CalendarDay from "@/components/pipeline/CalendarDay";
import calendarStyles from "./CalendarWork.module.css";
import { usePipelineAuth } from "@/components/auth/PipelineAuthProvider";
import {
  calendarClientName as formatCalendarClientName,
  calendarRange,
  findScheduleConflicts,
  groupEventsByDate,
  hasCalendarFilters,
  isoToOperationalInput,
  nextSchedulingInput,
  normalizeMethod,
  operationalInputToIso,
  operationalTimeZone,
  ownerKey,
  resolveCalendarState,
  scheduleTargetFromSelection,
  scheduleTargetFromUnscheduled,
  selectionIdentity,
  todayKey,
  uniqueOwnerOptions,
  uniqueValues,
  type CalendarSelection,
  type CalendarSnapshot,
  type CalendarView,
  type ScheduleTarget,
} from "@/components/pipeline/pipeline-calendar-model";
import type {
  AssessmentListResponse,
  AssessmentScheduleMethod,
  PipelineAssessmentRecord,
} from "@/lib/assessment/assessment-records";
import { fetchPipelineJson, PipelineApiError, usePipelineDataGeneration } from "@/lib/auth/authenticated-fetch";
import type { PipelineCalendarEvent, PipelineCalendarResponse } from "@/lib/pipeline/calendar-types";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import { loadPipelineWorkspaceResumeLocation } from "@/lib/pipeline/work-continuity-client";

export default function PipelineCalendar({ onOpenPacket }: { onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void }) {
  const { initialUser } = usePipelineAuth();
  const navigationKey = initialUser?.id ?? "calendar";
  const calendarElement = useRef<HTMLElement>(null);
  const restoreScroll = useRef<number | null>(null);
  const [view, setView] = useState<CalendarView>("day");
  const [anchor, setAnchor] = useState(todayKey);
  const [community, setCommunity] = useState("");
  const [owner, setOwner] = useState("");
  const [mySchedule, setMySchedule] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueSearch, setQueueSearch] = useState("");
  const [queueLimit, setQueueLimit] = useState(24);
  const [refreshToken, setRefreshToken] = useState(0);
  const dataGeneration = usePipelineDataGeneration();
  const [selected, setSelected] = useState<CalendarSelection | null>(null);
  const pendingFollowUp = useRef(false);
  const confirmLeaveDetails = () => !pendingFollowUp.current || window.confirm("Leave without saving this follow-up? Choose Cancel to keep editing.");
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget | null>(null);
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleDuration, setScheduleDuration] = useState("60");
  const [scheduleMethod, setScheduleMethod] = useState<AssessmentScheduleMethod>("zoom");
  const [scheduleLocation, setScheduleLocation] = useState("");
  const [mutationState, setMutationState] = useState({ busy: false, error: "", message: "", canOverride: false });
  const scheduleAssessmentRef = useRef<PipelineAssessmentRecord | null>(null);
  const deferredQueueSearch = useDebouncedValue(queueSearch, 250);
  const range = calendarRange(view, anchor);
  const requestKey = [view, range.from, range.to, deferredQueueSearch, queueLimit, community, owner, mySchedule].join(":");
  const [cache, setCache] = useState<Record<string, CalendarSnapshot>>({});
  const [navigationReady, setNavigationReady] = useState(false);
  const [requestState, setRequestState] = useState({ key: "", loading: false, error: "" });
  const calendarState = resolveCalendarState(cache[requestKey], requestState, requestKey);
  const { snapshot, loading, refreshing, error, events, unscheduled, scope, viewer } = calendarState;

  useEffect(() => {
    const saved = calendarNavigation.get(navigationKey);
    queueMicrotask(() => {
      if (saved) {
        restoreScroll.current = saved.scrollTop;
        setView(saved.view); setAnchor(saved.anchor); setCommunity(saved.community);
        setOwner(saved.owner); setMySchedule(saved.mine);
      }
      setNavigationReady(true);
    });
  }, [navigationKey]);

  useEffect(() => {
    if (navigationReady) calendarNavigation.set(navigationKey, { view, anchor, community, owner, mine: mySchedule, scrollTop: calendarNavigation.get(navigationKey)?.scrollTop ?? 0 });
  }, [navigationReady, navigationKey, view, anchor, community, owner, mySchedule]);

  useEffect(() => {
    if (!snapshot || restoreScroll.current === null) return;
    const top = restoreScroll.current;
    const frame = requestAnimationFrame(() => { if (calendarElement.current) calendarElement.current.scrollTop = top; restoreScroll.current = null; });
    return () => cancelAnimationFrame(frame);
  }, [snapshot]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") setRefreshToken((value) => value + 1);
    }, 30_000);
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
    if (!queueOpen && !selected && !scheduleTarget) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeTopOverlay = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-label^="Preview "]')) return;
      if (event.key !== "Escape" || mutationState.busy) return;
      if (scheduleTarget) {
        scheduleAssessmentRef.current = null;
        setScheduleTarget(null);
      } else if (selected) { if (!pendingFollowUp.current || window.confirm("Leave without saving this follow-up? Choose Cancel to keep editing.")) setSelected(null); }
      else setQueueOpen(false);
    };
    window.addEventListener("keydown", closeTopOverlay);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeTopOverlay);
    };
  }, [mutationState.busy, queueOpen, scheduleTarget, selected]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (pendingFollowUp.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => {
    if (!navigationReady) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      from: range.from,
      to: range.to,
      queue_limit: String(queueLimit),
      include_assignments: "false",
      include_work: String(view === "day"),
    });
    if (deferredQueueSearch) params.set("queue_q", deferredQueueSearch);
    if (community) params.set("queue_community", community);
    if (owner) params.set("queue_owner", owner);
    if (mySchedule) params.set("queue_mine", "true");
    queueMicrotask(() => {
      if (!controller.signal.aborted) setRequestState({ key: requestKey, loading: true, error: "" });
    });
    fetchPipelineJson<PipelineCalendarResponse>(`/api/calendar/events?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    }, { cacheTtlMs: 15_000, bypassCache: refreshToken > 0 }).then((payload) => {
      if (controller.signal.aborted) return;
      setCache((current) => ({
        ...Object.fromEntries(Object.entries(current).filter(([key]) => key !== requestKey).slice(-15)),
        [requestKey]: {
          events: payload.events ?? [],
          continuing: payload.continuing ?? [],
          unscheduled: payload.unscheduled ?? [],
          unscheduledTotal: payload.unscheduledTotal ?? 0,
          unscheduledHasMore: payload.unscheduledHasMore ?? false,
          assessors: payload.assessors ?? [],
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
  }, [navigationReady, view, community, deferredQueueSearch, mySchedule, owner, queueLimit, range.from, range.to, refreshToken, requestKey, dataGeneration]);

  const calendarEvents = events.filter((event) => event.kind !== "referral_assigned");
  const communityOptions = uniqueValues([
    community,
    ...calendarEvents.map((event) => event.community),
    ...(snapshot?.continuing ?? []).map((event) => event.community),
    ...unscheduled.map((item) => item.community),
  ]);
  const ownerOptions = uniqueOwnerOptions([
    ...(snapshot?.assessors ?? []).map((assessor) => ({ id: assessor.id, name: assessor.name })),
    ...calendarEvents.map((event) => ({ id: event.ownerId, name: event.owner })),
    ...unscheduled.map((item) => ({ id: item.ownerId, name: item.owner })),
  ]);
  const visibleEvents = calendarEvents.filter((event) => (
    (!community || event.community === community)
    && (!owner || ownerKey(event.ownerId, event.owner) === owner)
    && (scope === "personal" || !mySchedule || (Boolean(viewer?.id) && event.ownerId === viewer?.id))
  ));
  const appointments = visibleEvents.filter((event) => event.kind === "assessment");
  const followUps = visibleEvents.filter((event) => event.kind === "follow_up");
  const continuing = (snapshot?.continuing ?? []).filter((event) => (
    (!community || event.community === community)
    && (!owner || ownerKey(event.ownerId, event.owner) === owner)
    && (scope === "personal" || !mySchedule || event.ownerId === viewer?.id)
  ));
  const eventsByDate = groupEventsByDate(appointments);
  const hasFilters = hasCalendarFilters(community, owner, scope === "team" && mySchedule);
  const overdue = visibleEvents.filter((event) => event.kind === "assessment" && event.status === "overdue");
  const conflicts = findScheduleConflicts(visibleEvents);
  const scheduledCount = visibleEvents.filter((event) => event.kind === "assessment").length;

  const openWorkspace = (identity: { referralId: number; clientName: string; community: string }, location: PipelineWorkspaceLocation = { view: "intake" }) => {
    onOpenPacket({ id: identity.referralId, name: calendarClientName(identity.clientName, identity.community), community: identity.community as Referral["community"] }, location);
  };

  const openAssessment = async (event: PipelineCalendarEvent) => {
    const source = `${window.location.pathname}${window.location.search}`;
    const saved = await loadPipelineWorkspaceResumeLocation(event.referralId).catch(() => undefined);
    if (source !== `${window.location.pathname}${window.location.search}`) return;
    openWorkspace(selectionIdentity({ type: "event", event }), saved?.view === "assessment" ? saved : { view: "assessment" });
  };

  const beginScheduling = (target: ScheduleTarget) => {
    setSelected(null);
    scheduleAssessmentRef.current = null;
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
      const assessment = await resolveAssessmentForSchedule(scheduleTarget, scheduleAssessmentRef.current);
      scheduleAssessmentRef.current = assessment;
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
      scheduleAssessmentRef.current = null;
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

  const updateAppointmentStatus = async (event: PipelineCalendarEvent, status: "cancelled" | "no_show" | "completed") => {
    if (!confirmLeaveDetails()) return;
    if (!event.assessmentId) return;
    const confirmation = status === "completed"
      ? "Record that this interview happened? Documentation stays editable. This does not sign, submit, or send the assessment."
      : status === "no_show"
      ? "Mark this assessment as a no-show? It will return to the scheduling queue."
      : "Cancel this assessment appointment? It will return to the scheduling queue.";
    if (!window.confirm(confirmation)) return;
    setMutationState({ busy: true, error: "", message: status === "completed" ? "Recording interview..." : status === "no_show" ? "Recording no-show..." : "Cancelling appointment...", canOverride: false });
    try {
      const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(`/api/assessments/${encodeURIComponent(event.assessmentId)}`, { cache: "no-store" });
      const assessment = payload.assessment;
      if (event.assessmentVersion !== undefined && assessment.version !== event.assessmentVersion) {
        throw new Error("This assessment changed after the calendar loaded. Close this panel and refresh the calendar before recording the outcome.");
      }
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
      refreshCalendar(status === "completed" ? "Interview recorded. Continue documentation whenever you are ready." : status === "no_show" ? "No-show recorded" : "Appointment cancelled");
    } catch (reason) {
      setMutationState({ busy: false, error: reason instanceof Error ? reason.message : "The appointment could not be updated.", message: "", canOverride: false });
    }
  };

  const closeSchedule = () => {
    scheduleAssessmentRef.current = null;
    setScheduleTarget(null);
  };

  return (
    <main ref={calendarElement} onScroll={(event) => { const saved = calendarNavigation.get(navigationKey); if (saved && restoreScroll.current === null) saved.scrollTop = event.currentTarget.scrollTop; }} data-guide-target="calendar-workspace" data-performance-ready={pipelineSurfaceReady("calendar", loading, error)} aria-busy={loading} className={calendarStyles.desktop}>
      <div className={calendarStyles.board}>
        <CalendarHeader
          view={view}
          anchor={anchor}
          range={range}
          scope={scope}
          community={community}
          communityOptions={communityOptions}
          owner={owner}
          ownerOptions={ownerOptions}
          mySchedule={mySchedule}
          showFilters={showFilters}
          hasFilters={hasFilters}
          loading={loading}
          refreshing={refreshing}
          busy={mutationState.busy}
          message={error ? "" : mutationState.message}
          queueCount={snapshot?.unscheduledTotal ?? unscheduled.length}
          queueOpen={queueOpen}
          scheduledCount={scheduledCount}
          overdueCount={overdue.length}
          onView={(value) => {
            setView(value);
          }}
          onAnchor={setAnchor}
          onCommunity={setCommunity}
          onOwner={setOwner}
          onMySchedule={setMySchedule}
          onShowFilters={setShowFilters}
          onOpenQueue={() => setQueueOpen(true)}
          onRefresh={() => setRefreshToken((value) => value + 1)}
        />
        <div className={calendarStyles.paper}>
        <CalendarNotices error={error} mutationError={mutationState.error} scheduleOpen={Boolean(scheduleTarget)} onRetry={() => setRefreshToken((value) => value + 1)} />
        {view === "day" ? <CalendarDay
          date={anchor} loading={loading || !navigationReady} error={error}
          appointments={appointments} followUps={followUps} continuing={continuing}
          unscheduled={unscheduled} hasMore={snapshot?.unscheduledHasMore ?? false}
          onOpen={(event) => setSelected({ type: "event", event })}
          onContinue={(event) => void openAssessment(event)}
          onPrepare={(item) => setSelected({ type: "unscheduled", item })}
          onSchedule={(item) => beginScheduling(scheduleTargetFromUnscheduled(item))}
          onQueue={() => setQueueOpen(true)}
        /> : <CalendarViews
          loading={loading}
          view={view}
          anchor={anchor}
          scope={scope}
          owner={owner}
          mySchedule={mySchedule}
          range={range}
          events={appointments}
          unscheduled={unscheduled}
          assessors={snapshot?.assessors ?? []}
          eventsByDate={eventsByDate}
          conflicts={conflicts}
          hasFilters={hasFilters}
          onOpen={(event) => setSelected({ type: "event", event })}
          onAssessment={(event) => void openAssessment(event)}
          onFocusOwner={setOwner}
        />}
        {!loading && view !== "day" ? <CalendarFollowUps events={followUps} onOpen={(event) => setSelected({ type: "event", event })} /> : null}
        </div>
      </div>
      {queueOpen ? (
        <CalendarPortal><SchedulingQueue
          items={unscheduled}
          total={snapshot?.unscheduledTotal ?? unscheduled.length}
          hasMore={snapshot?.unscheduledHasMore ?? false}
          search={queueSearch}
          loading={refreshing}
          onSearch={(value) => {
            setQueueSearch(value);
            setQueueLimit(24);
          }}
          onClose={() => setQueueOpen(false)}
          onLoadMore={() => setQueueLimit((value) => Math.min(200, value + 24))}
          onOpenWorkspace={(item) => openWorkspace(item, {
            view: "intake",
            intakeField: item.nextAction === "assign" ? "owner" : item.nextAction === "complete_contact" ? "phone" : "name",
          })}
          onSchedule={(item) => {
            setQueueOpen(false);
            beginScheduling(scheduleTargetFromUnscheduled(item));
          }}
        /></CalendarPortal>
      ) : null}
      <CalendarPortal><CalendarOverlays
        selected={selected}
        scheduleTarget={scheduleTarget}
        scheduleStart={scheduleStart}
        scheduleDuration={scheduleDuration}
        scheduleMethod={scheduleMethod}
        scheduleLocation={scheduleLocation}
        mutationState={mutationState}
        scope={scope}
        onCloseSelection={() => { if (confirmLeaveDetails()) setSelected(null); }}
        onCloseSchedule={closeSchedule}
        onOpenWorkspace={() => {
          if (!selected) return;
          if (!confirmLeaveDetails()) return;
          if (selected.type === "event" && selected.event.kind === "assessment") void openAssessment(selected.event);
          else openWorkspace(selectionIdentity(selected));
        }}
        onOpenChart={() => { if (selected && confirmLeaveDetails()) openWorkspace(selectionIdentity(selected), { view: "chart" }); }}
        onDirtyChange={(dirty) => { pendingFollowUp.current = dirty; }}
        onScheduleSelection={() => { if (selected && confirmLeaveDetails()) beginScheduling(scheduleTargetFromSelection(selected)); }}
        onStatus={(status) => selected?.type === "event" && updateAppointmentStatus(selected.event, status)}
        onStart={setScheduleStart}
        onDuration={setScheduleDuration}
        onMethod={setScheduleMethod}
        onLocation={setScheduleLocation}
        onSave={() => saveSchedule(false)}
        onOverride={() => saveSchedule(true)}
      /></CalendarPortal>
    </main>
  );
}

// Navigation preferences only; client records remain in the authenticated data cache.
const calendarNavigation = new Map<string, { view: CalendarView; anchor: string; community: string; owner: string; mine: boolean; scrollTop: number }>();

async function assessmentForSchedule(target: ScheduleTarget) {
  if (target.assessmentId) {
    const payload = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(`/api/assessments/${encodeURIComponent(target.assessmentId)}`, { cache: "no-store" });
    return payload.assessment;
  }
  const existing = await fetchPipelineJson<AssessmentListResponse>(`/api/referrals/${target.referralId}/assessments`, { cache: "no-store" });
  if (existing.assessments[0]) return existing.assessments[0];
  const created = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(`/api/referrals/${target.referralId}/assessments`, {
    method: "POST",
    body: JSON.stringify({ data: {}, client_mutation_id: mutationId("calendar-create-assessment") }),
  });
  return created.assessment;
}

function resolveAssessmentForSchedule(target: ScheduleTarget, cached: PipelineAssessmentRecord | null) {
  return cached ? Promise.resolve(cached) : assessmentForSchedule(target);
}

function calendarClientName(name: string, community: string) {
  return formatCalendarClientName(name, community);
}

function mutationId(prefix: string) {
  return `${prefix}:${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}:${Math.random().toString(16).slice(2)}`}`;
}

function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);
  return debounced;
}
