"use client";

import { useId, useState } from "react";
import { ArrowRight, ChevronDown, FolderOpen, Maximize2 } from "lucide-react";

import HomeDialog, { type HomeDialogOrigin } from "@/components/pipeline/HomeDialog";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import { formatProfileDate } from "@/lib/pipeline/client-profile-presentation";
import { referralBoardStages, type ReferralBoardStage } from "@/lib/pipeline/referral-flow";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import type { ReferralWorklistItem } from "@/lib/pipeline/operations-types";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import type { Referral } from "@/lib/pipeline/referral-types";
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
      ) : layout === "board" ? (
        <ReferralLifecycleBoard items={boardItems} allItems={briefing.workflow.all_board_items} showOwner onOpenPacket={onOpenPacket} />
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

export function ReferralLifecycleBoard({ items, allItems = items, showOwner, onOpenPacket, initialStage = "received" }: {
  items: ReferralWorklistItem[];
  allItems?: ReferralWorklistItem[];
  showOwner: boolean;
  initialStage?: ReferralBoardStage;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
}) {
  const [mobileStage, setMobileStage] = useState<ReferralBoardStage>(initialStage);
  const [expanded, setExpanded] = useState<{ stage: ReferralBoardStage; origin: HomeDialogOrigin } | null>(null);
  const active = items.filter((item) => item.board.stage !== null);
  const allActive = allItems.filter((item) => item.board.stage !== null);
  const stages = referralBoardStages;

  function openFolder(stage: ReferralBoardStage, element: HTMLElement) {
    setMobileStage(stage);
    const folder = element.closest<HTMLElement>("[data-board-stage]") ?? element;
    folder.querySelector<HTMLButtonElement>("[data-open-folder]")?.focus({ preventScroll: true });
    const { left, top, width, height } = folder.getBoundingClientRect();
    setExpanded({ stage, origin: { left, top, width, height } });
  }

  function openFile(referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) {
    setExpanded(null);
    onOpenPacket(referral, location);
  }
  return (
    <>
      <label className="relative mb-4 block lg:hidden">
        <span className="sr-only">Referral stage</span>
        <select data-guide-target="home-board-stage" value={mobileStage} onChange={(event) => setMobileStage(event.target.value as ReferralBoardStage)} className="h-11 w-full appearance-none border border-[#c7d1cb] bg-white px-3 pr-10 text-[13px] font-bold text-[#202320] focus-visible:outline-[#0f8b73]">
          {stages.map((stage) => <option key={stage.key} value={stage.key}>{stage.label} ({active.filter((item) => item.board.stage === stage.key).length})</option>)}
        </select>
        <ChevronDown size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#176f60]" aria-hidden="true" />
      </label>
      <div data-current-work-board className="grid items-start gap-4 lg:grid-cols-3">
        {stages.map((stage) => {
          const stageItems = active.filter((item) => item.board.stage === stage.key);
          return <div key={stage.key} data-board-stage={stage.key} className={`${boardStyles.docket} ${mobileStage === stage.key ? "block" : "hidden"} min-w-0 lg:block`} onClick={(event) => {
            if (!(event.target as HTMLElement).closest("button, a, input, select, textarea, dialog")) openFolder(stage.key, event.currentTarget);
          }}>
            <div className={boardStyles.stageHeading}>
              <h2><button type="button" data-open-folder aria-label={`Open ${stage.label.toLowerCase()} folder`} aria-haspopup="dialog" aria-expanded={expanded?.stage === stage.key} className={boardStyles.openFolder} onClick={(event) => openFolder(stage.key, event.currentTarget)}>
                <span className={boardStyles.stageIcon}><FolderOpen size={23} aria-hidden="true" /></span>
                <span className={boardStyles.stageTitle}>{stage.label}<span>{stageItems.length.toLocaleString()} {stageItems.length === 1 ? "file" : "files"}</span></span>
                <span className={boardStyles.expandAffordance}><Maximize2 size={18} aria-hidden="true" /><span>View all</span></span>
              </button></h2>
            </div>
            <div data-folder-stack className={boardStyles.stack}>
              {stageItems.map((item) => <LifecycleCard key={item.referral_id} item={item} showOwner={showOwner} onOpenPacket={onOpenPacket} />)}
              {stageItems.length === 0 ? <p className="py-5 text-center text-[11px] font-medium text-[#77817a]">No referrals here</p> : null}
            </div>
            {expanded?.stage === stage.key ? <ExpandedStageFolder title={stage.label} items={stageItems} allItems={allActive.filter((item) => item.board.stage === stage.key)} origin={expanded.origin} showOwner={showOwner} onClose={() => setExpanded(null)} onOpenPacket={openFile} /> : null}
          </div>;
        })}
      </div>
    </>
  );
}

function ExpandedStageFolder({ title, items, allItems, origin, showOwner, onClose, onOpenPacket }: {
  title: string;
  items: ReferralWorklistItem[];
  allItems: ReferralWorklistItem[];
  origin: HomeDialogOrigin;
  showOwner: boolean;
  onClose: () => void;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
}) {
  const [scope, setScope] = useState<"all" | "mine">("mine");
  const visibleItems = scope === "all" ? allItems : items;
  return <HomeDialog label={`${title} folder`} title={<>
    <span className={boardStyles.expandedIcon}><FolderOpen size={25} aria-hidden="true" /></span>
    <span className={boardStyles.expandedLabel}>{title}</span>
    <span className={boardStyles.expandedCount} aria-live="polite">{visibleItems.length} {visibleItems.length === 1 ? "file" : "files"}</span>
  </>} size="browser" className={boardStyles.expandedFolder} expandFrom={origin} onClose={onClose}>
    <div className={boardStyles.scopeBar}>
      <div role="group" aria-label="Folder scope" className={boardStyles.scopeToggle}>
        {(["all", "mine"] as const).map((value) => <button key={value} type="button" aria-pressed={scope === value} onClick={() => setScope(value)}>{value === "all" ? "All" : "Mine"}</button>)}
      </div>
      <p>{scope === "mine" ? "You own or co-own these referrals, or are their designated assessor." : "Everyone’s referrals in this folder."}</p>
    </div>
    <div className={boardStyles.expandedScroll}>
      {visibleItems.length ? <div data-expanded-folder className={boardStyles.expandedGrid}>
        {visibleItems.map((item) => <LifecycleCard key={item.referral_id} item={item} showOwner={showOwner} onOpenPacket={onOpenPacket} />)}
      </div> : <p className={boardStyles.emptyFolder}>{scope === "mine" && allItems.length ? "None assigned to you here. Choose All to see everyone’s referrals." : "No referrals in this folder."}</p>}
    </div>
  </HomeDialog>;
}

function LifecycleCard({ item, showOwner, onOpenPacket }: {
  item: ReferralWorklistItem;
  showOwner: boolean;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
}) {
  const descriptionId = useId();
  const name = formatClientIdentityTitle({ name: item.client_name, community: item.community });
  const status = item.board.detail;
  const details = [
    { label: "Community", value: item.community },
    ...plannedAdmissionDetail(item),
    ...(showOwner ? [{ label: "Assessor", value: item.owner || "Unassigned" }] : []),
    ...(item.missing_document_count > 0 ? [{ label: "Documents needed", value: String(item.missing_document_count) }] : []),
  ];
  return <button type="button" data-board-card data-guide-target="home-board-card" data-card-stage={item.board.stage} data-board-outcome={item.outcome_state} aria-label={`Open ${name}`} aria-describedby={`${descriptionId}-status ${descriptionId}-action`} onClick={() => onOpenPacket({ id: item.referral_id, name, community: item.community as Referral["community"] }, item.board.location)} className={`${folderStyles.folder} ${boardStyles.folder}`}>
    <span className={boardStyles.tabs}>
      <strong data-folder-name className={`${folderStyles.tab} ${boardStyles.nameTab}`}><span className={folderStyles.tabLabel}>{name}</span></strong>
      <span id={`${descriptionId}-status`} data-board-status className={boardStyles.statusTab}>{status}</span>
    </span>
    <span data-folder-body className={`${folderStyles.body} ${boardStyles.body}`}>
      <span className={`${folderStyles.paper} ${boardStyles.paper}`}>
        <span className={boardStyles.fileIndex}>
          <span>{item.packet_sent_at ? `Packet sent ${formatProfileDate(item.packet_sent_at)}` : `Referral #${item.referral_id}`}</span>
          {item.received_at ? <span>Received {formatProfileDate(item.received_at)}</span> : null}
        </span>
        <span className={boardStyles.nextStep}>
          <span id={`${descriptionId}-action`} className={boardStyles.actionText}>{item.board.next_action}</span>
          <ArrowRight size={15} aria-hidden="true" />
        </span>
        <span data-folder-details className={boardStyles.details}>
          {details.map(({ label, value }) => <span key={label} className={boardStyles.detail}>
            <span className={boardStyles.detailLabel}>{label}</span>
            <span className={boardStyles.detailValue} title={value}>{value}</span>
          </span>)}
        </span>
      </span>
    </span>
  </button>;
}

function WorkflowRibbon({ item, showOwner, onOpenPacket, current }: {
  item: ReferralWorklistItem;
  showOwner: boolean;
  current: boolean;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
}) {
  const clientName = formatClientIdentityTitle({ name: item.client_name, community: item.community });
  const owner = showOwner ? item.owner || "Unassigned" : null;
  const presentation = { status: item.board.detail, nextAction: item.board.next_action, tone: "text-[#176f60]" };
  const stage = referralBoardStages.find((state) => state.key === item.board.stage);

  return (
    <button
      type="button"
      aria-label={`Open ${clientName}`}
      aria-current={current ? "true" : undefined}
      onClick={() => onOpenPacket({ id: item.referral_id, name: clientName, community: item.community as Referral["community"] }, item.board.location)}
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

function plannedAdmissionDetail(item: ReferralWorklistItem) {
  if (!item.planned_admission_date) return [];
  return [{ label: "Planned admission", value: formatProfileDate(item.planned_admission_date) ?? item.planned_admission_date }];
}
