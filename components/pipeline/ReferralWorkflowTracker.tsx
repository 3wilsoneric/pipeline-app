import { ArrowRight } from "lucide-react";

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
    <section data-guide-target="my-queue" aria-label="Current work" className="border-y border-[#d8dedb] bg-white">
      <div className="flex min-h-11 items-center justify-between gap-4 px-1">
        <h2 className="text-[13px] font-semibold text-[#202320]">Current work</h2>
        <span className="text-[10px] font-semibold text-[#69706c]">
          {unavailable ? "Unavailable" : `${briefing.workflow.active_total} ${briefing.scope === "team" ? "team" : "assigned"}`}
        </span>
      </div>
      {unavailable ? (
        <div className="border-t border-[#e5e9e7] px-4 py-8 text-center text-[12px] text-[#8a5a10]">
          Temporarily unavailable. Refresh to try again.
        </div>
      ) : items.length === 0 ? (
        <div className="border-t border-[#e5e9e7] px-4 py-8 text-center text-[12px] text-[#626a65]">
          No active referral work.
        </div>
      ) : (
        <div className="grid grid-flow-col auto-cols-[minmax(220px,1fr)] items-start gap-3 overflow-x-auto border-t border-[#e5e9e7] py-3 md:auto-cols-[minmax(230px,1fr)] xl:grid-flow-row xl:grid-cols-6 xl:overflow-visible">
          {activeReferralFlowStates.map((state) => {
            const stageItems = items.filter((item) => referralFlowStateForStatus(item.workflow_status) === state.key);
            return (
              <div key={state.key} className={`min-w-0 border-t-2 ${stageTone(state.key)}`}>
                <div className="flex h-8 items-center justify-between gap-3 px-1">
                  <h3 className="truncate text-[10px] font-bold uppercase tracking-[0.08em] text-[#4f5752]">{state.label}</h3>
                  <strong className="text-[11px] font-bold tabular-nums text-[#202320]">{counts[state.key]}</strong>
                </div>
                {stageItems.length > 0 ? (
                  <div className="space-y-2">
                    {stageItems.map((item) => (
                      <WorkflowCard
                        key={item.referral_id}
                        item={item}
                        showOwner={briefing.scope === "team"}
                        onOpenPacket={onOpenPacket}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="px-1 py-4 text-[10px] leading-4 text-[#8a908c]">{state.emptyLabel}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function WorkflowCard({ item, showOwner, onOpenPacket }: {
  item: ReferralWorklistItem;
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
      className={`group w-full border bg-white px-3 py-3 text-left outline-none transition-colors hover:border-[#0f8b73] hover:bg-[#f7fbf9] focus-visible:ring-2 focus-visible:ring-[#0f8b73] ${attention ? "border-[#d8b36c]" : "border-[#dfe3e1]"}`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-[12px] font-semibold text-[#202320]">{clientName}</span>
        <ArrowRight size={13} className="mt-0.5 shrink-0 text-[#8a908c] group-hover:text-[#0f8b73]" aria-hidden="true" />
      </span>
      <span className="mt-1 block line-clamp-2 min-h-8 text-[10px] leading-4 text-[#626a65]">{item.next_action}</span>
      <span className="mt-2 flex min-w-0 items-center justify-between gap-2 border-t border-[#edf0ee] pt-2 text-[9px] font-semibold text-[#717873]">
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
  if (state === "assignment" || state === "intake") return "border-[#0f8b73]";
  if (state === "ready_to_schedule" || state === "scheduled") return "border-[#b77b27]";
  if (state === "assessment") return "border-[#4866ad]";
  return "border-[#66706b]";
}
