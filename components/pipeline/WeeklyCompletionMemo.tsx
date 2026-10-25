"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ClipboardCheck } from "lucide-react";

import HomeDialog from "@/components/pipeline/HomeDialog";
import CompletionMemoReviewForm from "@/components/pipeline/CompletionMemoReviewForm";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import type { CompletionMemoClient, CompletionMemoTask, WeeklyCompletionMemo } from "@/lib/pipeline/weekly-completion-memo";
import styles from "./WeeklyCompletionMemo.module.css";

const seenPrefix = "pipeline:completion-memo:seen:v1";
const taskGroups: { key: CompletionMemoTask["group"]; label: string }[] = [
  { key: "chart", label: "Client chart" },
  { key: "assessment", label: "Assessment" },
  { key: "review", label: "Answers to check" },
  { key: "follow_through", label: "Placement follow-through" },
];

function taskInstruction(task: CompletionMemoTask, client: CompletionMemoClient) {
  if (task.id === "assessment:signature") return "Open the full assessment, review the answers, then sign it there.";
  if (task.group === "chart") return "Check the referral source, enter the confirmed value below, and save it to the client chart.";
  if (task.group === "review") return "Compare the recorded answer with its source. Correct the specific value here when you know it; leave it open if you do not.";
  if (task.group === "assessment") return client.assessment_signed
    ? "Add the missing answer to the signed assessment with its source. The previously sent Meet the Client will stay as sent."
    : "Enter the answer here. It saves to the working assessment and remains available for the final review.";
  if (task.id === "handoff") return "Open the handoff to check recipients, message, and files. Review the existing send history before sending anything.";
  return task.location.view === "files"
    ? "Check the existing files first. Attach or identify the right document in the client record; do not upload a duplicate."
    : "Open follow-through to update the existing checklist or handoff. This review page does not send an email.";
}

export default function WeeklyCompletionMemoCard({ memo, viewerId, onOpenReview }: {
  memo: WeeklyCompletionMemo;
  viewerId: string;
  onOpenReview: () => void;
}) {
  const [notificationOpen, setNotificationOpen] = useState(false);
  const seenKey = `${seenPrefix}:${encodeURIComponent(viewerId)}:${memo.week_key}`;
  const weekLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${memo.week_key}T12:00:00.000Z`));

  useEffect(() => {
    if (!memo.is_monday || memo.task_count === 0 || !memo.week_key) return;
    try {
      if (window.localStorage.getItem(seenKey) === "1") return;
    } catch { /* Keep the notification available without local storage. */ }
    const timer = window.setTimeout(() => setNotificationOpen(true), 0);
    return () => window.clearTimeout(timer);
  }, [memo.is_monday, memo.task_count, memo.week_key, seenKey]);

  function dismiss() {
    setNotificationOpen(false);
    try { window.localStorage.setItem(seenKey, "1"); } catch { /* Preference only. */ }
  }
  function review() {
    dismiss();
    onOpenReview();
  }

  return <>
    <button type="button" onClick={review}
      className="mt-3 flex w-full items-center gap-3 rounded-sheet border border-stage-green-border bg-primary-soft px-4 py-3 text-left transition-colors hover:bg-stage-green-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      aria-label={`Open completion memo, ${memo.clients.length} clients with items to review`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-paper bg-paper text-primary"><ClipboardCheck size={19} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-label font-bold text-ink">{memo.scope === "team" ? "Team follow-up" : "My follow-up"} · week of {weekLabel}</span>
        <span className="block text-meta text-ink-muted">{memo.clients.length} clients · {memo.task_count} items to review</span>
      </span>
      <ArrowRight size={17} className="shrink-0 text-primary" aria-hidden="true" />
    </button>
    {notificationOpen ? <HomeDialog label="Completion memo" title="Your Monday follow-up"
      description={`${memo.clients.length} accepted or admitted clients have ${memo.task_count} items to review. Open the review page to see each issue and update what you know.`}
      onClose={dismiss}>
      <div className="flex justify-end gap-3 p-5">
        <button type="button" onClick={dismiss} className="rounded-input border border-sheet-border px-4 py-2 text-label font-semibold text-ink">Later</button>
        <button type="button" onClick={review} className="rounded-input bg-primary px-4 py-2 text-label font-bold text-white">Review items</button>
      </div>
    </HomeDialog> : null}
  </>;
}

export function WeeklyCompletionMemoPage({ onBack, onOpenPacket }: {
  onBack: () => void;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location: PipelineWorkspaceLocation) => void;
}) {
  const [memo, setMemo] = useState<WeeklyCompletionMemo | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState("");
  const [dirty, setDirty] = useState(false);
  const { beforeNavigationRef } = usePipelineShell();
  const loadMemo = useCallback(async () => {
    try {
      const briefing = await fetchPipelineJson<HomeBriefingSnapshot>("/api/operations/home", { cache: "no-store" });
      setMemo(briefing.workflow.completion_memo);
      try {
        window.localStorage.setItem(`${seenPrefix}:${encodeURIComponent(briefing.viewer.id)}:${briefing.workflow.completion_memo.week_key}`, "1");
      } catch { /* The review page remains usable without local storage. */ }
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The follow-up review could not be loaded.");
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadMemo(), 0);
    return () => window.clearTimeout(timer);
  }, [loadMemo]);
  useEffect(() => {
    if (!dirty) return;
    const guard = async () => {
      if (!window.confirm("Discard the unsaved answer and leave this review?")) throw new Error("Review draft retained.");
    };
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    beforeNavigationRef.current = guard;
    window.addEventListener("beforeunload", leave);
    return () => {
      if (beforeNavigationRef.current === guard) beforeNavigationRef.current = null;
      window.removeEventListener("beforeunload", leave);
    };
  }, [beforeNavigationRef, dirty]);

  const owners = [...new Set(memo?.clients.map((client) => client.owner) ?? [])].sort((a, b) => a.localeCompare(b));
  const visibleClients = memo?.clients.filter((client) => !ownerFilter || client.owner === ownerFilter) ?? [];
  const selected = visibleClients.find((client) => client.referral_id === selectedId);
  const task = selected?.tasks.find((item) => item.id === selectedTaskId) ?? selected?.tasks[0];
  const weekLabel = memo ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${memo.week_key}T12:00:00.000Z`)) : "";

  function discardDraft() {
    if (dirty && !window.confirm("Discard the unsaved answer and switch items?")) return false;
    setDirty(false);
    return true;
  }
  function openTask(client: CompletionMemoClient, location: PipelineWorkspaceLocation) {
    if (!discardDraft()) return;
    onOpenPacket({ id: client.referral_id, name: client.client_name, community: client.community }, location);
  }

  return <main className={styles.page} aria-label="Completion memo review">
    <div className={styles.frame}>
      <button type="button" onClick={() => { if (discardDraft()) onBack(); }} className={styles.back}><ArrowLeft size={16} aria-hidden="true" />Pipeline Home</button>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Weekly completion memo · Week of {weekLabel}</p>
          <h1>{memo?.scope === "team" ? "Team follow-up" : "My follow-up"}</h1>
          <p>Review unfinished chart, assessment, and placement work for accepted or admitted clients.</p>
        </div>
        {memo ? <div className={styles.heroAside} aria-label={`${memo.clients.length} clients with ${memo.task_count} open items`}>
          <strong>{memo.clients.length}</strong><span>{memo.clients.length === 1 ? "client" : "clients"} to review</span>
          <small>{memo.task_count} open items</small>
        </div> : null}
      </header>
      {error ? <div role="alert" className="mt-5 rounded-input border border-red-300 bg-red-50 p-4 text-meta text-red-800">{error} <button type="button" onClick={() => void loadMemo()} className="font-bold underline">Retry</button></div> : null}
      {!memo && !error ? <p role="status" className="mt-6 text-meta text-ink-muted">Loading follow-up items…</p> : null}
      {memo && memo.clients.length === 0 ? <p className="mt-6 rounded-sheet border border-sheet-border bg-paper p-6 text-value">No open items for accepted or admitted clients.</p> : null}
      {memo && memo.clients.length > 0 ? <div className={styles.layout}>
        <nav aria-label="Clients in completion memo" className={styles.clients}>
          <div className={styles.clientsHeader}>
            <h2>Clients</h2>
            <p>Choose a record to review</p>
            {memo.scope === "team" ? <label>Assessor
              <select aria-label="Filter completion memo by assessor" value={ownerFilter} onChange={(event) => { if (discardDraft()) { setOwnerFilter(event.target.value); setSelectedId(null); setSelectedTaskId(null); } }}>
                <option value="">All assessors</option>
                {owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
              </select>
            </label> : null}
          </div>
          <div className={styles.clientList}>{visibleClients.map((client) => <div key={client.referral_id} className={styles.clientEntry}><button type="button"
            onClick={() => { if (discardDraft()) { setSelectedId(selectedId === client.referral_id ? null : client.referral_id); setSelectedTaskId(null); } }}
            aria-expanded={selected?.referral_id === client.referral_id}
            aria-controls={selected?.referral_id === client.referral_id ? "completion-client-detail" : undefined}
            data-status={client.status}
            className={styles.client}>
            <span className={styles.clientTop}><strong>{client.client_name}</strong><span className={styles.clientCount}>{client.tasks.length}<small> items</small></span></span>
            <span className={styles.clientMeta}>{client.community}{memo.scope === "team" ? ` · ${client.owner}` : ""} · {client.assessment_signed ? "Assessment signed" : "Signature needed"}</span>
            <span className={styles.clientStatus}>{client.status === "admitted" ? "Admitted" : "Accepted"}<span>{selected?.referral_id === client.referral_id ? "Close" : "Review"}<ChevronDown size={17} aria-hidden="true" /></span></span>
          </button>
          {selected?.referral_id === client.referral_id && task ? <div id="completion-client-detail" className={styles.workArea}>
          <div className={styles.workColumns}>
            <section aria-label={`${selected.client_name} issues`} className={styles.issues}>
              <div className={styles.issuesHeader}><h3>What needs attention</h3><span>{selected.tasks.length} items</span></div>
              {taskGroups.map(({ key, label }) => {
                const tasks = selected.tasks.filter((item) => item.group === key);
                return tasks.length ? <div key={key} className={styles.group} data-group={key}>
                  <h4><span>{label}</span><span>{tasks.length}</span></h4>
                  {tasks.map((item) => <button type="button" key={item.id} onClick={() => { if (task.id !== item.id && discardDraft()) setSelectedTaskId(item.id); }}
                    aria-current={task.id === item.id ? "true" : undefined}
                    className={styles.issue}>
                    <span>{item.label}</span><ArrowRight size={15} aria-hidden="true" />
                  </button>)}
                </div> : null;
              })}
            </section>
            <section aria-label={`${task.label} review`} className={styles.review}>
              <p className={styles.eyebrow}>Selected item · {taskGroups.find((group) => group.key === task.group)?.label}</p>
              <h3>{task.label}</h3>
              <div className={styles.detail}><strong>What needs attention</strong><p>{task.detail}</p></div>
              <div className={styles.instruction} data-group={task.group}><strong>What to do</strong><p>{taskInstruction(task, selected)}</p></div>
              <div className={styles.form}>
                <CompletionMemoReviewForm key={`${selected.referral_id}:${task.id}`} client={selected} task={task} onSaved={loadMemo} onOpenTask={() => openTask(selected, task.location)} onDirtyChange={setDirty} />
              </div>
            </section>
          </div>
          </div> : null}</div>)}</div>
          {visibleClients.length === 0 ? <p className={styles.noClients}>No clients for this assessor.</p> : null}
        </nav>
      </div> : null}
    </div>
  </main>;
}
