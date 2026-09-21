"use client";

import { useConfirmationDialog } from "./useConfirmationDialog";

import { useEffect, useState } from "react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { ReferralActivityEvent, ReferralWorkflowMetadata } from "@/lib/pipeline/referral-activity";
import { workflowStatusLabels } from "@/lib/pipeline/workflow-status";

type ReferralActivityPanelProps = { referralId?: number; version?: number };

// Routine saves stay in detailed history; unfamiliar events remain visible.
const routineActions = new Set(["referral_updated", "assessment_updated", "work_item_updated", "extraction_confirmed"]);
const importantFields = new Set(["owner", "ownerId", "owners", "stage", "workflowStatus", "admissionDate", "admissionDecision", "priority", "assessmentRecommendation", "ehrHandoff", "workspaceStatus", "documentName", "outcome"]);
const summaryFields = new Set(["owner", "stage", "workflowStatus", "admissionDate", "outcome", "priority"]);
const actionLabels: Record<string, string> = {
  referral_created: "Referral created",
  referral_assigned: "Assignee added",
  referral_reassigned: "Assignee changed",
  referral_unassigned: "Assignee removed",
  referral_stage_changed: "Stage changed",
  assessment_created: "Assessment created",
  assessment_imported: "Assessment imported",
  assessment_assigned: "Assessor changed",
  assessment_scheduled: "Assessment scheduled",
  assessment_rescheduled: "Assessment rescheduled",
  assessment_cancelled: "Assessment cancelled",
  assessment_no_show: "Assessment missed",
  assessment_interview_completed: "Interview completed; documentation remains editable",
  assessment_started: "Assessment started",
  assessment_completed: "Assessment completed",
  assessment_signed: "Assessment signed",
  assessment_addendum_added: "Assessment addendum added",
  assessment_recommendation_submitted: "Recommendation submitted",
  admission_decision_recorded: "Admission decision recorded",
  admission_decision_overridden: "Admission decision changed",
  admission_declined: "Admission denied",
  ehr_handoff_updated: "EHR handoff updated",
};

export default function ReferralActivityPanel({ referralId, version }: ReferralActivityPanelProps) {
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    referralId: number;
    events: ReferralActivityEvent[];
    metadata: ReferralWorkflowMetadata | null;
    error: boolean;
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const reload = (event: Event) => {
      if ((event as CustomEvent).detail?.referralId === referralId) setRefresh((value) => value + 1);
    };
    window.addEventListener("pipeline:documents-changed", reload);
    return () => window.removeEventListener("pipeline:documents-changed", reload);
  }, [referralId]);

  useEffect(() => {
    if (!referralId) return;
    const controller = new AbortController();
    fetchPipelineJson<{ events: ReferralActivityEvent[]; metadata: ReferralWorkflowMetadata }>(`/api/referrals/${referralId}/activity`, { cache: "no-store", signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) setResult({ referralId, events: payload.events ?? [], metadata: payload.metadata ?? null, error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ referralId, events: [], metadata: null, error: true });
      });
    return () => controller.abort();
  }, [referralId, version, retry, refresh]);

  if (!referralId) return <ActivityState message="Activity will appear once this referral is saved." />;
  if (!result || result.referralId !== referralId) return <ActivityState message="Loading activity..." busy />;
  if (result.error) return (
    <section data-guide-target="workspace-history" aria-label="Referral ownership and activity" className="flex items-center gap-4 px-3 py-6 text-[14px] text-[#53615a]">
      <p role="alert">Activity could not be loaded.</p>
      <button type="button" className="font-semibold text-[#08765d] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4" onClick={() => { setResult(null); setRetry((value) => value + 1); }}>Retry</button>
    </section>
  );
  return <ActivityTimeline key={referralId} events={result.events} metadata={result.metadata} referralId={referralId} />;
}

function ActivityTimeline({ events, metadata, referralId }: { events: ReferralActivityEvent[]; metadata: ReferralWorkflowMetadata | null; referralId: number }) {
  const important = events.filter((event) => !routineActions.has(event.action) || event.changed_fields.some((field) => importantFields.has(field)));
  return (
    <section data-guide-target="workspace-history" aria-label="Referral ownership and activity" className="mx-auto max-w-4xl py-3 sm:px-3">
      {important.length ? groupActivityByDay(important).map((group) => (
        <section key={group.date} aria-label={group.label} className="mb-5">
          <h3 className="border-b border-[#dce4df] px-3 py-2 text-[13px] font-semibold text-[#52625a]">{group.label}</h3>
          <ol className="divide-y divide-[#e8edea]">
            {group.events.map((event) => <ActivityRow key={event.event_id} referralId={referralId} event={event} />)}
          </ol>
        </section>
      )) : <p className="px-3 py-5 text-[14px] text-[#53615a]">{events.length ? "No major updates yet. Routine saves are in detailed history." : "No activity yet."}</p>}

      {events.length > 0 ? (
        <details className="border-t border-[#dce4df]">
          <summary className="cursor-pointer px-3 py-4 text-[13px] font-semibold text-[#52625a] focus-visible:outline-2 focus-visible:outline-offset-2">Detailed history</summary>
          <div className="px-3 pb-3">
            {metadata?.owners.length ? (
              <div role="group" aria-label="Workspace owners" className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-[#53615a]">
                {metadata.owners.map((owner) => <p key={owner.id}><span className="font-semibold text-[#25372d]">{owner.name}</span> · {owner.responsibilities.map(humanize).join(", ")}</p>)}
              </div>
            ) : null}
            {events.length === 100 ? <p className="mb-3 text-[13px] text-[#53615a]">Latest 100 recorded events.</p> : null}
            <ol aria-label="Detailed activity history" className="divide-y divide-[#e8edea] border-t border-[#dce4df]">
              {events.map((event) => <ActivityRow key={event.event_id} referralId={referralId} event={event} detailed />)}
            </ol>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function RestoreDocument({ event, referralId }: { event: ReferralActivityEvent; referralId: number }) {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const restore = async () => {
    if (!event.undo || busy || !await confirm({ title: "Restore this deleted file?", message: "Newer chart and checklist changes will be kept.", confirmLabel: "Restore file" })) return;
    setBusy(true);
    setError("");
    try {
      await fetchPipelineJson(`/api/files/${event.undo.document_id}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, deletion_id: event.undo.deletion_id }) });
      window.dispatchEvent(new CustomEvent("pipeline:documents-changed", { detail: { referralId } }));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The file could not be restored."); }
    finally { setBusy(false); }
  };
  return <div className="mt-2 text-[11px]">
    {confirmationDialog}
    <button type="button" disabled={busy} onClick={() => void restore()} className="font-bold text-[#0f7059] underline disabled:opacity-50">{busy ? "Restoring…" : "Restore file"}</button>
    <span className="ml-2 text-[#737373]">Available until {formatTimestamp(event.undo!.until)}</span>
    {error ? <p role="alert" className="mt-1 text-[#9aa7a0]">{error}</p> : null}
  </div>;
}

function ActivityRow({ event, referralId, detailed = false }: { event: ReferralActivityEvent; referralId: number; detailed?: boolean }) {
  const statusChange = !detailed && routineActions.has(event.action) ? event.changes.find((change) => change.field === "workflowStatus" && change.values_available && !change.masked) : undefined;
  const label = statusChange
    ? Object.hasOwn(workflowStatusLabels, statusChange.after) ? workflowStatusLabels[statusChange.after as keyof typeof workflowStatusLabels] : humanize(statusChange.after)
    : actionLabels[event.action] ?? humanize(event.action);
  const changes = detailed ? event.changes : event.changes.filter((change) => summaryFields.has(change.field) && change.values_available && !change.masked && change !== statusChange);
  return (
    <li data-activity-event={event.action} className="px-3 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <span className="text-[15px] font-semibold leading-6 text-[#23372c]">{label}</span>
        <time className="text-[13px] tabular-nums text-[#59665f]" dateTime={event.created_at}>{formatTimestamp(event.created_at)}</time>
      </div>
      <p className="mt-0.5 text-[13px] leading-5 text-[#59665f]">{event.actor_name}</p>
      {detailed && event.reason ? <p className="mt-2 break-words text-[14px] leading-6 text-[#35473c]">{event.reason}</p> : null}
      {!detailed && event.undo ? <RestoreDocument event={event} referralId={referralId} /> : null}
      {changes.length ? (
        <dl className="mt-2 space-y-1 text-[14px] leading-6 text-[#35473c]">
          {changes.map((change) => (
            <div key={change.field} className="flex flex-wrap gap-x-2">
              <dt className="font-medium">{change.label}:</dt>
              <dd className="min-w-0 break-words [overflow-wrap:anywhere]">
                {change.masked ? "Value changed (masked)" : !change.values_available ? "Historical values unavailable" : detailed ? <>{change.before} <span aria-label="changed to">→</span> {change.after}</> : change.after}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

function ActivityState({ message, busy = false }: { message: string; busy?: boolean }) {
  return <section data-guide-target="workspace-history" aria-label="Referral ownership and activity" aria-busy={busy} className="px-3 py-6 text-[14px] text-[#53615a]"><p role="status">{message}</p></section>;
}

function groupActivityByDay(events: ReferralActivityEvent[]) {
  const groups = new Map<string, ReferralActivityEvent[]>();
  for (const event of events) {
    const date = localDateKey(event.created_at);
    groups.set(date, [...(groups.get(date) ?? []), event]);
  }
  return [...groups.entries()].map(([date, groupedEvents]) => ({ date, label: activityDateLabel(date), events: groupedEvents }));
}

function localDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function activityDateLabel(dateKey: string) {
  if (dateKey === "Unknown date") return dateKey;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey === localDateKey(today.toISOString())) return "Today";
  if (dateKey === localDateKey(yesterday.toISOString())) return "Yesterday";
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
