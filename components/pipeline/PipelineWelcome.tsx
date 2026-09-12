"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CalendarClock, CalendarPlus } from "lucide-react";

import CurrentWorkOverlay from "@/components/pipeline/CurrentWorkOverlay";
import ContinueWorkPanel from "@/components/pipeline/ContinueWorkPanel";
import HomeModuleDashboard from "@/components/pipeline/HomeModuleDashboard";
import PipelineSearchPanel from "@/components/pipeline/PipelineSearchPanel";
import { SinceLastVisitAssignments } from "@/components/pipeline/WorkspaceActivityFeed";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { PipelineCalendarEvent, PipelineUnscheduledAssessment } from "@/lib/pipeline/calendar-types";
import type { PipelineHomeModuleId } from "@/lib/pipeline/home-dashboard-layout";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import { acknowledgePipelineAssignments, initializePipelineAssignmentTracking } from "@/lib/pipeline/work-continuity-client";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { PipelineSiteScreen } from "@/lib/pipeline/site-search";

export default function PipelineWelcome({
  onOpenPacket,
  onOpenProfile,
  onOpenSearchDestination,
  onResumeDraft,
  onViewAllSearchResults,
  currentWorkOpen,
  onOpenCurrentWork,
  onCloseCurrentWork,
  editHome = false,
  onFinishEditingHome,
  canAccessReports = false,
}: {
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
  onOpenProfile: (residentKey: string) => void;
  onOpenSearchDestination: (screen: PipelineSiteScreen) => void;
  onViewAllSearchResults: (query: string) => void;
  onResumeDraft: (draftKey: `new-${string}`, intakeField?: PipelineWorkspaceLocation["intakeField"]) => void;
  currentWorkOpen: boolean;
  onOpenCurrentWork: () => void;
  onCloseCurrentWork: () => void;
  editHome?: boolean;
  onFinishEditingHome?: () => void;
  canAccessReports?: boolean;
}) {
  const [briefing, setBriefing] = useState<HomeBriefingSnapshot | null>(null);
  const [error, setError] = useState("");
  const refreshController = useRef<AbortController | null>(null);
  const pendingRefresh = useRef<Promise<void> | null>(null);
  const acknowledgmentRevision = useRef(0);
  const { searchOpen, setSearchOpen } = usePipelineShell();

  const loadBriefing = useCallback(async () => {
    if (pendingRefresh.current) return pendingRefresh.current;
    const signal = refreshController.current?.signal;
    if (!signal || signal.aborted) return;
    const revision = acknowledgmentRevision.current;
    const pending = (async () => {
      try {
        const payload = await fetchPipelineJson<HomeBriefingSnapshot>("/api/operations/home", {
          cache: "no-store",
          signal,
        });
        // A refresh started before an acknowledgment must not restore seen rows.
        if (!signal.aborted && revision === acknowledgmentRevision.current) {
          setBriefing(payload);
          setError("");
        }
      } catch (loadError) {
        if (!signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Home is unavailable right now.");
        }
      }
    })();
    pendingRefresh.current = pending;
    try {
      await pending;
    } finally {
      if (pendingRefresh.current === pending) pendingRefresh.current = null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    refreshController.current = controller;
    const refreshOnFocus = () => {
      if (document.visibilityState === "visible") void loadBriefing();
    };
    const initialLoad = window.setTimeout(refreshOnFocus, 0);
    const interval = window.setInterval(refreshOnFocus, 30_000);
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
    return () => {
      controller.abort();
      pendingRefresh.current = null;
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
    };
  }, [loadBriefing]);

  useEffect(() => {
    const startedAt = briefing?.continuity.assignment_tracking_started_at;
    if (!briefing?.continuity.needs_assignment_tracking_initialization || !startedAt) return;
    void initializePipelineAssignmentTracking(startedAt)
      .then(() => setBriefing((current) => current ? {
        ...current,
        continuity: { ...current.continuity, needs_assignment_tracking_initialization: false },
      } : current))
      .catch(() => undefined);
  }, [briefing?.continuity.assignment_tracking_started_at, briefing?.continuity.needs_assignment_tracking_initialization]);

  const acknowledgeAssignments = useCallback(async (ids: string[], through?: string) => {
    await acknowledgePipelineAssignments(ids, through);
    acknowledgmentRevision.current += 1;
    const acknowledged = new Set(ids);
    setBriefing((current) => current ? {
      ...current,
      continuity: {
        ...current.continuity,
        new_assignments: current.continuity.new_assignments.filter((item) => !acknowledged.has(item.event_id)),
      },
    } : current);
  }, []);

  return (
    <>
      <main data-guide-target="home-workspace" className="h-full overflow-y-auto bg-white text-[#202320] outline-none">
        <div className="mx-auto w-full max-w-[1380px] px-4 pb-8 pt-2 sm:px-6 lg:px-8">
          <section aria-label="Search Pipeline" className="w-full bg-white px-1">
            <PipelineSearchPanel
              resting
              autoFocus={searchOpen}
              canAccessReports={canAccessReports}
              onSearchFocused={() => setSearchOpen(false)}
              onOpenPacket={onOpenPacket}
              onOpenProfile={onOpenProfile}
              onOpenDestination={onOpenSearchDestination}
              onViewAllResults={onViewAllSearchResults}
            />
          </section>

          {error ? (
            <div role="alert" className="mt-4 flex items-center justify-between gap-4 border-l-2 border-[#a9473d] bg-[#fff6f4] px-4 py-3 text-[12px] text-[#723d35]">
              <span>{error}</span>
              <button type="button" onClick={() => void loadBriefing()} className="font-semibold underline underline-offset-2">Retry</button>
            </div>
          ) : null}

          {!briefing && !error ? <HomeSkeleton /> : null}
          {briefing ? (
            <div className="mt-2 space-y-4">
              {briefing.unavailable_sections.length > 0 ? (
                <div role="status" className="border-l-2 border-[#b77b27] bg-[#fff8eb] px-4 py-2.5 text-[11px] text-[#73501f]">
                  A few live counts could not be refreshed. Open records remain available.
                </div>
              ) : null}
              <ContinueWorkPanel
                items={briefing.continuity.resume_items}
                onOpenPacket={onOpenPacket}
                onResumeDraft={onResumeDraft}
              />
              <HomeModuleDashboard
                viewerId={briefing.viewer.id}
                initialEditing={editHome}
                onFinishEditing={onFinishEditingHome}
                modules={{
                  "current-work": <CurrentWorkSummary briefing={briefing} onOpen={onOpenCurrentWork} onOpenPacket={onOpenPacket} />,
                  "new-assignments": (
                    <SinceLastVisitAssignments
                      items={briefing.continuity.new_assignments}
                      unavailable={briefing.continuity.unavailable}
                      onOpenPacket={onOpenPacket}
                      onAcknowledge={acknowledgeAssignments}
                    />
                  ),
                  "upcoming-assessments": <UpcomingAssessmentsPanel briefing={briefing} onOpenPacket={onOpenPacket} />,
                  "scheduling-queue": <SchedulingQueuePanel briefing={briefing} onOpenPacket={onOpenPacket} />,
                } satisfies Record<PipelineHomeModuleId, ReactNode>}
              />
            </div>
          ) : null}
        </div>
      </main>
      {briefing && currentWorkOpen ? (
        <CurrentWorkOverlay briefing={briefing} onClose={onCloseCurrentWork} onOpenPacket={onOpenPacket} />
      ) : null}
    </>
  );
}

function CurrentWorkSummary({ briefing, onOpen, onOpenPacket }: {
  briefing: HomeBriefingSnapshot;
  onOpen: () => void;
  onOpenPacket: BriefingPanelProps["onOpenPacket"];
}) {
  const unavailable = briefing.unavailable_sections.includes("current_work");
  const items = briefing.current_work.items;
  return (
    <section data-guide-target="my-queue" aria-label="Current work" className="bg-white">
      <SectionHeader
        title="My work"
        detail={unavailable ? "Unavailable" : `${briefing.current_work.total.toLocaleString()} requiring action`}
      />
      {unavailable ? <UnavailableLine /> : items.length === 0 ? (
        <EmptyLine>No assigned referrals require action right now.</EmptyLine>
      ) : (
        <div className="divide-y divide-[#e5e9e7] border-y border-[#dfe5e2]">
          {items.slice(0, 5).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenPacket({
                id: item.referral_id,
                name: item.client_name,
                community: item.community as Referral["community"],
              }, item.location)}
              className="group grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3 py-3 text-left hover:bg-[#f5faf8] sm:px-4"
            >
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-bold text-[#202723]">{clientDisplayName(item.client_name, item.community)}</span>
                <span className="mt-0.5 block truncate text-[11px] font-medium text-[#69716c]">{item.next_action}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[10px] font-black text-[#176f60]">
                {urgencyLabel(item.urgency)}<ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          ))}
        </div>
      )}
      <button type="button" aria-label="Open current work" onClick={onOpen} className="mt-2 flex min-h-9 w-full items-center justify-end gap-2 px-2 text-[10px] font-black uppercase tracking-[0.05em] text-[#176f60] hover:bg-[#f5faf8]">
        {!unavailable && briefing.current_work.total > 5 ? <span className="mr-auto normal-case tracking-normal">{(briefing.current_work.total - Math.min(5, items.length)).toLocaleString()} more</span> : null}
        {briefing.scope === "team" ? "Open team work" : "Open all assigned work"}<ArrowRight size={14} />
      </button>
    </section>
  );
}

function UpcomingAssessmentsPanel({ briefing, onOpenPacket }: BriefingPanelProps) {
  return (
    <section aria-label="Upcoming assessments" className="min-w-0 bg-white">
      <SectionHeader title="Upcoming assessments" detail={briefing.unavailable_sections.includes("upcoming") ? "Unavailable" : "Next 7 days"} icon={<CalendarClock size={15} />} />
      {briefing.unavailable_sections.includes("upcoming") ? (
        <UnavailableLine />
      ) : briefing.upcoming.length === 0 ? (
        <EmptyLine>The next seven days are clear. No assessments are scheduled.</EmptyLine>
      ) : (
        <div className="divide-y divide-[#e5e9e7]">
          {briefing.upcoming.slice(0, 6).map((event) => <ScheduleRow key={event.id} event={event} onOpenPacket={onOpenPacket} />)}
        </div>
      )}
    </section>
  );
}

function SchedulingQueuePanel({ briefing, onOpenPacket }: BriefingPanelProps) {
  const unavailable = briefing.unavailable_sections.includes("upcoming");
  return (
    <section aria-label="Assessments to schedule" className="min-w-0 bg-white">
      <SectionHeader
        title="Assessments to schedule"
        detail={unavailable ? "Unavailable" : `${briefing.unscheduled_total.toLocaleString()} waiting`}
        icon={<CalendarPlus size={15} />}
      />
      {unavailable ? (
        <UnavailableLine />
      ) : briefing.unscheduled.length === 0 ? (
        <EmptyLine>No assessment-ready referrals are waiting to be scheduled.</EmptyLine>
      ) : (
        <div className="divide-y divide-[#e5e9e7] border-y border-[#dfe5e2]">
          {briefing.unscheduled.slice(0, 6).map((item) => (
            <UnscheduledAssessmentRow key={`${item.referralId}-${item.assessmentId ?? "referral"}`} item={item} onOpenPacket={onOpenPacket} />
          ))}
        </div>
      )}
    </section>
  );
}

function UnscheduledAssessmentRow({ item, onOpenPacket }: { item: PipelineUnscheduledAssessment } & Pick<BriefingPanelProps, "onOpenPacket">) {
  return (
    <button
      type="button"
      onClick={() => onOpenPacket(
        { id: item.referralId, name: clientDisplayName(item.clientName, item.community), community: item.community as Referral["community"] },
        item.nextAction === "complete_intake" ? { view: "intake" } : item.nextAction === "assign" ? { view: "workflow" } : { view: "assessment" },
      )}
      className="group grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3 py-3 text-left hover:bg-[#f5faf8] sm:px-4"
    >
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-bold">{clientDisplayName(item.clientName, item.community)}</span>
        <span className="mt-0.5 block truncate text-[12px] font-medium text-[#69716c]">{item.community} · {item.owner || "Unassigned"}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-[10px] font-bold text-[#176f60]">
        {unscheduledActionLabel(item.nextAction)}
        <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </button>
  );
}

function ScheduleRow({ event, onOpenPacket }: { event: PipelineCalendarEvent } & Pick<BriefingPanelProps, "onOpenPacket">) {
  return (
    <button
      type="button"
      onClick={() => onOpenPacket(
        { id: event.referralId, name: clientDisplayName(event.clientName, event.community), community: event.community as Referral["community"] },
        { view: "assessment" },
      )}
      className="grid min-h-14 w-full grid-cols-[108px_minmax(0,1fr)_auto] items-center gap-4 px-3 py-3 text-left hover:bg-[#f5faf8] sm:px-4"
    >
      <span className="text-[11px] font-bold text-[#176f60]">{formatScheduleDate(event)}</span>
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-bold">{clientDisplayName(event.clientName, event.community)}</span>
        <span className="mt-0.5 block truncate text-[12px] font-medium text-[#69716c]">{event.title} · {event.community}</span>
      </span>
      <span className="text-[11px] font-semibold text-[#69716c]">{methodLabel(event.method)}</span>
    </button>
  );
}

type BriefingPanelProps = {
  briefing: HomeBriefingSnapshot;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
};

function SectionHeader({ title, detail, icon }: { title: string; detail: string; icon?: ReactNode }) {
  return (
    <div className="flex h-12 items-center justify-between gap-3 px-1">
      <h2 className="flex items-center gap-2.5 text-[15px] font-bold">{icon}{title}</h2>
      <span className="text-[11px] font-bold text-[#626a65]">{detail}</span>
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <div className="border border-[#e0e5e2] px-5 py-10 text-center text-[13px] font-medium text-[#626a65]">{children}</div>;
}

function UnavailableLine() {
  return <div className="px-5 py-10 text-center text-[12px] text-[#8a5a10]">Temporarily unavailable. Refresh to try again.</div>;
}

function HomeSkeleton() {
  return (
    <div aria-label="Loading home" aria-busy="true" className="mt-2 animate-pulse space-y-5" aria-live="polite">
      <div aria-hidden="true">
        <div className="flex h-14 items-center justify-between border-y border-[#e1e6e3] px-3">
          <span>
            <SkeletonBlock className="h-4 w-28" />
            <SkeletonBlock className="mt-2 h-3 w-20" />
          </span>
          <SkeletonBlock className="h-3 w-14" />
        </div>
        <div className="grid grid-cols-2 border-b border-[#e1e6e3] sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex h-12 items-center justify-between border-l border-[#e1e6e3] px-3 first:border-l-0">
              <SkeletonBlock className="h-3 w-20" />
              <SkeletonBlock className="h-4 w-4" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <PanelSkeleton />
        <PanelSkeleton />
      </div>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="flex h-12 items-center justify-between px-1">
        <SkeletonBlock className="h-4 w-36" />
        <SkeletonBlock className="h-3 w-16" />
      </div>
      <div className="space-y-4 border border-[#e1e6e3] px-4 py-5">
        <SkeletonBlock className="h-4 w-2/3" />
        <SkeletonBlock className="h-3 w-5/6" />
        <SkeletonBlock className="h-3 w-1/2" />
      </div>
    </div>
  );
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`bg-[#e9eeeb] ${className}`} />;
}

function formatScheduleDate(event: PipelineCalendarEvent) {
  const date = new Date(event.startsAt ?? `${event.date}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return event.date;
  const day = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (!event.startsAt) return day;
  return `${day} · ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function methodLabel(value?: string) {
  const labels: Record<string, string> = { in_person: "In person", phone: "Phone", zoom: "Zoom", video: "Zoom", record_review: "Record review" };
  return labels[value ?? ""] ?? "";
}

function unscheduledActionLabel(action: PipelineUnscheduledAssessment["nextAction"]) {
  if (action === "assign") return "Assign owner";
  if (action === "complete_intake") return "Complete intake";
  return "Schedule";
}

function clientDisplayName(name: string, community?: string) {
  return formatClientIdentityTitle({ name, community });
}

function urgencyLabel(value: HomeBriefingSnapshot["current_work"]["items"][number]["urgency"]) {
  if (value === "overdue") return "Overdue";
  if (value === "blocked") return "Blocked";
  if (value === "due_soon") return "Due soon";
  if (value === "stale") return "Needs follow-up";
  return "Open";
}
