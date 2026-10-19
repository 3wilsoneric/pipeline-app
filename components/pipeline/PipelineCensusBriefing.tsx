"use client";

import { useEffect, useState } from "react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { ClinicalCensusResponse } from "@/lib/clinical/clinical-contracts";
import type { AdmissionsCensusReport } from "@/lib/pipeline/admissions-census-report";
import styles from "./PipelineCensusBriefing.module.css";

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
        <div><p className={styles.overline}>Pipeline reports · Weekly briefing</p><h1>Admissions &amp; census</h1><p className={styles.deck}>The recorded community census and the placements moving through Pipeline.</p></div>
        <button type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1); }} disabled={loading} className={styles.refresh}>Refresh report</button>
      </header>

      {loading ? <p role="status" className={styles.loading}>Loading admissions and census…</p> : null}
      {!loading && !census && !admissions ? <p role="alert" className={styles.loading}>Admissions and census information is unavailable right now. Try refreshing the report.</p> : null}
      {!loading && (census || admissions) ? <>
        {censusError || admissionsError ? <p role="status" className={styles.warning}><strong>Partial report.</strong> {censusError ? "Current census is unavailable. " : ""}{admissionsError ? "Pipeline admissions are unavailable. " : ""}Available records remain below.</p> : null}
        {census?.freshness.warning ? <p role="status" className={styles.warning}><strong>Census update delayed.</strong> {census.freshness.warning}</p> : null}
        <BriefingLead census={census} admissions={admissions} />
        {admissions ? <AdmissionsSections report={admissions} /> : null}
        {census ? <CensusCommunities census={census} /> : null}
      </> : null}

      <footer data-guide-target="operations-briefing-source" className={styles.source}>
        Pipeline referral records{admissions ? ` updated ${formatTimestamp(admissions.generated_at)}` : ""} · Alamo Platform clinical snapshot{census ? ` dated ${formatDate(census.data_as_of)}` : ""}. Admissions are recorded events; without a prior census and discharge history, they do not measure census change.
      </footer>
    </article>
  </main>;
}

function BriefingLead({ census, admissions }: { census: ClinicalCensusResponse | null; admissions: AdmissionsCensusReport | null }) {
  const waiting = admissions?.metrics.awaiting_admission;
  const admitted = admissions?.history.month_outcomes.admitted;
  const overdue = admissions?.upcoming_admissions.past_planned_date;
  return <section data-guide-target="operations-briefing-metrics" aria-label="Census and placement overview" className={styles.lead}>
    <div className={styles.censusFigure}>
      <p className={styles.overline}>Current census</p>
      <p className={styles.censusNumber} data-unavailable={!census || census.portfolio_census_total === null || undefined}>{formatNumber(census?.portfolio_census_total ?? null)}</p>
      <p className={styles.caption}>Recorded community census{census ? ` · ${formatDate(census.data_as_of)}` : " · Clinical feed unavailable"}</p>
    </div>
    <div className={styles.leadNarrative}>
      <h2>Where admissions stand</h2>
      {admissions ? <>
        <p><strong>{formatNumber(waiting ?? null)} accepted placements</strong> are still awaiting a recorded arrival. <strong>{formatNumber(admitted ?? null)}</strong> actual admissions were recorded this month in Pipeline.</p>
        {overdue ? <p className={styles.attention}><strong>{overdue} planned {overdue === 1 ? "date has" : "dates have"} passed.</strong> Check whether the client arrived or the placement changed.</p> : <p className={styles.quiet}>No planned arrival dates have passed without an admission record.</p>}
        {admissions.metrics.stale || admissions.metrics.unassigned ? <p className={styles.quiet}>{admissions.metrics.stale} stale referrals and {admissions.metrics.unassigned} unassigned referrals remain on the board.</p> : null}
      </> : <p>Pipeline admission records are unavailable. The clinical census can still be reviewed below.</p>}
    </div>
  </section>;
}

function AdmissionsSections({ report }: { report: AdmissionsCensusReport }) {
  const boardTotal = report.board_columns.reduce((sum, column) => sum + column.count, 0);
  const months = report.history.monthly;
  const maximum = Math.max(1, ...months.flatMap((row) => [row.received, row.accepted, row.declined, row.admitted]));
  return <>
    <section aria-labelledby="current-work-heading" className={styles.section}>
      <div className={styles.sectionHeading}><div><p className={styles.overline}>Current work</p><h2 id="current-work-heading">The referral board</h2></div><p>{report.metrics.active_referrals} active referrals</p></div>
      <p className={styles.sectionIntro}>Each segment shows a current board position. These are files in progress, not historical outcomes.</p>
      <div className={styles.boardTrack} role="img" aria-label={report.board_columns.map((column) => `${column.label}: ${column.count}`).join(", ")}>
        {report.board_columns.map((column) => <span key={column.key} className={styles.boardSegment} data-stage={column.key} style={{ width: `${boardTotal ? column.count / boardTotal * 100 : 0}%` }} />)}
      </div>
      <ul className={styles.boardLegend}>{report.board_columns.map((column) => <li key={column.key} data-stage={column.key}><span className={styles.legendDot} aria-hidden="true" /><strong>{column.count}</strong><span>{column.label}</span></li>)}</ul>
    </section>

    <section aria-labelledby="admissions-history-heading" className={styles.section}>
      <div className={styles.sectionHeading}><div><p className={styles.overline}>Six-month view</p><h2 id="admissions-history-heading">What happened each month</h2></div></div>
      <p className={styles.sectionIntro}>Received, accepted, denied and admitted are dated events. An acceptance and admission may occur in different months.</p>
      {months.length ? <div className={styles.chartRegion} role="region" aria-label="Monthly admission activity" tabIndex={0}>
        <div className={styles.chartKey} aria-hidden="true"><span data-series="received">Received</span><span data-series="accepted">Accepted</span><span data-series="declined">Denied</span><span data-series="admitted">Admitted</span></div>
        <div className={styles.monthChart} style={{ gridTemplateColumns: `repeat(${months.length}, minmax(94px, 1fr))` }}>
          {months.map((row) => <div key={row.month} className={styles.monthGroup}>
            <div className={styles.barGroup} aria-hidden="true">
              {(["received", "accepted", "declined", "admitted"] as const).map((key) => <span key={key} data-series={key} className={styles.monthBar} style={{ height: `${Math.max(2, row[key] / maximum * 100)}%` }}><span>{row[key]}</span></span>)}
            </div>
            <p>{formatMonth(row.month)}</p>
          </div>)}
        </div>
        <table className="sr-only"><caption>Monthly admission activity</caption><thead><tr><th>Month</th><th>Received</th><th>Accepted</th><th>Denied</th><th>Admitted</th></tr></thead><tbody>{months.map((row) => <tr key={row.month}><th>{formatMonth(row.month)}</th><td>{row.received}</td><td>{row.accepted}</td><td>{row.declined}</td><td>{row.admitted}</td></tr>)}</tbody></table>
        <p className={styles.chartFoot}>History begins {formatMonth(report.history.coverage_start_month ?? months[0].month)}. Earlier months are not shown as zero.</p>
      </div> : <p className={styles.empty}>No dated admission history is available yet.</p>}
    </section>

    <section aria-labelledby="coming-up-heading" className={styles.section}>
      <div className={styles.sectionHeading}><div><p className={styles.overline}>Next seven days</p><h2 id="coming-up-heading">Coming up</h2></div></div>
      <div className={styles.scheduleGrid}>
        <ScheduleList title="Assessments this week" items={report.briefing.upcoming_assessments.map((item) => ({ key: `assessment-${item.pipeline_path}`, name: item.client_name, date: formatTimestamp(item.scheduled_at), detail: `${item.community} · ${item.owner}`, path: item.pipeline_path }))} complete={report.briefing.coverage.assessments_complete} />
        <ScheduleList title="Planned move-ins this week" items={report.briefing.planned_move_ins.map((item) => ({ key: `arrival-${item.pipeline_path}`, name: item.client_name, date: formatDate(item.planned_at), detail: `${item.community} · ${item.readiness === "blocked" ? "Requirements open" : item.readiness === "watch" ? "Review requirements" : "Ready"}`, path: item.pipeline_path }))} complete={report.briefing.coverage.move_ins_complete} />
      </div>
    </section>
  </>;
}

type ScheduleItem = { key: string; name: string; date: string; detail: string; path: string };
function ScheduleList({ title, items, complete }: { title: string; items: ScheduleItem[]; complete: boolean }) {
  return <section aria-label={title} className={styles.schedule}>
    <h3>{title}</h3>
    {items.length ? <ul>{items.slice(0, 5).map((item) => <li key={item.key}><a href={item.path}>{item.name}<span>{item.date}</span></a><p>{item.detail}</p></li>)}</ul> : <p className={styles.empty}>No {title.toLowerCase()} are recorded.</p>}
    {items.length > 5 ? <p className={styles.caption}>And {items.length - 5} more in this week&apos;s schedule.</p> : null}
    {!complete ? <p className={styles.caption}>Schedule list is capped; more may be planned.</p> : null}
  </section>;
}

function CensusCommunities({ census }: { census: ClinicalCensusResponse }) {
  const communities = [...census.communities].sort((a, b) => (b.current_census ?? -1) - (a.current_census ?? -1));
  const maximum = Math.max(1, ...communities.map((row) => row.current_census ?? 0));
  const needsReview = communities.filter((row) => row.reconciliation_status === "mismatch").length;
  return <section data-guide-target="operations-briefing-communities" className={styles.section} aria-labelledby="briefing-communities-heading">
    <div className={styles.sectionHeading}><div><p className={styles.overline}>Clinical snapshot</p><h2 id="briefing-communities-heading">Census by community</h2></div><p>{needsReview ? `${needsReview} need review` : "Counts reconciled"}</p></div>
    {communities.length ? <ul className={styles.communityList}>{communities.map((row) => <li key={row.community_id}>
      <div className={styles.communityLabel}><strong>{row.community_name}</strong><span className={row.reconciliation_status === "mismatch" ? styles.needsReview : undefined}>{reconciliationLabel(row.reconciliation_status)}</span></div>
      <div className={styles.communityBar} aria-hidden="true"><span style={{ width: `${row.current_census === null ? 0 : row.current_census / maximum * 100}%` }} /></div>
      <strong className={styles.communityCount}>{formatNumber(row.current_census)}</strong>
    </li>)}</ul> : <p className={styles.empty}>No community census values are available in this snapshot.</p>}
    <p className={styles.caption}>An unavailable value is not zero. “Needs review” means the community count and roster differ.</p>
  </section>;
}

function reconciliationLabel(status: ClinicalCensusResponse["reconciliation_status"]) { return status === "matched" ? "Reconciled" : status === "mismatch" ? "Needs review" : "Not compared"; }
function formatNumber(value: number | null) { return value === null ? "Unavailable" : value.toLocaleString("en-US"); }
function formatDate(value: string) { const date = new Date(value.slice(0, 10) + "T00:00:00Z"); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date); }
function formatMonth(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value + "-01T00:00:00Z")); }
function formatTimestamp(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date); }
