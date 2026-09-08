"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import type {
  SupervisorExceptionItem,
  SupervisorExceptionSnapshot,
} from "@/lib/pipeline/operations-types";
import type { Referral } from "@/lib/pipeline/referral-types";

const collapsedItemLimit = 8;
type ReferralDestination = { id: number; name?: string; community?: Referral["community"] };

export default function SupervisorCommandCenter({
  onOpenPacket,
  onOpenProfile,
  onOpenProfiles,
}: {
  onOpenPacket: (referral: ReferralDestination) => void;
  onOpenProfile: (profileId: string) => void;
  onOpenProfiles: () => void;
}) {
  const [snapshot, setSnapshot] = useState<SupervisorExceptionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const payload = await fetchPipelineJson<SupervisorExceptionSnapshot>(
        "/api/operations/supervisor-queue",
        { cache: "no-store", signal },
        { cacheTtlMs: 5_000 },
      );
      setSnapshot(payload);
      setError("");
    } catch (loadError) {
      if (!signal?.aborted) {
        setError(loadError instanceof Error ? loadError.message : "Supervisor exceptions could not be loaded.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const refreshOnFocus = () => void load(controller.signal);
    const interval = window.setInterval(() => void load(controller.signal), 60_000);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [load]);

  const visibleItems = useMemo(
    () => showAll ? snapshot?.items ?? [] : snapshot?.items.slice(0, collapsedItemLimit) ?? [],
    [showAll, snapshot],
  );

  return (
    <CommandCenterView
      snapshot={snapshot}
      visibleItems={visibleItems}
      loading={loading}
      error={error}
      showAll={showAll}
      onRefresh={() => void load()}
      onToggleAll={() => setShowAll((current) => !current)}
      onOpenItem={(item) => openException(item, { onOpenPacket, onOpenProfile, onOpenProfiles })}
    />
  );
}

function CommandCenterView({
  snapshot,
  visibleItems,
  loading,
  error,
  showAll,
  onRefresh,
  onToggleAll,
  onOpenItem,
}: {
  snapshot: SupervisorExceptionSnapshot | null;
  visibleItems: SupervisorExceptionItem[];
  loading: boolean;
  error: string;
  showAll: boolean;
  onRefresh: () => void;
  onToggleAll: () => void;
  onOpenItem: (item: SupervisorExceptionItem) => void;
}) {
  const counts = severityCounts(snapshot?.items ?? []);
  return (
    <section aria-label="Supervisor command center" className="border-y border-[#cfd7d2] bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dfe5e2] px-1 py-4 sm:px-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[#176f60]">
            <ShieldCheck size={17} aria-hidden="true" />
            <h1 className="text-[17px] font-black tracking-[-0.01em] text-[#17211d]">Supervisor command center</h1>
          </div>
          <p className="mt-1 text-[11px] font-medium text-[#68716c]">The exceptions that need ownership, review, or recovery now.</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading} className="flex h-9 items-center gap-2 px-3 text-[10px] font-black uppercase tracking-[0.07em] text-[#176f60] hover:bg-[#eff8f5] disabled:opacity-50">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} aria-hidden="true" /> Refresh
        </button>
      </header>

      {snapshot ? <CommandCenterCounts total={snapshot.total} counts={counts} /> : null}
      <CommandCenterStatus snapshot={snapshot} loading={loading} error={error} onRefresh={onRefresh} />
      <CommandCenterItems items={visibleItems} onOpenItem={onOpenItem} />
      <CommandCenterExpansion snapshot={snapshot} showAll={showAll} onToggleAll={onToggleAll} />
    </section>
  );
}

function CommandCenterStatus({
  snapshot,
  loading,
  error,
  onRefresh,
}: {
  snapshot: SupervisorExceptionSnapshot | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  if (error) {
    return (
      <div role="alert" className="mx-1 my-3 flex items-center justify-between gap-4 border-l-2 border-[#a9473d] bg-[#fff6f4] px-4 py-3 text-[11px] text-[#723d35] sm:mx-3">
        <span>{error}{snapshot ? " Showing the last successful snapshot." : ""}</span>
        <button type="button" onClick={onRefresh} className="shrink-0 font-black underline underline-offset-2">Retry</button>
      </div>
    );
  }
  if (loading && !snapshot) return <CommandCenterSkeleton />;
  if (snapshot?.total === 0) return <CommandCenterClear generatedAt={snapshot.generated_at} />;
  return null;
}

function CommandCenterItems({ items, onOpenItem }: { items: SupervisorExceptionItem[]; onOpenItem: (item: SupervisorExceptionItem) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="divide-y divide-[#e4e8e6]" aria-live="polite">
      {items.map((item) => <ExceptionRow key={item.id} item={item} onOpen={() => onOpenItem(item)} />)}
    </div>
  );
}

function CommandCenterExpansion({
  snapshot,
  showAll,
  onToggleAll,
}: {
  snapshot: SupervisorExceptionSnapshot | null;
  showAll: boolean;
  onToggleAll: () => void;
}) {
  if (!snapshot || snapshot.items.length <= collapsedItemLimit) return null;
  return (
    <div className="flex justify-center border-t border-[#dfe5e2] py-3">
      <button type="button" onClick={onToggleAll} aria-expanded={showAll} className="h-9 px-4 text-[10px] font-black uppercase tracking-[0.07em] text-[#176f60] hover:bg-[#eff8f5]">
        {showAll ? "Show priority exceptions" : `Show all ${snapshot.items.length} exceptions`}
      </button>
    </div>
  );
}

function CommandCenterCounts({ total, counts }: { total: number; counts: Record<SupervisorExceptionItem["severity"], number> }) {
  return (
    <dl className="grid grid-cols-2 gap-px border-b border-[#dfe5e2] bg-[#dfe5e2] sm:grid-cols-4">
      <CommandCenterCount label="Open" value={total} tone="text-[#17211d]" />
      <CommandCenterCount label="Critical" value={counts.critical} tone="text-[#a9473d]" />
      <CommandCenterCount label="Needs attention" value={counts.attention} tone="text-[#9a6411]" />
      <CommandCenterCount label="Review" value={counts.review} tone="text-[#176f60]" />
    </dl>
  );
}

function CommandCenterCount({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className="bg-[#f8faf9] px-4 py-3"><dt className="text-[8px] font-black uppercase tracking-[0.1em] text-[#68716c]">{label}</dt><dd className={`mt-1 text-[20px] font-black tabular-nums ${tone}`}>{value.toLocaleString()}</dd></div>;
}

function ExceptionRow({ item, onOpen }: { item: SupervisorExceptionItem; onOpen: () => void }) {
  const clientName = item.client_name
    ? formatClientIdentityTitle({ name: item.client_name, community: item.community })
    : "Identity review";
  const action = exceptionActionLabel(item.kind);
  return (
    <article className="grid min-w-0 gap-3 px-3 py-3 sm:grid-cols-[110px_minmax(0,1fr)_170px_auto] sm:items-center sm:px-4">
      <span className={severityBadgeClass(item.severity)}>{severityLabel(item.severity)}</span>
      <div className="min-w-0">
        <h2 className="truncate text-[13px] font-black text-[#17211d]" title={clientName}>{clientName}</h2>
        <p className="mt-0.5 truncate text-[10px] font-semibold text-[#606a65]">{item.label}{item.community ? ` · ${item.community}` : ""}</p>
        <p className="mt-1 text-[10px] leading-4 text-[#737b77]">{item.detail}</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-[9px] sm:block">
        <div><dt className="font-black uppercase tracking-[0.08em] text-[#7b827e]">Owner</dt><dd className={`mt-1 font-bold ${ownerLabel(item.owner) === "Unassigned" ? "text-[#a9473d]" : "text-[#313733]"}`}>{ownerLabel(item.owner)}</dd></div>
        <div className="sm:mt-2"><dt className="font-black uppercase tracking-[0.08em] text-[#7b827e]">Timing</dt><dd className="mt-1 font-bold text-[#535b57]">{exceptionTiming(item)}</dd></div>
      </dl>
      <button type="button" onClick={onOpen} aria-label={`${action} for ${clientName}`} className="flex h-9 items-center justify-center gap-2 border border-[#0f8b73] px-3 text-[10px] font-black text-[#0f705f] hover:bg-[#eff8f5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73]">
        {action}<ArrowRight size={13} aria-hidden="true" />
      </button>
    </article>
  );
}

function CommandCenterClear({ generatedAt }: { generatedAt: string }) {
  return (
    <div className="flex min-h-28 items-center gap-3 px-4 py-6">
      <CheckCircle2 size={22} className="text-[#0f8b73]" aria-hidden="true" />
      <div><h2 className="text-[13px] font-black text-[#17211d]">No exceptions need action</h2><p className="mt-1 text-[10px] text-[#68716c]">Checked {formatTimestamp(generatedAt)}.</p></div>
    </div>
  );
}

function CommandCenterSkeleton() {
  return <div aria-label="Loading supervisor command center" aria-busy="true" className="animate-pulse px-4 py-5"><div className="h-3 w-44 bg-[#e5ebe8]" /><div className="mt-4 h-12 bg-[#eef2f0]" /><div className="mt-2 h-12 bg-[#eef2f0]" /></div>;
}

function openException(
  item: SupervisorExceptionItem,
  actions: {
    onOpenPacket: (referral: ReferralDestination) => void;
    onOpenProfile: (profileId: string) => void;
    onOpenProfiles: () => void;
  },
) {
  if (isIdentityException(item) && item.profile_id) {
    actions.onOpenProfile(item.profile_id);
    return;
  }
  if (item.referral_id) {
    actions.onOpenPacket({
      id: item.referral_id,
      ...(item.client_name ? { name: item.client_name } : {}),
      ...(item.community ? { community: item.community as Referral["community"] } : {}),
    });
    return;
  }
  actions.onOpenProfiles();
}

function severityCounts(items: SupervisorExceptionItem[]) {
  const counts: Record<SupervisorExceptionItem["severity"], number> = { critical: 0, attention: 0, review: 0 };
  for (const item of items) counts[item.severity] += 1;
  return counts;
}

function isIdentityException(item: SupervisorExceptionItem) {
  return item.kind === "resident_link_candidate" || item.kind === "resident_link_collision";
}

function exceptionActionLabel(kind: SupervisorExceptionItem["kind"]) {
  if (kind === "unassigned_referral" || kind === "unassigned_requirement") return "Assign";
  if (kind === "decision_needed") return "Review decision";
  if (kind === "extraction_failed" || kind === "extraction_conflict") return "Review packet";
  if (kind === "resident_link_candidate" || kind === "resident_link_collision") return "Review match";
  if (kind === "ehr_handoff_failed") return "Review handoff";
  if (kind === "overdue_requirement") return "Resolve";
  return "Open workspace";
}

function severityLabel(severity: SupervisorExceptionItem["severity"]) {
  if (severity === "critical") return "Critical";
  if (severity === "attention") return "Attention";
  return "Review";
}

function severityBadgeClass(severity: SupervisorExceptionItem["severity"]) {
  const tone = severity === "critical"
    ? "border-[#d8a29b] bg-[#fff3f1] text-[#973e34]"
    : severity === "attention"
      ? "border-[#dac094] bg-[#fff8ed] text-[#8a5a10]"
      : "border-[#a9cbc1] bg-[#eff8f5] text-[#176f60]";
  return `inline-flex min-h-6 w-fit items-center border px-2 text-[8px] font-black uppercase tracking-[0.08em] ${tone}`;
}

function ownerLabel(owner: string | null) {
  const normalized = owner?.trim();
  return normalized && !["unknown", "pending"].includes(normalized.toLowerCase()) ? normalized : "Unassigned";
}

function exceptionTiming(item: SupervisorExceptionItem) {
  if (item.due_at) return `Due ${formatDate(item.due_at)}`;
  if (item.age_hours !== null) return item.age_hours < 24 ? `${Math.round(item.age_hours)}h open` : `${Math.round(item.age_hours / 24)}d open`;
  return "Needs review";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "not recorded" : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "just now" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
