"use client";

import { useEffect, useState } from "react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { ClinicalCensusResponse } from "@/lib/clinical/clinical-contracts";
import type { AdmissionsCensusReport } from "@/lib/pipeline/admissions-census-report";
import styles from "./PipelineCensusBriefing.module.css";

type ClientContext = { source_name: string | null; referring_county: string | null; prior_placement: string | null; owner: string };
type WeekRow = ClientContext & { client_name: string; date: string; detail: string; pipeline_path: string };

export default function PipelineCensusBriefing() {
  const [census, setCensus] = useState<ClinicalCensusResponse | null>(null);
  const [admissions, setAdmissions] = useState<AdmissionsCensusReport | null>(null);
  const [censusError, setCensusError] = useState(false);
  const [admissionsError, setAdmissionsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      fetchPipelineJson<ClinicalCensusResponse>("/api/clinical/census", { cache: "no-store" }, { maxResponseBytes: 256_000 }),
      fetchPipelineJson<AdmissionsCensusReport>("/api/operations/admissions-census", { cache: "no-store" }, { maxResponseBytes: 1_000_000 }),
    ]).then(([censusResult, admissionsResult]) => {
      if (!active) return;
      setCensus(censusResult.status === "fulfilled" ? censusResult.value : null);
      setAdmissions(admissionsResult.status === "fulfilled" ? admissionsResult.value : null);
      setCensusError(censusResult.status === "rejected");
      setAdmissionsError(admissionsResult.status === "rejected");
      setLoading(false);
    });
    return () => { active = false; };
  }, [retry]);

  return <main aria-label="Reports" data-testid="operations-workspace" className={styles.page}>
    <article data-monday-census-briefing="true" className={styles.briefing}>
      <header data-guide-target="operations-briefing-header" className={styles.masthead}>
        <div><p className={styles.overline}>Pipeline reports · Weekly briefing</p><h1>Admissions &amp; census</h1>
          {admissions ? <p className={styles.deck}>Week of {formatDate(admissions.briefing.week_start)} · Pacific time</p> : null}</div>
        <button type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1); }} disabled={loading} className={styles.refresh}>Refresh report</button>
      </header>

      {loading ? <p role="status" className={styles.loading}>Loading admissions and census…</p> : null}
      {!loading && !census && !admissions ? <p role="alert" className={styles.loading}>Admissions and census information is unavailable right now. Try refreshing the report.</p> : null}
      {!loading && (census || admissions) ? <>
        {censusError || admissionsError ? <p role="status" className={styles.warning}><strong>Partial report.</strong> {censusError ? "Current census is unavailable. " : ""}{admissionsError ? "Pipeline admissions are unavailable. " : ""}Available records remain below.</p> : null}
        {census?.freshness.warning ? <p role="status" className={styles.warning}><strong>Census update delayed.</strong> {census.freshness.warning}</p> : null}
        {census ? <CensusCommunities census={census} /> : null}
        {admissions ? <AdmissionsSections report={admissions} /> : null}
      </> : null}

      <footer data-guide-target="operations-briefing-source" className={styles.source}>
        Pipeline referral records{admissions ? ` updated ${formatTimestamp(admissions.generated_at)}` : ""} · Alamo Platform clinical snapshot{census ? ` dated ${formatDate(census.data_as_of)}` : ""}. Planned admissions are not confirmed arrivals.
      </footer>
    </article>
  </main>;
}

function CensusCommunities({ census }: { census: ClinicalCensusResponse }) {
  const communities = [...census.communities].sort((a, b) => (b.current_census ?? -1) - (a.current_census ?? -1));
  const maximum = Math.max(1, ...communities.map((row) => row.current_census ?? 0));
  const needsReview = communities.filter((row) => row.reconciliation_status === "mismatch").length;
  return <section data-guide-target="operations-briefing-communities" className={styles.section} aria-labelledby="briefing-communities-heading">
    <div className={styles.sectionHeading}><div><p className={styles.overline}>Current census · {formatDate(census.data_as_of)}</p><h2 id="briefing-communities-heading">Census by community</h2></div><p className={styles.total}><strong>{formatNumber(census.portfolio_census_total)}</strong> total residents</p></div>
    {communities.length ? <ul className={styles.communityList}>{communities.map((row) => <li key={row.community_id}>
      <div className={styles.communityLabel}><strong>{row.community_name}</strong>{row.reconciliation_status === "mismatch" ? <span className={styles.needsReview}>Needs review</span> : null}</div>
      <div className={styles.communityBar} aria-hidden="true"><span style={{ width: `${row.current_census === null ? 0 : row.current_census / maximum * 100}%` }} /></div>
      <strong className={styles.communityCount}>{formatNumber(row.current_census)}</strong>
    </li>)}</ul> : <p className={styles.empty}>No community census values are available in this snapshot.</p>}
    {needsReview ? <p className={styles.caption}>{needsReview} {needsReview === 1 ? "community count needs" : "community counts need"} review against the roster.</p> : null}
  </section>;
}

function AdmissionsSections({ report }: { report: AdmissionsCensusReport }) {
  const { briefing } = report;
  const admitted = briefing.admitted_last_week.map((item) => ({ ...item, date: item.admitted_at, detail: item.community }));
  const planned = briefing.planned_move_ins.map((item) => ({ ...item, date: item.planned_at, detail: `${item.community} · ${item.readiness === "blocked" ? "Requirements open" : item.readiness === "watch" ? "Review requirements" : "Ready"}` }));
  return <>
    <div data-guide-target="operations-briefing-metrics" className={styles.weekGrid}>
      <WeekList title="Admitted last week" dates={`${formatDate(briefing.last_week_start)}–${formatDate(briefing.last_week_end)}`} items={admitted} complete={briefing.coverage.admitted_last_week_complete} empty="No admissions were recorded last week." />
      <WeekList title="Planned admits this week" dates={`${formatDate(briefing.week_start)}–${formatDate(briefing.week_end)}`} items={planned} complete={briefing.coverage.move_ins_complete} empty="No upcoming planned admits are recorded this week." />
    </div>
    <section className={styles.section} aria-labelledby="moving-heading">
      <div className={styles.sectionHeading}><div><p className={styles.overline}>Current work</p><h2 id="moving-heading">Clients moving through</h2></div><p className={styles.sectionCount}>{briefing.moving_through.length}{briefing.coverage.moving_through_complete ? "" : "+"} active</p></div>
      {report.board_columns.map((column) => {
        const items = briefing.moving_through.filter((item) => item.stage === column.key);
        return items.length ? <div className={styles.stageGroup} key={column.key}>
          <h3><span data-stage={column.key} className={styles.stageDot} />{column.label} <span>{items.length}</span></h3>
          <ul className={styles.movingList}>{items.map((item) => <li key={item.pipeline_path}>
            <a href={item.pipeline_path}>{item.client_name}</a><span>{item.status}</span><span>{item.community}</span><ClientContextText item={item} />
          </li>)}</ul>
        </div> : null;
      })}
      {!briefing.moving_through.length ? <p className={styles.empty}>No active clients are moving through Pipeline.</p> : null}
      {!briefing.coverage.moving_through_complete ? <p className={styles.caption}>The list is capped; more clients are on the board.</p> : null}
    </section>
  </>;
}

function WeekList({ title, dates, items, complete, empty }: { title: string; dates: string; items: WeekRow[]; complete: boolean; empty: string }) {
  return <section className={styles.weekSection} aria-label={title}>
    <div className={styles.weekHeading}><div><p className={styles.overline}>{dates}</p><h2>{title}</h2></div><strong>{items.length}{complete ? "" : "+"}</strong></div>
    {items.length ? <ul className={styles.weekList}>{items.map((item) => <li key={item.pipeline_path}>
      <div><a href={item.pipeline_path}>{item.client_name}</a><span>{formatDate(item.date)}</span></div>
      <p>{item.detail}</p><ClientContextText item={item} />
    </li>)}</ul> : <p className={styles.empty}>{empty}</p>}
    {!complete ? <p className={styles.caption}>The list is capped; more records exist.</p> : null}
  </section>;
}

function ClientContextText({ item }: { item: ClientContext }) {
  return <span className={styles.origin}>Origin: {item.source_name || "not recorded"} · County: {item.referring_county || "not recorded"} · Prior placement: {item.prior_placement || "not recorded"} · Assessor: {item.owner}</span>;
}

function formatNumber(value: number | null) { return value === null ? "Unavailable" : value.toLocaleString("en-US"); }
function formatDate(value: string) { const date = new Date(value.slice(0, 10) + "T00:00:00Z"); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date); }
function formatTimestamp(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", minute: "2-digit", hour: "numeric", timeZone: "America/Los_Angeles" }).format(date)} PT`; }
