"use client";

import { useEffect, useRef, useState } from "react";
import HomeDialog from "@/components/pipeline/HomeDialog";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { activityEventLabel } from "@/lib/pipeline/referral-activity-presentation";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import type { ApplicationActivityEvent, ApplicationActivitySnapshot } from "@/lib/pipeline/application-activity-types";

export default function ApplicationActivityDashboard({ onClose }: { onClose: () => void }) {
  const [days, setDays] = useState("1");
  const [actor, setActor] = useState("");
  const [through, setThrough] = useState(() => new Date().toISOString());
  const [people, setPeople] = useState<ApplicationActivitySnapshot["people"]>([]);
  return <HomeDialog label="Application activity" title="Application activity" size="browser" description="Your private view of recorded sign-ins and actions across Pipeline." onClose={onClose}>
    <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="min-w-36 flex-1 text-sm font-medium">Period
          <select value={days} onChange={(event) => { setDays(event.target.value); setThrough(new Date().toISOString()); }} className="mt-1 block min-h-11 w-full rounded border border-[#b7c6bf] bg-white px-3">
            <option value="1">Last 24 hours</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option>
          </select>
        </label>
        <label className="min-w-36 flex-1 text-sm font-medium">Person
          <select value={actor} onChange={(event) => setActor(event.target.value)} className="mt-1 block min-h-11 w-full rounded border border-[#b7c6bf] bg-white px-3">
            <option value="">Everyone</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setThrough(new Date().toISOString())} className="min-h-11 rounded border border-[#b7c6bf] px-4 text-sm font-semibold">Refresh</button>
      </div>
      <ActivityResults key={`${days}:${actor}:${through}`} days={Number(days)} actor={actor} through={through} onPeople={setPeople} />
    </div>
  </HomeDialog>;
}

function ActivityResults({ days, actor, through, onPeople }: { days: number; actor: string; through: string; onPeople: (people: ApplicationActivitySnapshot["people"]) => void }) {
  const [data, setData] = useState<ApplicationActivitySnapshot | null>(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const query = new URLSearchParams({ since: new Date(Date.parse(through) - days * 86400_000).toISOString(), through, ...(actor ? { actor } : {}) }).toString();
  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    void fetchPipelineJson<ApplicationActivitySnapshot>(`/api/operations/application-activity?${query}`, { signal: active.signal, cache: "no-store" })
      .then((response) => { if (!active.signal.aborted) { setData(response); onPeople(response.people); setError(""); } })
      .catch(() => { if (!active.signal.aborted) setError("Activity could not be loaded. Your workspaces are still available. Try again."); });
    return () => active.abort();
  }, [query, attempt, onPeople]);

  async function loadMore() {
    if (!data?.next_cursor || loadingMore) return;
    const signal = controller.current?.signal;
    setLoadingMore(true);
    try {
      const response = await fetchPipelineJson<ApplicationActivitySnapshot>(`/api/operations/application-activity?${query}&cursor=${encodeURIComponent(data.next_cursor)}`, { signal, cache: "no-store" });
      if (!signal?.aborted) {
        setData((current) => current ? { ...current, events: [...current.events, ...response.events], next_cursor: response.next_cursor } : response);
        setError("");
      }
    } catch { if (!signal?.aborted) setError("Older activity could not be loaded. Try loading more again."); }
    finally { if (!signal?.aborted) setLoadingMore(false); }
  }

  const visiblePeople = data?.people.filter((person) => !actor || person.id === actor) ?? [];
  return <>
    {error ? <div role="alert" className="mb-4 rounded border border-[#cbd6d2] p-3 text-sm">{error} {!data ? <button type="button" className="ml-2 min-h-11 underline" onClick={() => setAttempt((value) => value + 1)}>Retry</button> : null}</div> : null}
    {!data && !error ? <p role="status">Loading activity…</p> : null}
    {data ? <>
      <p className="mb-3 text-xs text-[#53665d]">Updated {dateTime(data.through)} · Times shown in your time zone</p>
      <h3 className="mb-2 font-semibold">People</h3>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visiblePeople.map((person) => <article key={person.id} className="min-w-0 rounded-lg border border-[#dce4e0] p-3">
          <h4 className="break-words font-semibold">{person.name}</h4>
          {person.email ? <p className="break-all text-xs text-[#53665d]">{person.email}</p> : null}
          <dl className="mt-3 space-y-1 text-sm">
            <div><dt className="inline text-[#53665d]">Last activity: </dt><dd className="inline">{person.last_seen_at ? dateTime(person.last_seen_at) : "Not recorded"}</dd></div>
            <div><dt className="inline text-[#53665d]">Last sign-in in period: </dt><dd className="inline">{person.last_sign_in_at ? dateTime(person.last_sign_in_at) : "None recorded"}</dd></div>
            <div><dt className="inline text-[#53665d]">In period: </dt><dd className="inline">{person.sign_ins} sign-ins · {person.recorded_actions} actions</dd></div>
          </dl>
        </article>)}
      </div>
      <h3 className="font-semibold">Activity timeline</h3>
      <p className="mt-1 text-xs leading-5 text-[#53665d]">Recorded actions, not time worked or every click. Sign-in history starts with this feature; last activity can be more recent than sign-in. Changed field names are shown here; open the workspace for its full activity. One save can produce multiple audit records.</p>
      {data.events.length ? <ol className="mt-3 divide-y divide-[#dce4e0]">{data.events.map((event) => <ActivityRow key={event.id} event={event} />)}</ol> : <p className="py-8 text-sm text-[#53665d]">No recorded activity in this period.</p>}
      {data.next_cursor ? <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="mt-4 min-h-11 rounded border border-[#b7c6bf] px-4 text-sm font-semibold">{loadingMore ? "Loading…" : "Load more"}</button> : null}
    </> : null}
  </>;
}

function ActivityRow({ event }: { event: ApplicationActivityEvent }) {
  const workspace = event.workspace;
  return <li className="py-4 text-sm">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><strong className="break-words">{event.actor_name}</strong><time dateTime={event.created_at} className="text-xs text-[#53665d]">{dateTime(event.created_at)}</time></div>
    <p className="mt-1">{activityEventLabel(event)}</p>
    {workspace ? <p className="mt-1 break-words">{workspace.deleted ? `${workspace.name} · Workspace #${workspace.id} (deleted)` : <a className="font-medium text-[#08705c] underline underline-offset-2" href={toPipelinePath(`/?view=referrals&screen=packet&referralId=${workspace.id}`)}>{workspace.name} · Workspace #{workspace.id}</a>}</p> : event.entity_type !== "auth_session" ? <p className="mt-1 break-all text-xs text-[#53665d]">{event.entity_type.replaceAll("_", " ")} · {event.entity_id}</p> : null}
    {event.fields.length ? <p className="mt-1 break-words text-xs leading-5 text-[#53665d]">Changed: {event.fields.join(", ")}</p> : null}
  </li>;
}

function dateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
