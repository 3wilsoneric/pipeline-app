"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useState } from "react";
import { Activity, ArrowUpRight } from "lucide-react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import AzureUsageMeter from "./AzureUsageMeter";

type TeamStatus = { id: string; name: string; status: "online" | "today" | "away" };

const statusPresentation = {
  online: { label: "Using now", color: "bg-status-done" },
  today: { label: "Signed in today", color: "bg-status-in-progress" },
  away: { label: "No sign-in today", color: "bg-status-pending" },
} as const;

// Keep the opener mounted while the optional dashboard chunk loads, so the
// shared dialog can restore keyboard focus to it on close.
const ApplicationActivityDashboard = dynamic(() => import("./ApplicationActivityDashboard"), { loading: () => null });

export default function ApplicationActivityCard() {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<TeamStatus[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const descriptionId = useId();

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      void fetchPipelineJson<{ people: TeamStatus[] }>(`/api/operations/assessor-status?since=${encodeURIComponent(startOfToday.toISOString())}`, {
        cache: "no-store", signal: controller.signal,
      }).then((result) => {
        if (!controller.signal.aborted) { setPeople(result.people); setUnavailable(false); }
      }).catch(() => {
        if (!controller.signal.aborted) { setPeople(null); setUnavailable(true); }
      });
    };
    refresh();
    const interval = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  return <>
    <span id={descriptionId} className="sr-only">
      {people ? people.map((person) => `${person.name}: ${statusPresentation[person.status].label}`).join("; ") : unavailable ? "Team status is temporarily unavailable." : "Loading team status."}
    </span>
    <div className="my-3 grid gap-3 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
      <button type="button" aria-label="Open application activity" aria-describedby={descriptionId} onClick={() => setOpen(true)} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] content-start gap-x-3 gap-y-2 rounded-paper border border-card-border bg-paper px-4 py-3 text-left hover:bg-sheet focus-visible:outline-2 focus-visible:outline-focus">
        <Activity size={18} aria-hidden="true" className="mt-0.5 text-primary" />
        <span className="min-w-0"><span className="block text-sm font-semibold">Application activity</span><span className="block text-xs text-ink-muted">Only you · green now · blue today · gray none</span></span>
        <ArrowUpRight size={18} aria-hidden="true" className="text-ink-muted" />
        <span className="col-span-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
          {people?.length ? people.map((person) => <span key={person.id} data-status={person.status} title={`${person.name}: ${statusPresentation[person.status].label}`} className="flex min-w-0 items-center gap-1.5 text-xs">
            <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${statusPresentation[person.status].color}`} />
            <span className="truncate">{person.name}</span>
          </span>) : <span className="col-span-full text-xs text-ink-muted">{unavailable ? "Team status unavailable" : people ? "No users listed" : "Loading team…"}</span>}
        </span>
      </button>
      <AzureUsageMeter />
    </div>
    {open ? <ApplicationActivityDashboard onClose={() => setOpen(false)} /> : null}
  </>;
}
