"use client";

import { ArrowRight, FileText, History, UserRound } from "lucide-react";

import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import { normalizeOwnerName } from "@/lib/pipeline/referral-ownership";
import type { ReferralProgress } from "@/lib/pipeline/referral-progress";
import type { Referral } from "@/lib/pipeline/referral-types";
import { resolveReferralWorkflowStatus, workflowStatusLabels } from "@/lib/pipeline/workflow-status";
import { getWorkspaceAdmissionOutcome, getWorkspaceCounty } from "@/lib/pipeline/workspace-presentation";

export default function ReferralWorkspaceGallery({
  referrals,
  progressByReferral = {},
  onOpenPacket,
}: {
  referrals: Referral[];
  progressByReferral?: Record<number, ReferralProgress>;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  return (
    <div role="region" aria-label="Workspace gallery" className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {referrals.map((referral) => (
        <WorkspaceCard
          key={referral.id}
          referral={referral}
          progress={progressByReferral[referral.id]}
          onOpen={() => onOpenPacket(referral)}
        />
      ))}
    </div>
  );
}

function WorkspaceCard({
  referral,
  progress,
  onOpen,
}: {
  referral: Referral;
  progress?: ReferralProgress;
  onOpen: () => void;
}) {
  const historical = referral.workspaceStatus === "historical";
  const workflowStatus = referral.workflowStatus ?? resolveReferralWorkflowStatus(referral);
  const workflowLabel = workflowStatusLabels[workflowStatus];
  const outcome = getWorkspaceAdmissionOutcome(referral);
  const identityTitle = formatClientIdentityTitle(referral);
  const county = getWorkspaceCounty(referral);
  const reviewed = referral.packetFields?.filter((field) => ["accepted", "edited"].includes(field.review_status)).length ?? 0;
  const extracted = referral.packetFields?.length ?? 0;
  const percent = progress?.overall.percent ?? 0;
  const owner = normalizeOwnerName(referral.owner);

  return (
    <button
      type="button"
      data-guide-target="workspace-results"
      onClick={onOpen}
      aria-label={`Open ${identityTitle} referral workspace`}
      className="group min-w-0 overflow-hidden border border-[#d9dfdc] bg-white text-left outline-none transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[#80ae9f] hover:shadow-[0_10px_24px_rgba(25,55,45,0.09)] focus-visible:ring-2 focus-visible:ring-[#0f8b73]"
    >
      <span aria-hidden="true" className="relative block min-h-[132px] overflow-hidden border-b border-[#dfe5e2] bg-[#f4f8f6] px-4 py-4">
        <span className="flex items-start justify-between gap-3">
          <span className="inline-flex min-h-6 items-center border border-[#9bc7ba] bg-white px-2 text-[9px] font-black uppercase tracking-[0.08em] text-[#0c705f]">
            {historical ? "Historical chart" : workflowLabel}
          </span>
          <span className={`text-[10px] font-black ${outcomeClass(outcome.status)}`}>{outcome.label}</span>
        </span>

        {historical ? (
          <span className="mt-5 grid grid-cols-[36px_minmax(0,1fr)] items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center border border-[#cbd8d3] bg-white text-[#527268]"><History size={16} /></span>
            <span>
              <strong className="block text-[18px] font-black tabular-nums text-[#202823]">{referral.sourceMaterialCount ?? 0}</strong>
              <span className="block text-[9px] font-bold uppercase tracking-[0.08em] text-[#6d7772]">Imported source materials</span>
            </span>
          </span>
        ) : (
          <>
            <span className="mt-5 flex items-end justify-between gap-4">
              <span>
                <strong className="block text-[24px] font-black leading-none tabular-nums text-[#17211d]">{percent}%</strong>
                <span className="mt-1 block text-[9px] font-bold uppercase tracking-[0.08em] text-[#6d7772]">Data capture</span>
              </span>
              <span className="text-right text-[9px] font-bold leading-4 text-[#6d7772]">
                {progress ? `${progress.overall.complete}/${progress.overall.total} complete` : "Progress pending"}<br />
                {extracted > 0 ? `${reviewed}/${extracted} extracted reviewed` : "No extracted values"}
              </span>
            </span>
            <span className="mt-3 block h-2 bg-[#dfe7e3]">
              <span className="block h-full bg-[#0f8b73] transition-[width]" style={{ width: `${percent}%` }} />
            </span>
            <span className="mt-3 grid grid-cols-4 gap-1">
              {(progress?.sections ?? []).slice(0, 4).map((section) => (
                <span key={section.key} className="block h-1.5 bg-[#d8e2de]">
                  <span className="block h-full bg-[#5e9c89]" style={{ width: `${section.percent}%` }} />
                </span>
              ))}
            </span>
          </>
        )}
      </span>

      <span className="block px-4 py-3.5">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <strong className="block truncate text-[14px] font-black text-[#111111]" title={identityTitle}>{identityTitle}</strong>
            <span className="mt-1 block truncate text-[10px] font-medium text-[#68716c]">
              {[referral.community, county].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center text-[#0f8b73] transition-transform group-hover:translate-x-0.5"><ArrowRight size={16} /></span>
        </span>
        <span className="mt-3 flex items-center justify-between gap-3 border-t border-[#e7ebe8] pt-2.5 text-[10px] text-[#68716c]">
          <span className="flex min-w-0 items-center gap-1.5"><UserRound size={12} className="shrink-0" /><span className="truncate font-bold text-[#3f4843]">{owner}</span></span>
          <span className="flex shrink-0 items-center gap-1.5"><FileText size={12} />{historical ? `${referral.sourceMaterialCount ?? 0} materials` : `${workspaceFileCount(referral)} files`}</span>
          <time className="shrink-0" dateTime={referral.updatedAt ?? referral.createdAt}>{ageLabel(referral.updatedAt ?? referral.createdAt)}</time>
        </span>
      </span>
    </button>
  );
}

function workspaceFileCount(referral: Referral) {
  const attachmentCount = referral.requirements?.filter((requirement) => requirement.evidenceDocumentId).length ?? 0;
  return attachmentCount + (referral.documentName ? 1 : 0) + (referral.assessmentDocumentName ? 1 : 0);
}

function ageLabel(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "Updated";
  const hours = Math.max(0, Math.floor((Date.now() - time) / 36e5));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function outcomeClass(status: "admitted" | "accepted" | "denied" | "pending" | "unmatched") {
  if (status === "admitted") return "text-[#0f705d]";
  if (status === "accepted") return "text-[#405b9d]";
  if (status === "denied") return "text-[#8c392f]";
  return "text-[#6b5a2a]";
}
