"use client";

import { useId, useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";

import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import { activeReferralFlowStates, referralBoardStageForStatus, referralBoardStages, type ReferralBoardStage } from "@/lib/pipeline/referral-flow";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import type { ReferralWorklistItem } from "@/lib/pipeline/operations-types";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import type { Referral } from "@/lib/pipeline/referral-types";
import { workflowStatusLabels } from "@/lib/pipeline/workflow-status";
import folderStyles from "./ClientFolder.module.css";
import boardStyles from "./ReferralWorkflowTracker.module.css";

export default function ReferralWorkflowTracker({ briefing, onOpenPacket, selectedReferralId, limit, layout = "ribbons" }: {
  briefing: HomeBriefingSnapshot;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
  selectedReferralId?: number;
  limit?: number;
  layout?: "ribbons" | "board";
}) {
  const items = briefing.workflow.active_items ?? [];
  const boardItems = briefing.workflow.board_items ?? items;
  const unavailable = briefing.unavailable_sections.includes("workflow");

  return (
    <section aria-label="Current work board" className="bg-white">
      {unavailable ? (
        <div className="px-4 py-12 text-center text-[13px] font-medium text-[#8a5a10]">
          The Board is temporarily unavailable. Close this view and try again.
        </div>
      ) : (layout === "board" ? boardItems : items).length === 0 ? (
        <p className="px-1 py-5 text-[13px] font-medium text-[#626b65]">No active referral work.</p>
      ) : layout === "board" ? (
        <ReferralLifecycleBoard items={boardItems} showOwner={briefing.scope === "team"} onOpenPacket={onOpenPacket} />
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

function ReferralLifecycleBoard({ items, showOwner, onOpenPacket }: {
  items: ReferralWorklistItem[];
  showOwner: boolean;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
}) {
  const [mobileStage, setMobileStage] = useState<ReferralBoardStage>("received");
  return (
    <>
      <label className="relative mb-4 block lg:hidden">
        <span className="sr-only">Referral stage</span>
        <select value={mobileStage} onChange={(event) => setMobileStage(event.target.value as ReferralBoardStage)} className="h-11 w-full appearance-none border border-[#c7d1cb] bg-white px-3 pr-10 text-[13px] font-bold text-[#202320] focus-visible:outline-[#0f8b73]">
          {referralBoardStages.map((stage) => <option key={stage.key} value={stage.key}>{stage.label} ({items.filter((item) => referralBoardStageForStatus(item.workflow_status) === stage.key).length})</option>)}
        </select>
        <ChevronDown size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#176f60]" aria-hidden="true" />
      </label>
      <div data-current-work-board className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-4">
        {referralBoardStages.map((stage) => {
          const stageItems = items.filter((item) => referralBoardStageForStatus(item.workflow_status) === stage.key);
          return <div key={stage.key} data-board-stage={stage.key} className={`${mobileStage === stage.key ? "block" : "hidden"} min-w-0 lg:block`}>
            <div className={`flex min-h-10 items-center justify-between gap-2 border-t-2 px-1 py-2 ${boardRule(stage.key)}`}>
              <h2 className="truncate text-[12px] font-extrabold uppercase text-[#303b34]">{stage.label}</h2>
              <strong className="text-[12px] font-bold tabular-nums text-[#5d6861]">{stageItems.length.toLocaleString()}</strong>
            </div>
            <div data-folder-stack className={boardStyles.stack}>
              {stageItems.map((item) => <LifecycleCard key={item.referral_id} item={item} stage={stage.key} showOwner={showOwner} onOpenPacket={onOpenPacket} />)}
              {stageItems.length === 0 ? <p className="py-5 text-center text-[11px] font-medium text-[#77817a]">No referrals here</p> : null}
            </div>
          </div>;
        })}
      </div>
    </>
  );
}

function LifecycleCard({ item, stage, showOwner, onOpenPacket }: {
  item: ReferralWorklistItem;
  stage: ReferralBoardStage;
  showOwner: boolean;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
}) {
  const descriptionId = useId();
  const name = formatClientIdentityTitle({ name: item.client_name, community: item.community });
  const decision = stage === "decision" ? decisionPresentation(item) : null;
  const status = decision?.label ?? (stage === "in_progress" && item.assessment_state === "scheduled" ? "Assessment scheduled" : workflowStatusLabels[item.workflow_status]);
  return <button type="button" data-board-card data-board-outcome={item.outcome_state} aria-label={`Open ${name}`} aria-describedby={`${descriptionId}-status ${descriptionId}-action`} onClick={() => onOpenPacket({ id: item.referral_id, name, community: item.community as Referral["community"] }, item.location)} className={`${folderStyles.folder} ${boardStyles.folder}`}>
    <span className={boardStyles.tabs}>
      <strong data-folder-name className={`${folderStyles.tab} ${boardStyles.nameTab}`}><span className={folderStyles.tabLabel}>{name}</span></strong>
      <span id={`${descriptionId}-status`} data-board-status className={boardStyles.statusTab}>{status}</span>
    </span>
    <span data-folder-body className={`${folderStyles.body} ${boardStyles.body}`}>
      <span className={`${folderStyles.paper} ${boardStyles.paper}`}>
        <span className={boardStyles.nextStep}>
          <span id={`${descriptionId}-action`} className={boardStyles.actionText}>{item.next_action}</span>
          <ArrowRight size={15} aria-hidden="true" />
        </span>
        <span className={`grid gap-px border-t border-[#dde3de] bg-[#dde3de] ${showOwner ? "grid-cols-2" : "grid-cols-1"}`}>
          <span className="min-w-0 bg-white px-3 py-3">
            <span className="block text-[9px] font-bold uppercase tracking-[0.07em] text-[#59685f]">Community</span>
            <span className="mt-1 block text-[12px] font-semibold leading-5 text-[#25382e] [overflow-wrap:anywhere]">{item.community}</span>
          </span>
          {showOwner ? <span className="min-w-0 bg-white px-3 py-3">
            <span className="block text-[9px] font-bold uppercase tracking-[0.07em] text-[#59685f]">Assessor</span>
            <span className="mt-1 block text-[12px] font-semibold leading-5 text-[#25382e] [overflow-wrap:anywhere]">{item.owner || "Unassigned"}</span>
          </span> : null}
        </span>
      </span>
    </span>
  </button>;
}

function decisionPresentation(item: ReferralWorklistItem) {
  if (item.outcome_state === "accepted") return { label: "Accepted", tone: "text-[#176f60]", accent: "border-l-[#0f8b73]" };
  if (item.outcome_state === "declined") return { label: "Denied", tone: "text-[#a74338]", accent: "border-l-[#b84b3d]" };
  return { label: "Under review", tone: "text-[#936116]", accent: "border-l-[#b77b27]" };
}

function boardRule(stage: ReferralBoardStage) {
  if (stage === "received") return "border-t-[#0f8b73]";
  if (stage === "in_progress") return "border-t-[#4866ad]";
  if (stage === "decision") return "border-t-[#b77b27]";
  return "border-t-[#78844d]";
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
