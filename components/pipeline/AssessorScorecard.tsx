"use client";

import { useEffect, useRef, useState } from "react";
import { fetchPipelineApi, fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { Download, ChevronDown } from "lucide-react";
import type { AssessorScorecard as Snapshot, ScorecardPeriod } from "@/lib/pipeline/assessor-scorecard-types";
import { scorecardTrendMeasures, scorecardDisplayLabels, type ScorecardTrendMeasure, sortScorecardPeople, type ScorecardSort as Sort } from "@/lib/pipeline/assessor-scorecard-presentation";
import { admissionFlowToday } from "@/lib/pipeline/admission-flow-day";
import { admissionFlowStartDate } from "@/lib/pipeline/admission-flow-cohort";
import { scorecardRange, type ScorecardDates } from "@/lib/pipeline/assessor-scorecard-period";
import styles from "./AssessorScorecard.module.css";
import AssessorScorecardDetail from "./AssessorScorecardDetail";
import AssessorScorecardNarratives from "./AssessorScorecardNarratives";
import type { HomeDialogOrigin } from "./HomeDialog";
import AssessorScorecardCharts, { type ScorecardSelection } from "./AssessorScorecardCharts";

export default function AssessorScorecard() {
  const [scope, setScope] = useState<{ period: ScorecardPeriod; dates: ScorecardDates }>({ period: "4w", dates: {} });
  const [scopeChanged, setScopeChanged] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const sort: Sort = "days";
  const [measure, setMeasure] = useState<ScorecardTrendMeasure>("days");
  const query = new URLSearchParams({ period: scope.period, ...scope.dates }).toString();
  const reload = () => setRefresh((value) => value + 1);
  return <main aria-label="Assessor scorecard" data-testid="operations-workspace" className={styles.page}>
    <article className={styles.body}>
      <h1 className="sr-only">Assessor scorecard</h1>
      <div className={styles.results}><ScorecardResults key={`${query}:${refresh}`} query={query} period={scope.period} focusScope={scopeChanged} onScopeChange={next => { setScopeChanged(true); setScope(next); }} sort={sort} measure={measure} onMeasureChange={setMeasure} retry={reload} /></div>
    </article>
  </main>;
}

function ScorecardResults({ query, period, focusScope, onScopeChange, sort, measure, onMeasureChange, retry }: {
  query: string; period: ScorecardPeriod; focusScope: boolean; onScopeChange: (scope: { period: ScorecardPeriod; dates: ScorecardDates }) => void;
  sort: Sort; measure: ScorecardTrendMeasure; onMeasureChange: (measure: ScorecardTrendMeasure) => void; retry: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [selection, setSelection] = useState<(ScorecardSelection & { origin: HomeDialogOrigin }) | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchPipelineJson<Snapshot>(`/api/operations/assessor-scorecard?${query}`, { signal: controller.signal, cache: "no-store" })
      .then((data) => { if (!controller.signal.aborted) setSnapshot(data); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [query]);
  if (error) return <div role="alert" className={styles.notice}>Scorecard unavailable. Your workspaces are still available. <button type="button" onClick={retry}>Retry</button></div>;
  if (!snapshot) return <p role="status">Loading scorecard…</p>;
  const people = sortScorecardPeople(snapshot.people, sort);
  const detailSnapshot = selection?.comparison ? snapshot.comparison ?? snapshot : snapshot;
  const selected = detailSnapshot.people.find(person => person.id === selection?.person);
  const openDetail = (next: ScorecardSelection, trigger: HTMLButtonElement) => {
    const { left, top, width, height } = trigger.getBoundingClientRect();
    setSelection({ ...next, origin: { left, top, width, height } });
  };
  return <>
    <DateScope snapshot={snapshot} period={period} focusOnMount={focusScope} onChange={onScopeChange} />
    {!people.length ? <p className={styles.notice}>No assessor records in this period.</p> : <>
      <AssessorScorecardNarratives snapshot={snapshot} people={people} onSelect={openDetail} />
      <p className={styles.coverage}>Saved work is not attendance or clinical quality. {snapshot.complete ? "Activity covers completed days;" : "Activity includes the partial final day;"} current assignments do not establish why a client is waiting.</p>
      <details className={styles.comparisons}>
        <summary>Compare measures</summary>
        <div className={styles.controls}>
        <label className={styles.measureControl}><span>Measure</span><select value={measure} onChange={event => onMeasureChange(event.target.value as ScorecardTrendMeasure)}>
          {scorecardTrendMeasures.map(key => <option key={key} value={key}>{scorecardDisplayLabels[key]}</option>)}
        </select></label>
        </div>
        <AssessorScorecardCharts measure={measure} snapshot={snapshot} people={people} onSelect={openDetail} />
      </details>
    </>}
    {selected && selection ? <AssessorScorecardDetail person={selected} snapshot={detailSnapshot} selection={selection} origin={selection.origin}
      onSelect={next => setSelection({ ...next, origin: selection.origin })} onClose={() => setSelection(null)} /> : null}
    <details className={styles.methods}><summary>How this is counted</summary>
      <p>{day(snapshot.since)}–{day(snapshot.through)} · Pacific time</p>
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
    <ScorecardExport snapshot={snapshot} sort={sort} />
  </>;
}

function day(value: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

const periodLabels: Partial<Record<ScorecardPeriod, string>> = { "4w": "Last four weeks", last_week: "Last week", custom: "Custom dates", launch: "Since launch" };

function DateScope({ snapshot, period, focusOnMount, onChange }: { snapshot: Snapshot; period: ScorecardPeriod; focusOnMount: boolean; onChange: (scope: { period: ScorecardPeriod; dates: ScorecardDates }) => void }) {
  const summary = useRef<HTMLElement>(null);
  useEffect(() => { if (focusOnMount) summary.current?.focus({ preventScroll: true }); }, [focusOnMount]);
  const [choice, setChoice] = useState(period);
  const [dates, setDates] = useState({ start: admissionFlowToday(new Date(snapshot.since)), end: admissionFlowToday(new Date(snapshot.through)) });
  const [error, setError] = useState("");
  return <div className={styles.dateScope}>
    <details>
      <summary ref={summary}><strong>{periodLabels[period]}</strong><span>{day(snapshot.since)}–{day(snapshot.through)}{snapshot.complete ? "" : " · In progress"}</span><ChevronDown size={16} aria-hidden="true" /></summary>
      <div className={styles.dateOptions}>
        <label>Period<select value={choice} onChange={event => {
          const value = event.target.value as ScorecardPeriod;
          setChoice(value); setError("");
          if (value !== "custom") onChange({ period: value, dates: {} });
        }}>{Object.entries(periodLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        {choice === "custom" ? <form onSubmit={event => {
          event.preventDefault();
          try { scorecardRange("custom", new Date(), dates); onChange({ period: "custom", dates }); }
          catch (error) { setError(error instanceof Error ? error.message : "Choose valid dates."); }
        }}>
          <label>From<input type="date" required min={admissionFlowStartDate} max={admissionFlowToday()} value={dates.start} onChange={event => setDates({ ...dates, start: event.target.value })} /></label>
          <label>Through<input type="date" required min={dates.start || admissionFlowStartDate} max={admissionFlowToday()} value={dates.end} onChange={event => setDates({ ...dates, end: event.target.value })} /></label>
          <button className={styles.more} type="submit">Apply dates</button>
          {error ? <p role="alert">{error}</p> : null}
        </form> : null}
        <p>Completed weeks run Monday–Sunday · Pacific time</p>
      </div>
    </details>
    {snapshot.complete && !snapshot.comparison ? <p className={styles.periodNote}>A full prior-period comparison is unavailable before Pipeline’s launch.</p> : null}
  </div>;
}

function ScorecardExport({ snapshot, sort }: { snapshot: Snapshot; sort: Sort }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(false);
  const exportPdf = async () => {
    if (exporting) return;
    setExporting(true); setError(false);
    try {
      // Pin the displayed calendar dates even if the export crosses a Monday boundary.
      const params = new URLSearchParams({ period: "custom", start: admissionFlowToday(new Date(snapshot.since)), end: admissionFlowToday(new Date(snapshot.through)), format: "pdf", sort });
      const response = await fetchPipelineApi(`/api/operations/assessor-scorecard?${params}`, { cache: "no-store" });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) throw new Error("Export unavailable");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "pipeline-assessor-scorecard.pdf";
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch { setError(true); }
    finally { setExporting(false); }
  };
  return <footer className={styles.exportFooter}>
    {error ? <p className={styles.notice} role="alert">PDF unavailable. Try Export PDF again.</p> : null}
    <button className={styles.exportLink} type="button" disabled={exporting} onClick={() => void exportPdf()}><Download size={17} aria-hidden="true" />{exporting ? "Exporting…" : "Export PDF"}</button>
  </footer>;
}
