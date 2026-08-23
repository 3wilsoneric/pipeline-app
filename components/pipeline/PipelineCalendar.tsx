"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { PipelineCalendarEvent, PipelineCalendarEventKind } from "@/lib/pipeline/calendar-types";
import type { Referral } from "@/lib/pipeline/referral-types";

type CalendarView = "month" | "week" | "agenda";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const emptyEvents: PipelineCalendarEvent[] = [];
const eventColors: Record<PipelineCalendarEventKind, string> = {
  referral: "border-l-[#0f8b73] bg-[#effaf5] text-[#174f43]",
  assessment: "border-l-[#4b68ad] bg-[#eef1ff] text-[#354b85]",
  admission: "border-l-[#a16a16] bg-[#fff8ed] text-[#6f4b13]",
  requirement: "border-l-[#a9473d] bg-[#fff3f1] text-[#7c3229]",
};
const kindLabels: Record<PipelineCalendarEventKind, string> = {
  referral: "Referral received",
  assessment: "Assessment",
  admission: "Admission",
  requirement: "Requirement due",
};

export default function PipelineCalendar({ onOpenPacket }: { onOpenPacket: (referral: Pick<Referral, "id" | "name" | "community">) => void }) {
  const [view, setView] = useState<CalendarView>("month");
  const [compactViewport, setCompactViewport] = useState(false);
  const [anchor, setAnchor] = useState(todayKey);
  const [community, setCommunity] = useState("");
  const [owner, setOwner] = useState("");
  const [kind, setKind] = useState<PipelineCalendarEventKind | "">("");
  const displayView: CalendarView = compactViewport ? "agenda" : view;
  const rangeView: CalendarView = compactViewport ? "month" : view;
  const range = useMemo(() => calendarRange(rangeView, anchor), [anchor, rangeView]);
  const requestKey = `${range.from}:${range.to}`;
  const [result, setResult] = useState<{ key: string; events: PipelineCalendarEvent[]; error: string }>({ key: "", events: [], error: "" });
  const loading = result.key !== requestKey;
  const events = loading ? emptyEvents : result.events;
  const error = loading ? "" : result.error;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const syncViewport = () => setCompactViewport(media.matches);
    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ from: range.from, to: range.to });
    fetchPipelineJson<{ events?: PipelineCalendarEvent[] }>(`/api/calendar/events?${params}`, { cache: "no-store" })
      .then((payload) => {
        if (!cancelled) setResult({ key: requestKey, events: payload.events ?? [], error: "" });
      })
      .catch((reason) => {
        if (!cancelled) setResult({ key: requestKey, events: [], error: reason instanceof Error ? reason.message : "Calendar events could not be loaded." });
      });
    return () => { cancelled = true; };
  }, [range.from, range.to, requestKey]);

  const communityOptions = useMemo(() => uniqueValues(events.map((event) => event.community)), [events]);
  const ownerOptions = useMemo(() => uniqueValues(events.map((event) => event.owner)), [events]);
  const visibleEvents = useMemo(() => events.filter((event) => (
    (!community || event.community === community)
    && (!owner || event.owner === owner)
    && (!kind || event.kind === kind)
  )), [community, events, kind, owner]);
  const eventsByDate = useMemo(() => groupEventsByDate(visibleEvents), [visibleEvents]);
  const hasFilters = Boolean(community || owner || kind);

  const openEvent = (event: PipelineCalendarEvent) => onOpenPacket({
    id: event.referralId,
    name: event.clientName,
    community: event.community as Referral["community"],
  });

  return (
    <main aria-busy={loading} className="h-full overflow-y-auto bg-white px-4 pb-8 pt-1 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1480px]">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-[#d9d9d9] py-2">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" aria-label="Previous calendar range" onClick={() => setAnchor(shiftAnchor(rangeView, anchor, -1))} className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#d9d9d9] text-[#595959] hover:border-[#0f8b73] hover:text-[#0f8b73]"><ChevronLeft size={17} /></button>
            <button type="button" aria-label="Next calendar range" onClick={() => setAnchor(shiftAnchor(rangeView, anchor, 1))} className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#d9d9d9] text-[#595959] hover:border-[#0f8b73] hover:text-[#0f8b73]"><ChevronRight size={17} /></button>
            <h1 className="ml-1 truncate text-[17px] font-black text-[#111111] sm:text-[20px]">{rangeLabel(rangeView, range)}</h1>
            <button type="button" onClick={() => setAnchor(todayKey())} className="ml-1 h-9 border border-[#111111] px-3 text-[10px] font-black uppercase tracking-[0.08em] text-[#111111] hover:bg-[#111111] hover:text-white">Today</button>
          </div>
          <div className="flex items-center gap-3">
            <span role="status" aria-live="polite" className="hidden text-[10px] text-[#737373] sm:inline">{loading ? "Loading calendar events..." : `${visibleEvents.length} event${visibleEvents.length === 1 ? "" : "s"}`}</span>
            <div role="group" aria-label="Calendar view" className="flex border border-[#d9d9d9]">
              {(["month", "week", "agenda"] as const).map((option) => (
                <button key={option} type="button" aria-pressed={displayView === option} onClick={() => setView(option)} className={`${option === "agenda" ? "" : "hidden md:block"} h-9 px-3 text-[10px] font-black uppercase tracking-[0.06em] ${displayView === option ? "bg-[#111111] text-white" : "bg-white text-[#595959] hover:text-[#111111]"}`}>{option}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-[#e5e5e5] py-2 md:flex-nowrap md:overflow-x-auto">
          <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.12em] text-[#0c705f]">Show</span>
          <CalendarFilter label="community" value={community} onChange={setCommunity} options={communityOptions} />
          <CalendarFilter label="owner" value={owner} onChange={setOwner} options={ownerOptions} />
          <select aria-label="Filter calendar by event type" value={kind} onChange={(event) => setKind(event.target.value as PipelineCalendarEventKind | "")} className="h-8 w-[154px] shrink-0 border-0 border-b border-[#d9d9d9] bg-white px-1 text-[11px] font-bold text-[#111111] outline-none focus:border-[#0f8b73]">
            <option value="">All event types</option>
            {(Object.keys(kindLabels) as PipelineCalendarEventKind[]).map((value) => <option key={value} value={value}>{kindLabels[value]}</option>)}
          </select>
          {hasFilters ? <button type="button" onClick={() => { setCommunity(""); setOwner(""); setKind(""); }} className="flex h-8 shrink-0 items-center gap-1 px-2 text-[9px] font-black uppercase tracking-[0.08em] text-[#737373] hover:text-[#a63d2f]"><X size={12} /> Clear</button> : null}
        </div>

        {error ? <div role="alert" className="mt-4 border-l-2 border-[#a16a16] bg-[#fff8ed] px-4 py-3 text-[12px] text-[#6f4b13]">{error} Refresh or try another range.</div> : null}

        <div className="hidden md:block">
          {view === "month" ? <MonthView month={anchor.slice(0, 7)} eventsByDate={eventsByDate} onOpen={openEvent} /> : null}
          {view === "week" ? <WeekView range={range} eventsByDate={eventsByDate} onOpen={openEvent} /> : null}
          {view === "agenda" ? <AgendaView events={visibleEvents} loading={loading} hasFilters={hasFilters} onOpen={openEvent} /> : null}
        </div>
        <div className="md:hidden">
          <AgendaView events={visibleEvents} loading={loading} hasFilters={hasFilters} onOpen={openEvent} />
        </div>
      </div>
    </main>
  );
}

function CalendarFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <select aria-label={`Filter calendar by ${label}`} value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-[150px] shrink-0 border-0 border-b border-[#d9d9d9] bg-white px-1 text-[11px] font-bold text-[#111111] outline-none focus:border-[#0f8b73]">
      <option value="">All {label === "community" ? "communities" : "owners"}</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}

function MonthView({ month, eventsByDate, onOpen }: { month: string; eventsByDate: Map<string, PipelineCalendarEvent[]>; onOpen: (event: PipelineCalendarEvent) => void }) {
  const days = calendarDays(month);
  return (
    <div className="mt-4 grid grid-cols-7 border-l border-t border-[#d9d9d9]">
      {weekdays.map((day) => <div key={day} className="border-b border-r border-[#d9d9d9] px-3 py-2 text-[9px] font-black uppercase tracking-[0.08em] text-[#737373]">{day}</div>)}
      {days.map((day) => {
        const dayEvents = eventsByDate.get(day.date) ?? [];
        return (
          <div key={day.date} className={`min-h-[132px] border-b border-r border-[#d9d9d9] p-2 ${day.inMonth ? "bg-white" : "bg-[#fafafa]"}`}>
            <div className={`mb-2 text-[10px] font-black ${day.today ? "text-[#0f8b73]" : day.inMonth ? "text-[#595959]" : "text-[#a0a0a0]"}`}>{day.day}</div>
            <div className="space-y-1.5">
              {dayEvents.slice(0, 4).map((event) => <CalendarEventButton key={event.id} event={event} onOpen={onOpen} compact />)}
              {dayEvents.length > 4 ? <div className="px-2 text-[9px] font-bold text-[#737373]">+{dayEvents.length - 4} more</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeekView({ range, eventsByDate, onOpen }: { range: { from: string; to: string }; eventsByDate: Map<string, PipelineCalendarEvent[]>; onOpen: (event: PipelineCalendarEvent) => void }) {
  return (
    <div className="mt-4 grid grid-cols-7 border-l border-t border-[#d9d9d9]">
      {dateKeys(range.from, range.to).map((date, index) => (
        <div key={date} className="min-h-[430px] border-b border-r border-[#d9d9d9] bg-white">
          <div className={`border-b border-[#e5e5e5] px-3 py-3 ${date === todayKey() ? "bg-[#effaf5]" : ""}`}>
            <span className="block text-[9px] font-black uppercase tracking-[0.08em] text-[#737373]">{weekdays[index]}</span>
            <span className="mt-1 block text-[13px] font-black text-[#111111]">{shortDate(date)}</span>
          </div>
          <div className="space-y-2 p-2">
            {(eventsByDate.get(date) ?? []).map((event) => <CalendarEventButton key={event.id} event={event} onOpen={onOpen} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgendaView({ events, loading, hasFilters, onOpen }: { events: PipelineCalendarEvent[]; loading: boolean; hasFilters: boolean; onOpen: (event: PipelineCalendarEvent) => void }) {
  const groups = groupEventsByDate(events);
  return (
    <div className="mt-4 border-y border-[#d9d9d9]">
      {!loading && events.length === 0 ? <div className="py-14 text-center text-[12px] text-[#737373]">{hasFilters ? "No events match these filters." : "No referral events in this range."}</div> : null}
      {[...groups.entries()].map(([date, dayEvents]) => (
        <section key={date} className="grid border-b border-[#e5e5e5] last:border-b-0 md:grid-cols-[150px_minmax(0,1fr)]">
          <div className="bg-[#fafafa] px-4 py-4"><div className="text-[12px] font-black text-[#111111]">{longDate(date)}</div><div className="mt-1 text-[9px] font-black uppercase tracking-[0.08em] text-[#0c705f]">{dayEvents.length} event{dayEvents.length === 1 ? "" : "s"}</div></div>
          <div className="divide-y divide-[#e5e5e5]">
            {dayEvents.map((event) => (
              <button key={event.id} type="button" onClick={() => onOpen(event)} className="grid w-full gap-2 px-4 py-3 text-left hover:bg-[#f7faf9] sm:grid-cols-[minmax(0,1fr)_160px_120px]">
                <span className="min-w-0"><span className="block truncate text-[13px] font-black text-[#111111]">{event.clientName}</span><span className="mt-1 block truncate text-[11px] text-[#737373]">{event.title} · {event.detail}</span></span>
                <span className="truncate text-[11px] font-semibold text-[#595959]">{event.community}</span>
                <span className="truncate text-[10px] text-[#737373]">{event.owner}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function CalendarEventButton({ event, onOpen, compact = false }: { event: PipelineCalendarEvent; onOpen: (event: PipelineCalendarEvent) => void; compact?: boolean }) {
  return (
    <button type="button" onClick={() => onOpen(event)} title={`${event.clientName} · ${event.title} · ${event.owner}`} className={`block w-full border-l-2 px-2 text-left ${compact ? "py-1.5" : "py-2"} ${eventColors[event.kind]}`}>
      <span className={`block truncate font-black ${compact ? "text-[9px]" : "text-[11px]"}`}>{event.clientName}</span>
      <span className={`mt-0.5 block truncate opacity-80 ${compact ? "text-[8px]" : "text-[9px]"}`}>{event.title}</span>
      {!compact ? <span className="mt-1 block truncate text-[8px] opacity-70">{event.owner}</span> : null}
    </button>
  );
}

function calendarRange(view: CalendarView, anchor: string) {
  if (view === "week") {
    const date = parseDate(anchor);
    date.setUTCDate(date.getUTCDate() - date.getUTCDay());
    const from = dateKey(date);
    return { from, to: addDays(from, 6) };
  }
  if (view === "agenda") return { from: anchor, to: addDays(anchor, 29) };
  const from = `${anchor.slice(0, 7)}-01`;
  const date = parseDate(from);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return { from, to: dateKey(date) };
}

function shiftAnchor(view: CalendarView, anchor: string, direction: number) {
  if (view === "month") {
    const date = parseDate(`${anchor.slice(0, 7)}-01`);
    date.setUTCMonth(date.getUTCMonth() + direction);
    return dateKey(date);
  }
  return addDays(anchor, direction * (view === "week" ? 7 : 30));
}

function rangeLabel(view: CalendarView, range: { from: string; to: string }) {
  if (view === "month") return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(parseDate(range.from));
  return `${shortDate(range.from)} - ${shortDate(range.to)}`;
}

function groupEventsByDate(events: PipelineCalendarEvent[]) {
  const grouped = new Map<string, PipelineCalendarEvent[]>();
  for (const event of events) grouped.set(event.date, [...(grouped.get(event.date) ?? []), event]);
  return grouped;
}

function uniqueValues(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function parseDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, amount: number) {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

function dateKeys(from: string, to: string) {
  const values: string[] = [];
  for (let current = from; current <= to; current = addDays(current, 1)) values.push(current);
  return values;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(parseDate(value));
}

function longDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(parseDate(value));
}

function calendarDays(month: string) {
  const first = parseDate(`${month}-01`);
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  const today = todayKey();
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const key = dateKey(date);
    return { date: key, day: date.getUTCDate(), inMonth: key.startsWith(month), today: key === today };
  });
}
