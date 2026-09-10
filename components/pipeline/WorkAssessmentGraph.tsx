"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Network, RefreshCw } from "lucide-react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import type {
  WorkAssessmentArchetype,
  WorkAssessmentFeatureVector,
  WorkAssessmentGraphCase,
  WorkAssessmentGraphSnapshot,
} from "@/lib/pipeline/work-assessment-graph.mjs";
import type { Referral } from "@/lib/pipeline/referral-types";

const initialCaseLimit = 8;
const dimensionLabels: Array<{ key: keyof WorkAssessmentFeatureVector; label: string }> = [
  { key: "intake_completeness", label: "Intake" },
  { key: "document_readiness", label: "Files" },
  { key: "assessment_progress", label: "Assessment" },
  { key: "queue_urgency", label: "Urgency" },
  { key: "collision_pressure", label: "Collision" },
];

export default function WorkAssessmentGraph({
  onOpenPacket,
}: {
  onOpenPacket: (referral: { id: number; name?: string; community?: Referral["community"] }) => void;
}) {
  const [snapshot, setSnapshot] = useState<WorkAssessmentGraphSnapshot | null>(null);
  const [filter, setFilter] = useState<WorkAssessmentArchetype | "all">("all");
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const payload = await fetchPipelineJson<WorkAssessmentGraphSnapshot>(
        "/api/operations/work-assessment-graph",
        { cache: "no-store", signal },
        { cacheTtlMs: 5_000 },
      );
      setSnapshot(payload);
      setError("");
    } catch (loadError) {
      if (!signal?.aborted) setError(loadError instanceof Error ? loadError.message : "The work assessment map could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const refresh = () => void load(controller.signal);
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  const filteredCases = useMemo(
    () => (snapshot?.cases ?? []).filter((item) => filter === "all" || item.archetype === filter),
    [filter, snapshot],
  );
  const visibleCases = showAll ? filteredCases : filteredCases.slice(0, initialCaseLimit);
  const casesById = useMemo(
    () => new Map((snapshot?.cases ?? []).map((item) => [item.referral_id, item])),
    [snapshot],
  );

  return (
    <section aria-label="Work assessment graph" className="border-b border-[#cfd7d2] bg-[#fbfcfb]">
      <header className="flex flex-wrap items-center justify-between gap-3 px-1 py-4 sm:px-3">
        <button type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded} className="flex min-w-0 items-start gap-3 text-left">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center bg-[#e8f5f0] text-[#0f705f]"><Network size={16} aria-hidden="true" /></span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-[15px] font-black tracking-[-0.01em] text-[#17211d]">Work assessment map <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" /></span>
            <span className="mt-1 block text-[10px] font-medium text-[#68716c]">Where work stands, what blocks it, and what to inspect next.</span>
          </span>
        </button>
        <button type="button" onClick={() => void load()} disabled={loading} className="flex h-9 items-center gap-2 px-3 text-[10px] font-black uppercase tracking-[0.07em] text-[#176f60] hover:bg-[#eff8f5] disabled:opacity-50">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} aria-hidden="true" /> Refresh
        </button>
      </header>

      {expanded ? (
        <div className="border-t border-[#dfe5e2]">
          <GraphStatus snapshot={snapshot} loading={loading} error={error} onRetry={() => void load()} />
          {snapshot ? (
            <>
              <GraphSummary snapshot={snapshot} filter={filter} onFilter={setFilter} />
              <div className="divide-y divide-[#e4e8e6] bg-white" aria-live="polite">
                {visibleCases.map((item) => (
                  <WorkCaseRow
                    key={item.referral_id}
                    item={item}
                    similar={item.similar_work.map((match) => casesById.get(match.referral_id)).filter((match): match is WorkAssessmentGraphCase => Boolean(match))}
                    onOpen={() => onOpenPacket({ id: item.referral_id, name: item.client_name, community: item.community as Referral["community"] })}
                  />
                ))}
              </div>
              {filteredCases.length === 0 ? <div className="bg-white px-4 py-8 text-center text-[11px] text-[#68716c]">No active work matches this view.</div> : null}
              {filteredCases.length > initialCaseLimit ? (
                <div className="flex justify-center border-t border-[#dfe5e2] py-3">
                  <button type="button" onClick={() => setShowAll((current) => !current)} aria-expanded={showAll} className="h-9 px-4 text-[10px] font-black uppercase tracking-[0.07em] text-[#176f60] hover:bg-[#eff8f5]">
                    {showAll ? "Show priority work" : `Show all ${filteredCases.length}`}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function GraphSummary({
  snapshot,
  filter,
  onFilter,
}: {
  snapshot: WorkAssessmentGraphSnapshot;
  filter: WorkAssessmentArchetype | "all";
  onFilter: (filter: WorkAssessmentArchetype | "all") => void;
}) {
  const filters: Array<{ value: WorkAssessmentArchetype | "all"; label: string; count: number }> = [
    { value: "all", label: "Active", count: snapshot.total },
    { value: "records_blocked", label: "Records blocked", count: snapshot.summary.archetypes.records_blocked },
    { value: "assessment_active", label: "Assessment", count: snapshot.summary.archetypes.assessment_active },
    { value: "decision_ready", label: "Decision ready", count: snapshot.summary.archetypes.decision_ready },
    { value: "placement_follow_up", label: "Follow-up", count: snapshot.summary.archetypes.placement_follow_up },
  ];
  return (
    <div className="flex snap-x gap-px overflow-x-auto border-b border-[#dfe5e2] bg-[#dfe5e2]">
      {filters.map((item) => (
        <button
          type="button"
          key={item.value}
          aria-pressed={filter === item.value}
          onClick={() => onFilter(item.value)}
          className={`min-w-[130px] flex-1 snap-start bg-white px-4 py-3 text-left ${filter === item.value ? "shadow-[inset_0_-3px_#0f8b73]" : "hover:bg-[#f6faf8]"}`}
        >
          <span className="block text-[8px] font-black uppercase tracking-[0.09em] text-[#6d7570]">{item.label}</span>
          <span className="mt-1 block text-[19px] font-black tabular-nums text-[#17211d]">{item.count.toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
}

function GraphStatus({
  snapshot,
  loading,
  error,
  onRetry,
}: {
  snapshot: WorkAssessmentGraphSnapshot | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div role="alert" className="flex items-center justify-between gap-4 bg-[#fff6f4] px-4 py-3 text-[11px] text-[#723d35]">
        <span>{error}{snapshot ? " Showing the last successful map." : ""}</span>
        <button type="button" onClick={onRetry} className="shrink-0 font-black underline underline-offset-2">Retry</button>
      </div>
    );
  }
  if (loading && !snapshot) return <div role="status" aria-label="Loading work assessment graph" className="h-24 animate-pulse bg-[#f2f5f3]" />;
  return null;
}

function WorkCaseRow({
  item,
  similar,
  onOpen,
}: {
  item: WorkAssessmentGraphCase;
  similar: WorkAssessmentGraphCase[];
  onOpen: () => void;
}) {
  const clientName = formatClientIdentityTitle({ name: item.client_name, community: item.community });
  return (
    <article className="grid gap-4 px-3 py-4 lg:grid-cols-[minmax(220px,1.2fr)_minmax(300px,1.4fr)_minmax(220px,1fr)_auto] lg:items-center lg:px-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><span className={archetypeClass(item.archetype)}>{archetypeLabel(item.archetype)}</span><span className="text-[9px] font-bold text-[#747c77]">{item.owner}</span></div>
        <h3 className="mt-2 truncate text-[13px] font-black text-[#17211d]" title={clientName}>{clientName}</h3>
        <p className="mt-1 text-[10px] text-[#68716c]">{item.community}</p>
      </div>
      <div className="grid grid-cols-5 gap-2" aria-label={`Work-state vector for ${clientName}`}>
        {dimensionLabels.map(({ key, label }) => <Dimension key={key} label={label} value={item.vector[key]} unknown={key === "collision_pressure" && item.collision_signal === "not_observed"} />)}
      </div>
      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-[0.08em] text-[#6c746f]">Inspect next</p>
        <p className="mt-1 text-[10px] font-semibold leading-4 text-[#303733]">{item.inspect_next}</p>
        <p className="mt-1 truncate text-[9px] text-[#747c77]" title={item.why.join(" ")}>{item.why[0]}</p>
        {similar.length > 0 ? <p className="mt-1 truncate text-[9px] text-[#747c77]">Similar work: {similar.map((match) => formatClientIdentityTitle({ name: match.client_name, community: match.community })).join(", ")}</p> : null}
      </div>
      <button type="button" onClick={onOpen} aria-label={`Open ${clientName}`} className="flex h-9 items-center justify-center gap-2 border border-[#0f8b73] px-3 text-[10px] font-black text-[#0f705f] hover:bg-[#eff8f5]">
        Open <ArrowRight size={13} aria-hidden="true" />
      </button>
    </article>
  );
}

function Dimension({ label, value, unknown }: { label: string; value: number; unknown?: boolean }) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className="min-w-0">
      <span className="block truncate text-[7px] font-black uppercase tracking-[0.06em] text-[#737b77]">{label}</span>
      <span className="mt-1 block h-1.5 overflow-hidden bg-[#e4e9e6]" title={unknown ? `${label}: not observed` : `${label}: ${percent}%`}>
        <span className={`block h-full ${keyTone(label)}`} style={{ width: `${unknown ? 0 : percent}%` }} />
      </span>
      <span className="mt-1 block text-[8px] font-bold tabular-nums text-[#555e59]">{unknown ? "—" : `${percent}%`}</span>
    </div>
  );
}

function keyTone(label: string) {
  return label === "Urgency" || label === "Collision" ? "bg-[#bd7b19]" : "bg-[#0f8b73]";
}

function archetypeLabel(archetype: WorkAssessmentArchetype) {
  return ({
    unassigned: "Unassigned",
    records_blocked: "Records blocked",
    assessment_active: "Assessment active",
    decision_ready: "Decision ready",
    placement_follow_up: "Follow-up",
    intake_incomplete: "Intake incomplete",
    workflow_active: "Active",
  })[archetype];
}

function archetypeClass(archetype: WorkAssessmentArchetype) {
  const warning = ["unassigned", "records_blocked", "intake_incomplete"].includes(archetype);
  const ready = archetype === "decision_ready";
  const tone = warning
    ? "border-[#dac094] bg-[#fff8ed] text-[#8a5a10]"
    : ready
      ? "border-[#a9cbc1] bg-[#eff8f5] text-[#176f60]"
      : "border-[#cfd7d2] bg-white text-[#535b57]";
  return `inline-flex min-h-6 items-center border px-2 text-[8px] font-black uppercase tracking-[0.07em] ${tone}`;
}
