"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { PipelineCalendarEvent, PipelineCalendarEventKind } from "@/lib/pipeline/calendar-types";
import type { Referral } from "@/lib/pipeline/referral-types";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const emptyEvents: PipelineCalendarEvent[] = [];
const eventColors: Record<PipelineCalendarEventKind, string> = {
  referral: "border-l-[#0f8b73] bg-[#effaf5] text-[#174f43]",
  assessment: "border-l-[#4b68ad] bg-[#eef1ff] text-[#354b85]",
  admission: "border-l-[#a16a16] bg-[#fff8ed] text-[#6f4b13]",
  requirement: "border-l-[#a9473d] bg-[#fff3f1] text-[#7c3229]",
};

export default function PipelineCalendar({ onOpenPacket }: { onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [result, setResult] = useState<{ month: string; events: PipelineCalendarEvent[]; error: string }>({ month: "", events: [], error: "" });
  const loading = result.month !== month;
  const events = loading ? emptyEvents : result.events;
  const error = loading ? "" : result.error;

  useEffect(() => {
    let cancelled = false;
    fetchPipelineJson<{ events?: PipelineCalendarEvent[]; error?: string }>(`/api/calendar/events?month=${month}`, { cache: "no-store" })
      .then((payload) => {
        if (!cancelled) setResult({ month, events: payload.events ?? [], error: "" });
      })
      .catch((reason) => {
        if (!cancelled) setResult({ month, events: [], error: reason instanceof Error ? reason.message : "Calendar events could not be loaded." });
      });
    return () => { cancelled = true; };
  }, [month]);

  const days = useMemo(() => calendarDays(month), [month]);
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, PipelineCalendarEvent[]>();
    for (const event of events) grouped.set(event.date, [...(grouped.get(event.date) ?? []), event]);
    return grouped;
  }, [events]);

  return (
    <main className="h-full overflow-y-auto bg-white px-4 pb-8 pt-2 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1480px]">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-[#d9d9d9] pb-3">
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} className="flex h-10 w-10 items-center justify-center border border-[#d9d9d9] text-[#595959] hover:border-[#0f8b73] hover:text-[#0f8b73]"><ChevronLeft size={18} /></button>
            <button type="button" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} className="flex h-10 w-10 items-center justify-center border border-[#d9d9d9] text-[#595959] hover:border-[#0f8b73] hover:text-[#0f8b73]"><ChevronRight size={18} /></button>
            <h1 className="ml-2 text-[20px] font-black text-[#111111]">{monthLabel(month)}</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[11px] text-[#737373]">{loading ? "Loading..." : `${events.length} event${events.length === 1 ? "" : "s"}`}</span>
            <button type="button" onClick={() => setMonth(new Date().toISOString().slice(0, 7))} className="h-10 border border-[#111111] px-4 text-[11px] font-black text-[#111111] hover:bg-[#111111] hover:text-white">Today</button>
          </div>
        </div>

        {error ? <div className="mt-4 border-l-2 border-[#a16a16] bg-[#fff8ed] px-4 py-3 text-[12px] text-[#6f4b13]">{error} Refresh or try another month.</div> : null}

        <div className="mt-4 hidden grid-cols-7 border-l border-t border-[#d9d9d9] md:grid">
          {weekdays.map((day) => <div key={day} className="border-b border-r border-[#d9d9d9] px-3 py-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#737373]">{day}</div>)}
          {days.map((day) => (
            <div key={day.date} className={`min-h-[136px] border-b border-r border-[#d9d9d9] p-2 ${day.inMonth ? "bg-white" : "bg-[#fafafa]"}`}>
              <div className={`mb-2 text-[11px] font-black ${day.today ? "text-[#0f8b73]" : day.inMonth ? "text-[#595959]" : "text-[#a0a0a0]"}`}>{day.day}</div>
              <div className="space-y-1.5">
                {(eventsByDate.get(day.date) ?? []).slice(0, 4).map((event) => (
                  <button key={event.id} type="button" onClick={() => onOpenPacket({ id: event.referralId, name: event.clientName, community: event.community as Referral["community"] })} className={`block w-full border-l-2 px-2 py-1.5 text-left ${eventColors[event.kind]}`}>
                    <span className="block truncate text-[10px] font-black">{event.clientName}</span>
                    <span className="mt-0.5 block truncate text-[9px] opacity-80">{event.title}</span>
                  </button>
                ))}
                {(eventsByDate.get(day.date)?.length ?? 0) > 4 ? <div className="px-2 text-[9px] font-bold text-[#737373]">+{(eventsByDate.get(day.date)?.length ?? 0) - 4} more</div> : null}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 divide-y divide-[#d9d9d9] border-y border-[#d9d9d9] md:hidden">
          {events.length === 0 && !loading ? <div className="py-12 text-center text-[12px] text-[#737373]">No referral events this month.</div> : null}
          {events.map((event) => (
            <button key={event.id} type="button" onClick={() => onOpenPacket({ id: event.referralId, name: event.clientName, community: event.community as Referral["community"] })} className="grid w-full grid-cols-[64px_minmax(0,1fr)] gap-3 py-3 text-left">
              <span className="text-[11px] font-black text-[#0f8b73]">{shortDate(event.date)}</span>
              <span><span className="block text-[12px] font-black text-[#111111]">{event.clientName}</span><span className="mt-1 block text-[10px] text-[#737373]">{event.title} · {event.community}</span></span>
            </button>
          ))}
        </div>

        {!loading && !error && events.length === 0 ? <div className="hidden py-12 text-center text-[12px] text-[#737373] md:block">No referral events this month. New referrals appear here automatically.</div> : null}
      </div>
    </main>
  );
}

function shiftMonth(month: string, amount: number) {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00.000Z`));
}

function shortDate(date: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00.000Z`));
}

function calendarDays(month: string) {
  const first = new Date(`${month}-01T00:00:00.000Z`);
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const today = new Date().toISOString().slice(0, 10);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return { date: key, day: date.getUTCDate(), inMonth: key.startsWith(month), today: key === today };
  });
}
