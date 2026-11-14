"use client";

import { useEffect, useRef, useState } from "react";
import { fetchPipelineApi, fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import type { AssessorScorecard as Snapshot, ScorecardEvidence, ScorecardMetric, ScorecardPeriod } from "@/lib/pipeline/assessor-scorecard-types";
import { scorecardLabels as labels, sortScorecardPeople, type ScorecardSort as Sort } from "@/lib/pipeline/assessor-scorecard-presentation";
import styles from "./AssessorScorecard.module.css";

const columns: ScorecardMetric[] = ["confirmed", "clients", "handoffs", "assigned", "gaps"];

export default function AssessorScorecard() {
  const [period, setPeriod] = useState<ScorecardPeriod>("30d");
  const [refresh, setRefresh] = useState(0);
  const [sort, setSort] = useState<Sort>("confirmed");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const exportPdf = async () => {
    if (exporting) return;
    setExporting(true); setExportError(false);
    try {
      const response = await fetchPipelineApi(`/api/operations/assessor-scorecard?period=${period}&format=pdf&sort=${sort}`, { cache: "no-store" });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) throw new Error("Export unavailable");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `pipeline-assessor-scorecard-${period}.pdf`;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch { setExportError(true); }
    finally { setExporting(false); }
  };
  const reload = () => { setSort("confirmed"); setRefresh((value) => value + 1); };
  return <main aria-label="Assessor scorecard" data-testid="operations-workspace" className={styles.page}>
    <article className={styles.body}>
      <h1 className="sr-only">Assessor scorecard</h1>
      <header className={styles.toolbar}>
        <div className={styles.controls}><label><span>Period</span><select value={period} onChange={(event) => { setSort("confirmed"); setPeriod(event.target.value as ScorecardPeriod); }}>
          <option value="30d">Last 30 days</option><option value="week">This week</option><option value="launch">Since Pipeline launch</option>
        </select></label>
        <label><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          <option value="interviews">Interviews finished</option><option value="confirmed">Charts confirmed</option><option value="clients">Clients worked</option><option value="handoffs">Handoffs sent</option><option value="gaps">Open completion items</option><option value="interactions">Clicks / taps</option><option value="name">Name</option>
        </select></label>
        <div className={styles.actions}><button className={styles.refresh} type="button" onClick={reload}>Refresh</button>
        <button className={styles.refresh} type="button" disabled={exporting} onClick={() => void exportPdf()}>{exporting ? "Exporting…" : "Export PDF"}</button></div></div>
      </header>
      {exportError ? <p className={styles.notice} role="alert">PDF unavailable. Try Export PDF again.</p> : null}
      <div className={styles.results}><ScorecardResults key={`${period}:${refresh}`} period={period} sort={sort} retry={reload} /></div>
    </article>
  </main>;
}

function ScorecardResults({ period, sort, retry }: { period: ScorecardPeriod; sort: Sort; retry: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [selection, setSelection] = useState<{ person: string; metric: ScorecardMetric } | null>(null);
  const details = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchPipelineJson<Snapshot>(`/api/operations/assessor-scorecard?period=${period}`, { signal: controller.signal, cache: "no-store" })
      .then((data) => { if (!controller.signal.aborted) setSnapshot(data); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [period]);
  useEffect(() => { if (selection) details.current?.focus({ preventScroll: false }); }, [selection]);
  if (error) return <div role="alert" className={styles.notice}>Scorecard unavailable. Your workspaces are still available. <button type="button" onClick={retry}>Retry</button></div>;
  if (!snapshot) return <p role="status">Loading scorecard…</p>;
  const people = sortScorecardPeople(snapshot.people, sort);
  const selected = people.find((person) => person.id === selection?.person);
  const maximum = Math.max(1, ...people.map((person) => person.evidence.confirmed.length));
  return <>
    {!people.length ? <p className={styles.notice}>No assessor records in this period.</p> : <table className={styles.table}>
      <caption className="sr-only">Assessor work and current follow-through. Select a total to see its records.</caption>
      <thead><tr><th scope="col">Assessor</th>{columns.map((metric) => <th key={metric} scope="col">{labels[metric]}</th>)}<th scope="col">Clicks / taps</th></tr></thead>
      <tbody>{people.map((person) => <tr key={person.id} data-selected={selection?.person === person.id}>
        <th scope="row"><button className={styles.name} type="button" onClick={() => setSelection({ person: person.id, metric: "confirmed" })}>{person.name}</button>
          <span className={styles.sub}>{person.activeDays} days with recorded work{person.active ? "" : " · Inactive account"}</span></th>
        {columns.map((metric) => <td key={metric} data-current={metric === "assigned" || metric === "gaps"}>
          <span className={styles.mobileLabel}>{labels[metric]}</span>
          <button type="button" aria-label={`${person.name}: ${person.evidence[metric].length} ${labels[metric].toLowerCase()}`} onClick={() => setSelection({ person: person.id, metric })} className={styles.total}>
            {person.evidence[metric].length}
            {metric === "confirmed" ? <span aria-hidden="true" className={styles.bar}><span style={{ width: `${100 * person.evidence.confirmed.length / maximum}%` }} /></span> : null}
          </button>
        </td>)}
        <td><span className={styles.mobileLabel}>Clicks / taps</span><span className={styles.usage}>{person.usage ? person.usage.interactions.toLocaleString() : "—"}</span>
          <span className={styles.sub}>{person.usage ? `${person.usage.activeMinutes} active min` : "Not tracked"}</span></td>
      </tr>)}</tbody>
    </table>}
    <div className={styles.context}>
      <p>{day(snapshot.since)}–{day(snapshot.through)} · Pacific time<br /><span>Native Pipeline workspaces · Current assignments and gaps as of {day(snapshot.through)}</span></p>
    </div>
    <p className={styles.coverage}>{snapshot.usageSince ? `Usage tracking began ${day(snapshot.usageSince)}. Earlier clicks and active minutes are unavailable.` : "Historical click and active-time data are unavailable. Tracking starts when this release is enabled."}</p>
    {(snapshot.unattributedEvents || snapshot.unassignedWorkspaces || snapshot.unassignedGapItems) ? <p className={styles.notice}>
      {snapshot.unattributedEvents} unlinked audit events · {snapshot.unassignedWorkspaces} unassigned workspaces · {snapshot.unassignedGapItems} completion items without a linked owner. These are not credited to an assessor.
    </p> : null}
    {selected && selection ? <div ref={details} tabIndex={-1} className={styles.detail} aria-label={`${selected.name} breakdown`}>
      <div className={styles.detailHeader}><h3>{selected.name}</h3><span>{selected.usage ? `${selected.usage.days} days with tracked interaction` : "Usage not tracked"}</span></div>
      <div className={styles.metrics} aria-label="Work measures">
        {(Object.keys(labels) as ScorecardMetric[]).map((metric) => <button key={metric} type="button" aria-pressed={selection.metric === metric} onClick={() => setSelection({ person: selected.id, metric })}>
          <strong>{selected.evidence[metric].length}</strong> {labels[metric]}
        </button>)}
      </div>
      <p className={styles.coverage}>Median start-to-finish interval: {selected.interviewSpanHours === null ? "not available" : `${selected.interviewSpanHours.toFixed(1)} hours (${selected.interviewSpanSamples} interviews)`}. Elapsed time includes pauses; it is not time worked.</p>
      <h4>{labels[selection.metric]}</h4>
      <EvidenceList key={`${selected.id}:${selection.metric}`} evidence={selected.evidence[selection.metric]} />
    </div> : null}
    <details className={styles.methods}><summary>How this is counted</summary>
      <ul>
        <li>Charts confirmed count the first recorded chart confirmation per assessment, including denied cases. Interviews finished counts explicit finish events only; an absent event does not mean no interview occurred. Later reconfirmations do not add completions. Credit follows the actor who recorded the action, not today’s owner.</li>
        <li>Clients worked counts distinct workspaces with a recorded contribution. Fields touched counts a field once per assessor and assessment in the period. It does not judge answer quality. Notes have no complete author history and are not counted.</li>
        <li>Handoffs count the first accepted send per workspace. Additional handoffs and failed or unknown attempts are separate; “sent” does not prove recipient delivery.</li>
        <li>Assigned and completion items reflect the current record, using the same rules as Home and the completion memo. Gaps may depend on other teams; they are not a grade.</li>
        <li>Clicks / taps includes control activations by keyboard. Active minutes are distinct minutes containing a foreground interaction, deduplicated across tabs. They are approximate usage, not hours worked. No typed text, client data or screen recordings are captured. Offline or blocked tracking can leave gaps.</li>
        <li>Historical imports, trashed workspaces, demo sessions and recorded God mode actions are excluded. No overall performance score or acceptance-rate ranking is calculated.</li>
      </ul>
    </details>
  </>;
}

function EvidenceList({ evidence }: { evidence: ScorecardEvidence[] }) {
  const [limit, setLimit] = useState(20);
  const grouped = new Map<number, { first: ScorecardEvidence; items: ScorecardEvidence[] }>();
  for (const item of evidence) {
    const group = grouped.get(item.referralId) ?? { first: item, items: [] };
    group.items.push(item); grouped.set(item.referralId, group);
  }
  const groups = [...grouped.values()].sort((a, b) => a.first.client.localeCompare(b.first.client));
  return !groups.length ? <p className={styles.coverage}>No records for this measure.</p> : <>
    <ul className={styles.evidence}>{groups.slice(0, limit).map(({ first, items }) => <li key={first.referralId}>
      <div><a href={toPipelinePath(`/?view=referrals&screen=packet&referralId=${first.referralId}&workspaceStage=chart`)}>{first.client}</a><span>{first.community} · Workspace #{first.referralId}</span></div>
      {items.length === 1 ? <p>{first.detail}{first.at ? <time dateTime={first.at}> · {day(first.at)}</time> : null}</p> : <details><summary>{items.length} records</summary><ul>{items.map((item) => <li key={item.key}>{item.detail}{item.at ? <time dateTime={item.at}> · {day(item.at)}</time> : null}</li>)}</ul></details>}
    </li>)}</ul>
    {groups.length > limit ? <button type="button" className={styles.more} onClick={() => setLimit((value) => value + 20)}>Show more clients</button> : null}
  </>;
}
function day(value: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
