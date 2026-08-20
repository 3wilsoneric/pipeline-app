"use client";

import { useEffect, useState } from "react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type {
  ReferralActivityEvent,
  ReferralWorkflowMetadata,
} from "@/lib/pipeline/referral-activity";

export default function ReferralActivityPanel({ referralId, version }: { referralId?: number; version?: number }) {
  const [events, setEvents] = useState<ReferralActivityEvent[]>([]);
  const [metadata, setMetadata] = useState<ReferralWorkflowMetadata | null>(null);

  useEffect(() => {
    if (!referralId) return;
    let cancelled = false;
    fetchPipelineJson<{ events: ReferralActivityEvent[]; metadata: ReferralWorkflowMetadata }>(`/api/referrals/${referralId}/activity`, { cache: "no-store" })
      .then((payload) => {
        if (!cancelled) {
          setEvents(payload.events ?? []);
          setMetadata(payload.metadata ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEvents([]);
          setMetadata(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [referralId, version]);

  if (!referralId || !metadata) return null;

  return (
    <section aria-label="Referral ownership and activity" className="mt-5 border-t border-[#d9d9d9] pt-5">
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#0f8b73]">Ownership and timing</div>
      <div className="mt-3 grid gap-px border-y border-[#d9d9d9] bg-[#d9d9d9] sm:grid-cols-2 xl:grid-cols-4">
        <WorkflowFact
          label="Owner"
          value={metadata.owner?.name ?? "Unassigned"}
          detail={metadata.created_by ? `Created by ${metadata.created_by.name}` : "Assign an owner"}
          attention={!metadata.owner}
        />
        <WorkflowFact
          label="Last touched"
          value={metadata.last_changed_by?.name ?? "No activity"}
          detail={metadata.last_changed_at ? formatTimestamp(metadata.last_changed_at) : "Not recorded"}
        />
        <WorkflowFact
          label="Assessment time"
          value={metadata.assessment.elapsed_minutes === null ? "Not started" : formatDuration(metadata.assessment.elapsed_minutes)}
          detail={assessmentDetail(metadata)}
        />
        <WorkflowFact
          label={metadata.timing.decision_recorded ? "Referral to decision" : "Referral open"}
          value={formatDuration(metadata.timing.total_minutes)}
          detail={metadata.timing.referral_to_assessment_minutes === null
            ? "Assessment not started"
            : `${formatDuration(metadata.timing.referral_to_assessment_minutes)} to assessment`}
        />
      </div>

      {metadata.contributors.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px]">
          <span className="font-black uppercase tracking-[0.08em] text-[#737373]">Contributors</span>
          {metadata.contributors.map((contributor) => (
            <span key={contributor.id ?? contributor.name} className="text-[#404040]">
              {contributor.name} <span className="text-[#8a8a8a]">({contributor.event_count})</span>
            </span>
          ))}
        </div>
      ) : null}

      {events.length > 0 ? (
        <div className="mt-5">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#0f8b73]">Recent changes</div>
          <div className="mt-3 divide-y divide-[#eeeeee] border-y border-[#d9d9d9]">
            {events.slice(0, 8).map((event) => (
              <div key={event.event_id} className="grid gap-1 py-2 text-[11px] sm:grid-cols-[minmax(0,1fr)_180px_150px] sm:gap-4">
                <span className="font-black text-[#111111]">{formatAction(event.action)}</span>
                <span className="text-[#595959]">{event.actor_name}</span>
                <time className="text-[#737373] sm:text-right" dateTime={event.created_at}>{formatTimestamp(event.created_at)}</time>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function WorkflowFact({
  label,
  value,
  detail,
  attention = false,
}: {
  label: string;
  value: string;
  detail: string;
  attention?: boolean;
}) {
  return (
    <div className="min-w-0 bg-white px-4 py-3">
      <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#737373]">{label}</div>
      <div className={`mt-1 truncate text-[14px] font-black ${attention ? "text-[#a63d2f]" : "text-[#111111]"}`}>{value}</div>
      <div className="mt-1 truncate text-[10px] text-[#737373]">{detail}</div>
    </div>
  );
}

function assessmentDetail(metadata: ReferralWorkflowMetadata) {
  const assessment = metadata.assessment;
  if (assessment.status === "not_started") return "No assessment record";
  const owner = assessment.assessor?.name ? ` · ${assessment.assessor.name}` : "";
  if (assessment.status === "complete") return `Completed${owner}`;
  return `${assessment.status.replaceAll("_", " ")}${owner}`;
}

function formatAction(action: string) {
  return action.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDuration(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(minutes));
  if (safeMinutes < 60) return `${safeMinutes}m`;
  if (safeMinutes < 48 * 60) {
    const hours = Math.floor(safeMinutes / 60);
    const remainder = safeMinutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  }
  const days = Math.floor(safeMinutes / (24 * 60));
  const hours = Math.floor((safeMinutes % (24 * 60)) / 60);
  return hours ? `${days}d ${hours}h` : `${days}d`;
}
