"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowRight, CalendarClock, RefreshCw } from "lucide-react";

import PipelineSearchPanel from "@/components/pipeline/PipelineSearchPanel";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { PipelineCalendarEvent, PipelineUnscheduledAssessment } from "@/lib/pipeline/calendar-types";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import type { MyQueueItem, MyQueueUrgency } from "@/lib/pipeline/operations-types";
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
}: {
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  onOpenRecent: (destination: PipelineRecentDestination) => void;
  onOpenProfile: (residentKey: string) => void;
  onOpenSearchDestination: (screen: PipelineSiteScreen) => void;
  initialMode?: "welcome" | "workspace";
}) {
  const [briefing, setBriefing] = useState<HomeBriefingSnapshot | null>(null);
  const [recentItems, setRecentItems] = useState<PipelineRecentDestination[]>([]);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const { searchOpen } = usePipelineShell();

  const loadBriefing = useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true);
    try {
      const payload = await fetchPipelineJson<HomeBriefingSnapshot>("/api/operations/home", {
        cache: "no-store",
        signal,
      });
      setBriefing(payload);
      setError("");
    } catch (loadError) {
      if (!signal?.aborted) {
        setError(loadError instanceof Error ? loadError.message : "Home is unavailable right now.");
      }
    } finally {
      if (!signal?.aborted) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadBriefing(controller.signal);
    const refreshOnFocus = () => void loadBriefing();
    const interval = window.setInterval(() => void loadBriefing(), 60_000);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [loadBriefing]);

  useEffect(() => {
    const refreshRecent = () => setRecentItems(loadRecentDestinations());
    refreshRecent();
    void refreshRecentDestinations().then(refreshRecent).catch(() => undefined);
    return subscribeToRecentDestinations(refreshRecent);
  }, []);

  if (searchOpen) {
    return (
      <main className="h-full overflow-y-auto bg-white px-5 py-4 text-[#111111] md:px-8">
        <div className="mx-auto w-full max-w-[1280px]">
          <PipelineSearchPanel
            autoFocus
            onOpenPacket={onOpenPacket}
            onOpenProfile={onOpenProfile}
            onOpenDestination={onOpenSearchDestination}
          />
        </div>
      </main>
    );
  }

  return (
    <main data-guide-target="home-workspace" className="h-full overflow-y-auto bg-[#fbfcfb] text-[#202320]">
      <div className="mx-auto w-full max-w-[1380px] px-4 pb-8 pt-4 sm:px-6 lg:px-8">
        <header className="flex min-h-[62px] flex-wrap items-end justify-between gap-3 border-b border-[#d8dedb] pb-4">
          <div>
            <div className="text-[11px] font-semibold text-[#626a65]">{formatLongDate(new Date())}</div>
            <h1 className="mt-1 text-[28px] font-semibold tracking-[-0.035em] text-[#202320] sm:text-[32px]">
              {briefing ? `${daypart()}, ${firstName(briefing.viewer.name)}.` : "Home"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {briefing ? (
              <span className="text-[11px] font-semibold text-[#626a65]">
                {briefing.scope === "team" ? "Team view" : "Your work"}
              </span>
            ) : null}
            <button
              type="button"
              aria-label="Refresh home"
              title="Refresh home"
              onClick={() => void loadBriefing()}
              className="flex h-8 w-8 items-center justify-center border border-[#b9c6c1] bg-white text-[#176f60] hover:border-[#0f8b73]"
            >
              <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </header>

        {error ? (
          <div role="alert" className="mt-4 flex items-center justify-between gap-4 border-l-2 border-[#a9473d] bg-[#fff6f4] px-4 py-3 text-[12px] text-[#723d35]">
            <span>{error}</span>
            <button type="button" onClick={() => void loadBriefing()} className="font-semibold underline underline-offset-2">Retry</button>
          </div>
        ) : null}

        {!briefing && !error ? <HomeSkeleton /> : null}
        {briefing ? (
          <div className="mt-4 space-y-4">
            {briefing.unavailable_sections.length > 0 ? (
              <div role="status" className="border-l-2 border-[#b77b27] bg-[#fff8eb] px-4 py-2.5 text-[11px] text-[#73501f]">
                Some Home sections are temporarily unavailable. Available work remains current.
              </div>
            ) : null}
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)]">
              <ActivityPanel briefing={briefing} onOpenPacket={onOpenPacket} />
              <CurrentWorkPanel briefing={briefing} onOpenPacket={onOpenPacket} />
            </div>
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)]">
              <UpcomingPanel briefing={briefing} onOpenPacket={onOpenPacket} />
              <RecentPanel items={recentItems} onOpenRecent={onOpenRecent} />
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function ActivityPanel({ briefing, onOpenPacket }: BriefingPanelProps) {
  return (
    <section aria-label="Last 24 hours" className="min-w-0 border border-[#d8dedb] bg-white">
      <SectionHeader
        title="Last 24 hours"
        detail={briefing.unavailable_sections.includes("activity")
          ? "Unavailable"
          : `${briefing.activity.length}${briefing.activity_truncated ? "+" : ""} ${briefing.scope === "team" ? "team actions" : "actions"}`}
      />
      {briefing.unavailable_sections.includes("activity") ? (
        <UnavailableLine />
      ) : briefing.activity.length === 0 ? (
        <EmptyLine>No recorded activity in the last 24 hours.</EmptyLine>
      ) : (
        <div className="max-h-[340px] divide-y divide-[#e5e9e7] overflow-y-auto">
          {briefing.activity.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenPacket({ id: item.referral_id, name: clientDisplayName(item.client_name, item.community), community: item.community as Referral["community"] })}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-4 px-4 py-3 text-left hover:bg-[#f5faf8] sm:px-5"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-[#202320]">{item.label}</span>
                <span className="mt-0.5 block truncate text-[11px] text-[#6e746f]">{clientDisplayName(item.client_name, item.community)} · {item.community} · {item.actor_name}</span>
              </span>
              <span className="pt-0.5 text-[10px] font-semibold text-[#6e746f]">{relativeTime(item.occurred_at)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function CurrentWorkPanel({ briefing, onOpenPacket }: BriefingPanelProps) {
  return (
    <section data-guide-target="my-queue" aria-label="Current work" className="min-w-0 border border-[#d8dedb] bg-white">
      <SectionHeader title="Current work" detail={briefing.unavailable_sections.includes("current_work") ? "Unavailable" : `${briefing.current_work.total} assigned`} />
      {briefing.unavailable_sections.includes("current_work") ? (
        <UnavailableLine />
      ) : briefing.current_work.items.length === 0 ? (
        <EmptyLine>No assigned actions.</EmptyLine>
      ) : (
        <div className="divide-y divide-[#e5e9e7]">
          {briefing.current_work.items.map((item) => <QueueRow key={item.id} item={item} onOpenPacket={onOpenPacket} />)}
        </div>
      )}
    </section>
  );
}

function QueueRow({ item, onOpenPacket }: { item: MyQueueItem } & Pick<BriefingPanelProps, "onOpenPacket">) {
  return (
    <button
      type="button"
      onClick={() => onOpenPacket({ id: item.referral_id, name: clientDisplayName(item.client_name, item.community), community: item.community as Referral["community"] })}
      className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 text-left hover:bg-[#f5faf8]"
    >
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{clientDisplayName(item.client_name, item.community)}</span>
        <span className="mt-0.5 block truncate text-[11px] text-[#6e746f]">{item.next_action}</span>
      </span>
      <span className={`pt-0.5 text-[9px] font-bold uppercase tracking-[0.08em] ${urgencyColor(item.urgency)}`}>{urgencyLabel(item.urgency)}</span>
    </button>
  );
}

function UpcomingPanel({ briefing, onOpenPacket }: BriefingPanelProps) {
  return (
    <section aria-label="Upcoming" className="min-w-0 border border-[#d8dedb] bg-white">
      <SectionHeader title="Upcoming" detail={briefing.unavailable_sections.includes("upcoming") ? "Unavailable" : "Next 7 days"} icon={<CalendarClock size={15} />} />
      {briefing.unavailable_sections.includes("upcoming") ? (
        <UnavailableLine />
      ) : briefing.upcoming.length === 0 && briefing.unscheduled.length === 0 ? (
        <EmptyLine>No scheduled assessments or follow-ups.</EmptyLine>
      ) : (
        <div className="divide-y divide-[#e5e9e7]">
          {briefing.upcoming.slice(0, 6).map((event) => <ScheduleRow key={event.id} event={event} onOpenPacket={onOpenPacket} />)}
          {briefing.unscheduled.slice(0, Math.max(0, 6 - briefing.upcoming.length)).map((item) => (
            <UnscheduledRow key={item.referralId} item={item} onOpenPacket={onOpenPacket} />
          ))}
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
      className="grid w-full grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-[#f5faf8] sm:px-5"
    >
      <span className="text-[10px] font-semibold text-[#176f60]">{formatScheduleDate(event)}</span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{clientDisplayName(event.clientName, event.community)}</span>
        <span className="mt-0.5 block truncate text-[11px] text-[#6e746f]">{event.title} · {event.community}</span>
      </span>
      <span className="text-[10px] text-[#6e746f]">{methodLabel(event.method)}</span>
    </button>
  );
}

function UnscheduledRow({ item, onOpenPacket }: { item: PipelineUnscheduledAssessment } & Pick<BriefingPanelProps, "onOpenPacket">) {
  return (
    <button
      type="button"
      onClick={() => onOpenPacket({ id: item.referralId, name: clientDisplayName(item.clientName, item.community), community: item.community as Referral["community"] })}
      className="grid w-full grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-[#fff9ef] sm:px-5"
    >
      <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-[#9a641c]">Schedule</span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{clientDisplayName(item.clientName, item.community)}</span>
        <span className="mt-0.5 block truncate text-[11px] text-[#6e746f]">{item.community} · {item.owner}</span>
      </span>
      <ArrowRight size={14} className="text-[#9a641c]" />
    </button>
  );
}

function RecentPanel({ items, onOpenRecent }: { items: PipelineRecentDestination[]; onOpenRecent: (destination: PipelineRecentDestination) => void }) {
  return (
    <section data-guide-target="recent-work" aria-label="Recent" className="min-w-0 border border-[#d8dedb] bg-white">
      <SectionHeader title="Recent" detail="Your last five" />
      {items.length === 0 ? (
        <EmptyLine>Opened referrals and profiles will appear here.</EmptyLine>
      ) : (
        <div className="divide-y divide-[#e5e9e7]">
          {items.slice(0, 5).map((item) => (
            <button key={item.id} type="button" onClick={() => onOpenRecent(item)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 text-left hover:bg-[#f5f7fb]">
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{recentTitle(item)}</span>
                <span className="mt-0.5 block truncate text-[11px] text-[#6e746f]">{item.detail}</span>
              </span>
              <span className="pt-0.5 text-[10px] text-[#6e746f]">{relativeTime(item.visitedAt)}</span>
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
    <div className="flex h-11 items-center justify-between gap-3 border-b border-[#d8dedb] px-4 sm:px-5">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold">{icon}{title}</h2>
      <span className="text-[10px] font-semibold text-[#626a65]">{detail}</span>
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-[12px] text-[#626a65]">{children}</div>;
}

function UnavailableLine() {
  return <div className="px-5 py-10 text-center text-[12px] text-[#8a5a10]">Temporarily unavailable. Refresh to try again.</div>;
}

function HomeSkeleton() {
  return (
    <div aria-label="Loading home" aria-busy="true" className="mt-4 grid animate-pulse gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)]">
      <div className="h-[250px] border border-[#e1e5e3] bg-white" />
      <div className="h-[250px] border border-[#e1e5e3] bg-white" />
    </div>
  );
}

function firstName(value: string) {
  const naturalOrder = value.includes(",") ? value.split(",").slice(1).join(",").trim() : value.trim();
  return naturalOrder.split(/\s+/).find(Boolean) ?? value;
}

function daypart() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatLongDate(value: Date) {
  return value.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
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

function urgencyLabel(value: MyQueueUrgency) {
  return { overdue: "Overdue", blocked: "Blocked", due_soon: "Due soon", stale: "Stale", normal: "Next" }[value];
}

function urgencyColor(value: MyQueueUrgency) {
  return value === "overdue" || value === "blocked" ? "text-[#a9473d]" : value === "due_soon" ? "text-[#9a641c]" : "text-[#176f60]";
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
