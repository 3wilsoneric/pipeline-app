"use client";

import { useEffect, useRef, useState } from "react";

import {
  CalendarHeader,
  CalendarNotices,
  CalendarOverlays,
  CalendarPortal,
  CalendarViews,
  SchedulingQueue,
} from "@/components/pipeline/PipelineCalendarPresentation";
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
  type CalendarDisplayKind,
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
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import type { PipelineCalendarEvent, PipelineCalendarResponse } from "@/lib/pipeline/calendar-types";
import type { Referral } from "@/lib/pipeline/referral-types";

export default function PipelineCalendar({ onOpenPacket }: { onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void }) {
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(todayKey);
  const [community, setCommunity] = useState("");
  const [owner, setOwner] = useState("");
  const [kind, setKind] = useState<CalendarDisplayKind | "">("");
  const [mySchedule, setMySchedule] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueSearch, setQueueSearch] = useState("");
  const [queueLimit, setQueueLimit] = useState(24);
  const [refreshToken, setRefreshToken] = useState(0);
  const [selected, setSelected] = useState<CalendarSelection | null>(null);
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget | null>(null);
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleDuration, setScheduleDuration] = useState("60");
  const [scheduleMethod, setScheduleMethod] = useState<AssessmentScheduleMethod>("zoom");
  const [scheduleLocation, setScheduleLocation] = useState("");
  const [mutationState, setMutationState] = useState({ busy: false, error: "", message: "", canOverride: false });
  const scheduleAssessmentRef = useRef<PipelineAssessmentRecord | null>(null);
  const deferredQueueSearch = useDebouncedValue(queueSearch, 250);
  const range = calendarRange(view, anchor);
  const requestKey = [range.from, range.to, deferredQueueSearch, queueLimit, community, owner, mySchedule].join(":");
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
      if (event.key !== "Escape" || mutationState.busy) return;
      if (scheduleTarget) {
        scheduleAssessmentRef.current = null;
        setScheduleTarget(null);
      } else if (selected) setSelected(null);
      else setQueueOpen(false);
    };
    window.addEventListener("keydown", closeTopOverlay);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeTopOverlay);
    };
  }, [mutationState.busy, queueOpen, scheduleTarget, selected]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      from: range.from,
      to: range.to,
      queue_limit: String(queueLimit),
      include_assignments: "false",
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
    }, { cacheTtlMs: 15_000 }).then((payload) => {
      setCache((current) => ({
        ...current,
        [requestKey]: {
          events: payload.events ?? [],
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
  }, [community, deferredQueueSearch, mySchedule, owner, queueLimit, range.from, range.to, refreshToken, requestKey]);

  const calendarEvents = events.filter((event) => event.kind !== "referral_assigned");
  const communityOptions = uniqueValues([
    community,
    ...calendarEvents.map((event) => event.community),
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
    && (!mySchedule || (Boolean(viewer?.id) && event.ownerId === viewer?.id))
    && (!kind || event.kind === kind)
  ));
  const eventsByDate = groupEventsByDate(visibleEvents);
  const hasFilters = hasCalendarFilters(community, owner, kind, mySchedule);
  const overdue = visibleEvents.filter((event) => event.kind === "assessment" && event.status === "overdue");
  const conflicts = findScheduleConflicts(visibleEvents);
  const scheduledCount = visibleEvents.filter((event) => event.kind === "assessment").length;

  const openWorkspace = (identity: { referralId: number; clientName: string; community: string }) => {
    onOpenPacket({ id: identity.referralId, name: calendarClientName(identity.clientName, identity.community), community: identity.community as Referral["community"] });
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

  const closeSchedule = () => {
    scheduleAssessmentRef.current = null;
    setScheduleTarget(null);
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
          queueCount={snapshot?.unscheduledTotal ?? unscheduled.length}
          scheduledCount={scheduledCount}
          overdueCount={overdue.length}
          onView={setView}
          onAnchor={setAnchor}
          onCommunity={setCommunity}
          onOwner={setOwner}
          onKind={setKind}
          onMySchedule={setMySchedule}
          onShowFilters={setShowFilters}
          onOpenQueue={() => setQueueOpen(true)}
          onRefresh={() => setRefreshToken((value) => value + 1)}
        />
        <CalendarNotices error={error} mutationError={mutationState.error} scheduleOpen={Boolean(scheduleTarget)} onRetry={() => setRefreshToken((value) => value + 1)} />
        <CalendarViews
          loading={loading}
          view={view}
          anchor={anchor}
          scope={scope}
          owner={owner}
          mySchedule={mySchedule}
          range={range}
          events={visibleEvents}
          unscheduled={unscheduled}
          assessors={snapshot?.assessors ?? []}
          eventsByDate={eventsByDate}
          conflicts={conflicts}
          hasFilters={hasFilters}
          onOpen={(event) => setSelected({ type: "event", event })}
          onFocusOwner={setOwner}
        />
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
          onOpenWorkspace={(item) => openWorkspace(item)}
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
        onCloseSelection={() => setSelected(null)}
        onCloseSchedule={closeSchedule}
        onOpenWorkspace={() => selected && openWorkspace(selectionIdentity(selected))}
        onScheduleSelection={() => selected && beginScheduling(scheduleTargetFromSelection(selected))}
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
