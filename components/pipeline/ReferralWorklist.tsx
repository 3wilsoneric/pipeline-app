"use client";

import { ArrowRight } from "lucide-react";

import { getReferralProgress } from "@/lib/pipeline/referral-progress";
import type { ReferralProgress } from "@/lib/pipeline/referral-progress";
import { normalizeOwnerName } from "@/lib/pipeline/referral-ownership";
import {
  formatClientIdentityTitle,
  resolveClientCommunity,
  resolveClientGender,
} from "@/lib/pipeline/client-identity-presentation.mjs";
import type { Referral } from "@/lib/pipeline/referral-types";
import {
  getWorkspaceAdmissionOutcome,
  getWorkspaceCounty,
  isRecordedWorkspaceCommunity,
} from "@/lib/pipeline/workspace-presentation";

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
    const extractedTotal = referral.packetFields?.length ?? 0;
    const extractedReviewed = referral.packetFields?.filter((field) => ["accepted", "edited"].includes(field.review_status)).length ?? 0;
    return {
      referral,
      progress,
      extractedTotal,
      extractedReviewed,
      identityTitle: formatClientIdentityTitle(referral),
      outcome: getWorkspaceAdmissionOutcome(referral),
      county: getWorkspaceCounty(referral),
    };
  });

  return (
    <div role="region" aria-label="Referral worklist">
      <div className="divide-y divide-[#e2e2e2] lg:hidden">
        {rows.map(({ referral, progress, extractedReviewed, extractedTotal, identityTitle, outcome, county }) => (
          <CompactReferralRow
            key={referral.id}
            referral={referral}
            progress={progress}
            extractedReviewed={extractedReviewed}
            extractedTotal={extractedTotal}
            identityTitle={identityTitle}
            outcome={outcome}
            county={county}
            onOpen={() => onOpenPacket(referral)}
          />
        ))}
      </div>

      <div className="hidden overflow-x-auto lg:block">
        <div className="min-w-[820px]">
        <div className="grid grid-cols-[minmax(260px,1.65fr)_170px_135px_90px_110px_36px] items-center border-y border-[#d9d9d9] bg-[#fafafa] px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.08em] text-[#666666]">
          <span>Client</span>
          <span>Data capture</span>
          <span>Owner</span>
          <span>Updated</span>
          <span className="text-right">Admission</span>
          <span className="sr-only">Open</span>
        </div>
        <div className="divide-y divide-[#e2e2e2]">
          {rows.map(({ referral, progress, extractedReviewed, extractedTotal, identityTitle, outcome, county }) => (
            <button
              key={referral.id}
              type="button"
              data-guide-target="workspace-results"
              onClick={() => onOpenPacket(referral)}
              aria-label={`Open ${identityTitle} referral workspace`}
              className="grid w-full grid-cols-[minmax(260px,1.65fr)_170px_135px_90px_110px_36px] items-center px-4 py-3.5 text-left hover:bg-[#f7faf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73]"
            >
              <span className="min-w-0 pr-4">
                <span className="block truncate text-[13px] font-bold text-[#111111]" title={identityTitle}>{identityTitle}</span>
                {workspaceIdentityDetail(referral, county) ? (
                  <span className="mt-1 block truncate text-[9px] text-[#737373]">{workspaceIdentityDetail(referral, county)}</span>
                ) : null}
                {referral.priority !== "standard" ? (
                  <span className="mt-1 block text-[9px] font-semibold text-[#8c392f]">{referral.priority} priority</span>
                ) : null}
              </span>

              <span className="pr-5">
                {referral.workspaceStatus === "historical" ? (
                  <>
                    <span className="block text-[12px] font-black text-[#111111]">{referral.sourceMaterialCount ?? 0}</span>
                    <span className="mt-1 block text-[9px] text-[#737373]">material{referral.sourceMaterialCount === 1 ? "" : "s"}</span>
                  </>
                ) : (
                  <>
                    <span className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="font-black text-[#111111]">{progress.overall.percent}%</span>
                      <span className="text-[#737373]">{progress.overall.complete}/{progress.overall.total}</span>
                    </span>
                    <span className="mt-1.5 block h-1.5 bg-[#e5e9e6]">
                      <span className="block h-full bg-[#0f8b73]" style={{ width: `${progress.overall.percent}%` }} />
                    </span>
                    {extractedTotal > 0 ? (
                      <span className="mt-1 block text-[9px] text-[#737373]">{extractedReviewed}/{extractedTotal} extracted values reviewed</span>
                    ) : null}
                  </>
                )}
              </span>

              <span className="truncate text-[11px] font-semibold text-[#404040]">{normalizeOwnerName(referral.owner)}</span>
              <span className="text-[11px] text-[#737373]">
                {referral.workspaceStatus === "historical"
                  ? monthYearLabel(referral.createdAt)
                  : ageLabel(referral.updatedAt ?? referral.createdAt)}
              </span>
              <span className={`text-right text-[11px] ${outcomeTextClass(outcome.status)}`} title={outcome.explanation}>
                {outcome.label}
              </span>
              <span className="flex h-8 w-8 items-center justify-center text-[#0f8b73]"><ArrowRight size={15} /></span>
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
  extractedReviewed,
  extractedTotal,
  identityTitle,
  outcome,
  county,
  onOpen,
}: {
  referral: Referral;
  progress: ReferralProgress;
  extractedReviewed: number;
  extractedTotal: number;
  identityTitle: string;
  outcome: ReturnType<typeof getWorkspaceAdmissionOutcome>;
  county: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-guide-target="workspace-results"
      onClick={onOpen}
      aria-label={`Open ${identityTitle} referral workspace`}
      className="block w-full px-3 py-4 text-left transition-colors hover:bg-[#f7faf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73] sm:px-4"
    >
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-bold text-[#111111]" title={identityTitle}>{identityTitle}</span>
          {workspaceIdentityDetail(referral, county) ? (
            <span className="mt-1 block truncate text-[10px] text-[#737373]">{workspaceIdentityDetail(referral, county)}</span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-2" title={outcome.explanation}>
          <span className={`text-[11px] ${outcomeTextClass(outcome.status)}`}>{outcome.label}</span>
          <ArrowRight size={15} className="text-[#0f8b73]" />
        </span>
      </span>

      <span className="mt-3 block">
        <span>
          <span className="flex items-center justify-between gap-3 text-[10px]">
            <span className="font-black text-[#111111]">Data capture</span>
            <span className="text-[#737373]">{progress.overall.percent}% · {progress.overall.complete}/{progress.overall.total}</span>
          </span>
          <span className="mt-1.5 block h-1.5 bg-[#e5e9e6]">
            <span className="block h-full bg-[#0f8b73]" style={{ width: `${progress.overall.percent}%` }} />
          </span>
          {extractedTotal > 0 ? (
            <span className="mt-1 block text-[9px] text-[#737373]">{extractedReviewed}/{extractedTotal} extracted values reviewed</span>
          ) : null}
        </span>
      </span>

      <span className="mt-3 flex items-center justify-between gap-3 border-t border-[#ececec] pt-2.5 text-[10px]">
        <span className="truncate font-semibold text-[#404040]">{normalizeOwnerName(referral.owner)}</span>
        <span className="shrink-0 text-[#737373]">{ageLabel(referral.updatedAt ?? referral.createdAt)}</span>
      </span>
    </button>
  );
}

function outcomeTextClass(status: "admitted" | "accepted" | "denied" | "pending" | "unmatched") {
  if (status === "admitted") return "font-semibold text-[#0f705d]";
  if (status === "accepted") return "font-semibold text-[#405b9d]";
  if (status === "denied") return "font-semibold text-[#8c392f]";
  if (status === "unmatched") return "font-normal text-[#737373]";
  return "font-normal text-[#6b5a2a]";
}

function workspaceIdentityDetail(referral: Referral, county = "") {
  return [
    resolveClientGender(referral.gender),
    isRecordedWorkspaceCommunity(referral.community) ? resolveClientCommunity(referral.community) : null,
    county || null,
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

function monthYearLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Imported";
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}
