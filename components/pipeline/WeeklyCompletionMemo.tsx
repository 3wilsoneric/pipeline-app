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
          <p className={styles.eyebrow}>Week of {weekLabel}</p>
          <h1>{memo?.scope === "team" ? "Team follow-up" : "My follow-up"}</h1>
        </div>
        {memo ? <div className={styles.heroAside} aria-label={`${memo.clients.length} clients with ${memo.task_count} open items`}>
          <strong>{memo.clients.length}</strong><span>{memo.clients.length === 1 ? "client" : "clients"}</span>
          <strong>{memo.task_count}</strong><span>open items</span>
        </div> : null}
      </header>
      {error ? <div role="alert" className="mt-5 rounded-input border border-red-300 bg-red-50 p-4 text-meta text-red-800">{error} <button type="button" onClick={() => void loadMemo()} className="font-bold underline">Retry</button></div> : null}
      {!memo && !error ? <p role="status" className="mt-6 text-meta text-ink-muted">Loading follow-up items…</p> : null}
      {memo && memo.clients.length === 0 ? <p className="mt-6 rounded-sheet border border-sheet-border bg-paper p-6 text-value">No open items for accepted or admitted clients.</p> : null}
      {memo && memo.clients.length > 0 ? <div className={styles.layout}>
        <nav aria-label="Clients in completion memo" className={styles.clients}>
          <div className={styles.clientsHeader}>
            <h2>Clients</h2>
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
            <span className={styles.clientIdentity}><strong>{client.client_name}</strong><span>{client.community}{memo.scope === "team" ? ` · ${client.owner}` : ""}</span></span>
            <span className={styles.clientStatus}>{client.status === "admitted" ? "Admitted" : "Accepted"}{!client.assessment_signed ? " · Signature needed" : ""}</span>
            <span className={styles.clientCount}>{client.tasks.length}<small> {client.tasks.length === 1 ? "item" : "items"}</small></span>
            <ChevronDown size={19} className={styles.clientChevron} aria-hidden="true" />
          </button>
          {selected?.referral_id === client.referral_id && task ? <div id="completion-client-detail" className={styles.workArea}>
          <div className={styles.workColumns}>
            <section aria-label={`${selected.client_name} issues`} className={styles.issues}>
              <div className={styles.issuesHeader}><h3>To review</h3><span>{selected.tasks.length}</span></div>
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
              <p className={styles.eyebrow}>{taskGroups.find((group) => group.key === task.group)?.label}</p>
              <h3>{task.label}</h3>
              <p className={styles.detail}>{task.detail}</p>
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
