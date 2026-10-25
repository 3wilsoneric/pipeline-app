"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ClipboardCheck } from "lucide-react";

import HomeDialog from "@/components/pipeline/HomeDialog";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import type { WeeklyCompletionMemo } from "@/lib/pipeline/weekly-completion-memo";

const seenPrefix = "pipeline:completion-memo:seen:v1";

export default function WeeklyCompletionMemoCard({ memo, viewerId, onOpenPacket }: {
  memo: WeeklyCompletionMemo;
  viewerId: string;
  onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">, location: PipelineWorkspaceLocation, action: undefined, exact: true) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
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

  const selected = memo.clients.find((client) => client.referral_id === selectedId) ?? memo.clients[0];
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
        <span className="block text-label font-bold text-ink">Completion memo · week of {weekLabel}</span>
        <span className="block text-meta text-ink-muted">{memo.task_count === 0 ? "No open items for accepted or admitted clients" : `${memo.clients.length} clients · ${memo.task_count} items to review`}</span>
      </span>
      <ArrowRight size={17} className="shrink-0 text-primary" aria-hidden="true" />
    </button>

    {open ? <HomeDialog
      label="Completion memo"
      title="Completion memo"
      description={`Open items for ${memo.scope === "team" ? "the team’s" : "your"} accepted and admitted clients. This list updates from the live record; checklist entries should be verified before requesting another file.`}
      size="browser"
      onClose={close}
    >
      {memo.clients.length === 0 ? <p className="p-6 text-value text-ink-muted">No open items for accepted or admitted clients.</p> : <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(250px,340px)_minmax(0,1fr)]">
        <nav aria-label="Clients in completion memo" className="max-h-[30dvh] overflow-y-auto border-b border-sheet-border bg-sheet md:max-h-none md:border-b-0 md:border-r">
          {memo.clients.map((client) => <button
            key={client.referral_id}
            type="button"
            onClick={() => setSelectedId(client.referral_id)}
            aria-current={selected?.referral_id === client.referral_id ? "true" : undefined}
            className={`flex min-h-16 w-full items-center gap-3 border-b border-paper-rule px-4 py-3 text-left hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${selected?.referral_id === client.referral_id ? "bg-stage-green-tile" : ""}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-label font-bold text-ink">{client.client_name}</span>
              <span className="block truncate text-[11px] text-ink-muted">{client.community} · {memo.scope === "team" ? `${client.owner} · ` : ""}{client.status === "admitted" ? "Admitted" : "Accepted"}</span>
            </span>
            <span className="shrink-0 rounded-pill bg-paper px-2 py-0.5 text-[11px] font-bold text-link">{client.tasks.length}</span>
          </button>)}
        </nav>
        {selected ? <section aria-label={`${selected.client_name} completion items`} className="min-h-0 overflow-y-auto p-5 sm:p-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-link">{selected.status === "admitted" ? "Admitted" : "Accepted"} · {selected.community}</p>
          <h3 className="mt-1 text-title font-bold text-ink">{selected.client_name}</h3>
          {memo.scope === "team" ? <p className="mt-1 text-meta text-ink-muted">Assigned to {selected.owner}</p> : null}
          <ol className="mt-5 divide-y divide-paper-rule border-y border-paper-rule">
            {selected.tasks.map((task) => <li key={task.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div>
                <p className="text-value font-semibold text-ink">{task.label}</p>
                <p className="mt-1 max-w-xl text-meta leading-5 text-ink-muted">{task.detail}</p>
              </div>
              <button type="button" onClick={() => openTask(selected, task.location)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-input border border-stage-green-border bg-paper px-3 text-meta font-bold text-link hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                {task.action}<ArrowRight size={14} aria-hidden="true" />
              </button>
            </li>)}
          </ol>
        </section> : null}
      </div>}
    </HomeDialog> : null}
  </>;
}
