"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ArrowRight, RefreshCw, UserPlus, UserRound, UsersRound } from "lucide-react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { Referral } from "@/lib/pipeline/referral-types";
import type {
  WorkspaceActivityItem,
  WorkspaceActivityResponse,
  WorkspaceActivityScope,
} from "@/lib/pipeline/workspace-activity-types";

export default function WorkspaceActivityFeed({
  canViewTeam,
  onOpenPacket,
}: {
  canViewTeam: boolean;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  const [scope, setScope] = useState<WorkspaceActivityScope>("attention");
  const [items, setItems] = useState<WorkspaceActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (cursor?: string, signal?: AbortSignal) => {
    if (cursor) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ scope, limit: "40" });
      if (cursor) params.set("cursor", cursor);
      const payload = await fetchPipelineJson<WorkspaceActivityResponse>(`/api/operations/activity?${params}`, {
        cache: "no-store",
        signal,
      }, { cacheTtlMs: 5_000 });
      setItems((current) => cursor ? mergeActivityItems(current, payload.items) : payload.items);
      setNextCursor(payload.next_cursor);
    } catch (loadError) {
      if (!signal?.aborted) setError(loadError instanceof Error ? loadError.message : "Activity could not be loaded.");
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [scope]);

  useEffect(() => {
    const controller = new AbortController();
    void load(undefined, controller.signal);
    const refreshOnFocus = () => void load();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      controller.abort();
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [load]);

  const groups = useMemo(() => groupActivity(items), [items]);

  return (
    <section aria-label="Workspace activity" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#cfd7d3] pb-3">
        <div>
          <h2 className="text-[18px] font-black text-[#17211d]">Workspace activity</h2>
          <p className="mt-1 text-[11px] font-medium text-[#68716c]">Assignments, schedules, stages, and decisions—never clinical field content.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="flex h-9 items-center gap-2 px-3 text-[10px] font-black uppercase tracking-[0.08em] text-[#0c705f] hover:bg-[#eff8f5] disabled:opacity-50">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div role="tablist" aria-label="Activity scope" className="mt-3 flex flex-wrap gap-2">
        <ScopeButton active={scope === "attention"} onClick={() => setScope("attention")} icon={<AlertTriangle size={14} />} label="Needs attention" detail="Urgent, blocked, decision-ready" />
        <ScopeButton active={scope === "mine"} onClick={() => setScope("mine")} icon={<UserRound size={14} />} label="Mine" detail="Movement on your referrals" />
        {canViewTeam ? <ScopeButton active={scope === "team"} onClick={() => setScope("team")} icon={<UsersRound size={14} />} label="Team" detail="Across active workspaces" /> : null}
      </div>

      {error ? (
        <div role="alert" className="mt-4 flex items-center justify-between gap-4 border-l-2 border-[#a9473d] bg-[#fff6f4] px-4 py-3 text-[11px] text-[#723d35]">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="font-black underline underline-offset-2">Retry</button>
        </div>
      ) : null}
      {loading && items.length === 0 ? <ActivitySkeleton /> : null}
      {!loading && !error && groups.length === 0 ? (
        <div className="mt-4 border border-[#dfe5e2] px-5 py-14 text-center">
          <Activity size={20} className="mx-auto text-[#7b9189]" />
          <div className="mt-3 text-[14px] font-black text-[#202723]">{emptyTitle(scope)}</div>
          <p className="mx-auto mt-2 max-w-md text-[11px] leading-5 text-[#6d7571]">{emptyDetail(scope)}</p>
        </div>
      ) : null}

      {groups.length > 0 ? (
        <div className="mt-4 space-y-5">
          {groupByDay(groups).map((section) => (
            <section key={section.key} aria-label={section.label}>
              <h3 className="mb-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#66716c]">{section.label}</h3>
              <div className="divide-y divide-[#e4e8e6] border-y border-[#d4dbd8]">
                {section.groups.map((group) => (
                  <ActivityGroupRow key={group.id} group={group} onOpenPacket={onOpenPacket} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {nextCursor ? (
        <div className="mt-4 flex justify-center">
          <button type="button" onClick={() => void load(nextCursor)} disabled={loadingMore} className="h-10 border border-[#9fc2b7] px-5 text-[10px] font-black uppercase tracking-[0.08em] text-[#0c705f] hover:bg-[#eff8f5] disabled:opacity-50">
            {loadingMore ? "Loading" : "Load more activity"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function SinceLastVisitAssignments({
  viewerId,
  onOpenPacket,
}: {
  viewerId: string;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  const [items, setItems] = useState<WorkspaceActivityItem[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const storageKey = lastVisitStorageKey(viewerId);
    const fallback = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
    const stored = window.localStorage.getItem(storageKey);
    const since = stored && Number.isFinite(Date.parse(stored)) ? stored : fallback;
    const params = new URLSearchParams({ scope: "assigned", limit: "6", since });
    fetchPipelineJson<WorkspaceActivityResponse>(`/api/operations/activity?${params}`, {
      cache: "no-store",
      signal: controller.signal,
    }, { cacheTtlMs: 5_000 })
      .then((payload) => {
        setItems(payload.items);
        setUnavailable(false);
        window.localStorage.setItem(storageKey, payload.generated_at);
      })
      .catch(() => {
        if (!controller.signal.aborted) setUnavailable(true);
      });
    return () => controller.abort();
  }, [viewerId]);

  return (
    <section aria-label="Since your last visit" className="min-w-0 bg-white">
      <div className="flex h-12 items-center justify-between gap-3 px-1">
        <h2 className="flex items-center gap-2.5 text-[15px] font-bold text-[#202723]"><UserPlus size={15} className="text-[#0f8b73]" />New assignments</h2>
        <span className="text-[11px] font-bold text-[#626a65]">Since your last visit</span>
      </div>
      {unavailable ? (
        <p className="border border-[#ead5ad] bg-[#fffaf0] px-5 py-10 text-center text-[12px] text-[#8a5a10]">New assignments could not be checked. Your current queue is still available above.</p>
      ) : items === null ? (
        <div className="h-28 animate-pulse border border-[#e1e6e3] bg-[#f3f6f4]" aria-label="Checking new referral assignments" />
      ) : items.length === 0 ? (
        <p className="border border-[#e0e5e2] px-5 py-10 text-center text-[13px] font-medium text-[#626a65]">No referrals were assigned since your last visit.</p>
      ) : (
        <div className="divide-y divide-[#e5e9e7] border-y border-[#dfe5e2]">
          {items.slice(0, 6).map((item) => (
            <button key={item.event_id} type="button" onClick={() => openActivityItem(item, onOpenPacket)} className="group grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3 py-3 text-left hover:bg-[#f1f8f5] sm:px-4">
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-bold text-[#202723]">{item.workspace.client_name}</span>
                <span className="mt-0.5 block truncate text-[12px] font-medium text-[#69716c]">{item.workspace.community}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[10px] font-bold text-[#176f60]">Assigned {relativeTime(item.created_at)}<ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function ScopeButton({ active, onClick, icon, label, detail }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; detail: string }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`flex min-h-10 items-center gap-2 border px-3 text-left ${active ? "border-[#0f8b73] bg-[#eff8f5] text-[#0c705f]" : "border-[#d8dedb] bg-white text-[#59625e] hover:border-[#9fb9b0]"}`}>
      {icon}
      <span><span className="block text-[10px] font-black">{label}</span><span className="hidden text-[8px] font-semibold text-[#78817d] sm:block">{detail}</span></span>
    </button>
  );
}

type ActivityGroup = {
  id: string;
  actorName: string;
  actorKey: string;
  createdAt: string;
  items: WorkspaceActivityItem[];
};

function ActivityGroupRow({ group, onOpenPacket }: { group: ActivityGroup; onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void }) {
  if (group.items.length === 1) {
    const item = group.items[0];
    return (
      <button type="button" onClick={() => openActivityItem(item, onOpenPacket)} className="group grid min-h-16 w-full grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left hover:bg-[#f5faf8] sm:px-4">
        <ActorMark name={group.actorName} />
        <span className="min-w-0">
          <span className="block text-[11px] leading-5 text-[#3f4843]"><strong className="text-[#17211d]">{group.actorName}</strong> {activityVerb(item.action)} <strong className="text-[#17211d]">{item.workspace.client_name}</strong></span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] font-semibold text-[#78817d]">
            <span>{item.workspace.community}</span><span>{relativeTime(item.created_at)}</span>{item.attention ? <AttentionBadge attention={item.attention} /> : null}
          </span>
        </span>
        <ArrowRight size={15} className="text-[#0f8b73] transition-transform group-hover:translate-x-0.5" />
      </button>
    );
  }
  const workspaceCount = new Set(group.items.map((item) => item.workspace.referral_id)).size;
  return (
    <details className="group px-3 py-3 sm:px-4">
      <summary className="grid min-h-10 cursor-pointer list-none grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-3 outline-none [&::-webkit-details-marker]:hidden">
        <ActorMark name={group.actorName} />
        <span className="min-w-0">
          <span className="block text-[11px] text-[#3f4843]"><strong className="text-[#17211d]">{group.actorName}</strong> made {group.items.length} updates across {workspaceCount} workspace{workspaceCount === 1 ? "" : "s"}</span>
          <span className="mt-1 block text-[9px] font-semibold text-[#78817d]">{relativeTime(group.createdAt)} · Show details</span>
        </span>
        <span className="text-[10px] font-black text-[#0c705f] group-open:hidden">Show</span>
        <span className="hidden text-[10px] font-black text-[#0c705f] group-open:block">Hide</span>
      </summary>
      <div className="ml-[50px] mt-2 divide-y divide-[#edf0ee] border-t border-[#e1e6e3]">
        {group.items.map((item) => (
          <button key={item.event_id} type="button" onClick={() => openActivityItem(item, onOpenPacket)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:text-[#0c705f]">
            <span className="min-w-0"><span className="block truncate text-[10px] font-black">{item.workspace.client_name}</span><span className="mt-0.5 block truncate text-[9px] text-[#78817d]">{activityVerb(item.action)} · {item.workspace.community}</span></span>
            <span className="flex shrink-0 items-center gap-2">{item.attention ? <AttentionBadge attention={item.attention} /> : null}<ArrowRight size={13} /></span>
          </button>
        ))}
      </div>
    </details>
  );
}

function ActorMark({ name }: { name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "P";
  return <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center border border-[#b8dacf] bg-[#eff8f5] text-[9px] font-black text-[#0c705f]">{initials}</span>;
}

function AttentionBadge({ attention }: { attention: NonNullable<WorkspaceActivityItem["attention"]> }) {
  const classes = attention.level === "urgent"
    ? "border-[#e1a198] bg-[#fff2ef] text-[#923a30]"
    : attention.level === "attention"
      ? "border-[#dfbd7d] bg-[#fff8e9] text-[#79510e]"
      : "border-[#a8c4bb] bg-[#f2f8f5] text-[#316457]";
  return <span className={`inline-flex min-h-5 items-center border px-1.5 text-[8px] font-black uppercase tracking-[0.05em] ${classes}`}>{attention.label}</span>;
}

function groupActivity(items: WorkspaceActivityItem[]) {
  const groups: ActivityGroup[] = [];
  for (const item of items) {
    const actorKey = item.actor_id?.trim().toLowerCase() || item.actor_name.trim().toLowerCase();
    const previous = groups.at(-1);
    const closeInTime = previous
      ? Math.abs(Date.parse(previous.createdAt) - Date.parse(item.created_at)) <= 20 * 60 * 1_000
      : false;
    if (previous && previous.actorKey === actorKey && closeInTime && previous.items.length < 12) {
      previous.items.push(item);
      continue;
    }
    groups.push({ id: item.event_id, actorName: item.actor_name, actorKey, createdAt: item.created_at, items: [item] });
  }
  return groups;
}

function groupByDay(groups: ActivityGroup[]) {
  const sections: Array<{ key: string; label: string; groups: ActivityGroup[] }> = [];
  for (const group of groups) {
    const key = dayKey(group.createdAt);
    const previous = sections.at(-1);
    if (previous?.key === key) previous.groups.push(group);
    else sections.push({ key, label: dayLabel(group.createdAt), groups: [group] });
  }
  return sections;
}

function mergeActivityItems(current: WorkspaceActivityItem[], incoming: WorkspaceActivityItem[]) {
  const byId = new Map(current.map((item) => [item.event_id, item]));
  incoming.forEach((item) => byId.set(item.event_id, item));
  return [...byId.values()].sort((left, right) => right.created_at.localeCompare(left.created_at) || right.event_id.localeCompare(left.event_id));
}

function openActivityItem(item: WorkspaceActivityItem, onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void) {
  onOpenPacket({
    id: item.workspace.referral_id,
    name: item.workspace.client_name,
    community: item.workspace.community as Referral["community"],
  });
}

function activityVerb(action: string) {
  const labels: Record<string, string> = {
    referral_created: "created the workspace for",
    referral_updated: "updated",
    referral_assigned: "assigned",
    referral_reassigned: "reassigned",
    referral_unassigned: "unassigned",
    referral_stage_changed: "changed the workflow stage for",
    manual_intake_authorized: "authorized manual intake for",
    assessment_created: "started an assessment for",
    assessment_imported: "imported an assessment for",
    assessment_updated: "updated the assessment for",
    assessment_assigned: "changed the assessor for",
    assessment_scheduled: "scheduled the assessment for",
    assessment_rescheduled: "rescheduled the assessment for",
    assessment_cancelled: "cancelled the assessment for",
    assessment_no_show: "recorded a no-show for",
    assessment_started: "started the scheduled assessment for",
    assessment_completed: "completed the assessment for",
    assessment_signed: "signed the assessment for",
    assessment_addendum_added: "added an assessment addendum for",
    assessment_recommendation_submitted: "submitted a recommendation for",
    work_item_updated: "updated a requirement for",
    admission_decision_recorded: "recorded an admission decision for",
    admission_decision_overridden: "overrode the admission decision for",
    admission_declined: "declined",
    ehr_handoff_updated: "updated the EHR handoff for",
    extraction_confirmed: "confirmed extracted assessment data for",
  };
  return labels[action] ?? "updated";
}

function relativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Recently";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
}

function dayKey(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en-CA") : value.slice(0, 10);
}

function dayLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Earlier";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

function lastVisitStorageKey(viewerId: string) {
  return `pipeline:last-activity-visit:${encodeURIComponent(viewerId)}`;
}

function emptyTitle(scope: WorkspaceActivityScope) {
  if (scope === "attention") return "No exceptions need action";
  if (scope === "mine") return "No updates on your referrals";
  if (scope === "assigned") return "No new assignments";
  return "No team updates in this view";
}

function emptyDetail(scope: WorkspaceActivityScope) {
  if (scope === "attention") return "Urgent, blocked, incomplete, and decision-ready workspaces surface here.";
  if (scope === "mine") return "Assignment, scheduling, stage, and decision changes on your referrals surface here.";
  if (scope === "assigned") return "New referrals assigned to you surface here.";
  return "Assignment, scheduling, stage, and decision changes across active team workspaces surface here.";
}

function ActivitySkeleton() {
  return (
    <div aria-label="Loading workspace activity" aria-busy="true" className="mt-4 animate-pulse divide-y divide-[#e4e8e6] border-y border-[#d4dbd8]">
      {Array.from({ length: 5 }, (_, index) => <div key={index} className="flex h-16 items-center gap-3 px-4"><span className="h-8 w-8 bg-[#e8eeeb]" /><span className="h-3 w-2/3 bg-[#e8eeeb]" /></div>)}
    </div>
  );
}
