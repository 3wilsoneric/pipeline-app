"use client";

import { ArrowRight } from "lucide-react";

import { getReferralProgress } from "@/lib/pipeline/referral-progress";
import type { ReferralProgress } from "@/lib/pipeline/referral-progress";
import { normalizeOwnerName } from "@/lib/pipeline/referral-ownership";
import {
  formatClientIdentityTitle,
  formatReferralIdentityContext,
  resolveClientCommunity,
  resolveClientGender,
} from "@/lib/pipeline/client-identity-presentation.mjs";
import type { Referral } from "@/lib/pipeline/referral-types";
import { formatProfileDate } from "@/lib/pipeline/client-profile-presentation";
import { prefetchPipelineWorkspace } from "@/lib/pipeline/client-navigation";
import { getWorkspaceCounty, getWorkspaceWorkflowLabel, isClientChartWorkspace, isEarlierWorkspaceMonth, isRecordedWorkspaceCommunity, workspaceFileCount } from "@/lib/pipeline/workspace-presentation";
import { workspaceMonthKey } from "@/lib/pipeline/workspace-month.mjs";
import styles from "./WorkspaceDirectory.module.css";

export default function ReferralWorklist({
  referrals,
  onOpenPacket,
  progressByReferral = {},
}: {
  referrals: Referral[];
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
  progressByReferral?: Record<number, ReferralProgress>;
}) {
  const rows = referrals.map((referral) => {
    const progress = progressByReferral[referral.id] ?? getReferralProgress(referral);
    return {
      referral,
      progress,
      identityTitle: formatClientIdentityTitle(referral),
      county: getWorkspaceCounty(referral),
    };
  });

  return (
    <div role="region" aria-label="Referral worklist">
      <div className="divide-y divide-[#e2e2e2] lg:hidden">
        {rows.map(({ referral, progress, identityTitle, county }) => (
          <CompactReferralRow
            key={referral.id}
            referral={referral}
            progress={progress}
            identityTitle={identityTitle}
            county={county}
            onOpen={() => onOpenPacket(referral)}
          />
        ))}
      </div>

      <div className="hidden overflow-x-auto lg:block">
        <div className="min-w-[820px]">
        <div className="grid grid-cols-[minmax(260px,1.65fr)_170px_135px_90px_36px] items-center border-y border-[#d9d9d9] bg-[#fafafa] px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.08em] text-[#666666]">
          <span>Client</span>
          <span>Status</span>
          <span>Owner</span>
          <span>Date</span>
          <span className="sr-only">Open</span>
        </div>
        <div className="divide-y divide-[#e2e2e2]">
          {rows.map(({ referral, progress, identityTitle, county }) => (
            <button
              key={referral.id}
              type="button"
              data-guide-target="workspace-results"
              data-earlier-workspace={isEarlierWorkspaceMonth(workspaceMonthKey(referral))}
              onClick={() => onOpenPacket(referral)}
              onPointerEnter={() => prefetchPipelineWorkspace(referral)}
              onFocus={() => prefetchPipelineWorkspace(referral)}
              aria-label={`Open ${identityTitle} referral workspace`}
              className={`${styles.row} grid w-full grid-cols-[minmax(260px,1.65fr)_170px_135px_90px_36px] items-center px-4 py-3.5 text-left hover:bg-[#f7faf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73]`}
            >
              <span className="flex min-w-0 items-start gap-3 pr-4">
                <WorkspaceChartThumbnail referral={referral} />
                <span className="min-w-0 pt-0.5">
                  <span data-workspace-name className="block truncate text-[13px] font-bold text-[#111111]" title={identityTitle}>{identityTitle}</span>
                  {workspaceIdentityDetail(referral, county) ? (
                    <span className="mt-1 block truncate text-[9px] text-[#737373]">{workspaceIdentityDetail(referral, county)}</span>
                  ) : null}
                  {!isClientChartWorkspace(referral) && referral.priority !== "standard" ? (
                    <span className="mt-1 block text-[9px] font-semibold text-[#8c392f]">{referral.priority} priority</span>
                  ) : null}
                </span>
              </span>

              <span className="pr-5">
                <WorkspaceStatus referral={referral} progress={progress} />
              </span>

              <span className="truncate text-[11px] font-semibold text-[#404040]">{normalizeOwnerName(referral.owner)}</span>
              <span className="text-[11px] text-[#737373]">{workspaceDateLabel(referral)}</span>
              <span data-workspace-open className="flex h-8 w-8 items-center justify-center text-[#0f8b73]"><ArrowRight size={15} /></span>
            </button>
          ))}
        </div>
        </div>
      </div>
    </div>
  );
}

function CompactReferralRow({
  referral,
  progress,
  identityTitle,
  county,
  onOpen,
}: {
  referral: Referral;
  progress: ReferralProgress;
  identityTitle: string;
  county: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-guide-target="workspace-results"
      data-earlier-workspace={isEarlierWorkspaceMonth(workspaceMonthKey(referral))}
      onClick={onOpen}
      onPointerEnter={() => prefetchPipelineWorkspace(referral)}
      onFocus={() => prefetchPipelineWorkspace(referral)}
      aria-label={`Open ${identityTitle} referral workspace`}
      className={`${styles.row} block w-full px-3 py-4 text-left transition-colors hover:bg-[#f7faf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73] sm:px-4`}
    >
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="flex min-w-0 items-start gap-3">
          <WorkspaceChartThumbnail referral={referral} />
          <span className="min-w-0 pt-0.5">
            <span data-workspace-name className="block truncate text-[13px] font-bold text-[#111111]" title={identityTitle}>{identityTitle}</span>
            {workspaceIdentityDetail(referral, county) ? (
              <span className="mt-1 block truncate text-[10px] text-[#737373]">{workspaceIdentityDetail(referral, county)}</span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <ArrowRight data-workspace-open size={15} className="text-[#0f8b73]" />
        </span>
      </span>

      <span className="mt-3 block">
        <WorkspaceStatus referral={referral} progress={progress} />
      </span>

      <span className="mt-3 flex items-center justify-between gap-3 border-t border-[#ececec] pt-2.5 text-[10px]">
        <span className="truncate font-semibold text-[#404040]">{normalizeOwnerName(referral.owner)}</span>
        <span className="shrink-0 text-[#66716b]">{workspaceDateLabel(referral)}</span>
      </span>
    </button>
  );
}

function WorkspaceStatus({ referral, progress }: { referral: Referral; progress: ReferralProgress }) {
  const openDocuments = progress.state.open_document_count;
  const fileCount = isClientChartWorkspace(referral) ? workspaceFileCount(referral) : null;
  const detail = fileCount !== null
    ? `${fileCount} ${fileCount === 1 ? "file" : "files"}`
    : openDocuments > 0 ? `${openDocuments} ${openDocuments === 1 ? "document" : "documents"} needed` : null;
  return <span className="block min-w-0">
    <span className="block truncate text-[11px] font-semibold text-[#25382e]">{getWorkspaceWorkflowLabel(referral)}</span>
    {detail ? <span className="mt-1 block truncate text-[10px] text-[#66716b]">{detail}</span> : null}
  </span>;
}

export function WorkspaceChartThumbnail({ referral }: { referral: Referral }) {
  const seed = Math.abs(referral.id) % 13;
  const firstLine = 15 + seed;
  const secondLine = 10 + ((seed * 3) % 17);
  const accent = !isClientChartWorkspace(referral) && (referral.priority === "urgent" || referral.priority === "high") ? "#c85b4d" : "#0f8b73";
  return (
    <span
      aria-hidden="true"
      data-testid="workspace-chart-thumbnail"
      className="flex h-12 w-[58px] shrink-0 items-center justify-center overflow-hidden border border-[#cad4cf] bg-[#edf4f1] shadow-[0_2px_5px_rgba(29,52,43,0.08)]"
    >
      <svg viewBox="0 0 58 48" className="h-full w-full" focusable="false">
        <rect x="7" y="4" width="44" height="40" fill="#ffffff" stroke="#c7d3ce" />
        <rect x="7" y="4" width="44" height="6" fill={accent} />
        <rect x="11" y="14" width="8" height="8" fill="#dcebe5" />
        <rect x="22" y="14" width={firstLine} height="2" fill="#90a29a" />
        <rect x="22" y="19" width={secondLine} height="2" fill="#d0dad6" />
        <rect x="11" y="27" width="32" height="2" fill="#d5dfdb" />
        <rect x="11" y="32" width="26" height="2" fill="#d5dfdb" />
        <rect x="11" y="38" width="32" height="3" fill="#e1e8e5" />
        <path d="M45 4h6v6z" fill="#e8efec" />
      </svg>
    </span>
  );
}

function workspaceDateLabel(referral: Referral) {
  if (isClientChartWorkspace(referral)) return referral.workspaceMonth ?? "—";
  return ageLabel(referral.updatedAt ?? referral.createdAt);
}

function workspaceIdentityDetail(referral: Referral, county = "") {
  return [
    resolveClientGender(referral.gender),
    isRecordedWorkspaceCommunity(referral.community) ? resolveClientCommunity(referral.community) : null,
    county || null,
    formatReferralIdentityContext({ name: referral.name, referralId: referral.id, received: formatProfileDate(referral.date), source: referral.source }) || null,
  ].filter(Boolean).join(" · ");
}

function ageLabel(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Unknown";
  const hours = Math.max(0, Math.floor((Date.now() - time) / 36e5));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
