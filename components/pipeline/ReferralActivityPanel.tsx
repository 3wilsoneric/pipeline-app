"use client";

import { useEffect, useState } from "react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { ReferralActivityEvent } from "@/lib/pipeline/referral-activity";

export default function ReferralActivityPanel({ referralId, version }: { referralId?: number; version?: number }) {
  const [events, setEvents] = useState<ReferralActivityEvent[]>([]);

  useEffect(() => {
    if (!referralId) return;
    let cancelled = false;
    fetchPipelineJson<{ events: ReferralActivityEvent[] }>(`/api/referrals/${referralId}/activity`, { cache: "no-store" })
      .then((payload) => {
        if (!cancelled) setEvents(payload.events ?? []);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [referralId, version]);

  if (!referralId || events.length === 0) return null;

  return (
    <section aria-label="Referral activity" className="mt-5 border-t border-[#d9d9d9] pt-5">
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#0f8b73]">Activity</div>
      <div className="mt-3 divide-y divide-[#eeeeee] border-y border-[#d9d9d9]">
        {events.slice(0, 8).map((event) => (
          <div key={event.event_id} className="grid gap-1 py-2 text-[11px] sm:grid-cols-[minmax(0,1fr)_180px_150px] sm:gap-4">
            <span className="font-black text-[#111111]">{formatAction(event.action)}</span>
            <span className="text-[#595959]">{event.actor_name}</span>
            <time className="text-[#737373] sm:text-right" dateTime={event.created_at}>{formatTimestamp(event.created_at)}</time>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatAction(action: string) {
  return action.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
