"use client";

import { ArrowRight } from "lucide-react";

import { normalizeOwnerName } from "@/lib/pipeline/referral-ownership";
import {
  formatClientIdentityTitle,
} from "@/lib/pipeline/client-identity-presentation.mjs";
import {
  activeReferralFlowStates,
  getReferralFlowState,
  getReferralWorkflowStatus,
  type ActiveReferralFlowState,
} from "@/lib/pipeline/referral-flow";
import { getReferralProgress, type ReferralProgress } from "@/lib/pipeline/referral-progress";
import type { Referral } from "@/lib/pipeline/referral-types";
import { workflowStatusLabels } from "@/lib/pipeline/workflow-status";
import { getWorkspaceCounty, isRecordedWorkspaceCommunity } from "@/lib/pipeline/workspace-presentation";

type WorkflowRow = {
  referral: Referral;
  progress: ReferralProgress;
};

export type ReferralFlowFilter = "all" | ActiveReferralFlowState;

export function ReferralFlowTabs({
  referrals,
  value,
  onChange,
}: {
  referrals: Referral[];
  value: ReferralFlowFilter;
  onChange: (value: ReferralFlowFilter) => void;
}) {
  const activeReferrals = referrals.filter((referral) => getReferralFlowState(referral) !== "complete");
  const counts = Object.fromEntries(activeReferralFlowStates.map(({ key }) => [
    key,
    activeReferrals.filter((referral) => getReferralFlowState(referral) === key).length,
  ])) as Record<ActiveReferralFlowState, number>;
  const options: Array<{ key: ReferralFlowFilter; label: string; count: number }> = [
    { key: "all", label: "All active", count: activeReferrals.length },
    ...activeReferralFlowStates.map(({ key, label }) => ({ key, label, count: counts[key] })),
  ];

  return (
    <div className="flex h-14 items-center sm:h-[104px] xl:h-14">
      <label htmlFor="current-work-state" className="sr-only">Filter current work by state</label>
      <select
        id="current-work-state"
        value={value}
        onChange={(event) => onChange(event.target.value as ReferralFlowFilter)}
        className="h-10 w-full border border-[#cfd6d3] bg-white px-3 text-[12px] font-bold text-[#303638] outline-none focus:border-[#0f8b73] sm:hidden"
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>{option.label} ({option.count})</option>
        ))}
      </select>
      <div role="tablist" aria-label="Current work states" className="hidden h-full w-full grid-cols-12 gap-px bg-[#dfe4e2] sm:grid xl:grid-cols-7">
        {options.map((option, index) => {
          const active = value === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(option.key)}
              className={`group flex min-w-0 items-center justify-between gap-2 border-t-2 px-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73] ${index < 4 ? "col-span-3" : "col-span-4"} xl:col-span-1 ${
                active
                  ? "border-[#0f8b73] bg-[#eff8f5] text-[#0c705f]"
                  : "border-transparent bg-white text-[#4f5652] hover:bg-[#f7faf9]"
              }`}
            >
              <span className="min-w-0 truncate text-[10px] font-black uppercase tracking-[0.06em]">{option.label}</span>
              <span className={`shrink-0 text-[11px] font-black tabular-nums ${active ? "text-[#0c705f]" : "text-[#777d79]"}`}>{option.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ReferralWorkflowTracker({
  referrals,
  progressByReferral = {},
  flowFilter = "all",
  loading,
  onOpenPacket,
}: {
  referrals: Referral[];
  progressByReferral?: Record<number, ReferralProgress>;
  flowFilter?: ReferralFlowFilter;
  loading: boolean;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  const rows = sortWorkflowRows(referrals
    .map((referral) => ({
      referral,
      progress: progressByReferral[referral.id] ?? getReferralProgress(referral),
    }))
    .filter(({ referral }) => {
      const state = getReferralFlowState(referral);
      return state !== "complete" && (flowFilter === "all" || state === flowFilter);
    }));
  const emptyLabel = flowFilter === "all"
    ? "No active referral work"
    : activeReferralFlowStates.find(({ key }) => key === flowFilter)?.emptyLabel ?? "No referral work in this state";

  return (
    <section aria-label="Referral workflow tracker" className="min-w-0 bg-white">
      <div className="hidden min-w-[760px] grid-cols-[minmax(220px,1.5fr)_minmax(170px,1fr)_135px_120px_80px_34px] items-center border-y border-[#d9d9d9] bg-[#fafafa] px-4 py-2.5 text-[9px] font-black uppercase tracking-[0.08em] text-[#666666] lg:grid">
        <span>Client</span>
        <span>Current state</span>
        <span>Owner</span>
        <span>Data capture</span>
        <span>Updated</span>
        <span className="sr-only">Open</span>
      </div>
      {rows.length > 0 ? (
        <div className="divide-y divide-[#e2e2e2]">
          {rows.map(({ referral, progress }) => (
            <WorkflowRow
              key={referral.id}
              referral={referral}
              progress={progress}
              onOpen={() => onOpenPacket(referral)}
            />
          ))}
        </div>
      ) : (
        <div className="border-b border-[#e2e2e2] px-4 py-14 text-center">
          <div className="text-[13px] font-bold text-[#303638]">{loading ? "Loading current work" : emptyLabel}</div>
          {!loading ? <div className="mt-1 text-[10px] text-[#737373]">Choose another state or create a referral workspace.</div> : null}
        </div>
      )}
    </section>
  );
}

function WorkflowRow({
  referral,
  progress,
  onOpen,
}: {
  referral: Referral;
  progress: ReferralProgress;
  onOpen: () => void;
}) {
  const identityTitle = formatClientIdentityTitle(referral);
  const workflowStatus = getReferralWorkflowStatus(referral);
  const workflowLabel = workflowStatusLabels[workflowStatus];
  const identityDetail = [
    isRecordedWorkspaceCommunity(referral.community) ? referral.community : "",
    getWorkspaceCounty(referral),
  ].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${identityTitle} referral workspace`}
      className="group block w-full px-4 py-3.5 text-left transition-colors hover:bg-[#f7faf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73] lg:grid lg:min-w-[760px] lg:grid-cols-[minmax(220px,1.5fr)_minmax(170px,1fr)_135px_120px_80px_34px] lg:items-center"
    >
      <span className="flex min-w-0 items-start justify-between gap-3 lg:block lg:pr-5">
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-bold text-[#111111]" title={identityTitle}>{identityTitle}</span>
          {identityDetail ? <span className="mt-1 block truncate text-[10px] text-[#737373]">{identityDetail}</span> : null}
          {referral.priority !== "standard" ? <span className="mt-1 block text-[9px] font-semibold text-[#8c392f]">{capitalize(referral.priority)} priority</span> : null}
        </span>
        <ArrowRight size={15} className="mt-0.5 shrink-0 text-[#0f8b73] lg:hidden" />
      </span>
      <span className="mt-3 block min-w-0 lg:mt-0 lg:pr-5">
        <span className="block truncate text-[11px] font-bold text-[#0c705f]">{workflowLabel}</span>
      </span>
      <span className="mt-2 block truncate text-[10px] font-semibold text-[#646a67] lg:hidden">
        {normalizeOwnerName(referral.owner)} · {progress.overall.percent}% data · {mobileUpdatedLabel(referral.updatedAt ?? referral.createdAt)}
      </span>
      <span className="hidden truncate text-[10px] font-semibold text-[#404040] lg:block lg:pr-4">
        {normalizeOwnerName(referral.owner)}
      </span>
      <span className="mt-2 block lg:mt-0 lg:pr-5">
        <span className="flex items-center justify-between text-[9px] font-bold text-[#404040]">
          <span className="hidden lg:inline">{progress.overall.percent}%</span>
          <span className="hidden text-[#777d79] lg:inline">{progress.overall.complete}/{progress.overall.total}</span>
        </span>
        <span className="block h-1 overflow-hidden bg-[#e4e7e5] lg:mt-1.5">
          <span className="block h-full bg-[#0f8b73]" style={{ width: `${progress.overall.percent}%` }} />
        </span>
      </span>
      <span className="hidden text-[9px] font-semibold text-[#737373] lg:block">{ageLabel(referral.updatedAt ?? referral.createdAt)}</span>
      <span className="hidden h-8 w-8 items-center justify-center text-[#0f8b73] transition-transform group-hover:translate-x-0.5 lg:flex"><ArrowRight size={15} /></span>
    </button>
  );
}

function sortWorkflowRows(rows: WorkflowRow[]) {
  const priorityRank: Record<Referral["priority"], number> = { urgent: 0, high: 1, standard: 2 };
  const stateRank = Object.fromEntries(activeReferralFlowStates.map(({ key }, index) => [key, index])) as Record<ActiveReferralFlowState, number>;
  return [...rows].sort((left, right) => {
    const state = stateRank[getReferralFlowState(left.referral) as ActiveReferralFlowState]
      - stateRank[getReferralFlowState(right.referral) as ActiveReferralFlowState];
    if (state !== 0) return state;
    const priority = priorityRank[left.referral.priority] - priorityRank[right.referral.priority];
    if (priority !== 0) return priority;
    return timestamp(left.referral.updatedAt ?? left.referral.createdAt) - timestamp(right.referral.updatedAt ?? right.referral.createdAt);
  });
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function timestamp(value: string) {
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : Number.MAX_SAFE_INTEGER;
}

function ageLabel(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Unknown";
  const hours = Math.max(0, Math.floor((Date.now() - time) / 36e5));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function mobileUpdatedLabel(value: string) {
  const age = ageLabel(value);
  if (age === "Just now") return "updated just now";
  if (age === "Unknown") return "update unknown";
  return `updated ${age} ago`;
}
