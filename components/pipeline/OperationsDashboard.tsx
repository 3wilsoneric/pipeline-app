"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Download,
  RefreshCw,
  UsersRound,
} from "lucide-react";

import type { Referral } from "@/lib/pipeline/referral-types";
import type {
  OperationsRequirementItem,
  OperationsSnapshot,
  OperationsWorkItem,
  SupervisorExceptionItem,
  SupervisorExceptionKind,
  SupervisorExceptionSnapshot,
} from "@/lib/pipeline/operations-types";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";

export default function OperationsDashboard({
  onOpenPacket,
}: {
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [supervisorQueue, setSupervisorQueue] = useState<SupervisorExceptionSnapshot | null>(null);
  const [error, setError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [reportMonth, setReportMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const loadSnapshot = useCallback(async (signal?: AbortSignal) => {
    setIsRefreshing(true);
    setError("");
    try {
      const payload = await fetchPipelineJson<{
        snapshot?: OperationsSnapshot;
        supervisor_queue?: SupervisorExceptionSnapshot;
      }>(`/api/operations/dashboard?month=${encodeURIComponent(reportMonth)}`, { cache: "no-store", signal });
      if (!payload.snapshot || !("metrics" in payload.snapshot)) throw new Error("Operations data is unavailable right now.");
      setSnapshot(payload.snapshot);
      setSupervisorQueue(payload.supervisor_queue ?? null);
    } catch (loadError) {
      if (signal?.aborted) return;
      setError(loadError instanceof Error ? loadError.message : "Operations data is unavailable right now.");
    } finally {
      if (!signal?.aborted) setIsRefreshing(false);
    }
  }, [reportMonth]);

  useEffect(() => {
    const controller = new AbortController();
    void loadSnapshot(controller.signal);
    return () => controller.abort();
  }, [loadSnapshot]);

  const updatedLabel = useMemo(() => {
    if (!snapshot) return "Loading";
    return new Date(snapshot.generated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }, [snapshot]);

  return (
    <main aria-label="Operations overview" className="h-full overflow-y-auto bg-white text-[#111111]">
      <div data-testid="operations-workspace" className="mx-auto w-full max-w-[1480px] px-4 py-3 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#d9d9d9] pb-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="flex items-center gap-2 text-[20px] font-black">
              <Activity size={18} className="text-[#0f8b73]" />
              Operations
            </h1>
            <span className="text-[12px] text-[#737373]">
              {snapshot ? `${snapshot.metrics.active} active referrals` : "Current referral work"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-[#737373]">Updated {updatedLabel}</span>
            <button
              type="button"
              onClick={() => void loadSnapshot()}
              aria-label="Refresh operations"
              title="Refresh operations"
              className="flex h-8 w-8 items-center justify-center border border-[#b3b3b3] text-[#111111] hover:border-[#0f8b73] hover:text-[#0f8b73]"
            >
              <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
            </button>
          </div>
        </header>

        {error ? (
          <div className="mt-4 border-l-2 border-[#a63d2f] bg-[#fff7f5] px-4 py-3 text-[13px] font-semibold text-[#59332d]" role="alert">
            {error}
          </div>
        ) : null}
        {!snapshot && !error ? <OperationsSkeleton /> : null}
        {snapshot ? (
          <SnapshotContent
            snapshot={snapshot}
            supervisorQueue={supervisorQueue}
            reportMonth={reportMonth}
            onReportMonthChange={setReportMonth}
            onOpenPacket={onOpenPacket}
          />
        ) : null}
      </div>
    </main>
  );
}

function OperationsSkeleton() {
  return (
    <div aria-label="Loading operations" aria-busy="true" className="animate-pulse">
      <section className="mt-3 grid gap-px border-y border-[#d9d9d9] bg-[#d9d9d9] sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="min-h-[92px] bg-white px-5 py-4">
            <div className="h-2.5 w-24 rounded bg-[#edf0ee]" />
            <div className="mt-3 h-7 w-14 rounded bg-[#e7eae8]" />
          </div>
        ))}
      </section>
      <section className="mt-4 border-y border-[#d9d9d9]">
        <div className="flex min-h-[50px] items-center justify-between border-b border-[#d9d9d9] px-5">
          <div className="h-3.5 w-24 rounded bg-[#e8ebe9]" />
          <div className="h-8 w-32 rounded bg-[#f0f2f1]" />
        </div>
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="grid min-h-[54px] grid-cols-[10px_minmax(0,1fr)_100px] items-center gap-3 border-b border-[#e5e5e5] px-5 last:border-b-0">
            <div className="h-2 w-2 rounded-full bg-[#dfe3e1]" />
            <div className="h-3 w-2/5 rounded bg-[#edf0ee]" />
            <div className="h-3 rounded bg-[#f2f3f2]" />
          </div>
        ))}
      </section>
      <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
        <div className="min-h-[220px] border-y border-[#d9d9d9] bg-[#fafbfa]" />
        <div className="min-h-[220px] border-y border-[#d9d9d9] bg-[#fafbfa]" />
      </div>
    </div>
  );
}

function SnapshotContent({
  snapshot,
  supervisorQueue,
  reportMonth,
  onReportMonthChange,
  onOpenPacket,
}: {
  snapshot: OperationsSnapshot;
  supervisorQueue: SupervisorExceptionSnapshot | null;
  reportMonth: string;
  onReportMonthChange: (month: string) => void;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  const [exceptionKind, setExceptionKind] = useState<SupervisorExceptionKind | "all">("all");
  const attentionWork = snapshot.work.filter((item) => item.blocker_count > 0 || item.due_soon || item.stale);
  const visibleWork = (attentionWork.length > 0 ? attentionWork : snapshot.work).slice(0, 8);
  const visibleRequirements = snapshot.requirements.slice(0, 10);
  const visibleExceptions = supervisorQueue?.items
    .filter((item) => exceptionKind === "all" || item.kind === exceptionKind)
    .slice(0, 12) ?? [];

  return (
    <>
      <section className="mt-3 grid gap-px border-y border-[#d9d9d9] bg-[#d9d9d9] sm:grid-cols-2 lg:grid-cols-4" aria-label="Operations summary">
        <SummaryMetric label="Active referrals" value={snapshot.metrics.active} />
        <SummaryMetric label="Needs action" value={snapshot.metrics.needs_action} attention={snapshot.metrics.needs_action > 0} />
        <SummaryMetric label="Overdue items" value={snapshot.metrics.overdue_requirements} attention={snapshot.metrics.overdue_requirements > 0} />
        <SummaryMetric label="Decisions needed" value={snapshot.metrics.decisions_needed} attention={snapshot.metrics.decisions_needed > 0} />
      </section>

      {supervisorQueue ? (
        <section className="mt-4 border-y border-[#d9d9d9] bg-white" aria-label="Supervisor exception queue">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d9d9d9] px-4 py-3 sm:px-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-[14px] font-black">Exceptions</h2>
              <span className="text-[10px] text-[#737373]">{supervisorQueue.total} unresolved</span>
            </div>
            <select
              aria-label="Filter supervisor exceptions"
              value={exceptionKind}
              onChange={(event) => setExceptionKind(event.target.value as SupervisorExceptionKind | "all")}
              className="h-8 border border-[#c9ceca] bg-white px-2 text-[11px] font-semibold outline-none focus:border-[#0f8b73]"
            >
              <option value="all">All exceptions</option>
              {Object.entries(supervisorQueue.counts).map(([kind, count]) => (
                <option key={kind} value={kind}>{exceptionFilterLabel(kind as SupervisorExceptionKind)} ({count})</option>
              ))}
            </select>
          </div>
          <div className="divide-y divide-[#e5e5e5]">
            {visibleExceptions.map((item) => (
              <SupervisorExceptionRow key={item.id} item={item} onOpenPacket={onOpenPacket} />
            ))}
            {visibleExceptions.length === 0 ? (
              <EmptyState
                label={supervisorQueue.items.length === 0 ? "No open exceptions" : "No exceptions match this filter"}
                detail={supervisorQueue.items.length === 0 ? "The supervisor queue is clear." : "Choose another exception type."}
              />
            ) : null}
          </div>
        </section>
      ) : null}

      {snapshot.assessment_report ? (
        <AssessmentCompletionReport
          report={snapshot.assessment_report}
          month={reportMonth}
          onMonthChange={onReportMonthChange}
        />
      ) : null}

      <div className="mt-4 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
        <section className="min-w-0 border-y border-[#d9d9d9] bg-white" aria-label="Action queue">
          <SectionHeading title="Work queue" detail={`${snapshot.metrics.open_requirements} open requirements`} />
          <div className="divide-y divide-[#e5e5e5]">
            {visibleRequirements.length > 0 ? visibleRequirements.map((item) => (
              <RequirementRow key={item.work_item_id} item={item} onOpenPacket={onOpenPacket} />
            )) : visibleWork.length > 0 ? visibleWork.map((item) => (
              <WorkRow key={item.referral_id} item={item} onOpenPacket={onOpenPacket} />
            )) : <EmptyState label="Nothing needs attention" detail="The referral queue is clear." />}
          </div>
        </section>

        <aside className="min-w-0 border-y border-[#d9d9d9] bg-white">
          <section aria-label="Assessor load">
            <SectionHeading title="Team" detail={`${snapshot.assessors.length} owner${snapshot.assessors.length === 1 ? "" : "s"}`} />
            <div className="divide-y divide-[#e5e5e5]">
              {snapshot.assessors.length > 0 ? snapshot.assessors.map((assessor) => (
                <AssessorRow key={assessor.owner} assessor={assessor} />
              )) : <EmptyState label="No assigned work" detail="Assign an owner when referrals arrive." />}
            </div>
          </section>

          <section className="border-t border-[#d9d9d9]" aria-label="Data gaps">
            <SectionHeading title="Data gaps" detail="Open records" />
            <div className="grid grid-cols-2 gap-px bg-[#d9d9d9]">
              <DataGap label="Owner" value={snapshot.data_quality.missing_owner} />
              <DataGap label="Packet" value={snapshot.data_quality.missing_packet} />
              <DataGap label="Assessment" value={snapshot.data_quality.missing_assessment} />
              <DataGap label="Decision" value={snapshot.data_quality.missing_decision} />
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

function AssessmentCompletionReport({
  report,
  month,
  onMonthChange,
}: {
  report: NonNullable<OperationsSnapshot["assessment_report"]>;
  month: string;
  onMonthChange: (month: string) => void;
}) {
  return (
    <section className="mt-4 border-y border-[#d9d9d9] bg-white" aria-label="Monthly assessment completions">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d9d9d9] px-4 py-3 sm:px-5">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[14px] font-black">Assessments completed</h2>
          <span className="text-[10px] text-[#737373]">{report.total_completed} total</span>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="assessment-report-month" className="sr-only">Assessment report month</label>
          <select
            id="assessment-report-month"
            aria-label="Assessment report month"
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
            className="h-8 border border-[#c9ceca] bg-white px-2 text-[11px] font-semibold outline-none focus:border-[#0f8b73]"
          >
            {reportMonthOptions().map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => downloadAssessmentReport(report)}
            className="flex h-8 items-center gap-2 border border-[#c9ceca] px-2.5 text-[10px] font-black hover:border-[#0f8b73] hover:text-[#0f8b73]"
          >
            <Download size={13} aria-hidden="true" /> CSV
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[#d9d9d9] text-[9px] font-black uppercase tracking-[0.1em] text-[#737373]">
              <th className="px-4 py-2.5 sm:px-5">Staff member</th>
              <th className="w-40 px-4 py-2.5 text-right sm:px-5">Completed</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.assessor_id ?? `legacy:${row.assessor_name}`} className="border-b border-[#e5e5e5] last:border-b-0">
                <td className="px-4 py-3 text-[12px] font-black sm:px-5">{row.assessor_name}</td>
                <td className="px-4 py-3 text-right text-[14px] font-black text-[#0f8b73] sm:px-5">{row.completed_assessments}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function reportMonthOptions() {
  const current = new Date();
  return Array.from({ length: 18 }, (_, index) => {
    const date = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - index, 1));
    return {
      value: date.toISOString().slice(0, 7),
      label: date.toLocaleDateString([], { month: "long", year: "numeric", timeZone: "UTC" }),
    };
  });
}

function downloadAssessmentReport(report: NonNullable<OperationsSnapshot["assessment_report"]>) {
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = [
    ["Month", "Staff member", "Completed assessments"],
    ...report.rows.map((row) => [report.month, row.assessor_name, row.completed_assessments]),
  ].map((row) => row.map(escape).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `pipeline-assessments-${report.month}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function SupervisorExceptionRow({
  item,
  onOpenPacket,
}: {
  item: SupervisorExceptionItem;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  const canOpen = Boolean(item.referral_id && item.client_name && item.community);
  const content = (
    <>
      <span className={`mt-1.5 h-2 w-2 rounded-full ${item.severity === "critical" ? "bg-[#a63d2f]" : item.severity === "attention" ? "bg-[#b98b1c]" : "bg-[#0f8b73]"}`} />
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[12px] font-black">{item.label}</span>
          {item.client_name ? <span className="text-[11px] text-[#737373]">{item.client_name} · {item.community}</span> : null}
        </span>
        <span className="mt-1 block truncate text-[11px] text-[#595959]">{item.detail}</span>
      </span>
      <span className="flex items-center gap-2 pt-1 text-[10px] font-black uppercase tracking-[0.08em] text-[#595959]">
        {exceptionLabel(item.kind)}
        {canOpen ? <ArrowRight size={14} className="text-[#0f8b73]" /> : null}
      </span>
    </>
  );
  const className = "grid w-full grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-left hover:bg-[#f7faf9] sm:px-5";
  return canOpen ? (
    <button
      type="button"
      className={className}
      onClick={() => onOpenPacket({
        id: item.referral_id!,
        name: item.client_name!,
        community: item.community as Referral["community"],
      })}
    >
      {content}
    </button>
  ) : <div className={className}>{content}</div>;
}

function exceptionLabel(kind: SupervisorExceptionKind) {
  return {
    overdue_requirement: "Overdue",
    unassigned_referral: "No owner",
    unassigned_requirement: "No owner",
    blocked_referral: "Blocked",
    stale_referral: "Stale",
    extraction_failed: "Extraction",
    extraction_conflict: "Conflict",
    decision_needed: "Decision",
    resident_link_candidate: "Roster link",
    resident_link_collision: "Link collision",
    ehr_handoff_failed: "EHR failure",
  }[kind];
}

function exceptionFilterLabel(kind: SupervisorExceptionKind) {
  return {
    overdue_requirement: "Overdue requirement",
    unassigned_referral: "Referral has no owner",
    unassigned_requirement: "Requirement has no owner",
    blocked_referral: "Blocked referral",
    stale_referral: "Stale referral",
    extraction_failed: "Extraction failed",
    extraction_conflict: "Extraction conflict",
    decision_needed: "Decision needed",
    resident_link_candidate: "Roster link candidate",
    resident_link_collision: "Roster link collision",
    ehr_handoff_failed: "EHR handoff failed",
  }[kind];
}

function RequirementRow({
  item,
  onOpenPacket,
}: {
  item: OperationsRequirementItem;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  const status = item.overdue ? "Overdue" : item.unassigned ? "Unassigned" : item.due_soon ? "Due soon" : item.status;
  return (
    <button
      type="button"
      onClick={() => onOpenPacket({ id: item.referral_id, name: item.client_name, community: item.community as Referral["community"] })}
      className="group grid w-full grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-left hover:bg-[#f7faf9] sm:px-5"
    >
      <span className={`mt-1.5 h-2 w-2 rounded-full ${item.overdue ? "bg-[#a63d2f]" : item.due_soon ? "bg-[#b98b1c]" : "bg-[#0f8b73]"}`} />
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[13px] font-black">{item.label}</span>
          <span className="text-[11px] text-[#737373]">{item.client_name} · {item.community}</span>
        </span>
        <span className="mt-1 block text-[11px] text-[#737373]">{item.owner} · {formatRequirementDue(item.due_at)}</span>
        <span className="mt-1.5 block truncate text-[11px] font-semibold text-[#111111]">{item.next_action}</span>
      </span>
      <span className={`flex items-center gap-2 pt-1 text-[10px] font-black uppercase tracking-[0.08em] ${item.overdue ? "text-[#a63d2f]" : "text-[#595959]"}`}>
        {status}
        <ArrowRight size={14} className="text-[#0f8b73] transition-transform group-hover:translate-x-1" />
      </span>
    </button>
  );
}

function formatRequirementDue(value: string | null) {
  if (!value) return "No due date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid due date" : `Due ${date.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function WorkRow({
  item,
  onOpenPacket,
}: {
  item: OperationsWorkItem;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  const open = () => onOpenPacket({
    id: item.referral_id,
    name: item.client_name,
    community: item.community as Referral["community"],
  });
  const status = item.stale
    ? "Stale"
    : item.due_soon
      ? "Due soon"
      : item.blocker_count > 0
        ? `${item.blocker_count} blocker${item.blocker_count === 1 ? "" : "s"}`
        : "Review";

  return (
    <button type="button" onClick={open} className="group grid w-full grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-left hover:bg-[#f7faf9] sm:px-5">
      <span className="mt-1.5 h-2 w-2 rounded-full bg-[#a63d2f]" />
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[13px] font-black">{item.client_name}</span>
          <span className="text-[11px] text-[#737373]">{item.community}</span>
        </span>
        <span className="mt-1 block text-[11px] text-[#737373]">{item.owner} · {item.stage}</span>
        <span className="mt-1.5 block truncate text-[11px] font-semibold text-[#111111]">{item.next_action ?? "Review next step"}</span>
      </span>
      <span className="flex items-center gap-2 pt-1 text-[10px] font-black uppercase tracking-[0.08em] text-[#a63d2f]">
        {status}
        <ArrowRight size={14} className="text-[#0f8b73] transition-transform group-hover:translate-x-1" />
      </span>
    </button>
  );
}

function AssessorRow({ assessor }: { assessor: OperationsSnapshot["assessors"][number] }) {
  return (
    <div className="px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between gap-3 text-[12px] font-black">
        <span>{assessor.owner}</span>
        <span>{assessor.active} active</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#737373]">
        <span>{assessor.blocked} blocked</span>
        <span>{assessor.stale} stale</span>
        <span>{assessor.due_soon} due soon</span>
      </div>
    </div>
  );
}

function SummaryMetric({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 bg-white px-4 py-3 sm:block">
      <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#737373]">{label}</div>
      <div className={`mt-1 text-[22px] font-black ${attention ? "text-[#a63d2f]" : "text-[#111111]"}`}>{value}</div>
    </div>
  );
}

function DataGap({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-white px-4 py-3">
      <span className="text-[11px] font-black text-[#595959]">{label}</span>
      <span className={`text-[14px] font-black ${value > 0 ? "text-[#a63d2f]" : "text-[#0f8b73]"}`}>{value}</span>
    </div>
  );
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[#d9d9d9] px-4 py-3 sm:px-5">
      <h2 className="text-[14px] font-black">{title}</h2>
      <span className="text-[10px] text-[#737373]">{detail}</span>
    </div>
  );
}

function EmptyState({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <UsersRound size={20} className="mx-auto text-[#b3b3b3]" />
      <div className="mt-3 text-[13px] font-black">{label}</div>
      <div className="mt-1 text-[11px] text-[#737373]">{detail}</div>
    </div>
  );
}
