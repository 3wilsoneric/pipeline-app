"use client";

import { useEffect, useState } from "react";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { ClinicalCensusResponse } from "@/lib/clinical/clinical-contracts";

export default function PipelineCensusBriefing() {
  const [census, setCensus] = useState<ClinicalCensusResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    fetchPipelineJson<ClinicalCensusResponse>("/api/clinical/census", { cache: "no-store" }, { maxResponseBytes: 256_000 })
      .then((response) => {
        if (!active) return;
        setCensus(response);
        setError("");
      })
      .catch(() => {
        if (!active) return;
        setCensus(null);
        setError("Current census information is unavailable in Pipeline right now. Please try again.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  return <main aria-label="Reports" data-testid="operations-workspace" className="h-full overflow-y-auto bg-page px-4 py-5 text-ink-2 sm:px-7 sm:py-7">
    <div className="mx-auto max-w-[1300px] bg-paper px-5 shadow-card sm:px-9">
      {census ? <BriefingContent census={census} /> : <section data-guide-target="operations-briefing-header" className="flex min-h-[280px] flex-col items-start justify-center border-t-[5px] border-primary py-10" aria-live="polite">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Reports</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">Census briefing</h1>
        <p data-guide-target="operations-briefing-source" role={error ? "alert" : "status"} className="mt-5 max-w-xl text-[15px] leading-6 text-ink-muted">
          {loading ? "Loading Pipeline census…" : error}
        </p>
        {!loading && error ? <button type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1); }} className="mt-6 rounded-md bg-primary px-5 py-3 font-semibold text-on-fill hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">Try again</button> : null}
      </section>}
    </div>
  </main>;
}

function BriefingContent({ census }: { census: ClinicalCensusResponse }) {
  const communities = census.communities;
  const verified = communities.filter((row) => row.reconciliation_status === "matched").length;
  const needsReview = communities.filter((row) => row.reconciliation_status === "mismatch").length;
  const unavailable = communities.length - verified - needsReview;
  const warning = census.freshness.warning;

  return <article data-monday-census-briefing="true" className="border-t-[5px] border-primary">
    <header data-guide-target="operations-briefing-header" className="flex flex-col justify-between gap-5 border-b-2 border-ink-2 py-7 sm:flex-row sm:items-end">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-primary">Pipeline reports</p>
        <h1 className="mt-2 text-[clamp(1.8rem,3vw,2.6rem)] font-semibold leading-tight tracking-[-0.05em]">Census briefing</h1>
        <p className="mt-2 text-sm text-ink-muted">Current census as of {formatDate(census.data_as_of)}</p>
      </div>
      <div className="text-sm text-ink-muted sm:text-right">
        <p>Current snapshot, not a weekly trend</p>
        <p>Updated {formatTimestamp(census.generated_at)}</p>
      </div>
    </header>

    {warning ? <p role="status" className="border-l-4 border-stage-orange bg-stage-orange-tile px-4 py-3 text-sm text-stage-orange"><strong>Data update delayed.</strong> {warning}</p> : null}

    <section data-guide-target="operations-briefing-metrics" aria-label="Census metrics" className="grid border-b-2 border-ink-2 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Current census" value={formatNumber(census.portfolio_census_total)} detail={`As of ${formatDate(census.data_as_of)}`} />
      <Metric label="Communities" value={String(communities.length)} detail="In the current snapshot" />
      <Metric label="Reconciled" value={String(verified)} detail="Community counts match their rosters" tone="positive" />
      <Metric label="Needs review" value={String(needsReview)} detail={unavailable ? `${unavailable} without a comparison` : "Community count and roster differ"} tone={needsReview ? "warning" : undefined} />
    </section>

    <section data-guide-target="operations-briefing-communities" className="py-7" aria-labelledby="briefing-communities-heading">
      <div className="flex items-end justify-between gap-4 border-b border-ink-2 pb-3">
        <h2 id="briefing-communities-heading" className="text-xl font-semibold tracking-[-0.035em]">By community</h2>
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-ink-muted">Current snapshot</p>
      </div>
      {communities.length ? <div className="divide-y divide-paper-rule">{communities.map((row) => <div key={row.community_id} className="grid grid-cols-[1fr_auto] items-center gap-3 py-4 sm:grid-cols-[minmax(150px,1fr)_100px_110px] sm:gap-5">
        <p className="font-medium">{row.community_name}</p>
        <p className="text-right font-semibold tabular-nums">{formatNumber(row.current_census)}</p>
        <p className={`col-span-2 text-sm sm:col-span-1 sm:text-right ${row.reconciliation_status === "mismatch" ? "text-stage-orange" : "text-ink-muted"}`}>{reconciliationLabel(row.reconciliation_status)}</p>
      </div>)}</div> : <p className="py-6 text-sm text-ink-muted">No community census values are available in this snapshot.</p>}
      <p className="mt-3 text-xs leading-5 text-ink-muted">Counts are shown only when supplied by the census source. Missing values are not treated as zero.</p>
    </section>

    <p className="border-l-4 border-primary bg-primary-soft px-5 py-4 text-[15px] leading-7 text-action">
      {census.portfolio_census_total === null
        ? "A complete portfolio total is not available in this snapshot. Check the community rows and data status before relying on these figures."
        : `The current recorded census is ${formatNumber(census.portfolio_census_total)} across ${communities.length} communities. ${verified} communities are reconciled${needsReview ? `; ${needsReview} need review` : ""}${unavailable ? `; ${unavailable} could not be compared` : ""}.`}
    </p>
    <footer data-guide-target="operations-briefing-source" className="mt-7 border-t border-paper-rule py-5 text-xs leading-5 text-ink-muted">Pipeline current-census data. This snapshot does not include a prior-period census, so no weekly change is reported.</footer>
  </article>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "positive" | "warning" }) {
  return <div className="min-h-36 border-b border-paper-rule px-4 py-5 sm:even:border-l xl:border-b-0 xl:border-l xl:first:border-l-0">
    <p className="text-xs font-bold uppercase tracking-[0.12em] text-ink-muted">{label}</p>
    <p className={`mt-3 text-[2rem] font-semibold leading-none tracking-[-0.04em] tabular-nums ${tone === "positive" ? "text-primary" : tone === "warning" ? "text-stage-orange" : "text-ink-2"}`}>{value}</p>
    <p className="mt-3 text-sm text-ink-muted">{detail}</p>
  </div>;
}

function reconciliationLabel(status: ClinicalCensusResponse["reconciliation_status"]) {
  return status === "matched" ? "Reconciled" : status === "mismatch" ? "Needs review" : "Not compared";
}

function formatNumber(value: number | null) { return value === null ? "Unavailable" : value.toLocaleString("en-US"); }
function formatDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}
function formatTimestamp(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
