"use client";

import { useEffect, useState } from "react";
import { fetchPipelineApi, fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { Download, RefreshCw } from "lucide-react";
import type { AssessorScorecard as Snapshot, ScorecardPeriod } from "@/lib/pipeline/assessor-scorecard-types";
import { scorecardTrendMeasures, scorecardDisplayLabels, type ScorecardTrendMeasure, sortScorecardPeople, type ScorecardSort as Sort } from "@/lib/pipeline/assessor-scorecard-presentation";
import styles from "./AssessorScorecard.module.css";
import AssessorScorecardDetail from "./AssessorScorecardDetail";
import type { HomeDialogOrigin } from "./HomeDialog";
import AssessorScorecardCharts, { type ScorecardSelection } from "./AssessorScorecardCharts";

export default function AssessorScorecard() {
  const [period, setPeriod] = useState<ScorecardPeriod>("launch");
  const [refresh, setRefresh] = useState(0);
  const [sort, setSort] = useState<Sort>("days");
  const [measure, setMeasure] = useState<ScorecardTrendMeasure>("days");
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
  const reload = () => { setSort("days"); setRefresh((value) => value + 1); };
  return <main aria-label="Assessor scorecard" data-testid="operations-workspace" className={styles.page}>
    <article className={styles.body}>
      <h1 className="sr-only">Assessor scorecard</h1>
      <header className={styles.toolbar}>
        <div className={styles.controls}><label><span>Period</span><select value={period} onChange={(event) => { setSort("days"); setPeriod(event.target.value as ScorecardPeriod); }}>
          <option value="30d">Last 30 days</option><option value="week">This week</option><option value="launch">Since launch</option>
        </select></label>
        <label><span>Sort by</span><select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          <option value="days">Recorded workdays</option><option value="interviews">Interviews</option><option value="confirmed">Confirmations</option><option value="clients">Clients worked</option><option value="handoffs">Handoffs sent</option><option value="gaps">Open items</option><option value="interactions">Clicks / taps</option><option value="name">Name</option>
        </select></label>
        <label className={styles.measureControl}><span>Measure</span><select value={measure} onChange={event => setMeasure(event.target.value as ScorecardTrendMeasure)}>
          {scorecardTrendMeasures.map(key => <option key={key} value={key}>{scorecardDisplayLabels[key]}</option>)}
        </select></label>
        <div className={styles.actions}><button className={styles.refresh} type="button" onClick={reload}><RefreshCw size={17} aria-hidden="true" />Refresh</button>
        <button className={styles.refresh} type="button" disabled={exporting} onClick={() => void exportPdf()}><Download size={17} aria-hidden="true" />{exporting ? "Exporting…" : "Export PDF"}</button></div></div>
      </header>
      {exportError ? <p className={styles.notice} role="alert">PDF unavailable. Try Export PDF again.</p> : null}
      <div className={styles.results}><ScorecardResults key={`${period}:${refresh}`} period={period} sort={sort} measure={measure} retry={reload} /></div>
    </article>
  </main>;
}

function ScorecardResults({ period, sort, measure, retry }: { period: ScorecardPeriod; sort: Sort; measure: ScorecardTrendMeasure; retry: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [selection, setSelection] = useState<(ScorecardSelection & { origin: HomeDialogOrigin }) | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchPipelineJson<Snapshot>(`/api/operations/assessor-scorecard?period=${period}`, { signal: controller.signal, cache: "no-store" })
      .then((data) => { if (!controller.signal.aborted) setSnapshot(data); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [period]);
  if (error) return <div role="alert" className={styles.notice}>Scorecard unavailable. Your workspaces are still available. <button type="button" onClick={retry}>Retry</button></div>;
  if (!snapshot) return <p role="status">Loading scorecard…</p>;
  const people = sortScorecardPeople(snapshot.people, sort);
  const selected = people.find((person) => person.id === selection?.person);
  return <>
    <div className={styles.context}><span>{day(snapshot.since)}–{day(snapshot.through)} · Pacific time</span><span>Select an assessor to explore</span></div>
    {!people.length ? <p className={styles.notice}>No assessor records in this period.</p> : <AssessorScorecardCharts measure={measure} snapshot={snapshot} people={people} onSelect={(next, trigger) => {
      const { left, top, width, height } = trigger.getBoundingClientRect();
      setSelection({ ...next, origin: { left, top, width, height } });
    }} />}
    {selected && selection ? <AssessorScorecardDetail person={selected} snapshot={snapshot} selection={selection} origin={selection.origin}
      onSelect={next => setSelection({ ...next, origin: selection.origin })} onClose={() => setSelection(null)} /> : null}
    <details className={styles.methods}><summary>How this is counted</summary>
      <p>Native Pipeline workspaces · {snapshot.usageSince ? `Usage tracking began ${day(snapshot.usageSince)}. Earlier clicks and active minutes are unavailable.` : "Historical click and active-time data are unavailable. Tracking starts when this release is enabled."}</p>
      {(snapshot.unattributedEvents || snapshot.unassignedWorkspaces || snapshot.unassignedGapItems) ? <p>{snapshot.unattributedEvents} unlinked audit events · {snapshot.unassignedWorkspaces} unassigned workspaces · {snapshot.unassignedGapItems} completion items without a linked owner. These are not credited to an assessor.</p> : null}
      <ul>
        <li>Charts confirmed count the first recorded chart confirmation per assessment, including denied cases. Interviews finished counts explicit finish events only; an absent event does not mean no interview occurred. Later reconfirmations do not add completions. Credit follows the actor who recorded the action, not today’s owner.</li>
        <li>Days with recorded work count Pacific days containing substantive saved work. Empty autosaves do not count. Weekly client counts include repeat contributions in later weeks; adding weeks does not give the distinct total.</li>
        <li>Clients worked counts distinct workspaces with a recorded contribution. Fields touched counts a field once per assessor and assessment in the period. It does not judge answer quality. Notes have no complete author history and are not counted.</li>
        <li>Handoffs count the first accepted send per workspace. Additional handoffs and failed or unknown attempts are separate; “sent” does not prove recipient delivery.</li>
        <li>Assigned and completion items reflect the current record, using the same rules as Home and the completion memo. Gaps may depend on other teams; they are not a grade.</li>
        <li>Clicks / taps includes control activations by keyboard. Active minutes are distinct minutes containing a foreground interaction, deduplicated across tabs. They are approximate usage, not hours worked. No typed text, client data or screen recordings are captured. Offline or blocked tracking can leave gaps.</li>
        <li>Historical imports, trashed workspaces, demo sessions and recorded God mode actions are excluded. No overall performance score or acceptance-rate ranking is calculated.</li>
      </ul>
    </details>
  </>;
}

function day(value: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
