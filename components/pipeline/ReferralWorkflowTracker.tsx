"use client";

import { ArrowRight } from "lucide-react";

import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import { activeReferralFlowStates } from "@/lib/pipeline/referral-flow";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import type { ReferralWorklistItem } from "@/lib/pipeline/operations-types";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import type { Referral } from "@/lib/pipeline/referral-types";
import { workflowStatusLabels } from "@/lib/pipeline/workflow-status";

export default function ReferralWorkflowTracker({ briefing, onOpenPacket, selectedReferralId, limit }: {
  briefing: HomeBriefingSnapshot;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
  selectedReferralId?: number;
  limit?: number;
}) {
  const items = briefing.workflow.active_items ?? [];
  const unavailable = briefing.unavailable_sections.includes("workflow");

  return (
    <section aria-label="Current work board" className="bg-white">
      {unavailable ? (
        <div className="px-4 py-12 text-center text-[13px] font-medium text-[#8a5a10]">
          Current work is temporarily unavailable. Close this view and try again.
        </div>
      ) : items.length === 0 ? (
        <p className="px-1 py-5 text-[13px] font-medium text-[#626b65]">No active referral work.</p>
      ) : (
        <>
          <div data-current-work-board className="border-t border-[#dfe5e1]">
            {(limit === undefined ? items : items.slice(0, limit)).map((item) => (
              <WorkflowRibbon
                key={item.referral_id}
                item={item}
                showOwner={briefing.scope === "team"}
                current={item.referral_id === selectedReferralId}
                onOpenPacket={onOpenPacket}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function WorkflowCardSkeleton() {
  return (
    <div aria-hidden="true" data-home-layout-placeholder className="flex min-h-16 items-center gap-3 border-b border-[#e1e7e3] px-3">
      <div className="h-9 w-[3px] shrink-0 bg-[#cadbd2]" />
      <div className="min-w-0 flex-1"><div className="h-3 w-2/3 max-w-40 bg-[#dce4df]" /><div className="mt-2 h-2 w-1/2 bg-[#edf0ee]" /></div>
      <div className="h-5 w-24 shrink-0 bg-[#e9eeeb]" />
    </div>
  );
}

function WorkflowRibbon({ item, showOwner, onOpenPacket, current }: {
  item: ReferralWorklistItem;
  showOwner: boolean;
  current: boolean;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
}) {
  const clientName = formatClientIdentityTitle({ name: item.client_name, community: item.community });
  const owner = showOwner ? item.owner || "Unassigned" : null;
  const presentation = workCardStatusPresentation(item, showOwner);
  const stage = activeReferralFlowStates.find((state) => state.key === item.flow_state);

  return (
    <button
      type="button"
      aria-label={`Open ${clientName}`}
      aria-current={current ? "true" : undefined}
      onClick={() => onOpenPacket({ id: item.referral_id, name: clientName, community: item.community as Referral["community"] }, item.location)}
      className={`group grid min-h-[66px] w-full grid-cols-[3px_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-[#e1e7e3] px-2 py-2.5 text-left outline-none hover:bg-[#f5f9f7] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73] sm:grid-cols-[3px_minmax(0,1fr)_minmax(0,1fr)_auto_18px] sm:gap-x-4 sm:px-3 ${current ? "bg-[#eff8f3]" : "bg-white"}`}
    >
      <span aria-hidden="true" className={`h-9 w-[3px] ${stageAccent(item.flow_state)}`} />
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-bold text-[#202320]">{clientName}</span>
        <span className="mt-0.5 block truncate text-[11px] font-medium text-[#69716c] sm:hidden">{owner ? `${owner} · ` : ""}{presentation.status}</span>
        <span className="mt-0.5 hidden truncate text-[11px] font-medium text-[#69716c] sm:block">{item.community}{owner ? ` · ${owner}` : ""}</span>
      </span>
      <span className="hidden min-w-0 sm:block">
        <span className={`block truncate text-[11px] font-bold ${presentation.tone}`}>{presentation.status}</span>
        <span className="mt-0.5 block truncate text-[11px] font-medium text-[#5f6762]">{presentation.nextAction}</span>
      </span>
      <span className={`max-w-[116px] px-2 py-1 text-center text-[11px] font-bold leading-4 sm:max-w-none sm:min-w-[148px] ${stageBadge(item.flow_state)}`}>{stage?.label ?? "Complete"}</span>
      <ArrowRight size={16} className="hidden shrink-0 text-[#7b837e] group-hover:text-[#0f8b73] sm:block" aria-hidden="true" />
    </button>
  );
}

function workCardStatusPresentation(item: ReferralWorklistItem, team: boolean) {
  const awaitingSupervisor = item.outcome_state !== "accepted"
    && (item.workflow_status === "recommendation_submitted" || item.workflow_status === "decision_pending");
  const waiting = awaitingSupervisor && !team;
  const attention = item.urgency !== "normal" && !waiting;
  return {
    status: workCardStatus(item, awaitingSupervisor, team),
    tone: waiting ? "text-[#626b65]" : attention || item.workflow_status === "changes_requested" ? "text-[#936116]" : "text-[#176f60]",
    nextAction: waiting ? "Assessment submitted for review" : item.next_action,
  };
}

function workCardStatus(item: ReferralWorklistItem, awaitingSupervisor: boolean, team: boolean) {
  if (item.outcome_state === "accepted") {
    const count = item.missing_document_count;
    return count > 0 ? `Accepted · ${count.toLocaleString()} ${count === 1 ? "document" : "documents"} needed` : "Accepted · Complete client data";
  }
  if (awaitingSupervisor) return team ? "Supervisor review needed" : "Waiting for supervisor";
  return workflowStatusLabels[item.workflow_status] ?? "In progress";
}

function stageAccent(state: ReferralWorklistItem["flow_state"]) {
  if (state === "ready_to_schedule") return "bg-[#0f8b73]";
  if (state === "scheduled") return "bg-[#b77b27]";
  if (state === "assessment") return "bg-[#4866ad]";
  return state === "complete_chart" ? "bg-[#78844d]" : "bg-[#68716c]";
}

function stageBadge(state: ReferralWorklistItem["flow_state"]) {
  if (state === "ready_to_schedule") return "bg-[#eaf6f1] text-[#176f60]";
  if (state === "scheduled") return "bg-[#fff5e7] text-[#80581b]";
  if (state === "assessment") return "bg-[#edf2fb] text-[#36558f]";
  return state === "complete_chart" ? "bg-[#f1f3e9] text-[#536334]" : "bg-[#eef1ef] text-[#49524c]";
}
