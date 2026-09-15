"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ArrowRight, CalendarClock, CalendarPlus, Maximize2 } from "lucide-react";

import CurrentWorkOverlay from "@/components/pipeline/CurrentWorkOverlay";
import ReferralWorkflowTracker, { WorkflowCardSkeleton } from "@/components/pipeline/ReferralWorkflowTracker";
import ContinueWorkPanel from "@/components/pipeline/ContinueWorkPanel";
import HomeModuleDashboard from "@/components/pipeline/HomeModuleDashboard";
import HomeDialog from "@/components/pipeline/HomeDialog";
import PipelineSearchPanel from "@/components/pipeline/PipelineSearchPanel";
import { SinceLastVisitAssignments } from "@/components/pipeline/WorkspaceActivityFeed";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import { fetchPipelineJson, usePipelineDataGeneration } from "@/lib/auth/authenticated-fetch";
import type { PipelineCalendarEvent, PipelineUnscheduledAssessment } from "@/lib/pipeline/calendar-types";
import type { PipelineHomeModuleId } from "@/lib/pipeline/home-dashboard-layout";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import { acknowledgePipelineAssignments, initializePipelineAssignmentTracking } from "@/lib/pipeline/work-continuity-client";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { PipelineSiteScreen } from "@/lib/pipeline/site-search";
import { prefetchPipelineWorkspace, cancelPipelineWarmup } from "@/lib/pipeline/client-navigation";
import { pipelineSurfaceReady } from "@/lib/observability/browser-performance-contract";

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
  initialBriefing,
  viewerId,
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
  initialBriefing?: HomeBriefingSnapshot | null;
  viewerId?: string;
}) {
  const [briefing, setBriefing] = useState<HomeBriefingSnapshot | null>(initialBriefing ?? null);
  const [error, setError] = useState("");
  const dataGeneration = usePipelineDataGeneration();
  const refreshController = useRef<AbortController | null>(null);
  const pendingRefresh = useRef<Promise<void> | null>(null);
  const acknowledgmentRevision = useRef(0);
  const { searchOpen, setSearchOpen } = usePipelineShell();
  const [searchVisible, setSearchVisible] = useState(true);

  // Prepare one likely next workspace, not every referral/chart. Intent reads
  // still use the unchanged short TTL and protected shared cache. New briefing
  // publications may replace the queued target; leaving Home cancels the queue.
  const nextWorkspaceId = nextBriefingWorkspaceId(briefing);
  useEffect(() => {
    if (nextWorkspaceId) prefetchPipelineWorkspace(nextWorkspaceId);
    return cancelPipelineWarmup;
  }, [nextWorkspaceId]);

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
  }, [loadBriefing, dataGeneration]);

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

  const searchProps = {
    autoFocus: searchOpen,
    canAccessReports,
    onOpenPacket,
    onOpenProfile,
    onOpenDestination: onOpenSearchDestination,
    onViewAllResults: onViewAllSearchResults,
  };
  const briefingModules = briefing ? {
    "recent-work": <ContinueWorkPanel items={briefing.continuity.resume_items} unavailable={briefing.continuity.unavailable} onOpenPacket={onOpenPacket} onResumeDraft={onResumeDraft} />,
    "current-work": <CurrentWorkSummary briefing={briefing} onOpen={onOpenCurrentWork} onOpenPacket={onOpenPacket} />,
    "new-assignments": <SinceLastVisitAssignments items={briefing.continuity.new_assignments} unavailable={briefing.continuity.unavailable} onOpenPacket={onOpenPacket} onAcknowledge={acknowledgeAssignments} />,
    "upcoming-assessments": <UpcomingAssessmentsPanel briefing={briefing} onOpenPacket={onOpenPacket} />,
    "scheduling-queue": <SchedulingQueuePanel briefing={briefing} onOpenPacket={onOpenPacket} />,
  } : {
    "recent-work": null,
    "current-work": null,
    "new-assignments": null,
    "upcoming-assessments": null,
    "scheduling-queue": null,
  };

  return (
    <>
      <main data-guide-target="home-workspace" data-performance-ready={pipelineSurfaceReady("home", !briefing, error)} className="h-full overflow-y-auto bg-white text-[#202320] outline-none">
        <div className="mx-auto w-full max-w-[1380px] px-4 pb-8 pt-2 sm:px-6 lg:px-8">
          <HomeSearchAccess visible={searchVisible} searchProps={searchProps} onClose={() => setSearchOpen(false)} />

          {error ? (
            <div role="alert" className="mt-4 flex items-center justify-between gap-4 border-l-2 border-[#a9473d] bg-[#fff6f4] px-4 py-3 text-[12px] text-[#723d35]">
              <span>{error}</span>
              <button type="button" onClick={() => void loadBriefing()} className="font-semibold underline underline-offset-2">Retry</button>
            </div>
          ) : null}

          {viewerId ? (
            <div className="mt-2 space-y-4">
              <HomeLiveCountNotice sections={briefing?.unavailable_sections} />
              <HomeModuleDashboard
                key={viewerId}
                viewerId={viewerId}
                initialEditing={editHome}
                onFinishEditing={onFinishEditingHome}
                onSearchVisibilityChange={setSearchVisible}
                modules={{
                  ...briefingModules,
                  "search": (
                    <section aria-label="Search Pipeline" className="w-full bg-white px-1">
                      <PipelineSearchPanel
                        {...searchProps}
                        resting
                        onSearchFocused={() => setSearchOpen(false)}
                      />
                    </section>
                  ),
                } satisfies Record<PipelineHomeModuleId, ReactNode>}
              />
            </div>
          ) : null}
          {!briefing && !error ? <HomeSkeleton /> : null}
        </div>
      </main>
      {briefing && currentWorkOpen ? (
        <CurrentWorkOverlay briefing={briefing} onClose={onCloseCurrentWork} onOpenPacket={onOpenPacket} />
      ) : null}
    </>
  );
}

function HomeLiveCountNotice({ sections }: { sections: HomeBriefingSnapshot["unavailable_sections"] | undefined }) {
  if (!sections?.length) return null;
  return (
    <div role="status" className="border-l-2 border-[#b77b27] bg-[#fff8eb] px-4 py-2.5 text-[11px] text-[#73501f]">
      A few live counts could not be refreshed. Open records remain available.
    </div>
  );
}

function HomeSearchAccess({ visible, searchProps, onClose }: {
  visible: boolean;
  searchProps: ComponentProps<typeof PipelineSearchPanel>;
  onClose: () => void;
}) {
  if (visible || !searchProps.autoFocus) return null;
  return (
    <HomeDialog label="Search Pipeline" title="Search" onClose={onClose}>
      <div className="p-4"><PipelineSearchPanel {...searchProps} /></div>
    </HomeDialog>
  );
}

function CurrentWorkSummary({ briefing, onOpen, onOpenPacket }: {
  briefing: HomeBriefingSnapshot;
  onOpen: () => void;
  onOpenPacket: BriefingPanelProps["onOpenPacket"];
}) {
  return (
    <section data-guide-target="my-queue" aria-label="Current work" className="bg-white">
      <div className="mb-3 flex items-center gap-3 px-1">
        <h2 className="text-[16px] font-extrabold text-[#202320]">{briefing.scope === "team" ? "Team referrals" : "Assigned referrals"}</h2>
        <span className="text-[12px] font-bold tabular-nums text-[#68706b]">{briefing.workflow.active_total.toLocaleString()}</span>
        <button type="button" aria-label="Open current work" title="Expand referrals" onClick={onOpen} className="ml-auto flex h-9 w-9 items-center justify-center text-[#176f60] outline-none hover:bg-[#eff8f5] focus-visible:ring-2 focus-visible:ring-[#0f8b73]">
          <Maximize2 size={17} aria-hidden="true" />
        </button>
      </div>
      <ReferralWorkflowTracker briefing={briefing} onOpenPacket={onOpenPacket} limit={10} />
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
        <div className="space-y-3"><p className="sr-only">No assessments are scheduled in the next seven days.</p><WorkflowCardSkeleton /><WorkflowCardSkeleton /></div>
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
        <div className="space-y-3"><p className="sr-only">No referrals are waiting to be scheduled.</p><WorkflowCardSkeleton /><WorkflowCardSkeleton /></div>
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

function nextBriefingWorkspaceId(briefing: HomeBriefingSnapshot | null) {
  if (!briefing) return undefined;
  return briefing.continuity.resume_items.find((item) => item.referral_id)?.referral_id
    ?? briefing.upcoming[0]?.referralId
    ?? briefing.continuity.new_assignments[0]?.workspace.referral_id;
}
