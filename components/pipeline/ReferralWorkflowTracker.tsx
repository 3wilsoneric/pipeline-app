"use client";

import { ArrowRight, CircleAlert } from "lucide-react";

import { normalizeOwnerName } from "@/lib/pipeline/referral-ownership";
import { getReferralProgress, type ReferralProgress, type ReferralProgressPhase } from "@/lib/pipeline/referral-progress";
import { getStageLabel } from "@/lib/pipeline/referral-workflow";
import type { Referral } from "@/lib/pipeline/referral-types";

const phases: Array<{ key: ReferralProgressPhase; label: string }> = [
  { key: "pre", label: "Pre" },
  { key: "assessment", label: "Assessment" },
  { key: "post", label: "Post" },
];

export default function ReferralWorkflowTracker({
  referrals,
  progressByReferral = {},
  loading,
  onOpenPacket,
}: {
  referrals: Referral[];
  progressByReferral?: Record<number, ReferralProgress>;
  loading: boolean;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void;
}) {
  const rows = referrals.map((referral) => ({
    referral,
    progress: progressByReferral[referral.id] ?? getReferralProgress(referral),
  }));

  return (
    <section aria-label="Referral workflow tracker" className="min-w-0 bg-white">
      <div className="hidden grid-cols-[minmax(180px,0.9fr)_minmax(320px,1.5fr)_130px_82px_34px] items-center border-y border-[#d9d9d9] bg-[#fafafa] px-4 py-2 text-[9px] font-black uppercase tracking-[0.1em] text-[#737373] xl:grid">
        <span>Workspace</span>
        <span>Workflow</span>
        <span>Owner</span>
        <span>Updated</span>
        <span className="sr-only">Open</span>
      </div>

      {rows.length > 0 ? (
        <div className="divide-y divide-[#e2e2e2]">
          {rows.map(({ referral, progress }) => (
            <button
              key={referral.id}
              type="button"
              onClick={() => onOpenPacket(referral)}
              aria-label={`Open ${referral.name} referral workspace`}
              className="grid w-full grid-cols-[minmax(0,1fr)_34px] items-center gap-x-3 gap-y-3 px-4 py-4 text-left hover:bg-[#f7faf9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73] xl:grid-cols-[minmax(180px,0.9fr)_minmax(320px,1.5fr)_130px_82px_34px] xl:gap-x-0 xl:py-3"
            >
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-black text-[#111111]">{referral.name}</span>
                <span className="mt-1 block truncate text-[10px] text-[#737373]">
                  {referral.community || "Community pending"}
                  {referral.priority !== "standard" ? ` · ${capitalize(referral.priority)}` : ""}
                </span>
                {referral.tags?.length ? (
                  <span className="mt-1 block truncate text-[9px] font-semibold text-[#0c705f]" title={referral.tags.map((tag) => `#${tag}`).join(" · ")}>
                    {referral.tags.slice(0, 2).map((tag) => `#${tag}`).join(" · ")}
                    {referral.tags.length > 2 ? ` +${referral.tags.length - 2}` : ""}
                  </span>
                ) : null}
              </span>

              <span className="col-span-2 min-w-0 xl:col-span-1 xl:pr-7">
                <WorkflowRail phase={progress.phase} name={referral.name} />
                <span className="mt-2 flex min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.06em] text-[#404040]">
                    {getStageLabel(referral.stage)}
                  </span>
                  <span className="h-px min-w-3 flex-1 bg-[#e2e2e2]" />
                  <span className="shrink-0 text-[9px] font-black text-[#0c705f]">{progress.overall.percent}% complete</span>
                </span>
                {progress.next_action ? (
                  <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[10px] text-[#595959]">
                    {progress.blockers.length > 0 ? <CircleAlert size={11} className="shrink-0 text-[#a66a12]" /> : null}
                    <span className="truncate">Next: {progress.next_action}</span>
                  </span>
                ) : null}
              </span>

              <span className="hidden min-w-0 xl:block">
                <span className="block truncate text-[10px] font-semibold text-[#404040]">{normalizeOwnerName(referral.owner)}</span>
                <span className="mt-1 block text-[9px] text-[#737373]">
                  {progress.blockers.length > 0
                    ? `${progress.blockers.length} blocker${progress.blockers.length === 1 ? "" : "s"}`
                    : "No blockers"}
                </span>
              </span>

              <span className="hidden text-[10px] text-[#737373] xl:block">{ageLabel(referral.updatedAt ?? referral.createdAt)}</span>
              <span className="col-start-2 row-start-1 flex h-8 w-8 items-center justify-center text-[#0f8b73] xl:col-start-5 xl:row-auto">
                <ArrowRight size={15} />
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-5 py-16 text-center">
          <div className="text-[15px] font-black text-[#111111]">
            {loading ? "Loading active workspaces" : "No active workspaces"}
          </div>
          {!loading ? (
            <p className="mx-auto mt-2 max-w-[420px] text-[12px] leading-5 text-[#737373]">
              New referral workspaces will appear here and stay visible until an admission decision closes them.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function WorkflowRail({ phase, name }: { phase: ReferralProgressPhase; name: string }) {
  const currentIndex = phases.findIndex((entry) => entry.key === phase);

  return (
    <span className="grid grid-cols-3 gap-1" aria-label={`${name} workflow phase: ${phases[currentIndex]?.label ?? "Pre"}`}>
      {phases.map((entry, index) => {
        const state = index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";
        return (
          <span key={entry.key} className="min-w-0">
            <span className={`block h-1.5 ${phaseBarClass(entry.key, state)}`} />
            <span className={`mt-1 block truncate text-[9px] font-black uppercase tracking-[0.04em] ${phaseLabelClass(entry.key, state)}`}>
              {entry.label}
            </span>
          </span>
        );
      })}
    </span>
  );
}

function phaseBarClass(phase: ReferralProgressPhase, state: "complete" | "current" | "upcoming") {
  if (state === "complete") return "bg-[#53605c]";
  if (state === "upcoming") return "bg-[#e4e7e5]";
  if (phase === "assessment") return "bg-[#cf8b24]";
  if (phase === "post") return "bg-[#4d69ae]";
  return "bg-[#0f8b73]";
}

function phaseLabelClass(phase: ReferralProgressPhase, state: "complete" | "current" | "upcoming") {
  if (state === "complete") return "text-[#53605c]";
  if (state === "upcoming") return "text-[#737373]";
  if (phase === "assessment") return "text-[#9b6111]";
  if (phase === "post") return "text-[#405b9d]";
  return "text-[#0c705f]";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
