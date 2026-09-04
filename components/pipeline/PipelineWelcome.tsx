"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowRight, CalendarClock } from "lucide-react";

import CurrentWorkOverlay from "@/components/pipeline/CurrentWorkOverlay";
import PipelineSearchPanel from "@/components/pipeline/PipelineSearchPanel";
import ReferralDraftResumeList from "@/components/pipeline/ReferralDraftResumeList";
import { SinceLastVisitAssignments } from "@/components/pipeline/WorkspaceActivityFeed";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { PipelineCalendarEvent } from "@/lib/pipeline/calendar-types";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import type { Referral } from "@/lib/pipeline/referral-types";
import { activeReferralFlowStates } from "@/lib/pipeline/referral-flow";
import type { PipelineSiteScreen } from "@/lib/pipeline/site-search";

export default function PipelineWelcome({
  onOpenPacket,
  onOpenProfile,
  onOpenSearchDestination,
  onResumeDraft,
  currentWorkOpen,
  onOpenCurrentWork,
  onCloseCurrentWork,
  canAccessReports = false,
}: {
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  onOpenProfile: (residentKey: string) => void;
  onOpenSearchDestination: (screen: PipelineSiteScreen) => void;
  onResumeDraft: (draftKey: `new-${string}`) => void;
  currentWorkOpen: boolean;
  onOpenCurrentWork: () => void;
  onCloseCurrentWork: () => void;
  canAccessReports?: boolean;
}) {
  const [briefing, setBriefing] = useState<HomeBriefingSnapshot | null>(null);
  const [error, setError] = useState("");
  const { searchOpen } = usePipelineShell();

  const loadBriefing = useCallback(async (signal?: AbortSignal) => {
    try {
      const payload = await fetchPipelineJson<HomeBriefingSnapshot>("/api/operations/home", {
        cache: "no-store",
        signal,
      }, { cacheTtlMs: 15_000 });
      setBriefing(payload);
      setError("");
    } catch (loadError) {
      if (!signal?.aborted) {
        setError(loadError instanceof Error ? loadError.message : "Home is unavailable right now.");
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initialLoad = window.setTimeout(() => void loadBriefing(controller.signal), 0);
    const refreshOnFocus = () => void loadBriefing();
    const interval = window.setInterval(() => void loadBriefing(), 60_000);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      controller.abort();
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [loadBriefing]);

  if (searchOpen) {
    return (
      <main className="h-full overflow-y-auto bg-white px-5 py-4 text-[#111111] outline-none md:px-8">
        <div className="mx-auto w-full max-w-[1280px]">
          <PipelineSearchPanel
            autoFocus
            canAccessReports={canAccessReports}
            onOpenPacket={onOpenPacket}
            onOpenProfile={onOpenProfile}
            onOpenDestination={onOpenSearchDestination}
          />
        </div>
      </main>
    );
  }

  return (
    <>
      <main data-guide-target="home-workspace" className="h-full overflow-y-auto bg-white text-[#202320] outline-none">
        <div className="mx-auto w-full max-w-[1380px] px-4 pb-8 pt-2 sm:px-6 lg:px-8">

          {error ? (
            <div role="alert" className="mt-4 flex items-center justify-between gap-4 border-l-2 border-[#a9473d] bg-[#fff6f4] px-4 py-3 text-[12px] text-[#723d35]">
              <span>{error}</span>
              <button type="button" onClick={() => void loadBriefing()} className="font-semibold underline underline-offset-2">Retry</button>
            </div>
          ) : null}

          <ReferralDraftResumeList onResume={onResumeDraft} className="mt-2" />

          {!briefing && !error ? <HomeSkeleton /> : null}
          {briefing ? (
            <div className="mt-2 space-y-4">
              {briefing.unavailable_sections.length > 0 ? (
                <div role="status" className="border-l-2 border-[#b77b27] bg-[#fff8eb] px-4 py-2.5 text-[11px] text-[#73501f]">
                  A few live counts could not be refreshed. Open records remain available.
                </div>
              ) : null}
              <CurrentWorkSummary briefing={briefing} onOpen={onOpenCurrentWork} />
              <div className="grid min-w-0 gap-6 xl:grid-cols-2">
                <SinceLastVisitAssignments viewerId={briefing.viewer.id} onOpenPacket={onOpenPacket} />
                <UpcomingAssessmentsPanel briefing={briefing} onOpenPacket={onOpenPacket} />
              </div>
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

function CurrentWorkSummary({ briefing, onOpen }: { briefing: HomeBriefingSnapshot; onOpen: () => void }) {
  const counts = briefing.workflow.flow_counts ?? {
    ready_to_schedule: 0,
    scheduled: 0,
    assessment: 0,
    complete_chart: 0,
  };
  const unavailable = briefing.unavailable_sections.includes("workflow");
  const activeLabel = unavailable
    ? "Temporarily unavailable"
    : `${briefing.workflow.active_total.toLocaleString()} active ${briefing.workflow.active_total === 1 ? "referral" : "referrals"} · intake through decision`;

  return (
    <section data-guide-target="my-queue" aria-label="Current work" className="bg-white">
      <button
        type="button"
        aria-label="Open current work"
        onClick={onOpen}
        className="group w-full border-y border-[#dfe4e1] text-left outline-none transition-colors hover:bg-[#f6faf8] focus-visible:bg-[#eef7f3] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73]"
      >
        <span className="flex min-h-14 items-center justify-between gap-4 px-2 sm:px-3">
          <span className="min-w-0">
            <span className="block text-[15px] font-black text-[#111111]">Active referrals</span>
            <span className="mt-0.5 block text-[11px] font-semibold text-[#68706b]">
              {activeLabel}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-[11px] font-black uppercase text-[#176f60]">
            Open worklist
            <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
          </span>
        </span>
        {!unavailable ? (
          <span className="grid grid-cols-2 border-t border-[#e7ebe8] sm:grid-cols-4">
            {activeReferralFlowStates.map((state) => (
              <span key={state.key} className="flex min-h-12 items-center justify-between gap-3 border-[#e7ebe8] px-3 even:border-l sm:border-l sm:first:border-l-0">
                <span className="truncate text-[10px] font-extrabold uppercase text-[#68706b]">{state.label}</span>
                <strong className="text-[14px] font-black tabular-nums text-[#202320]">{counts[state.key].toLocaleString()}</strong>
              </span>
            ))}
          </span>
        ) : null}
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

function ScheduleRow({ event, onOpenPacket }: { event: PipelineCalendarEvent } & Pick<BriefingPanelProps, "onOpenPacket">) {
  return (
    <button
      type="button"
      onClick={() => onOpenPacket({ id: event.referralId, name: clientDisplayName(event.clientName, event.community), community: event.community as Referral["community"] })}
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
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
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

function clientDisplayName(name: string, community?: string) {
  return formatClientIdentityTitle({ name, community });
}
