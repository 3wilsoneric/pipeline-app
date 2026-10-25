"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ClipboardCheck } from "lucide-react";

import HomeDialog from "@/components/pipeline/HomeDialog";
import CompletionMemoReviewForm from "@/components/pipeline/CompletionMemoReviewForm";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import type { CompletionMemoTask, WeeklyCompletionMemo } from "@/lib/pipeline/weekly-completion-memo";

const seenPrefix = "pipeline:completion-memo:seen:v1";
const taskGroups: { key: CompletionMemoTask["group"]; label: string }[] = [
  { key: "chart", label: "Chart data" },
  { key: "assessment", label: "Assessment and signature" },
  { key: "review", label: "Answers to review" },
  { key: "follow_through", label: "Placement follow-through" },
];

export default function WeeklyCompletionMemoCard({ memo, viewerId, onOpenPacket, onSaved }: {
  memo: WeeklyCompletionMemo;
  viewerId: string;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location: PipelineWorkspaceLocation, action: undefined, exact: true) => void;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [ownerFilter, setOwnerFilter] = useState("");
  const seenKey = `${seenPrefix}:${encodeURIComponent(viewerId)}:${memo.week_key}`;
  const weekLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${memo.week_key}T12:00:00.000Z`));

  useEffect(() => {
    if (!memo.is_monday || memo.task_count === 0 || !memo.week_key) return;
    try {
      if (window.localStorage.getItem(seenKey) === "1") return;
    } catch { /* This week's memo remains available from the home card. */ }
    const timer = window.setTimeout(() => setOpen(true), 0);
    return () => window.clearTimeout(timer);
  }, [memo.is_monday, memo.task_count, memo.week_key, seenKey]);

  const owners = [...new Set(memo.clients.map((client) => client.owner))].sort((a, b) => a.localeCompare(b));
  const visibleClients = ownerFilter ? memo.clients.filter((client) => client.owner === ownerFilter) : memo.clients;
  const selected = visibleClients.find((client) => client.referral_id === selectedId) ?? visibleClients[0];
  const taskIndex = selected ? Math.max(0, selected.tasks.findIndex((task) => task.id === selectedTaskId)) : 0;
  const task = selected?.tasks[taskIndex];
  function close() {
    setOpen(false);
    try { window.localStorage.setItem(seenKey, "1"); } catch { /* Preference only. */ }
  }
  function openTask(client: NonNullable<typeof selected>, location: PipelineWorkspaceLocation) {
    close();
    onOpenPacket({ id: client.referral_id, name: client.client_name, community: client.community }, location, undefined, true);
  }

  return <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="mt-3 flex w-full items-center gap-3 rounded-sheet border border-stage-green-border bg-primary-soft px-4 py-3 text-left transition-colors hover:bg-stage-green-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      aria-label={`Open completion memo, ${memo.clients.length} clients with items to review`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-paper bg-paper text-primary"><ClipboardCheck size={19} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-label font-bold text-ink">{memo.scope === "team" ? "Team follow-up" : "My follow-up"} · week of {weekLabel}</span>
        <span className="block text-meta text-ink-muted">{memo.task_count === 0 ? "No open items for accepted or admitted clients" : `${memo.clients.length} clients need a review`}</span>
      </span>
      <ArrowRight size={17} className="shrink-0 text-primary" aria-hidden="true" />
    </button>

    {open ? <HomeDialog
      label="Completion memo"
      title="Completion memo"
      description={`A focused review of ${memo.scope === "team" ? "the team’s" : "your"} accepted and admitted clients. Save answers here or open the full record when you need more context.`}
      size="browser"
      onClose={close}
    >
      {memo.clients.length === 0 ? <p className="p-6 text-value text-ink-muted">No open items for accepted or admitted clients.</p> : <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(250px,340px)_minmax(0,1fr)]">
        <nav aria-label="Clients in completion memo" className="max-h-[30dvh] overflow-y-auto border-b border-sheet-border bg-sheet md:max-h-none md:border-b-0 md:border-r">
          {memo.scope === "team" ? <label className="sticky top-0 z-10 block border-b border-paper-rule bg-sheet px-4 py-3 text-label font-semibold text-ink">Assessor
            <select aria-label="Filter completion memo by assessor" value={ownerFilter} onChange={(event) => { setOwnerFilter(event.target.value); setSelectedId(null); setSelectedTaskId(null); }} className="mt-1 block w-full rounded-input border border-sheet-border bg-paper px-2 py-2 text-value font-normal">
              <option value="">All assessors</option>
              {owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
            </select>
          </label> : null}
          {visibleClients.map((client) => <button
            key={client.referral_id}
            type="button"
            onClick={() => { setSelectedId(client.referral_id); setSelectedTaskId(null); }}
            aria-current={selected?.referral_id === client.referral_id ? "true" : undefined}
            className={`flex min-h-16 w-full items-center gap-3 border-b border-paper-rule px-4 py-3 text-left hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${selected?.referral_id === client.referral_id ? "bg-stage-green-tile" : ""}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label font-bold text-ink">{client.client_name}</span>
              <span className="block truncate text-[11px] text-ink-muted">{client.community} · {memo.scope === "team" ? `${client.owner} · ` : ""}{client.status === "admitted" ? "Admitted" : "Accepted"} · {client.assessment_signed ? "Assessment signed" : "Signature needed"}</span>
            </span>
            <span className="shrink-0 rounded-pill bg-paper px-2 py-0.5 text-[11px] font-bold text-link">{client.tasks.length}</span>
          </button>)}
        </nav>
        {selected && task ? <section aria-label={`${selected.client_name} completion items`} className="min-h-0 overflow-y-auto p-5 sm:p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-link">{selected.status === "admitted" ? "Admitted" : "Accepted"} · {selected.community}</p>
          <h3 className="mt-1 text-title font-bold text-ink">{selected.client_name}</h3>
          {memo.scope === "team" ? <p className="mt-1 text-meta text-ink-muted">Assigned to {selected.owner}</p> : null}
          <p className="mt-1 text-meta text-ink-muted">Assessment {selected.assessment_signed ? "signed" : "not signed"}</p>
          <div className="mt-5 border-t border-paper-rule pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-meta text-ink-muted">Item {taskIndex + 1} of {selected.tasks.length}</p>
              <select aria-label="Choose item to review" value={task.id} onChange={(event) => setSelectedTaskId(event.target.value)} className="max-w-full rounded-input border border-sheet-border bg-paper px-2 py-2 text-meta text-ink">
                {taskGroups.map(({ key, label }) => {
                  const tasks = selected.tasks.filter((item) => item.group === key);
                  return tasks.length ? <optgroup key={key} label={`${label} · ${tasks.length}`}>
                    {tasks.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </optgroup> : null;
                })}
              </select>
            </div>
            <h4 className="mt-5 text-subtitle font-bold text-ink">{task.label}</h4>
            <p className="mt-1 max-w-2xl text-meta leading-5 text-ink-muted">{task.detail}</p>
            <div className="mt-5 rounded-sheet border border-sheet-border bg-paper p-4 sm:p-5">
              <CompletionMemoReviewForm key={`${selected.referral_id}:${task.id}`} client={selected} task={task} onSaved={onSaved} onOpenTask={() => openTask(selected, task.location)} />
            </div>
            <div className="mt-5 flex justify-between gap-3 border-t border-paper-rule pt-4">
              <button type="button" disabled={taskIndex === 0} onClick={() => setSelectedTaskId(selected.tasks[taskIndex - 1].id)} className="inline-flex items-center gap-1 text-label font-semibold text-link disabled:opacity-40"><ArrowLeft size={15} />Previous</button>
              <button type="button" disabled={taskIndex >= selected.tasks.length - 1} onClick={() => setSelectedTaskId(selected.tasks[taskIndex + 1].id)} className="inline-flex items-center gap-1 text-label font-semibold text-link disabled:opacity-40">Next item<ArrowRight size={15} /></button>
            </div>
          </div>
        </section> : null}
      </div>}
    </HomeDialog> : null}
  </>;
}
