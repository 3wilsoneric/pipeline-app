"use client";

import { useEffect, useRef, useState } from "react";

import PipelineSearchPanel from "@/components/pipeline/PipelineSearchPanel";
import { fetchCurrentPipelineUser, fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import {
  getPipelineWelcomeHistoryKey,
  getPipelineWelcomeSessionKey,
} from "@/lib/pipeline/home-state";
import {
  loadRecentDestinations,
  refreshRecentDestinations,
  subscribeToRecentDestinations,
  type PipelineRecentDestination,
} from "@/lib/pipeline/recent-destinations";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import type { MyQueueSnapshot, MyQueueUrgency } from "@/lib/pipeline/operations-types";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { PipelineSiteScreen } from "@/lib/pipeline/site-search";

export default function PipelineWelcome({
  onOpenPacket,
  onOpenRecent,
  onOpenProfile,
  onOpenOperations,
  onOpenSearchDestination,
  initialMode = "welcome",
}: {
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  onOpenRecent: (destination: PipelineRecentDestination) => void;
  onOpenProfile: (residentKey: string) => void;
  onOpenOperations: () => void;
  onOpenSearchDestination: (screen: PipelineSiteScreen) => void;
  initialMode?: "welcome" | "workspace";
}) {
  const [welcomeName, setWelcomeName] = useState("");
  const [welcomeKind, setWelcomeKind] = useState<"first" | "returning" | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeResolved, setWelcomeResolved] = useState(false);
  const [recentItems, setRecentItems] = useState<PipelineRecentDestination[]>([]);
  const { searchOpen, setHomeMode } = usePipelineShell();

  useEffect(() => {
    let cancelled = false;

    fetchCurrentPipelineUser()
      .then((payload) => {
        const id = payload?.user?.id?.trim();
        const name = payload?.user?.name?.trim();
        if (cancelled || !id || !name) return;

        const sessionKey = getPipelineWelcomeSessionKey(id);
        const historyKey = getPipelineWelcomeHistoryKey(id);
        const seenThisSession = readStorage(window.sessionStorage, sessionKey);
        const returningUser = readStorage(window.localStorage, historyKey);

        setWelcomeName(getFirstName(name));
        writeStorage(window.localStorage, historyKey);

        if (initialMode === "workspace" || seenThisSession) {
          writeStorage(window.sessionStorage, sessionKey);
          setShowWelcome(false);
          setWelcomeKind(null);
          setHomeMode("workspace");
          return;
        }

        writeStorage(window.sessionStorage, sessionKey);
        setWelcomeKind(returningUser ? "returning" : "first");
        setShowWelcome(true);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setWelcomeResolved(true);
      });

    return () => {
      cancelled = true;
    };
  }, [initialMode, setHomeMode]);

  useEffect(() => {
    const refreshRecent = () => setRecentItems(loadRecentDestinations());
    refreshRecent();
    void refreshRecentDestinations().then(refreshRecent).catch(() => undefined);
    return subscribeToRecentDestinations(refreshRecent);
  }, []);

  return (
    <main className="h-full overflow-y-auto bg-white text-[#111111]">
      <div className={`mx-auto flex min-h-full w-full max-w-[1240px] flex-col px-5 md:px-8 ${showWelcome ? "py-8 md:py-10" : "py-4 md:py-5"}`}>
        {!welcomeResolved ? <WelcomeSkeleton /> : null}

        {welcomeResolved && showWelcome && welcomeKind && !searchOpen ? (
          <div>
            <h1 className="text-[42px] font-semibold leading-[1.02] text-[#111111] md:text-[58px]">
              {welcomeKind === "first" ? "Welcome" : "Welcome back"}, {welcomeName}.
            </h1>
            <p className="mt-3 max-w-[560px] text-[15px] font-normal leading-6 text-[#595959]">
              Move referrals through assessment and keep every client record current.
            </p>
          </div>
        ) : null}

        {welcomeResolved && !searchOpen ? (
          <div className={`${showWelcome ? "mt-8 md:mt-10" : "mt-1"} grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1.42fr)_minmax(340px,0.88fr)]`}>
            <MyQueue
              ownerName={welcomeName}
              onOpenPacket={onOpenPacket}
              onOpenOperations={onOpenOperations}
            />
            <RecentWork
              items={recentItems}
              onOpenRecent={onOpenRecent}
              className="mt-0"
            />
          </div>
        ) : null}

        {welcomeResolved && searchOpen ? (
          <PipelineSearchPanel
            autoFocus
            className="mt-1"
            onOpenPacket={onOpenPacket}
            onOpenProfile={onOpenProfile}
            onOpenDestination={onOpenSearchDestination}
          />
        ) : null}

      </div>
    </main>
  );
}

function WelcomeSkeleton() {
  return (
    <div aria-label="Loading home" aria-busy="true" className="min-h-[300px] animate-pulse pt-1">
      <div className="h-12 w-full max-w-[520px] rounded bg-[#f0f2f1]" />
      <div className="mt-4 h-5 w-full max-w-[430px] rounded bg-[#f5f6f5]" />
    </div>
  );
}

function getFirstName(displayName: string) {
  const trimmedName = displayName.trim();
  const naturalOrderName = trimmedName.includes(",")
    ? trimmedName.split(",").slice(1).join(",").trim()
    : trimmedName;

  return naturalOrderName.split(/\s+/).find(Boolean) ?? trimmedName;
}

function readStorage(storage: Storage, key: string) {
  try {
    return storage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeStorage(storage: Storage, key: string) {
  try {
    storage.setItem(key, "true");
  } catch {
    // The greeting remains usable when browser storage is unavailable.
  }
}

function MyQueue({
  ownerName,
  onOpenPacket,
  onOpenOperations,
}: {
  ownerName: string;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  onOpenOperations: () => void;
}) {
  const [queue, setQueue] = useState<MyQueueSnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const queueSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let loading = false;
    let checking = false;
    const controller = new AbortController();
    const loadQueue = async () => {
      if (loading) return;
      loading = true;
      try {
        const payload = await fetchPipelineJson<MyQueueSnapshot & { sequence?: number }>("/api/operations/my-queue", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!cancelled) {
          setQueue(payload);
          if (Number.isSafeInteger(payload.sequence) && Number(payload.sequence) >= 0) {
            queueSequence.current = Number(payload.sequence);
          }
          setLoadFailed(false);
        }
      } catch {
        if (!cancelled) {
          setLoadFailed(true);
        }
      } finally {
        loading = false;
      }
    };
    const checkForQueueChanges = async () => {
      if (checking || loading) return;
      checking = true;
      try {
        const change = await fetchPipelineJson<{ changed?: boolean; sequence?: number }>(
          `/api/referrals/changes?after=${queueSequence.current}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (Number.isSafeInteger(change.sequence) && Number(change.sequence) >= 0) {
          queueSequence.current = Number(change.sequence);
        }
        if (change.changed) await loadQueue();
      } catch {
        // Keep the last successful queue and retry on the next heartbeat.
      } finally {
        checking = false;
      }
    };
    const refreshOnFocus = () => void checkForQueueChanges();
    void loadQueue();
    const interval = window.setInterval(() => void checkForQueueChanges(), 10_000);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, []);

  const items = queue?.items.slice(0, 5) ?? [];
  const summary = summarizeQueue(queue?.items ?? []);

  return (
    <section aria-label="Your assigned work" className="flex min-h-[300px] min-w-0 flex-col overflow-hidden rounded-md border border-[#c9d3cf] border-t-[3px] border-t-[#0f8b73] bg-white shadow-[0_8px_24px_rgba(28,58,49,0.06)] sm:min-h-[330px] xl:min-h-[360px]">
      <div className="flex min-h-[88px] items-center justify-between gap-5 border-b border-[#dce3e0] px-6 py-5 md:px-7">
        <div className="min-w-0">
          <h2 className="text-[22px] font-black leading-tight text-[#111111]">Your work</h2>
          <p className="mt-1.5 text-[13px] leading-5 text-[#656565]">Assigned referral actions, ordered by urgency</p>
        </div>
        <button
          type="button"
          onClick={onOpenOperations}
          title={loadFailed && queue ? "The latest queue refresh failed. Showing the last successful snapshot." : undefined}
          className={`min-w-[108px] shrink-0 rounded-sm border px-4 py-2.5 text-[12px] font-black transition-colors ${loadFailed && queue ? "border-[#d7bd84] bg-[#fffaf0] text-[#8a6118] hover:bg-[#fff5df]" : "border-[#9fcbbd] bg-[#f4faf7] text-[#0c705f] hover:border-[#0f8b73] hover:bg-[#e9f6f0]"}`}
        >
          {queue ? loadFailed ? "Refresh failed" : `${queue.total} open` : ownerName || "Loading"}
        </button>
      </div>
      {queue ? (
        <dl className="grid grid-cols-3 border-b border-[#dce3e0] bg-[#fafcfb]">
          <QueueSummaryItem label="Due today" value={summary.dueToday} tone={summary.dueToday > 0 ? "attention" : "neutral"} />
          <QueueSummaryItem label="Overdue" value={summary.overdue} tone={summary.overdue > 0 ? "critical" : "neutral"} />
          <QueueSummaryItem label="Blocked" value={summary.blocked} tone={summary.blocked > 0 ? "critical" : "neutral"} last />
        </dl>
      ) : null}
      {loadFailed && !queue ? (
        <button type="button" onClick={onOpenOperations} className="flex flex-1 flex-col justify-center px-7 py-10 text-left hover:bg-[#fff9f7]">
          <span className="text-[16px] font-black text-[#a04436]">Assigned work is unavailable</span>
          <span className="mt-2 max-w-[460px] text-[13px] leading-5 text-[#666666]">Open Operations to review assignments and retry the current snapshot.</span>
        </button>
      ) : !queue ? (
        <QueueSkeleton />
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col justify-center px-7 py-10">
          <div className="text-[17px] font-black text-[#111111]">No assigned actions</div>
          <p className="mt-2 max-w-[470px] text-[13px] leading-6 text-[#666666]">Referral and requirement assignments will appear here with their deadline and next step.</p>
        </div>
      ) : (
        <div className="flex-1 divide-y divide-[#dfe5e2]">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenPacket({
                id: item.referral_id,
                name: item.client_name,
                community: item.community as Referral["community"],
              })}
              className="group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-5 border-l-[3px] border-transparent px-6 py-4 text-left transition-colors hover:border-[#0f8b73] hover:bg-[#f6faf8] focus-visible:border-[#0f8b73] focus-visible:bg-[#f6faf8] focus-visible:outline-none md:px-7"
            >
              <span className="min-w-0">
                <span className="block truncate text-[16px] font-black text-[#111111]">{item.client_name}</span>
                <span className="mt-1 block truncate text-[12px] font-semibold text-[#595959]">{item.community}</span>
                <span className="mt-2 block line-clamp-2 text-[13px] leading-5 text-[#666666]">{item.next_action}</span>
              </span>
              <span className="self-center text-right">
                <span className={`block text-[10px] font-black uppercase tracking-[0.08em] ${queueUrgencyColor(item.urgency)}`}>
                  {queueUrgencyLabel(item.urgency)}
                </span>
                <span className="mt-1.5 block text-[11px] text-[#6f6f6f]">{formatQueueDueDate(item.due_at)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function QueueSkeleton() {
  return (
    <div aria-label="Loading queue" aria-busy="true" className="flex-1 divide-y divide-[#e5e5e5]">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_56px] gap-4 px-5 py-4">
          <div className="animate-pulse">
            <div className="h-3.5 w-2/5 rounded bg-[#e9ecea]" />
            <div className="mt-2 h-2.5 w-3/5 rounded bg-[#f0f2f1]" />
            <div className="mt-2 h-2.5 w-4/5 rounded bg-[#f4f5f4]" />
          </div>
          <div className="h-3 animate-pulse rounded bg-[#f0f2f1]" />
        </div>
      ))}
    </div>
  );
}

function QueueSummaryItem({
  label,
  value,
  tone,
  last = false,
}: {
  label: string;
  value: number;
  tone: "neutral" | "attention" | "critical";
  last?: boolean;
}) {
  const toneClass = tone === "critical"
    ? "text-[#a04436]"
    : tone === "attention"
      ? "text-[#9b5b0b]"
      : "text-[#111111]";
  return (
    <div className={`px-6 py-4 ${last ? "" : "border-r border-[#dce3e0]"}`}>
      <dt className="text-[10px] font-black uppercase tracking-[0.1em] text-[#737373]">{label}</dt>
      <dd className={`mt-1 text-[22px] font-black leading-none ${toneClass}`}>{value}</dd>
    </div>
  );
}

function RecentWork({
  items,
  onOpenRecent,
  className = "",
}: {
  items: PipelineRecentDestination[];
  onOpenRecent: (destination: PipelineRecentDestination) => void;
  className?: string;
}) {
  return (
    <section aria-label="Recent" className={`flex min-h-[300px] min-w-0 flex-col overflow-hidden rounded-md border border-[#c9d3cf] border-t-[3px] border-t-[#4568b1] bg-white shadow-[0_8px_24px_rgba(37,54,94,0.05)] sm:min-h-[330px] xl:min-h-[360px] ${className}`}>
      <div className="flex min-h-[88px] items-center justify-between gap-5 border-b border-[#dce3e0] px-6 py-5">
        <div className="min-w-0">
          <h2 className="text-[22px] font-black leading-tight text-[#111111]">Recent</h2>
          <p className="mt-1.5 text-[13px] leading-5 text-[#656565]">Resume where you left off</p>
        </div>
        <span className="shrink-0 rounded-sm bg-[#f1f4fb] px-3 py-2 text-[10px] font-black uppercase tracking-[0.1em] text-[#4568b1]">Last five</span>
      </div>
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col justify-center px-7 py-10">
          <div className="text-[17px] font-black text-[#111111]">Nothing opened yet</div>
          <p className="mt-2 max-w-[360px] text-[13px] leading-6 text-[#666666]">Client profiles and referral workspaces you open will appear here.</p>
        </div>
      ) : (
        <div className="flex-1 divide-y divide-[#dfe5e2]">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenRecent(item)}
              className="group block w-full min-w-0 border-l-[3px] border-transparent px-6 py-4 text-left transition-colors hover:border-[#4568b1] hover:bg-[#f7f8fc] focus-visible:border-[#4568b1] focus-visible:bg-[#f7f8fc] focus-visible:outline-none"
            >
              <span className="flex min-w-0 items-start justify-between gap-4">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-black text-[#111111]">{recentTitle(item)}</span>
                  <span className="mt-1.5 block truncate text-[13px] text-[#666666]">{recentDetail(item)}</span>
                </span>
                <span className="shrink-0 pt-0.5 text-right">
                  <span className="block text-[10px] font-black uppercase tracking-[0.1em] text-[#4568b1]">{recentKindLabel(item)}</span>
                  <span className="mt-1.5 block text-[11px] text-[#6f6f6f]">{formatRecentTime(item.visitedAt)}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function recentKindLabel(item: PipelineRecentDestination) {
  if (item.kind === "profile") return "Profile";
  if (item.kind === "referral") return "Workspace";
  if (item.screen === "packet") return "New referral";
  if (item.screen === "operations") return "Operations";
  return "Page";
}

function recentTitle(item: PipelineRecentDestination) {
  return item.id === "page:referrals" ? "Workspaces" : item.title;
}

function recentDetail(item: PipelineRecentDestination) {
  return item.id === "page:referrals" ? "Client referral records" : item.detail;
}

function formatRecentTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Recently";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (elapsedMinutes < 1) return "Just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  return elapsedDays === 1 ? "Yesterday" : `${elapsedDays}d ago`;
}

function queueUrgencyLabel(urgency: MyQueueUrgency) {
  return {
    overdue: "Overdue",
    blocked: "Blocked",
    due_soon: "Due soon",
    stale: "Stale",
    normal: "Next",
  }[urgency];
}

function queueUrgencyColor(urgency: MyQueueUrgency) {
  return {
    overdue: "text-[#a04436]",
    blocked: "text-[#a04436]",
    due_soon: "text-[#9b5b0b]",
    stale: "text-[#6b5b2c]",
    normal: "text-[#0f8b73]",
  }[urgency];
}

function summarizeQueue(items: MyQueueSnapshot["items"]) {
  const today = localDateKey(new Date());
  return {
    dueToday: items.filter((item) => item.due_at?.slice(0, 10) === today).length,
    overdue: items.filter((item) => item.urgency === "overdue").length,
    blocked: items.filter((item) => item.urgency === "blocked").length,
  };
}

function formatQueueDueDate(value: string | null) {
  if (!value) return "No deadline";
  const dateKey = value.slice(0, 10);
  const today = localDateKey(new Date());
  if (dateKey === today) return "Due today";

  const parsed = new Date(`${dateKey}T12:00:00`);
  if (!Number.isFinite(parsed.getTime())) return "Deadline set";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
