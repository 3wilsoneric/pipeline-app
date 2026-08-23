"use client";

import { ArrowRight, CircleAlert } from "lucide-react";

import { getReferralProgress } from "@/lib/pipeline/referral-progress";
import type { ReferralProgress } from "@/lib/pipeline/referral-progress";
import { normalizeOwnerName } from "@/lib/pipeline/referral-ownership";
import type { Referral } from "@/lib/pipeline/referral-types";
import {
  getWorkspaceAdmissionOutcome,
  visibleWorkspaceTags,
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
      outcome: getWorkspaceAdmissionOutcome(referral),
      visibleTags: visibleWorkspaceTags(referral.tags),
    };
  });

  return (
    <div aria-label="Referral worklist">
      <div className="divide-y divide-[#e2e2e2] lg:hidden">
        {rows.map(({ referral, progress, extractedReviewed, extractedTotal, outcome, visibleTags }) => (
          <CompactReferralRow
            key={referral.id}
            referral={referral}
            progress={progress}
            extractedReviewed={extractedReviewed}
            extractedTotal={extractedTotal}
            outcome={outcome}
            visibleTags={visibleTags}
            onOpen={() => onOpenPacket(referral)}
          />
        ))}
      </div>

      <div className="hidden overflow-x-auto lg:block">
        <div className="min-w-[920px]">
        <div className="grid grid-cols-[minmax(210px,1.2fr)_minmax(220px,1.35fr)_145px_170px_135px_90px_36px] items-center border-y border-[#d9d9d9] bg-[#fafafa] px-4 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-[#737373]">
          <span>Client</span>
          <span>Next action</span>
          <span>Admission</span>
          <span>Data capture</span>
          <span>Owner</span>
          <span>Updated</span>
          <span className="sr-only">Open</span>
        </div>
        <div className="divide-y divide-[#e2e2e2]">
          {rows.map(({ referral, progress, extractedReviewed, extractedTotal, outcome, visibleTags }) => (
            <button
              key={referral.id}
              type="button"
              onClick={() => onOpenPacket(referral)}
              aria-label={`Open ${referral.name} referral workspace`}
              className="grid w-full grid-cols-[minmax(210px,1.2fr)_minmax(220px,1.35fr)_145px_170px_135px_90px_36px] items-center px-4 py-3 text-left hover:bg-[#f7faf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73]"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#b8dacf] bg-[#effaf5] text-[10px] font-black text-[#0c705f]">
                  {getInitials(referral.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-black text-[#111111]">{referral.name}</span>
                  <span className="mt-1 block truncate text-[10px] text-[#737373]">{referral.community || "Community pending"}</span>
                  {visibleTags.length ? (
                    <span className="mt-1 block truncate text-[9px] font-semibold text-[#0c705f]" title={visibleTags.map((tag) => `#${tag}`).join(" · ")}>
                      {visibleTags.slice(0, 2).map((tag) => `#${tag}`).join(" · ")}
                      {visibleTags.length > 2 ? ` +${visibleTags.length - 2}` : ""}
                    </span>
                  ) : null}
                </span>
              </span>

              <span className="min-w-0 pr-4">
                {referral.workspaceStatus === "historical" ? (
                  <>
                    <span className="block truncate text-[11px] font-black text-[#111111]">Imported workspace</span>
                    <span className="mt-1 block truncate text-[9px] text-[#737373]">{referral.sourceProjectName || "Imported client materials"}</span>
                  </>
                ) : (
                  <>
                    <span className="flex items-start gap-2 text-[11px] font-black text-[#111111]">
                      {progress.blockers.length > 0 ? <CircleAlert size={13} className="mt-0.5 shrink-0 text-[#b07b21]" /> : null}
                      <span className="truncate">{progress.next_action || "No blocking action"}</span>
                    </span>
                    <span className="mt-1 block text-[9px] text-[#737373]">
                      {progress.blockers.length} blocker{progress.blockers.length === 1 ? "" : "s"}
                    </span>
                  </>
                )}
              </span>

              <span title={outcome.explanation}>
                <span className={outcomeClass(outcome.status)}>{outcome.label}</span>
                <span className="mt-1 block text-[8px] font-semibold uppercase tracking-[0.06em] text-[#737373]">
                  {outcome.evidence === "census_match"
                    ? "Census match"
                    : outcome.evidence === "recorded"
                      ? "Decision recorded"
                      : outcome.evidence === "no_census_match"
                        ? "No census match"
                        : "In progress"}
                </span>
                {referral.priority !== "standard" ? (
                  <span className="mt-1 block text-[8px] font-black uppercase tracking-[0.06em] text-[#a04436]">{referral.priority} priority</span>
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

              <span className="truncate text-[10px] font-semibold text-[#404040]">{normalizeOwnerName(referral.owner)}</span>
              <span className="text-[10px] text-[#737373]">
                {referral.workspaceStatus === "historical"
                  ? monthYearLabel(referral.createdAt)
                  : ageLabel(referral.updatedAt ?? referral.createdAt)}
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
  outcome,
  visibleTags,
  onOpen,
}: {
  referral: Referral;
  progress: ReferralProgress;
  extractedReviewed: number;
  extractedTotal: number;
  outcome: ReturnType<typeof getWorkspaceAdmissionOutcome>;
  visibleTags: string[];
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${referral.name} referral workspace`}
      className="block w-full px-3 py-4 text-left transition-colors hover:bg-[#f7faf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73] sm:px-4"
    >
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-black text-[#111111]">{referral.name}</span>
          <span className="mt-1 block truncate text-[10px] text-[#737373]">{referral.community || "Community pending"}</span>
          {visibleTags.length ? (
            <span className="mt-1 block truncate text-[9px] font-semibold text-[#0c705f]" title={visibleTags.map((tag) => `#${tag}`).join(" · ")}>
              {visibleTags.slice(0, 2).map((tag) => `#${tag}`).join(" · ")}
              {visibleTags.length > 2 ? ` +${visibleTags.length - 2}` : ""}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-2" title={outcome.explanation}>
          <span className={outcomeClass(outcome.status)}>{outcome.label}</span>
          <ArrowRight size={15} className="text-[#0f8b73]" />
        </span>
      </span>

      <span className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1.25fr)_minmax(170px,0.75fr)] sm:items-end">
        <span className="min-w-0">
          <span className="flex items-start gap-2 text-[11px] font-black text-[#111111]">
            {progress.blockers.length > 0 ? <CircleAlert size={13} className="mt-0.5 shrink-0 text-[#b07b21]" /> : null}
            <span className="line-clamp-2">{progress.next_action || "No blocking action"}</span>
          </span>
          <span className="mt-1 block text-[9px] text-[#737373]">
            {progress.blockers.length} blocker{progress.blockers.length === 1 ? "" : "s"}
          </span>
        </span>

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

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase();
}

function outcomeClass(status: "admitted" | "accepted" | "denied" | "pending" | "unmatched") {
  const shared = "inline-flex border px-2 py-1 text-[9px] font-black uppercase";
  if (status === "admitted") return `${shared} border-[#8fc7b7] bg-[#effaf5] text-[#0f705d]`;
  if (status === "accepted") return `${shared} border-[#9eb0d8] bg-[#f1f5ff] text-[#405b9d]`;
  if (status === "denied") return `${shared} border-[#d8aaa4] bg-[#fff3f1] text-[#8c392f]`;
  if (status === "unmatched") return `${shared} border-[#d9d9d9] bg-[#f7f7f7] text-[#595959]`;
  return `${shared} border-[#d8c58c] bg-[#fff9e8] text-[#745315]`;
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
