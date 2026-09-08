"use client";

import { useEffect, useState } from "react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type {
  ReferralActivityEvent,
  ReferralWorkflowMetadata,
} from "@/lib/pipeline/referral-activity";

type ReferralActivityPanelProps = {
  referralId?: number;
  version?: number;
  compact?: boolean;
  onOpenFull?: () => void;
};

export default function ReferralActivityPanel({
  referralId,
  version,
  compact = false,
  onOpenFull,
}: ReferralActivityPanelProps) {
  const [result, setResult] = useState<{
    referralId: number;
    events: ReferralActivityEvent[];
    metadata: ReferralWorkflowMetadata | null;
    error: boolean;
  } | null>(null);

  useEffect(() => {
    if (!referralId) return;
    let cancelled = false;
    fetchPipelineJson<{ events: ReferralActivityEvent[]; metadata: ReferralWorkflowMetadata }>(`/api/referrals/${referralId}/activity`, { cache: "no-store" })
      .then((payload) => {
        if (!cancelled) {
          setResult({
            referralId,
            events: payload.events ?? [],
            metadata: payload.metadata ?? null,
            error: false,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResult({ referralId, events: [], metadata: null, error: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [referralId, version]);

  if (!referralId) {
    return <ActivityState title="No activity yet" detail="Create this workspace to begin its ownership and change history." />;
  }
  if (!result || result.referralId !== referralId) {
    return <ActivityState title="Loading activity" detail="Fetching the latest ownership and timing history." busy />;
  }
  if (result.error || !result.metadata) {
    return <ActivityState title="Activity could not be loaded" detail="Return to Intake and try opening Activity again." />;
  }
  const { events, metadata } = result;

  return <ActivityContent compact={compact} events={events} metadata={metadata} onOpenFull={onOpenFull} />;
}

function ActivityContent({
  compact,
  events,
  metadata,
  onOpenFull,
}: {
  compact: boolean;
  events: ReferralActivityEvent[];
  metadata: ReferralWorkflowMetadata;
  onOpenFull?: () => void;
}) {
  if (compact) return <CompactActivity events={events} onOpenFull={onOpenFull} />;
  return <FullActivity events={events} metadata={metadata} />;
}

function CompactActivity({
  events,
  onOpenFull,
}: {
  events: ReferralActivityEvent[];
  onOpenFull?: () => void;
}) {
  return (
    <section aria-label="Workspace change history" className="bg-white py-1.5">
      <div className="flex items-center justify-between gap-3 text-[10px] text-[#737373]">
        <span>
          <span className="font-semibold text-[#404040]">Change history</span>
          <span aria-hidden="true"> · </span>
          {events.length} change{events.length === 1 ? "" : "s"}
        </span>
        {onOpenFull ? (
          <button type="button" onClick={onOpenFull} className="font-semibold text-[#0f705f] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73]">
            View<span className="sr-only"> change history</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}

function FullActivity({ events, metadata }: { events: ReferralActivityEvent[]; metadata: ReferralWorkflowMetadata }) {
  return (
    <section aria-label="Referral ownership and activity" className="py-2 sm:px-2">
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#0f8b73]">Ownership and timing</div>
      <div className="mt-3 grid gap-px border-y border-[#d9d9d9] bg-[#d9d9d9] sm:grid-cols-2 xl:grid-cols-4">
        <WorkflowFact
          label="Owners"
          value={ownerNames(metadata) || "Unassigned"}
          detail={metadata.owner ? `Primary assignee ${metadata.owner.name}` : metadata.created_by ? `Created by ${metadata.created_by.name}` : "Assign an owner"}
          attention={metadata.owners.length === 0}
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
          label="Referral age"
          value={formatDuration(metadata.timing.total_minutes)}
          detail={metadata.timing.referral_to_assessment_minutes === null
            ? "Assessment not started"
            : `${formatDuration(metadata.timing.referral_to_assessment_minutes)} to assessment`}
        />
      </div>

      <WorkspaceOwners owners={metadata.owners} />

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
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#0f8b73]">Recent changes</div>
            <div className="text-[10px] text-[#737373]">{events.length === 100 ? "Latest 100 recorded events" : `${events.length} recorded event${events.length === 1 ? "" : "s"}`}</div>
          </div>
          <div className="mt-3 divide-y divide-[#eeeeee] border-y border-[#d9d9d9]">
            {events.map((event) => (
              <div key={event.event_id} className="py-3 text-[11px]">
                <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_180px_150px] sm:gap-4">
                  <span className="font-black text-[#111111]">{formatAction(event.action)}</span>
                  <span className="text-[#595959]">{event.actor_name}</span>
                  <time className="text-[#737373] sm:text-right" dateTime={event.created_at}>{formatTimestamp(event.created_at)}</time>
                </div>
                {event.reason ? <div className="mt-1 text-[10px] text-[#595959]"><span className="font-black">Reason:</span> {event.reason}</div> : null}
                {event.changes.length > 0 ? (
                  <div className="mt-2 space-y-1 border-l-2 border-[#dfe7e3] pl-2">
                    {event.changes.map((change) => (
                      <div key={change.field} className="grid gap-0.5 text-[10px] sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3">
                        <span className="font-black text-[#595959]">{change.label}</span>
                        <span className="min-w-0 break-words text-[#737373]">
                          {change.masked
                            ? "Value changed (masked)"
                            : change.values_available
                              ? <><span>{change.before}</span> <span aria-hidden="true">→</span> <span>{change.after}</span></>
                              : "Change recorded; historical values unavailable"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ownerNames(metadata: ReferralWorkflowMetadata) {
  return metadata.owners.map((owner) => owner.name).join(", ");
}

function WorkspaceOwners({ owners }: { owners: ReferralWorkflowMetadata["owners"] }) {
  if (owners.length === 0) return null;
  return (
    <div role="group" aria-label="Workspace owners" className="mt-3 flex flex-wrap gap-2">
      {owners.map((owner) => (
        <div key={owner.id} className="border border-[#d9d9d9] bg-[#fbfcfb] px-2.5 py-1.5 text-[10px]">
          <span className="font-black text-[#111111]">{owner.name}</span>
          <span className="ml-1.5 text-[#737373]">{owner.responsibilities.map(formatAction).join(", ")}</span>
        </div>
      ))}
    </div>
  );
}

function ActivityState({ title, detail, busy = false }: { title: string; detail: string; busy?: boolean }) {
  return (
    <section aria-label="Referral ownership and activity" className="px-3 py-12 text-center sm:px-6" aria-busy={busy}>
      <div className="text-[13px] font-black text-[#111111]">{title}</div>
      <p className="mx-auto mt-2 max-w-md text-[11px] leading-5 text-[#737373]">{detail}</p>
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
