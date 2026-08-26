"use client";

import { ArrowRight, CircleAlert } from "lucide-react";

import { normalizeOwnerName } from "@/lib/pipeline/referral-ownership";
import { getReferralProgress, type ReferralProgress, type ReferralProgressPhase } from "@/lib/pipeline/referral-progress";
import type { Referral } from "@/lib/pipeline/referral-types";

type WorkflowRow = {
  referral: Referral;
  progress: ReferralProgress;
};

const phases: Array<{ key: ReferralProgressPhase; label: string }> = [
  { key: "pre", label: "Intake" },
  { key: "assessment", label: "Assessment" },
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
  const lanes = phases.map((phase) => ({
    ...phase,
    rows: sortWorkflowRows(rows.filter((row) => row.progress.phase === phase.key)),
  }));

  return (
    <section aria-label="Referral workflow tracker" className="min-w-0 bg-white">
      <div className="grid min-w-0 border-y border-[#d9d9d9] bg-[#d9d9d9] md:grid-cols-2 md:gap-px">
        {lanes.map((lane) => (
          <section
            key={lane.key}
            aria-label={`${lane.label} referral workspaces`}
            className="min-w-0 bg-[#fafafa]"
          >
            <div className={`flex min-h-12 items-center justify-between border-t-[3px] bg-white px-3 ${laneBorderClass(lane.key)}`}>
              <h3 className={`text-[11px] font-black uppercase tracking-[0.1em] ${laneTextClass(lane.key)}`}>
                {lane.label}
              </h3>
              <span className="min-w-6 text-right text-[11px] font-black tabular-nums text-[#595959]">
                {lane.rows.length}
              </span>
            </div>

            {lane.rows.length > 0 ? (
              <div className="space-y-2 border-t border-[#e2e2e2] p-2.5">
                {lane.rows.map(({ referral, progress }) => (
                  <WorkflowCard
                    key={referral.id}
                    referral={referral}
                    progress={progress}
                    onOpen={() => onOpenPacket(referral)}
                  />
                ))}
              </div>
            ) : (
              <div className="border-t border-[#e2e2e2] px-3 py-8 text-center text-[10px] font-semibold text-[#737373] md:min-h-28">
                {loading ? "Loading workspaces" : `No workspaces in ${lane.label.toLowerCase()}`}
              </div>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

function WorkflowCard({
  referral,
  progress,
  onOpen,
}: {
  referral: Referral;
  progress: ReferralProgress;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${referral.name} referral workspace`}
      className="group block w-full border border-[#d9d9d9] bg-white p-3 text-left shadow-[0_1px_0_rgba(0,0,0,0.03)] transition hover:border-[#9fcfc2] hover:shadow-[0_3px_10px_rgba(15,139,115,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73]"
    >
      <span className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-black text-[#111111]">{referral.name}</span>
          <span className="mt-1 block truncate text-[10px] text-[#737373]">
            {referral.community || "Community pending"}
            {referral.priority !== "standard" ? ` · ${capitalize(referral.priority)}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-[9px] font-semibold text-[#737373]">
          {ageLabel(referral.updatedAt ?? referral.createdAt)}
        </span>
      </span>

      <span className="mt-3 flex items-center justify-between gap-3">
        <span className="truncate text-[9px] font-black uppercase tracking-[0.05em] text-[#404040]">
          {progress.overall.complete} of {progress.overall.total} data items complete
        </span>
        <span className="shrink-0 text-[9px] font-black tabular-nums text-[#0c705f]">
          {progress.overall.percent}%
        </span>
      </span>
      <span className="mt-1.5 block h-1.5 overflow-hidden bg-[#e4e7e5]">
        <span
          className={`block h-full ${progressBarClass(progress.phase)}`}
          style={{ width: `${progress.overall.percent}%` }}
        />
      </span>

      <span className="mt-3 flex min-h-8 min-w-0 items-start gap-2 text-[10px] leading-4 text-[#404040]">
        {progress.blockers.length > 0 ? <CircleAlert size={12} className="mt-0.5 shrink-0 text-[#a66a12]" /> : null}
        <span className="line-clamp-2">
          {progress.next_action ? progress.next_action : "No next action"}
        </span>
      </span>

      <span className="mt-3 flex items-center border-t border-[#ececec] pt-2.5">
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-[#404040]">
          {normalizeOwnerName(referral.owner)}
        </span>
        <span className={`mr-2 shrink-0 text-[9px] font-semibold ${progress.blockers.length > 0 ? "text-[#8a5a10]" : "text-[#737373]"}`}>
          {progress.blockers.length > 0
            ? `${progress.blockers.length} blocker${progress.blockers.length === 1 ? "" : "s"}`
            : "Ready"}
        </span>
        <ArrowRight size={14} className="shrink-0 text-[#0f8b73] transition-transform group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

function sortWorkflowRows(rows: WorkflowRow[]) {
  const priorityRank: Record<Referral["priority"], number> = { urgent: 0, high: 1, standard: 2 };
  return [...rows].sort((left, right) => {
    const priority = priorityRank[left.referral.priority] - priorityRank[right.referral.priority];
    if (priority !== 0) return priority;
    if (left.progress.action_required !== right.progress.action_required) return left.progress.action_required ? -1 : 1;
    if (left.progress.blockers.length !== right.progress.blockers.length) {
      return right.progress.blockers.length - left.progress.blockers.length;
    }
    return timestamp(left.referral.updatedAt ?? left.referral.createdAt) - timestamp(right.referral.updatedAt ?? right.referral.createdAt);
  });
}

function laneBorderClass(phase: ReferralProgressPhase) {
  if (phase === "assessment") return "border-[#cf8b24]";
  return "border-[#0f8b73]";
}

function laneTextClass(phase: ReferralProgressPhase) {
  if (phase === "assessment") return "text-[#9b6111]";
  return "text-[#0c705f]";
}

function progressBarClass(phase: ReferralProgressPhase) {
  if (phase === "assessment") return "bg-[#cf8b24]";
  return "bg-[#0f8b73]";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function timestamp(value: string) {
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : Number.MAX_SAFE_INTEGER;
}

function ageLabel(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Unknown";
  const hours = Math.max(0, Math.floor((Date.now() - time) / 36e5));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
