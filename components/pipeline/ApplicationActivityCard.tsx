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
    <button type="button" aria-label="Open application activity" aria-describedby={descriptionId} onClick={() => setOpen(true)} className="my-3 flex w-full flex-wrap items-center gap-3 rounded-lg border border-[#d7dfdb] bg-white px-4 py-3 text-left hover:bg-[#f8faf9] focus-visible:outline-2 focus-visible:outline-[#087d66] sm:flex-nowrap">
      <Activity size={20} aria-hidden="true" className="shrink-0 text-[#087d66]" />
      <span className="shrink-0"><span className="block font-semibold">Application activity</span><span className="block text-xs text-[#53665d]">Only you · green now · blue today · gray none</span></span>
      <span className="order-3 flex w-full min-w-0 items-center gap-3 overflow-x-auto whitespace-nowrap py-1 sm:order-none sm:ml-2 sm:w-auto sm:flex-1">
        {people?.length ? people.map((person) => <span key={person.id} data-status={person.status} title={`${person.name}: ${statusPresentation[person.status].label}`} className="inline-flex shrink-0 items-center gap-1.5 text-sm">
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${statusPresentation[person.status].color}`} />
          {person.name}
        </span>) : <span className="text-sm text-[#53665d]">{unavailable ? "Team status unavailable" : people ? "No users listed" : "Loading team…"}</span>}
      </span>
      <ArrowUpRight size={18} aria-hidden="true" className="ml-auto shrink-0 sm:ml-0" />
    </button>
    <AzureUsageMeter />
    {open ? <ApplicationActivityDashboard onClose={() => setOpen(false)} /> : null}
  </>;
}
