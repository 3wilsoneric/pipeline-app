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
    assignment: 0,
    intake: 0,
    ready_to_schedule: 0,
    scheduled: 0,
    assessment: 0,
    review: 0,
  };
  const items = briefing.workflow.active_items ?? [];
  const unavailable = briefing.unavailable_sections.includes("workflow");
  return (
    <section data-guide-target="my-queue" aria-label="Current work" className="bg-white">
      <details open className="group/workflow">
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-1 py-1 text-[#202320] outline-none hover:bg-[#f7faf8] focus-visible:bg-[#eef6f3] [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-2.5 text-[14px] font-bold">
            <ChevronDown
              size={17}
              aria-hidden="true"
              className="shrink-0 text-[#176f60] transition-transform duration-200 group-open/workflow:rotate-180"
            />
            {unavailable ? "Referral work unavailable" : `${briefing.workflow.active_total} active ${briefing.workflow.active_total === 1 ? "referral" : "referrals"}`}
          </span>
        </summary>

        {unavailable ? (
          <div className="px-4 py-7 text-center text-[12px] text-[#8a5a10]">
            Temporarily unavailable. Refresh to try again.
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-7 text-center text-[12px] text-[#626a65]">
            No active referral work.
          </div>
        ) : (
          <div className="grid grid-flow-col auto-cols-[minmax(230px,1fr)] items-start gap-4 overflow-x-auto pb-3 pt-1 md:auto-cols-[minmax(240px,1fr)] xl:grid-flow-row xl:grid-cols-6 xl:overflow-visible">
            {activeReferralFlowStates.map((state) => {
              const stageItems = items.filter((item) => referralFlowStateForStatus(item.workflow_status) === state.key);
              return (
                <div key={state.key} className="min-w-0">
                  <div className="flex h-9 items-center justify-between gap-3 px-1">
                    <h3 className={`truncate text-[11px] font-extrabold uppercase ${stageTone(state.key)}`}>{state.label}</h3>
                    <strong className="text-[12px] font-extrabold tabular-nums text-[#202320]">{counts[state.key]}</strong>
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
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </details>
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
      className={`group min-h-[116px] w-full border border-l-[3px] border-[#dce3df] bg-white px-3.5 py-3.5 text-left shadow-[0_3px_12px_rgba(32,35,32,0.045)] outline-none transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-[#0f8b73] hover:shadow-[0_7px_18px_rgba(32,35,32,0.08)] focus-visible:ring-2 focus-visible:ring-[#0f8b73] ${cardAccent(state)}`}
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
  if (state === "assignment" || state === "intake") return "text-[#176f60]";
  if (state === "ready_to_schedule" || state === "scheduled") return "text-[#936116]";
  if (state === "assessment") return "text-[#4866ad]";
  return "text-[#5d6661]";
}

function cardAccent(state: (typeof activeReferralFlowStates)[number]["key"]) {
  if (state === "assignment" || state === "intake") return "border-l-[#0f8b73]";
  if (state === "ready_to_schedule" || state === "scheduled") return "border-l-[#b77b27]";
  if (state === "assessment") return "border-l-[#4866ad]";
  return "border-l-[#69716c]";
}
