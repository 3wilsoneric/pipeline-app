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
import { getStageLabel } from "@/lib/pipeline/referral-workflow";
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

        setWelcomeName(name);
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

        {welcomeResolved && showWelcome && welcomeKind ? (
          <div>
            <h1 className="text-[42px] font-semibold leading-[1.02] text-[#111111] md:text-[58px]">
              {welcomeKind === "first" ? "Welcome" : "Welcome back"}, {welcomeName}.
            </h1>
            <p className="mt-3 max-w-[560px] text-[15px] font-normal leading-6 text-[#595959]">
              Work referrals, complete assessments, and keep every client record current.
            </p>
          </div>
        ) : null}

        {welcomeResolved && !searchOpen ? (
          <div className={`${showWelcome ? "mt-8 md:mt-10" : "mt-1"} grid min-w-0 gap-5 lg:grid-cols-[minmax(340px,0.82fr)_minmax(0,1.18fr)]`}>
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
            className="mt-10"
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
        if (!cancelled) setLoadFailed(true);
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

  return (
    <section aria-label="My queue" className="flex min-h-[300px] min-w-0 flex-col overflow-hidden rounded-md border border-[#d9d9d9] bg-white">
      <div className="flex min-h-[72px] items-center justify-between gap-4 border-b border-[#d9d9d9] bg-[#fbfcfb] px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[18px] font-black text-[#111111]">My queue</h2>
          <p className="mt-1 truncate text-[11px] text-[#737373]">Your next referral actions</p>
        </div>
        <button
          type="button"
          onClick={onOpenOperations}
          title={loadFailed && queue ? "The latest queue refresh failed. Showing the last successful snapshot." : undefined}
          className={`min-w-[104px] shrink-0 rounded border bg-white px-3 py-2 text-[11px] font-black ${loadFailed && queue ? "border-[#d7bd84] text-[#8a6118] hover:bg-[#fffaf0]" : "border-[#b8dacf] text-[#0c705f] hover:border-[#0f8b73] hover:bg-[#effaf5]"}`}
        >
          {queue ? loadFailed ? "Refresh failed" : `${queue.total} assigned` : ownerName || "Loading"}
        </button>
      </div>
      {loadFailed && !queue ? (
        <button type="button" onClick={onOpenOperations} className="flex flex-1 flex-col justify-center px-6 py-10 text-left hover:bg-[#fff9f7]">
          <span className="text-[14px] font-black text-[#a04436]">Queue unavailable</span>
          <span className="mt-2 max-w-[380px] text-[12px] leading-5 text-[#737373]">Open Operations to review assigned work and retry the current snapshot.</span>
        </button>
      ) : !queue ? (
        <QueueSkeleton />
      ) : items.length === 0 ? (
        <div className="flex flex-1 flex-col justify-center px-6 py-10">
          <div className="text-[15px] font-black text-[#111111]">You&apos;re caught up</div>
          <p className="mt-2 max-w-[380px] text-[12px] leading-5 text-[#737373]">No active referral work is assigned to you. New actions will appear here automatically.</p>
        </div>
      ) : (
        <div className="flex-1 divide-y divide-[#e5e5e5]">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenPacket({
                id: item.referral_id,
                name: item.client_name,
                community: item.community as Referral["community"],
              })}
              className="group grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-4 border-l-[3px] border-transparent px-5 py-4 text-left hover:border-[#0f8b73] hover:bg-[#f7faf9] focus-visible:border-[#0f8b73] focus-visible:bg-[#f7faf9] focus-visible:outline-none"
            >
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-black text-[#111111]">{item.client_name}</span>
                <span className="mt-1 block truncate text-[11px] font-semibold text-[#595959]">{item.community} · {getStageLabel(item.stage)}</span>
                <span className="mt-1.5 block line-clamp-2 text-[12px] leading-5 text-[#737373]">{item.next_action}</span>
              </span>
              <span className={`self-center text-[10px] font-black uppercase tracking-[0.08em] ${queueUrgencyColor(item.urgency)}`}>
                {queueUrgencyLabel(item.urgency)}
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
    <section aria-label="Recent" className={`flex min-h-[300px] min-w-0 flex-col overflow-hidden rounded-md border border-[#d9d9d9] bg-white ${className}`}>
      <div className="flex min-h-[72px] items-center justify-between gap-4 border-b border-[#d9d9d9] bg-[#fbfcfb] px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[18px] font-black text-[#111111]">Recent</h2>
          <p className="mt-1 truncate text-[11px] text-[#737373]">Resume where you left off</p>
        </div>
        <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.1em] text-[#737373]">Last five</span>
      </div>
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col justify-center px-6 py-10">
          <div className="text-[15px] font-black text-[#111111]">Nothing opened yet</div>
          <p className="mt-2 max-w-[340px] text-[12px] leading-5 text-[#737373]">Profiles, referral packets, and work pages you open in this session will appear here.</p>
        </div>
      ) : (
        <div className="flex-1 divide-y divide-[#e5e5e5]">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenRecent(item)}
              className="group block w-full min-w-0 border-l-[3px] border-transparent px-5 py-4 text-left hover:border-[#0f8b73] hover:bg-[#f7faf9] focus-visible:border-[#0f8b73] focus-visible:bg-[#f7faf9] focus-visible:outline-none"
            >
              <span className="flex min-w-0 items-start justify-between gap-4">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-black text-[#111111]">{item.title}</span>
                  <span className="mt-1 block truncate text-[12px] text-[#737373]">{item.detail}</span>
                </span>
                <span className="shrink-0 pt-0.5 text-right">
                  <span className="block text-[9px] font-black uppercase tracking-[0.1em] text-[#0c705f]">{recentKindLabel(item)}</span>
                  <span className="mt-1 block text-[10px] text-[#8a8a8a]">{formatRecentTime(item.visitedAt)}</span>
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
  if (item.kind === "referral") return "Referral";
  if (item.screen === "packet") return "New packet";
  if (item.screen === "operations") return "Operations";
  return "Page";
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
