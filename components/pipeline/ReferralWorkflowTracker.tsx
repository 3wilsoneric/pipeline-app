"use client";

import { useId, useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";

import HomeDialog, { type HomeDialogOrigin } from "@/components/pipeline/HomeDialog";
import { AssessmentCalendarTile } from "./HomeAssessmentCalendar";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import { formatProfileDate } from "@/lib/pipeline/client-profile-presentation";
import { referralBoardSection, referralBoardStages, type ReferralBoardSection, type ReferralBoardStage } from "@/lib/pipeline/referral-flow";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import type { ReferralWorklistItem } from "@/lib/pipeline/operations-types";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import type { Referral } from "@/lib/pipeline/referral-types";
import boardStyles from "./ReferralWorkflowTracker.module.css";
import PipelineIllustration from "./PipelineIllustration";

type OpenWorkspace = (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
type ClientSpace = {
  recentIds: number[];
  unavailable: boolean;
  onResume: OpenWorkspace;
  upcoming: { count: number; unavailable: boolean; date: string; onOpen: (origin: HomeDialogOrigin) => void };
};

export default function ReferralWorkflowTracker({ briefing, onOpenPacket, selectedReferralId, limit, layout = "ribbons", clientSpace }: {
  briefing: HomeBriefingSnapshot;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
  selectedReferralId?: number;
  limit?: number;
  layout?: "ribbons" | "board";
  clientSpace?: ClientSpace;
}) {
  const items = briefing.workflow.active_items ?? [];
  const boardItems = briefing.workflow.board_items ?? items;
  const unavailable = briefing.unavailable_sections.includes("workflow");

  return (
    <section aria-label="Current work board" className="bg-white">
      {unavailable && !(layout === "board" && clientSpace) ? (
        <div className="px-4 py-12 text-center text-[13px] font-medium text-[#8a5a10]">
          The Board is temporarily unavailable. Close this view and try again.
        </div>
      ) : layout === "board" ? (
        <ReferralLifecycleBoard items={unavailable ? [] : boardItems} allItems={unavailable ? [] : briefing.workflow.all_board_items} unavailable={unavailable} showOwner onOpenPacket={onOpenPacket} clientSpace={clientSpace} />
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

export function ReferralLifecycleBoard({ items, allItems = items, showOwner, onOpenPacket, initialStage = "in_progress", clientSpace, unavailable = false }: {
  items: ReferralWorklistItem[];
  allItems?: ReferralWorklistItem[];
  showOwner: boolean;
  initialStage?: ReferralBoardStage;
  unavailable?: boolean;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
  clientSpace?: ClientSpace;
}) {
  const [mobileStage, setMobileStage] = useState<ReferralBoardSection>(referralBoardSection(initialStage) ?? "in_progress");
  const [expanded, setExpanded] = useState<{ stage: ReferralBoardSection; origin: HomeDialogOrigin } | null>(null);
  const active = items.filter((item) => item.board.stage !== null && (!clientSpace || item.outcome_state !== "declined"));
  const allActive = allItems.filter((item) => item.board.stage !== null && (!clientSpace || item.outcome_state !== "declined"));
  // Home groups current work by acceptance; the stored workflow and next action stay authoritative.
  const sectionFor = (item: ReferralWorklistItem): ReferralBoardSection | null => clientSpace
    ? item.board.stage === "decision" && item.outcome_state === "accepted" ? "decision" : "in_progress"
    : referralBoardSection(item.board.stage);
  const stages = referralBoardStages.map((stage) => ({ ...stage,
    label: clientSpace && stage.key === "decision" ? "Clients in handoff" : stage.label,
  }));
  const byId = new Map(allActive.map((item) => [item.referral_id, item]));
  const recent = (clientSpace?.recentIds ?? [])
    .flatMap((id) => byId.has(id) ? [byId.get(id)!] : []).slice(0, 6);

  function openFolder(stage: ReferralBoardSection, element: HTMLElement) {
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
      {clientSpace ? null : <label className="relative mb-4 block lg:hidden">
        <span className="sr-only">Referral stage</span>
        <select data-guide-target="home-board-stage" value={mobileStage} onChange={(event) => setMobileStage(event.target.value as ReferralBoardSection)} className="h-11 w-full appearance-none rounded-input border border-control-border bg-paper px-3 pr-10 text-value font-bold text-ink focus-visible:outline-focus">
          {stages.map((stage) => <option key={stage.key} value={stage.key}>{stage.label} ({active.filter((item) => sectionFor(item) === stage.key).length})</option>)}
        </select>
        <ChevronDown size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
      </label>}
      <div data-current-work-board className={`${boardStyles.board} ${clientSpace ? boardStyles.clientSpace : "grid items-start gap-6 lg:grid-cols-2"}`}>
        <div className={clientSpace ? boardStyles.categoryLinks : "contents"} data-home-priorities={clientSpace ? true : undefined}>
        {clientSpace ? <AssessmentCalendarTile {...clientSpace.upcoming} /> : null}
        {stages.map((stage) => {
          const stageItems = active.filter((item) => sectionFor(item) === stage.key);
          return <div key={stage.key} data-board-stage={stage.key} className={`${boardStyles.docket} ${clientSpace || mobileStage === stage.key ? "block" : "hidden"} min-w-0 lg:block`} onClick={(event) => {
            if (!unavailable && !(event.target as HTMLElement).closest("button, a, input, select, textarea, dialog")) openFolder(stage.key, event.currentTarget);
          }}>
            <div className={boardStyles.stageHeading}>
              <h2><button type="button" data-open-folder disabled={unavailable} aria-label={`Open ${stage.label.toLowerCase()} folder`} aria-haspopup="dialog" aria-expanded={expanded?.stage === stage.key} className={boardStyles.openFolder} onClick={(event) => openFolder(stage.key, event.currentTarget)}>
                  <span className={boardStyles.stageIdentity}><span className={boardStyles.stageTitle}>{stage.label}</span>
                  <span className={boardStyles.stageCount}>{unavailable ? "Unavailable" : <>{stageItems.length.toLocaleString()}<span className={clientSpace ? "sr-only" : undefined}> {stageItems.length === 1 ? "file" : "files"}</span></>}</span></span>
                {clientSpace ? null : <span className={boardStyles.expandAffordance}>View all<ArrowRight size={16} aria-hidden="true" /></span>}
              </button></h2>
            </div>
            {clientSpace ? null : <div data-folder-stack className={boardStyles.stack}>
              {stageItems.map((item) => <LifecycleCard key={item.referral_id} item={item} showOwner={showOwner} onOpenPacket={onOpenPacket} />)}
              {stageItems.length === 0 ? <p className="text-center">No referrals here</p> : null}
            </div>}
            {expanded?.stage === stage.key ? <ExpandedStageFolder title={stage.label} items={stageItems} allItems={allActive.filter((item) => sectionFor(item) === stage.key)} origin={expanded.origin} showOwner={showOwner} onClose={() => setExpanded(null)} onOpenPacket={openFile} /> : null}
          </div>;
        })}
        </div>
        {unavailable ? <p role="status" className={boardStyles.emptyRecent}>The Board is temporarily unavailable. Close this view and try again.</p> : null}
        {clientSpace && !unavailable ? <div className={boardStyles.workingClients}>
          {recent.length ? <section aria-label="Recent clients"><h2 className={boardStyles.shelfTitle}>Recent</h2><div className={boardStyles.clientShelf}>
            {recent.map((item, index) => <ClientFile featured={index === 0} key={item.referral_id} item={item} showOwner={showOwner} onOpenPacket={clientSpace.onResume} resume />)}
          </div></section> : null}
          {clientSpace.unavailable ? <p role="status" className={boardStyles.emptyRecent}>Recent work could not be loaded.</p> : !recent.length ? <p className={boardStyles.emptyRecent}>No recent work yet.</p> : null}
        </div> : null}
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
        {visibleItems.map((item) => <ClientFile key={item.referral_id} item={item} showOwner={showOwner} onOpenPacket={onOpenPacket} />)}
      </div> : <p className={boardStyles.emptyFolder}>{scope === "mine" && allItems.length ? "None assigned to you here. Choose All to see everyone’s referrals." : "No referrals in this folder."}</p>}
    </div>
  </HomeDialog>;
}

function ClientFile(props: Parameters<typeof LifecycleCard>[0]) {
  return <div className={boardStyles.clientFile} data-client-file={props.item.referral_id} data-featured={props.featured || undefined} data-card-stage={referralBoardSection(props.item.board.stage)}>
    <LifecycleCard {...props} />
  </div>;
}

// A client file is one resume target. Full chronology and notes remain in the workspace.
function LifecycleCard({ item, showOwner, onOpenPacket, resume = false, featured = false }: {
  item: ReferralWorklistItem;
  showOwner: boolean;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location?: PipelineWorkspaceLocation) => void;
  resume?: boolean;
  featured?: boolean;
}) {
  const descriptionId = useId();
  const name = formatClientIdentityTitle({ name: item.client_name, community: item.community });
  const opensFiles = item.board.location.view === "files";
  const planned = plannedAdmissionDetail(item)[0];
  return <button type="button" data-board-card data-featured={featured || undefined} data-guide-target="home-board-card" data-card-stage={referralBoardSection(item.board.stage)} data-board-outcome={item.outcome_state}
    aria-label={`Open ${name}`} aria-describedby={`${descriptionId}-status ${descriptionId}-action`}
    onClick={() => onOpenPacket({ id: item.referral_id, name, community: item.community as Referral["community"] }, item.board.location)} className={boardStyles.card}>
    {featured ? <span className={boardStyles.taskArt}><PipelineIllustration kind={item.board.stage === "received" ? "folder" : referralBoardSection(item.board.stage) === "in_progress" ? "assessment" : item.outcome_state === "accepted" ? "placement" : "decision"} size={72} /></span> : null}
    <span className={boardStyles.cardCopy}>
      <span className={boardStyles.cardHead}>
        <strong data-folder-name className={boardStyles.name}>{name}</strong>
        <span id={`${descriptionId}-status`} data-board-status className={boardStyles.status}>{item.board.detail}</span>
      </span>
      <span data-folder-details className={boardStyles.fileIndex}>
        <span className={boardStyles.detail}><span className="sr-only">Community: </span>{item.community}</span>
        {showOwner ? <span className={boardStyles.owner} data-unassigned={item.owner ? undefined : true}><span className="sr-only">Assessor: </span>{item.owner || "Unassigned"}</span> : null}
        {item.missing_document_count > 0 ? <span className={boardStyles.docsNeeded}>{item.missing_document_count} {item.missing_document_count === 1 ? "document" : "documents"} needed</span> : null}
      </span>
      {planned ? <span className={boardStyles.meta}>{planned.label} {planned.value}</span> : null}
    </span>
    <span className={boardStyles.footer}>
      <span id={`${descriptionId}-action`} className={boardStyles.nextStep} title={resume ? undefined : item.board.next_action}>
        <span className={boardStyles.actionText}>{resume ? "Resume" : opensFiles ? "Open Files" : item.board.next_action}</span><ArrowRight size={17} aria-hidden="true" />
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
  const stage = referralBoardStages.find((state) => state.key === referralBoardSection(item.board.stage));

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
