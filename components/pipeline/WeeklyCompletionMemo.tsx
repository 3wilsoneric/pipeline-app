"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ClipboardCheck } from "lucide-react";

import HomeDialog from "@/components/pipeline/HomeDialog";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import { completionMemoAssessmentField } from "@/lib/pipeline/completion-memo-fields";
import { assessmentSectionForField } from "@/lib/assessment/assessment-sections";
import type { WeeklyCompletionMemo } from "@/lib/pipeline/weekly-completion-memo";
import styles from "./WeeklyCompletionMemo.module.css";

const seenPrefix = "pipeline:completion-memo:seen:v1";

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
      description={`${memo.clients.length} accepted or admitted clients have ${memo.task_count} items to review. Open a client’s assessment to see what needs attention beside the relevant questions.`}
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
  const [ownerFilter, setOwnerFilter] = useState("");
  const loadMemo = useCallback(async () => {
    try {
      const briefing = await fetchPipelineJson<HomeBriefingSnapshot>("/api/operations/home", { cache: "no-store" });
      setMemo(briefing.workflow.completion_memo);
      try {
        window.localStorage.setItem(`${seenPrefix}:${encodeURIComponent(briefing.viewer.id)}:${briefing.workflow.completion_memo.week_key}`, "1");
      } catch { /* The review page remains usable without local storage. */ }
      setError("");
      return briefing.workflow.completion_memo;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The follow-up review could not be loaded.");
      return null;
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadMemo(), 0);
    return () => window.clearTimeout(timer);
  }, [loadMemo]);
  const owners = [...new Set(memo?.clients.map((client) => client.owner) ?? [])].sort((a, b) => a.localeCompare(b));
  const visibleClients = memo?.clients.filter((client) => !ownerFilter || client.owner === ownerFilter) ?? [];
  const weekLabel = memo ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${memo.week_key}T12:00:00.000Z`)) : "";

  return <main className={styles.page} aria-label="Completion memo review">
    <div className={styles.frame}>
      <button type="button" onClick={onBack} className={styles.back}><ArrowLeft size={16} aria-hidden="true" />Pipeline Home</button>
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Week of {weekLabel}</p>
          <h1>{memo?.scope === "team" ? "Team follow-up" : "My follow-up"}</h1>
        </div>
        {memo?.scope === "team" ? <label className={styles.ownerFilter}>Assessor
          <select aria-label="Filter completion memo by assessor" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
            <option value="">All assessors</option>
            {owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
          </select>
        </label> : null}
      </header>
      {error ? <div role="alert" className="mt-5 rounded-input border border-red-300 bg-red-50 p-4 text-meta text-red-800">{error} <button type="button" onClick={() => void loadMemo()} className="font-bold underline">Retry</button></div> : null}
      {!memo && !error ? <p role="status" className="mt-6 text-meta text-ink-muted">Loading follow-up items…</p> : null}
      {memo && memo.clients.length === 0 ? <p className="mt-6 rounded-sheet border border-sheet-border bg-paper p-6 text-value">No open items for accepted or admitted clients.</p> : null}
      {memo && memo.clients.length > 0 ? <div className={styles.layout}>
        <nav aria-label="Clients in completion memo" className={styles.clients}>
          <div className={styles.clientList}>{visibleClients.map((client) => <div key={client.referral_id} className={styles.clientEntry}><button type="button"
            onClick={() => {
              const firstField = client.tasks.map((task) => completionMemoAssessmentField(task.id)).find((field) => field);
              onOpenPacket({ id: client.referral_id, name: client.client_name, community: client.community }, {
                view: "assessment", assessmentMode: "prepare",
                ...(firstField ? { assessmentSection: assessmentSectionForField(firstField) } : {}),
                ...(firstField ? { assessmentQuestion: firstField } : {}),
              });
            }}
            data-status={client.status}
            className={styles.client}>
            <span className={styles.clientIdentity}><strong>{client.client_name}</strong><span>{client.community}{memo.scope === "team" ? ` · ${client.owner}` : ""}</span></span>
            <span className={styles.clientStatus}>{client.status === "admitted" ? "Admitted" : "Accepted"}{!client.assessment_signed ? " · Signature needed" : ""}</span>
            <span className={styles.clientCount}>{client.tasks.length}<small> {client.tasks.length === 1 ? "item" : "items"}</small></span>
            <ArrowRight size={19} className={styles.clientChevron} aria-hidden="true" />
          </button>
          </div>)}</div>
          {visibleClients.length === 0 ? <p className={styles.noClients}>No clients for this assessor.</p> : null}
        </nav>
      </div> : null}
    </div>
  </main>;
}
