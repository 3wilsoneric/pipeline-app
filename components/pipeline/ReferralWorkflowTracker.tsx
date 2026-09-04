"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";

import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import { activeReferralFlowStates, referralFlowStateForStatus } from "@/lib/pipeline/referral-flow";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import type { ReferralWorklistItem } from "@/lib/pipeline/operations-types";
import type { Referral } from "@/lib/pipeline/referral-types";

export default function ReferralWorkflowTracker({ briefing, onOpenPacket }: {
  briefing: HomeBriefingSnapshot;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  const counts = briefing.workflow.flow_counts ?? {
    ready_to_schedule: 0,
    scheduled: 0,
    assessment: 0,
    complete_chart: 0,
  };
  const items = briefing.workflow.active_items ?? [];
  const unavailable = briefing.unavailable_sections.includes("workflow");
  const [mobileStage, setMobileStage] = useState<(typeof activeReferralFlowStates)[number]["key"]>("ready_to_schedule");

  const selectMobileStage = (stage: (typeof activeReferralFlowStates)[number]["key"]) => {
    setMobileStage(stage);
  };

  return (
    <section aria-label="Current work board" className="bg-white">
      {unavailable ? (
        <div className="px-4 py-12 text-center text-[13px] font-medium text-[#8a5a10]">
          Current work is temporarily unavailable. Close this view and try again.
        </div>
      ) : items.length === 0 ? (
        <div className="flex min-h-[240px] items-center justify-center border border-[#dfe4e1] px-4 py-12 text-center text-[13px] font-semibold text-[#626a65]">
          No active referral work.
        </div>
      ) : (
        <>
          <label className="relative mb-4 block lg:hidden">
            <span className="sr-only">Current work stage</span>
            <select
              aria-label="Current work stage"
              value={mobileStage}
              onChange={(event) => selectMobileStage(event.target.value as (typeof activeReferralFlowStates)[number]["key"])}
              className="h-12 w-full appearance-none border border-[#bcc5c0] bg-white px-4 pr-11 text-[14px] font-bold text-[#202320] outline-none focus:border-[#0f8b73] focus:ring-1 focus:ring-[#0f8b73]"
            >
              {activeReferralFlowStates.map((state) => (
                <option key={state.key} value={state.key}>{state.label} ({counts[state.key]})</option>
              ))}
            </select>
            <ChevronDown size={18} aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#176f60]" />
          </label>
          <div data-current-work-board className="grid items-start gap-5 lg:grid-cols-4">
            {activeReferralFlowStates.map((state) => {
              const stageItems = items.filter((item) => referralFlowStateForStatus(item.workflow_status) === state.key);
              return (
                <div key={state.key} className={`${mobileStage === state.key ? "block" : "hidden"} min-w-0 lg:block`}>
                  <div className={`mb-2 flex min-h-10 items-center justify-between gap-3 border-t-2 px-1 pt-2 ${columnRule(state.key)}`}>
                    <h2 className={`truncate text-[12px] font-extrabold uppercase ${stageTone(state.key)}`}>{state.label}</h2>
                    <strong className="text-[12px] font-extrabold tabular-nums text-[#4f5752]">{counts[state.key].toLocaleString()}</strong>
                  </div>
                  {stageItems.length > 0 ? (
                    <div className="space-y-2">
                      {stageItems.map((item) => (
                        <WorkflowCard
                          key={item.referral_id}
                          item={item}
                          state={state.key}
                          showOwner={briefing.scope === "team"}
                          onOpenPacket={onOpenPacket}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="border border-[#e1e6e3] px-4 py-8 text-center text-[11px] font-medium text-[#7b837e]">
                      {state.emptyLabel}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function WorkflowCard({ item, state, showOwner, onOpenPacket }: {
  item: ReferralWorklistItem;
  state: (typeof activeReferralFlowStates)[number]["key"];
  showOwner: boolean;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  const clientName = formatClientIdentityTitle({ name: item.client_name, community: item.community });
  const owner = showOwner && item.owner !== "Unassigned" ? item.owner : null;
  const attention = item.urgency !== "normal";

  return (
    <button
      type="button"
      aria-label={`Open ${clientName}`}
      onClick={() => onOpenPacket({ id: item.referral_id, name: clientName, community: item.community as Referral["community"] })}
      className={`group min-h-[108px] w-full border border-l-[3px] border-[#dce3df] bg-white px-4 py-3.5 text-left shadow-[0_2px_9px_rgba(32,35,32,0.04)] outline-none transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-[#0f8b73] hover:shadow-[0_6px_16px_rgba(32,35,32,0.07)] focus-visible:ring-2 focus-visible:ring-[#0f8b73] ${cardAccent(state)}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-[14px] font-bold text-[#202320]">{clientName}</span>
        <ArrowRight size={15} className="mt-0.5 shrink-0 text-[#7b837e] group-hover:text-[#0f8b73]" aria-hidden="true" />
      </span>
      <span className="mt-1.5 block line-clamp-2 min-h-9 text-[11px] font-medium leading-[18px] text-[#5f6762]">{item.next_action}</span>
      <span className="mt-2.5 flex min-w-0 items-center justify-between gap-2 text-[10px] font-bold text-[#69716c]">
        <span className="truncate">{item.community}{owner ? ` · ${owner}` : ""}</span>
        <span className={attention ? "shrink-0 text-[#936116]" : "shrink-0"}>{formatWorkAge(item.age_hours)}</span>
      </span>
    </button>
  );
}

function formatWorkAge(hours: number) {
  if (!Number.isFinite(hours) || hours < 1) return "New";
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}

function stageTone(state: (typeof activeReferralFlowStates)[number]["key"]) {
  if (state === "ready_to_schedule") return "text-[#176f60]";
  if (state === "scheduled") return "text-[#936116]";
  if (state === "assessment") return "text-[#4866ad]";
  return "text-[#657044]";
}

function cardAccent(state: (typeof activeReferralFlowStates)[number]["key"]) {
  if (state === "ready_to_schedule") return "border-l-[#0f8b73]";
  if (state === "scheduled") return "border-l-[#b77b27]";
  if (state === "assessment") return "border-l-[#4866ad]";
  return "border-l-[#78844d]";
}

function columnRule(state: (typeof activeReferralFlowStates)[number]["key"]) {
  if (state === "ready_to_schedule") return "border-t-[#0f8b73]";
  if (state === "scheduled") return "border-t-[#b77b27]";
  if (state === "assessment") return "border-t-[#4866ad]";
  return "border-t-[#78844d]";
}
