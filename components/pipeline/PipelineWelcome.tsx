"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CalendarClock } from "lucide-react";

import PipelineSearchPanel from "@/components/pipeline/PipelineSearchPanel";
import ReferralDraftResumeList from "@/components/pipeline/ReferralDraftResumeList";
import ReferralWorkflowTracker from "@/components/pipeline/ReferralWorkflowTracker";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { PipelineCalendarEvent } from "@/lib/pipeline/calendar-types";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import {
  loadRecentDestinations,
  refreshRecentDestinations,
  subscribeToRecentDestinations,
  type PipelineRecentDestination,
} from "@/lib/pipeline/recent-destinations";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { PipelineSiteScreen } from "@/lib/pipeline/site-search";

export default function PipelineWelcome({
  onOpenPacket,
  onOpenRecent,
  onOpenProfile,
  onOpenSearchDestination,
  onResumeDraft,
  canAccessReports = false,
}: {
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  onOpenRecent: (destination: PipelineRecentDestination) => void;
  onOpenProfile: (residentKey: string) => void;
  onOpenSearchDestination: (screen: PipelineSiteScreen) => void;
  onResumeDraft: (draftKey: `new-${string}`) => void;
  canAccessReports?: boolean;
}) {
  const [briefing, setBriefing] = useState<HomeBriefingSnapshot | null>(null);
  const [recentItems, setRecentItems] = useState<PipelineRecentDestination[]>([]);
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

  useEffect(() => {
    const refreshRecent = () => setRecentItems(
      loadRecentDestinations().filter((item) => item.screen !== "operations" || canAccessReports),
    );
    refreshRecent();
    void refreshRecentDestinations().then(refreshRecent).catch(() => undefined);
    return subscribeToRecentDestinations(refreshRecent);
  }, [canAccessReports]);

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
                Some Home sections are temporarily unavailable. Available work remains current.
              </div>
            ) : null}
            <ReferralWorkflowTracker briefing={briefing} onOpenPacket={onOpenPacket} />
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
              <UpcomingAssessmentsPanel briefing={briefing} onOpenPacket={onOpenPacket} />
              <RecentPanel items={recentItems} onOpenRecent={onOpenRecent} />
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function UpcomingAssessmentsPanel({ briefing, onOpenPacket }: BriefingPanelProps) {
  return (
    <section aria-label="Upcoming assessments" className="min-w-0 bg-white">
      <SectionHeader title="Upcoming assessments" detail={briefing.unavailable_sections.includes("upcoming") ? "Unavailable" : "Next 7 days"} icon={<CalendarClock size={15} />} />
      {briefing.unavailable_sections.includes("upcoming") ? (
        <UnavailableLine />
      ) : briefing.upcoming.length === 0 ? (
        <EmptyLine>No assessments are scheduled in the next seven days.</EmptyLine>
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

function RecentPanel({ items, onOpenRecent }: { items: PipelineRecentDestination[]; onOpenRecent: (destination: PipelineRecentDestination) => void }) {
  return (
    <section data-guide-target="recent-work" aria-label="Recent" className="min-w-0 bg-white">
      <SectionHeader title="Recent" detail="Your last five" />
      {items.length === 0 ? (
        <EmptyLine>Opened referrals and profiles will appear here.</EmptyLine>
      ) : (
        <div className="divide-y divide-[#e5e9e7]">
          {items.slice(0, 5).map((item) => (
            <button key={item.id} type="button" onClick={() => onOpenRecent(item)} className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3 py-3 text-left hover:bg-[#f5f7fb] sm:px-4">
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-bold">{recentTitle(item)}</span>
                <span className="mt-0.5 block truncate text-[12px] font-medium text-[#69716c]">{item.detail}</span>
              </span>
              <span className="text-[11px] font-semibold text-[#69716c]">{relativeTime(item.visitedAt)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
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
        <div className="flex h-12 items-center gap-3">
          <SkeletonBlock className="h-4 w-4" />
          <SkeletonBlock className="h-4 w-36" />
        </div>
        <div className="grid grid-flow-col auto-cols-[minmax(230px,1fr)] gap-4 overflow-hidden pb-3 xl:grid-flow-row xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="min-w-0">
              <div className="flex h-9 items-center justify-between px-1">
                <SkeletonBlock className="h-3 w-20" />
                <SkeletonBlock className="h-3 w-3" />
              </div>
              {index < 2 ? (
                <div className="min-h-[116px] border border-l-[3px] border-[#e1e6e3] bg-white px-3.5 py-3.5">
                  <SkeletonBlock className="h-4 w-3/4" />
                  <SkeletonBlock className="mt-3 h-3 w-1/2" />
                  <SkeletonBlock className="mt-8 h-3 w-full" />
                </div>
              ) : null}
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

function relativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Recently";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
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

function recentTitle(item: PipelineRecentDestination) {
  if (item.id === "page:referrals") return "Workspaces";
  return item.kind === "profile" || item.kind === "referral"
    ? clientDisplayName(item.title, item.kind === "referral" ? item.community : undefined)
    : item.title;
}

function clientDisplayName(name: string, community?: string) {
  return formatClientIdentityTitle({ name, community });
}
