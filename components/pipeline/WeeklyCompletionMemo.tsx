"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ClipboardCheck } from "lucide-react";

import HomeDialog from "@/components/pipeline/HomeDialog";
import CompletionMemoReviewForm from "@/components/pipeline/CompletionMemoReviewForm";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import type { CompletionMemoClient, CompletionMemoTask, WeeklyCompletionMemo } from "@/lib/pipeline/weekly-completion-memo";

const seenPrefix = "pipeline:completion-memo:seen:v1";
const taskGroups: { key: CompletionMemoTask["group"]; label: string }[] = [
  { key: "chart", label: "Chart data" },
  { key: "assessment", label: "Assessment and signature" },
  { key: "review", label: "Answers to review" },
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
  const selected = visibleClients.find((client) => client.referral_id === selectedId) ?? visibleClients[0];
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

  return <main className="h-full overflow-y-auto bg-sheet px-4 py-5 text-ink sm:px-6 lg:px-8" aria-label="Completion memo review">
    <div className="mx-auto max-w-[1440px]">
      <button type="button" onClick={() => { if (discardDraft()) onBack(); }} className="inline-flex items-center gap-2 text-label font-semibold text-link hover:underline"><ArrowLeft size={16} />Pipeline Home</button>
      <div className="mt-5 border-b border-paper-rule pb-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-link">Week of {weekLabel}</p>
        <h1 className="mt-1 text-title font-bold">{memo?.scope === "team" ? "Team follow-up" : "My follow-up"}</h1>
        <p className="mt-1 text-meta text-ink-muted">Accepted and admitted clients with unfinished information or follow-through. Save chart and assessment answers here; file, signature, and handoff items open their existing workflow.</p>
      </div>
      {error ? <div role="alert" className="mt-5 rounded-input border border-red-300 bg-red-50 p-4 text-meta text-red-800">{error} <button type="button" onClick={() => void loadMemo()} className="font-bold underline">Retry</button></div> : null}
      {!memo && !error ? <p role="status" className="mt-6 text-meta text-ink-muted">Loading follow-up items…</p> : null}
      {memo && memo.clients.length === 0 ? <p className="mt-6 rounded-sheet border border-sheet-border bg-paper p-6 text-value">No open items for accepted or admitted clients.</p> : null}
      {memo && memo.clients.length > 0 ? <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(220px,270px)_minmax(260px,370px)_minmax(0,1fr)]">
        <nav aria-label="Clients in completion memo" className="min-w-0 self-start rounded-sheet border border-sheet-border bg-paper">
          {memo.scope === "team" ? <label className="block border-b border-paper-rule px-4 py-3 text-label font-semibold">Assessor
            <select aria-label="Filter completion memo by assessor" value={ownerFilter} onChange={(event) => { if (discardDraft()) { setOwnerFilter(event.target.value); setSelectedId(null); setSelectedTaskId(null); } }} className="mt-1 block w-full rounded-input border border-sheet-border bg-paper px-2 py-2 text-value font-normal">
              <option value="">All assessors</option>
              {owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
            </select>
          </label> : null}
          {visibleClients.map((client) => <button key={client.referral_id} type="button"
            onClick={() => { if (selected?.referral_id !== client.referral_id && discardDraft()) { setSelectedId(client.referral_id); setSelectedTaskId(null); } }}
            aria-current={selected?.referral_id === client.referral_id ? "true" : undefined}
            className={`flex min-h-16 w-full items-center gap-3 border-b border-paper-rule px-4 py-3 text-left last:border-b-0 hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${selected?.referral_id === client.referral_id ? "bg-stage-green-tile" : ""}`}>
            <span className="min-w-0 flex-1"><span className="block truncate text-label font-bold">{client.client_name}</span>
              <span className="block truncate text-[11px] text-ink-muted">{client.community} · {client.status === "admitted" ? "Admitted" : "Accepted"}{memo.scope === "team" ? ` · ${client.owner}` : ""}</span></span>
            <span className="shrink-0 rounded-pill bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-link">{client.tasks.length}</span>
          </button>)}
        </nav>
        {selected && task ? <>
          <section aria-label={`${selected.client_name} issues`} className="min-w-0 self-start rounded-sheet border border-sheet-border bg-paper">
            <div className="border-b border-paper-rule px-4 py-4"><h2 className="text-subtitle font-bold">{selected.client_name}</h2>
              <p className="mt-1 text-meta text-ink-muted">{selected.tasks.length} items · {selected.assessment_signed ? "Assessment signed" : "Signature needed"}</p></div>
            {taskGroups.map(({ key, label }) => {
              const tasks = selected.tasks.filter((item) => item.group === key);
              return tasks.length ? <div key={key} className="border-b border-paper-rule last:border-b-0">
                <h3 className="px-4 pb-1 pt-4 text-[11px] font-bold uppercase tracking-[0.08em] text-link">{label}</h3>
                {tasks.map((item) => <button type="button" key={item.id} onClick={() => { if (task.id !== item.id && discardDraft()) setSelectedTaskId(item.id); }}
                  aria-current={task.id === item.id ? "true" : undefined}
                  className={`block w-full border-t border-paper-rule px-4 py-3 text-left hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${task.id === item.id ? "bg-stage-green-tile" : ""}`}>
                  <span className="block text-label font-semibold">{item.label}</span>
                  <span className="mt-1 block text-meta leading-5 text-ink-muted">{item.detail}</span>
                </button>)}
              </div> : null;
            })}
          </section>
          <section aria-label={`${task.label} review`} className="min-w-0 self-start rounded-sheet border border-sheet-border bg-paper p-5 sm:p-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-link">Review and update</p>
            <h2 className="mt-2 text-subtitle font-bold">{task.label}</h2>
            <p className="mt-2 text-meta leading-5 text-ink-muted">{task.detail}</p>
            <div className="mt-5 border-t border-paper-rule pt-5">
              <CompletionMemoReviewForm key={`${selected.referral_id}:${task.id}`} client={selected} task={task} onSaved={loadMemo} onOpenTask={() => openTask(selected, task.location)} onDirtyChange={setDirty} />
            </div>
          </section>
        </> : null}
      </div> : null}
    </div>
  </main>;
}
