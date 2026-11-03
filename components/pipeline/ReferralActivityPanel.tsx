"use client";

import { useConfirmationDialog } from "./useConfirmationDialog";

import { useEffect, useState } from "react";
import { CalendarDays, ChevronDown, RefreshCw } from "lucide-react";
import PipelineIllustration, { type PipelineIllustrationKind } from "./PipelineIllustration";
import styles from "./ReferralActivityPanel.module.css";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { ReferralActivityEvent, ReferralWorkflowMetadata } from "@/lib/pipeline/referral-activity";
import { workflowStatusLabels } from "@/lib/pipeline/workflow-status";
import { activityEventLabel, activityEventProvenance } from "@/lib/pipeline/referral-activity-presentation";
import { referralOwnerResponsibilityLabels, referralRoleFacts } from "@/lib/pipeline/referral-owner-identity";
import { displayWorkspaceSource } from "@/lib/pipeline/workspace-presentation";

type ReferralActivityPanelProps = { referralId?: number; version?: number };

// Routine saves stay in detailed history; unfamiliar events remain visible.
const routineActions = new Set(["referral_updated", "assessment_updated", "work_item_updated", "extraction_confirmed"]);
const importantFields = new Set(["owner", "ownerId", "owners", "stage", "workflowStatus", "admissionDate", "admissionDecision", "placementCancellation", "priority", "assessmentRecommendation", "ehrHandoff", "workspaceStatus", "documentName", "outcome"]);
const summaryFields = new Set(["owner", "stage", "workflowStatus", "admissionDate", "outcome", "priority"]);

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
    <section data-guide-target="workspace-history" aria-label="Referral ownership and activity" className={styles.timeline}>
      {metadata ? <ReferralPeople metadata={metadata} /> : null}
      {important.length ? groupActivityByDay(important).map((group) => (
        <section key={group.date} aria-label={group.label} className={styles.day}>
          <h3 className={styles.dayHeading}><CalendarDays size={18} aria-hidden="true" />{group.label}</h3>
          <ol className={styles.events}>
            {group.events.map((event) => <ActivityRow key={event.event_id} referralId={referralId} event={event} />)}
          </ol>
        </section>
      )) : <p className="px-3 py-5 text-[14px] text-[#53615a]">{events.length ? "No major updates yet. Routine saves are in detailed history." : "No activity yet."}</p>}

      {events.length > 0 ? (
        <details className={styles.history}>
          <summary><PipelineIllustration kind="history" size={32} />Detailed history<ChevronDown size={18} aria-hidden="true" /></summary>
          <div className={styles.historyBody}>
            {events.length === 100 ? <p className="mb-3 text-[13px] text-[#53615a]">Latest 100 recorded events.</p> : null}
            <ol aria-label="Detailed activity history" className={styles.detailedEvents}>
              {events.map((event) => <ActivityRow key={event.event_id} referralId={referralId} event={event} detailed />)}
            </ol>
          </div>
        </details>
      ) : null}
    </section>
  );
}

// Assignment, the assessment's assessor, and its author are separate recorded
// roles. Show each from its own source; never substitute the current viewer.
function ReferralPeople({ metadata }: { metadata: ReferralWorkflowMetadata }) {
  const roles = referralRoleFacts({
    owner: metadata.owner?.name,
    ownerId: metadata.owner?.id,
    assessment: metadata.assessment.status === "not_started" ? null : metadata.assessment,
  });
  return (
    <div className={styles.people}>
      <dl aria-label="Referral roles" className={styles.roles}>
        {roles.map((role) => (
          <div key={role.role} data-referral-role={role.role} className={styles.person}>
            <dt><span className={styles.personPicture} aria-hidden="true"><PipelineIllustration kind={role.role === "assigned_assessor" ? "assignment" : "assessment"} size={40} /></span>{role.label}</dt>
            <dd>{role.value}</dd>
          </div>
        ))}
      </dl>
      {metadata.owners.length ? (
        <div role="group" aria-label="Workspace owners" className={styles.owners}>
          {metadata.owners.map((owner) => <p key={owner.id}><strong>{owner.name}</strong> · {owner.responsibilities.map((responsibility) => referralOwnerResponsibilityLabels[responsibility] ?? humanize(responsibility)).join(", ")}</p>)}
        </div>
      ) : null}
    </div>
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
  const statusChange = routineStatusChange(event, detailed);
  const synchronized = event.entity_type === "referral" && event.action.startsWith("assessment_");
  const picture = activityPicture(event);
  const label = statusChange
    ? Object.hasOwn(workflowStatusLabels, statusChange.after) ? workflowStatusLabels[statusChange.after as keyof typeof workflowStatusLabels] : humanize(statusChange.after)
    : activityEventLabel(event);
  const changes = detailed ? event.changes : event.changes.filter((change) => summaryFields.has(change.field) && change.values_available && !change.masked && change !== statusChange);
  return (
    <li data-activity-event={event.action} data-activity-kind={picture} data-synchronized={synchronized || undefined} data-detailed={detailed || undefined} className={styles.event}>
      {!detailed ? <span className={styles.eventPicture} aria-hidden="true">{synchronized ? <RefreshCw size={18} /> : <PipelineIllustration kind={picture} size={40} />}</span> : null}
      <div className={styles.eventBody}>
      <div className={styles.eventHeading}>
        <span className={styles.eventTitle}>{label}</span>
        <time title={formatTimestamp(event.created_at)} dateTime={event.created_at}>{formatTimestamp(event.created_at, !detailed)}</time>
      </div>
      <p className={styles.actor}>{event.actor_name}</p>
      {detailed ? (
        <details className="mt-1 text-[13px] text-[#59665f]">
          <summary className="cursor-pointer font-medium max-sm:min-h-(--spacing-control) max-sm:py-3 max-sm:text-label focus-visible:outline-2 focus-visible:outline-offset-2">Record details</summary>
          <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
            {activityEventProvenance(event).map((item) => (
              <div key={item.label} className="contents"><dt>{item.label}</dt><dd className="min-w-0 break-all font-mono text-[12px]">{item.value}</dd></div>
            ))}
          </dl>
        </details>
      ) : null}
      {detailed && event.reason ? <p className="mt-2 break-words text-[14px] leading-6 text-[#35473c]">{displayWorkspaceSource(event.reason)}</p> : null}
      {!detailed && event.undo ? <RestoreDocument event={event} referralId={referralId} /> : null}
      {changes.length ? (
        <dl className={styles.changes}>
          {changes.map((change) => (
            <div key={change.field}>
              <dt className={!detailed && change.field === "workflowStatus" ? "sr-only" : undefined}>{change.label}:</dt>
              <dd>
                {change.masked ? "Value changed (masked)" : !change.values_available ? "Historical values unavailable" : detailed ? <>{change.before} <span aria-label="changed to">→</span> {change.after}</> : change.field === "workflowStatus" && Object.hasOwn(workflowStatusLabels, change.after) ? workflowStatusLabels[change.after as keyof typeof workflowStatusLabels] : change.after}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      </div>
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

function formatTimestamp(value: string, timeOnly = false) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString([], timeOnly ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function routineStatusChange(event: ReferralActivityEvent, detailed: boolean) {
  return !detailed && routineActions.has(event.action) ? event.changes.find((change) => change.field === "workflowStatus" && change.values_available && !change.masked) : undefined;
}

// Illustrations describe the recorded action, not its success or clinical outcome.
function activityPicture(event: ReferralActivityEvent): PipelineIllustrationKind {
  if (/^(document_|file_)/.test(event.action) || event.entity_type === "document") return "folder";
  if (/^assessment_(scheduled|rescheduled|cancelled|no_show)$/.test(event.action)) return "calendar";
  if (event.action.startsWith("meet_client_")) return "placement";
  if (event.action.startsWith("admission_") || event.action === "assessment_recommendation_submitted") return "decision";
  if (/assigne?d|unassigned/.test(event.action)) return "assignment";
  if (event.action.startsWith("assessment_")) return "assessment";
  return event.action === "referral_created" ? "intake" : "history";
}
