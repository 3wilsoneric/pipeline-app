"use client";

import { useEffect, useState } from "react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { ClinicalCensusResponse } from "@/lib/clinical/clinical-contracts";
import type { AdmissionsCensusReport } from "@/lib/pipeline/admissions-census-report";

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

  return <main aria-label="Reports" data-testid="operations-workspace" className="h-full overflow-y-auto bg-page px-4 py-5 text-ink-2 sm:px-7 sm:py-7">
    <article data-monday-census-briefing="true" className="mx-auto max-w-[1300px] border-t-[5px] border-primary bg-paper px-5 shadow-card sm:px-9">
      <header data-guide-target="operations-briefing-header" className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink-2 py-7">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-primary">Pipeline reports</p>
          <h1 className="mt-2 text-[clamp(1.8rem,3vw,2.6rem)] font-semibold leading-tight tracking-[-0.05em]">Admissions &amp; census</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">The referral journey alongside today’s recorded community census.</p>
        </div>
        <button type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1); }} disabled={loading} className="rounded-md border border-paper-rule px-4 py-2 text-sm font-semibold text-action hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50">Refresh report</button>
      </header>

      {loading ? <p role="status" className="py-14 text-sm text-ink-muted">Loading admissions and census…</p> : null}
      {!loading && !census && !admissions ? <p role="alert" className="py-14 text-sm text-ink-muted">Admissions and census information is unavailable right now. Try refreshing the report.</p> : null}
      {!loading && (census || admissions) ? <>
        {(censusError || admissionsError) ? <p role="status" className="mt-5 border-l-4 border-stage-orange bg-stage-orange-tile px-4 py-3 text-sm text-stage-orange">
          <strong>Partial report.</strong> {censusError ? "Current census is unavailable. " : ""}{admissionsError ? "Pipeline admissions are unavailable. " : ""}Available figures remain visible below.
        </p> : null}
        {census?.freshness.warning ? <p role="status" className="mt-5 border-l-4 border-stage-orange bg-stage-orange-tile px-4 py-3 text-sm text-stage-orange"><strong>Census update delayed.</strong> {census.freshness.warning}</p> : null}

        <section data-guide-target="operations-briefing-metrics" aria-label="Admissions and census metrics" className="grid border-b-2 border-ink-2 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Current census" value={formatNumber(census?.portfolio_census_total ?? null)} detail={census ? "Clinical snapshot · " + formatDate(census.data_as_of) : "Clinical feed unavailable"} />
          <Metric label="Active referrals" value={formatNumber(admissions?.metrics.active_referrals ?? null)} detail="Current Pipeline board" />
          <Metric label="Awaiting arrival" value={formatNumber(admissions?.metrics.awaiting_admission ?? null)} detail="Accepted, without recorded arrival" />
          <Metric label="Admitted this month" value={formatNumber(admissions?.history.month_outcomes.admitted ?? null)} detail="Pipeline actual admit dates" />
        </section>

        {admissions ? <AdmissionsSections report={admissions} /> : null}
        {census ? <CensusCommunities census={census} /> : null}
      </> : null}

      <footer data-guide-target="operations-briefing-source" className="mt-6 border-t border-paper-rule py-5 text-xs leading-5 text-ink-muted">
        Admissions figures come from Pipeline referral records{admissions ? ", updated " + formatTimestamp(admissions.generated_at) : ""}. Current census comes from the Alamo Platform clinical snapshot{census ? " dated " + formatDate(census.data_as_of) : ""}. Pipeline does not receive a prior-period census or governed discharge series here, so this report does not infer census change from Pipeline admissions.
      </footer>
    </article>
  </main>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="min-h-32 border-b border-paper-rule px-2 py-5 sm:px-4 xl:border-b-0 xl:border-l xl:first:border-l-0">
    <p className="text-xs font-bold uppercase tracking-[0.1em] text-ink-muted">{label}</p>
    <p className="mt-3 text-[2rem] font-semibold leading-none tracking-[-0.04em] tabular-nums">{value}</p>
    <p className="mt-3 text-xs leading-5 text-ink-muted">{detail}</p>
  </div>;
}

function AdmissionsSections({ report }: { report: AdmissionsCensusReport }) {
  const months = report.history.monthly;
  const maximum = Math.max(1, ...months.flatMap((row) => [row.received, row.accepted, row.declined, row.admitted]));
  return <>
    <section aria-label="Admission flow" className="grid gap-7 border-b border-paper-rule py-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div>
        <SectionHeading eyebrow="Current work" title="Where referrals stand" />
        <div className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
          {report.board_columns.map((column) => <div key={column.key} className="rounded-lg border border-paper-rule bg-page px-3 py-4 sm:px-4">
            <p className="text-2xl font-semibold tabular-nums tracking-[-0.04em] sm:text-3xl">{column.count}</p>
            <p className="mt-2 text-xs font-medium leading-4 text-ink-muted sm:text-sm">{column.label}</p>
          </div>)}
        </div>
        <p className="mt-3 text-xs leading-5 text-ink-muted">Current board positions, not all historical referrals.</p>
      </div>
      <div className="rounded-lg border border-paper-rule bg-primary-soft px-5 py-5">
        <p className="text-xs font-bold uppercase tracking-[0.13em] text-primary">What needs attention</p>
        <p className="mt-4 text-sm leading-6"><strong>{report.metrics.stale}</strong> stale referrals · <strong>{report.metrics.unassigned}</strong> unassigned</p>
        <p className="mt-2 text-sm leading-6"><strong>{report.upcoming_admissions.next_7_days}</strong> planned arrivals in the next 7 days · <strong>{report.upcoming_admissions.past_planned_date}</strong> past planned date</p>
        <p className="mt-3 text-xs leading-5 text-ink-muted">Planned arrivals are not admitted until an actual admit date is recorded.</p>
      </div>
    </section>

    <section aria-labelledby="admissions-history-heading" className="border-b border-paper-rule py-8">
      <SectionHeading eyebrow="Six-month view" title="Admission activity" id="admissions-history-heading" />
      <p className="mt-2 text-sm leading-6 text-ink-muted">Events in each month: referrals received, decisions accepted or declined, and actual admissions recorded in Pipeline. These are separate events, not a same-month conversion rate.</p>
      {months.length ? <div className="mt-5 overflow-x-auto rounded-lg border border-paper-rule focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" role="region" aria-label="Monthly admission activity" tabIndex={0}>
        <div className="grid min-w-[600px]" style={{ gridTemplateColumns: "repeat(" + months.length + ", minmax(100px, 1fr))" }}>
          {months.map((row) => <div key={row.month} className="border-r border-paper-rule px-3 py-4 last:border-r-0">
            <p className="text-sm font-semibold">{formatMonth(row.month)}</p>
            <div className="mt-4 space-y-2">
              <HistoryBar label="Received" count={row.received} maximum={maximum} color="bg-primary" />
              <HistoryBar label="Accepted" count={row.accepted} maximum={maximum} color="bg-stage-blue" />
              <HistoryBar label="Declined" count={row.declined} maximum={maximum} color="bg-ink-muted" />
              <HistoryBar label="Admitted" count={row.admitted} maximum={maximum} color="bg-stage-orange" />
            </div>
          </div>)}
        </div>
        <p className="border-t border-paper-rule px-3 py-3 text-xs leading-5 text-ink-muted">History begins {formatMonth(report.history.coverage_start_month ?? months[0].month)}; earlier months are not shown as zero.</p>
      </div> : <p className="mt-5 text-sm text-ink-muted">No dated admission history is available yet.</p>}
    </section>

    <section aria-label="Coming up" className="grid gap-8 border-b border-paper-rule py-8 lg:grid-cols-2">
      <ScheduleList title="Assessments this week" items={report.briefing.upcoming_assessments.map((item) => ({
        key: "assessment-" + item.pipeline_path, name: item.client_name, date: formatTimestamp(item.scheduled_at),
        detail: item.community + " · " + item.owner, path: item.pipeline_path,
      }))} complete={report.briefing.coverage.assessments_complete} />
      <ScheduleList title="Planned move-ins this week" items={report.briefing.planned_move_ins.map((item) => ({
        key: "arrival-" + item.pipeline_path, name: item.client_name, date: formatDate(item.planned_at),
        detail: item.community + " · " + (item.readiness === "blocked" ? "Requirements open" : item.readiness === "watch" ? "Review requirements" : "Ready"), path: item.pipeline_path,
      }))} complete={report.briefing.coverage.move_ins_complete} />
    </section>
  </>;
}

function SectionHeading({ eyebrow, title, id }: { eyebrow: string; title: string; id?: string }) {
  return <div><p className="text-xs font-bold uppercase tracking-[0.13em] text-primary">{eyebrow}</p><h2 id={id} className="mt-1 text-xl font-semibold tracking-[-0.035em]">{title}</h2></div>;
}

function HistoryBar({ label, count, maximum, color }: { label: string; count: number; maximum: number; color: string }) {
  return <div><div className="flex justify-between gap-1 text-[11px] text-ink-muted"><span>{label}</span><strong className="tabular-nums text-ink-2">{count}</strong></div><div aria-hidden="true" className="mt-1 h-1.5 rounded-full bg-page"><div className={"h-full rounded-full " + color} style={{ width: String(count / maximum * 100) + "%" }} /></div></div>;
}

type ScheduleItem = { key: string; name: string; date: string; detail: string; path: string };
function ScheduleList({ title, items, complete }: { title: string; items: ScheduleItem[]; complete: boolean }) {
  return <section aria-label={title}>
    <div className="flex items-baseline justify-between gap-3 border-b border-paper-rule pb-3"><h2 className="text-lg font-semibold tracking-[-0.03em]">{title}</h2><span className="text-sm font-semibold tabular-nums text-primary">{items.length}{complete ? "" : "+"}</span></div>
    {items.length ? <ul className="divide-y divide-paper-rule">{items.slice(0, 5).map((item) => <li key={item.key} className="py-3">
      <a href={item.path} className="flex items-start justify-between gap-3 rounded-sm text-sm font-semibold text-action hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><span>{item.name}</span><span className="shrink-0 text-right text-xs font-medium text-ink-muted">{item.date}</span></a>
      <p className="mt-1 text-xs text-ink-muted">{item.detail}</p>
    </li>)}</ul> : <p className="py-5 text-sm text-ink-muted">No {title.toLowerCase()} are recorded.</p>}
    {items.length > 5 ? <p className="text-xs text-ink-muted">And {items.length - 5} more in this week’s schedule.</p> : null}
    {!complete ? <p className="mt-2 text-xs text-stage-orange">Schedule list is capped; the displayed count is a minimum.</p> : null}
  </section>;
}

function CensusCommunities({ census }: { census: ClinicalCensusResponse }) {
  const communities = census.communities;
  const verified = communities.filter((row) => row.reconciliation_status === "matched").length;
  const needsReview = communities.filter((row) => row.reconciliation_status === "mismatch").length;
  return <section data-guide-target="operations-briefing-communities" className="py-8" aria-labelledby="briefing-communities-heading">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink-2 pb-3">
      <SectionHeading eyebrow="Clinical snapshot" title="Census by community" id="briefing-communities-heading" />
      <p className="text-xs text-ink-muted">{verified} reconciled · {needsReview} need review</p>
    </div>
    {communities.length ? <div className="grid gap-2 pt-4 sm:grid-cols-2 xl:grid-cols-3">{communities.map((row) => <div key={row.community_id} className="flex items-start justify-between gap-3 rounded-lg border border-paper-rule px-4 py-4">
      <div><p className="font-semibold">{row.community_name}</p><p className={"mt-1 text-xs " + (row.reconciliation_status === "mismatch" ? "text-stage-orange" : "text-ink-muted")}>{reconciliationLabel(row.reconciliation_status)}</p></div>
      <p className="text-2xl font-semibold tabular-nums tracking-[-0.04em]">{formatNumber(row.current_census)}</p>
    </div>)}</div> : <p className="py-6 text-sm text-ink-muted">No community census values are available in this snapshot.</p>}
    <p className="mt-4 text-xs leading-5 text-ink-muted">Missing community values are unavailable, not zero. A reconciliation warning means the community count and roster differ.</p>
  </section>;
}

function reconciliationLabel(status: ClinicalCensusResponse["reconciliation_status"]) {
  return status === "matched" ? "Reconciled" : status === "mismatch" ? "Needs review" : "Not compared";
}

function formatNumber(value: number | null) { return value === null ? "Unavailable" : value.toLocaleString("en-US"); }
function formatDate(value: string) {
  const date = new Date(value.slice(0, 10) + "T00:00:00Z");
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}
function formatMonth(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value + "-01T00:00:00Z")); }
function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
