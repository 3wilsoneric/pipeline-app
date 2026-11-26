"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import HomeDialog, { type HomeDialogOrigin } from "./HomeDialog";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type { ClinicalCensusResponse } from "@/lib/clinical/clinical-contracts";
import type { AdmissionsCensusReport } from "@/lib/pipeline/admissions-census-report";
import { DUE_AWAITING_CENSUS_LABEL } from "@/lib/pipeline/admission-confirmation";
import styles from "./PipelineCensusBriefing.module.css";

type ClientContext = { source_name: string | null; referring_county: string | null; prior_placement: string | null; owner: string };
type WeekRow = ClientContext & { client_name: string; date: string; detail: string; pipeline_path: string; blocker?: string | null };
type MovingRow = AdmissionsCensusReport["briefing"]["moving_through"][number];
type MovingPhase = MovingRow["phase"] | "outcome_review";
const movingPhases: { key: MovingPhase; label: string }[] = [
  { key: "outcome_review", label: "Review admission" },
  { key: "needs_date", label: "Needs admit date" },
  { key: "awaiting_arrival", label: "Planned admission" },
  { key: "intake_assessment", label: "Intake & assessment" },
  { key: "decision_pending", label: "Decision pending" },
];

function displayPhase(row: MovingRow, today: string): MovingPhase {
  return row.phase === "awaiting_arrival" && Boolean(row.planned_at && row.planned_at < today)
    ? "outcome_review" : row.phase;
}

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
        <div><h1>Monday briefing</h1>
          {admissions ? <p className={styles.deck}>Week of {formatDate(admissions.briefing.week_start)} · Pacific time</p> : null}</div>
        <div className={styles.actions}>
          <button type="button" onClick={() => { setLoading(true); setRetry((value) => value + 1); }} disabled={loading} className={styles.refresh}>Refresh report</button>
        </div>
      </header>

      {loading ? <p role="status" className={styles.loading}>Loading admissions and census…</p> : null}
      {!loading && !census && !admissions ? <p role="alert" className={styles.loading}>Admissions and census information is unavailable right now. Try refreshing the report.</p> : null}
      {!loading && (census || admissions) ? <>
        {censusError || admissionsError ? <p role="status" className={styles.warning}><strong>Partial report.</strong> {censusError ? "Current census is unavailable. " : ""}{admissionsError ? "Pipeline admissions are unavailable. " : ""}Available records remain below.</p> : null}
        {census?.freshness.warning ? <p role="status" className={styles.warning}><strong>Census update delayed.</strong> {census.freshness.warning}</p> : null}
        {admissions ? <WeeklyWork report={admissions} /> : null}
        {census ? <CommunityFlow census={census} weekStart={admissions?.briefing.last_week_start} /> : null}
        {admissions ? <AdmissionsSections report={admissions} /> : null}
      </> : null}

      <footer data-guide-target="operations-briefing-source" className={styles.source}>
        <span>{admissions ? `Updated ${formatTimestamp(admissions.generated_at)}` : ""}</span>
        <details><summary>Sources &amp; counting</summary>
          <p>Pipeline records · Pacific weeks. Assessments count the first interview finish or chart confirmation per native workspace. Acceptances use current decision dates. Admissions count only arrivals confirmed by the ElderMark census or recorded by staff. Planned admissions whose date has passed are shown as due and awaiting census confirmation, with the reason, and are not counted as admissions.</p>
          {census ? <><p>Alamo Platform census: {formatDate(census.data_as_of)}. Weekly movement includes all community residents. Census bars use operating capacity, not licensed maximums.</p>
            <ul>{census.communities.map(community => <li key={community.community_id}>{community.community_name}: {community.operating_capacity ?? "unknown"} operating / {community.licensed_capacity ?? "unknown"} licensed beds{community.capacity_as_of ? ` · effective ${formatDate(community.capacity_as_of)}` : ""}.</li>)}</ul></> : null}
        </details>
      </footer>
    </article>
  </main>;
}

function AdmissionsSections({ report }: { report: AdmissionsCensusReport }) {
  const [selectedPhase, setSelectedPhase] = useState<MovingPhase | "all" | null>(null);
  const [communityFilter, setCommunityFilter] = useState("all");
  const [assessorFilter, setAssessorFilter] = useState("all");
  const { briefing } = report;
  const moving = briefing.moving_through;
  const phases = movingPhases.map(item => ({ ...item, count: moving.filter(row => displayPhase(row, briefing.window_end) === item.key).length })).filter(item => item.count);
  const phase = selectedPhase === "all" || phases.some(item => item.key === selectedPhase) ? selectedPhase : phases[0]?.key ?? "all";
  const communities = [...new Set(moving.map(row => row.community))].sort();
  const assessors = [...new Set(moving.map(row => row.owner))].sort();
  const community = communities.includes(communityFilter) ? communityFilter : "all";
  const assessor = assessors.includes(assessorFilter) ? assessorFilter : "all";
  const visible = moving.filter(row => (phase === "all" || displayPhase(row, briefing.window_end) === phase) && (community === "all" || row.community === community) && (assessor === "all" || row.owner === assessor));
  return <section className={styles.weekPaper} aria-label="Clients moving through">
    <header className={styles.periodHeading}><h2 id="moving-heading">Clients moving through <span className={styles.inlineCount}>{moving.length}{briefing.coverage.moving_through_complete ? "" : "+"}</span></h2>
      {communities.length > 1 || assessors.length > 1 ? <details className={styles.filters}>
        <summary>Filter{community !== "all" || assessor !== "all" ? " · applied" : ""}</summary>
        <div className={styles.movementFilters}>
          {communities.length > 1 ? <label>Community <select value={community} onChange={event => setCommunityFilter(event.target.value)}><option value="all">All communities</option>{communities.map(value => <option key={value}>{value}</option>)}</select></label> : null}
          {assessors.length > 1 ? <label>Assessor <select value={assessor} onChange={event => setAssessorFilter(event.target.value)}><option value="all">All assessors</option>{assessors.map(value => <option key={value}>{value}</option>)}</select></label> : null}
        </div>
      </details> : null}
    </header>
    {phases.length > 1 ? <div className={styles.phaseFilters} aria-label="Choose clients to review">
      <button type="button" aria-pressed={phase === "all"} onClick={() => setSelectedPhase("all")}>All <b>{moving.length}</b></button>
      {phases.map(({key,label,count}) => <button key={key} type="button" aria-pressed={phase === key} onClick={() => setSelectedPhase(key)}>{label} <b>{count}</b></button>)}
    </div> : null}
    {visible.length ? <ul className={styles.movingList}>{visible.map(item => <li key={item.pipeline_path}>
      <div><a href={toPipelinePath(item.pipeline_path)}>{item.client_name}</a><span>{item.community} · {item.owner}</span></div>
      <div><strong>{movingPhases.find(phase => phase.key === displayPhase(item, briefing.window_end))?.label ?? item.status}</strong>{item.planned_at ? <span>{formatDate(item.planned_at, false)}</span> : null}</div>
      <ClientContextText item={item} />
    </li>)}</ul> : <p className={styles.empty}>{moving.length ? "No matching clients." : "No active clients."}</p>}
    {!briefing.coverage.moving_through_complete ? <p className={styles.caption}>Showing the first {moving.length} clients.</p> : null}
  </section>;
}

function WeekList({ title, dates, items, complete, empty }: { title: string; dates: string; items: WeekRow[]; complete: boolean; empty: string }) {
  return <section aria-label={title}>
    <div className={styles.weekHeading}><div><p className={styles.overline}>{dates}</p><h2>{title}</h2></div><strong>{items.length}{complete ? "" : "+"}</strong></div>
    {items.length ? <ul className={styles.weekList}>{items.map((item) => <li key={item.pipeline_path}>
      <div><a href={toPipelinePath(item.pipeline_path)}>{item.client_name}</a><span>{formatDate(item.date, false)}</span></div>
      <p>{item.detail} · {item.owner || "Unassigned"}</p><BlockerText item={item} /><ClientContextText item={item} />
    </li>)}</ul> : <p className={styles.empty}>{empty}</p>}
    {!complete ? <p className={styles.caption}>The list is capped; more records exist.</p> : null}
  </section>;
}

/** Plain-language reason the daily census check has not confirmed a due admission. */
function BlockerText({ item }: { item: object }) {
  const blocker = "blocker" in item && typeof item.blocker === "string" ? item.blocker : null;
  return blocker ? <p data-confirmation-blocker="true" className={styles.blocker}><strong>Why not confirmed:</strong> {blocker}</p> : null;
}

function ClientContextText({ item }: { item: ClientContext }) {
  return <details className={styles.clientDetails}>
    <summary>From {item.source_name || "origin not recorded"}</summary>
    <dl><div><dt>County</dt><dd>{item.referring_county || "Not recorded"}</dd></div>
      <div><dt>Prior placement</dt><dd>{item.prior_placement || "Not recorded"}</dd></div>
    </dl>
  </details>;
}

function WeeklyWork({ report }: { report: AdmissionsCensusReport }) {
  const { briefing: b } = report;
  const [selected, setSelected] = useState(0);
  const [origin, setOrigin] = useState("all");
  const [expanded, setExpanded] = useState<HomeDialogOrigin | null>(null);
  const groups = [
    { label: "Assessments", tone: "assessment", complete: b.coverage.assessed_last_week_complete,
      items: b.assessed_last_week?.map(row => ({ ...row, date: row.completed_at, detail: `${row.community} · ${row.decision === "accepted" ? "Accepted" : row.decision === "declined" ? "Denied" : "Decision pending"}` })) ?? [] },
    { label: "Accepted", tone: "accepted", complete: b.coverage.accepted_last_week_complete,
      items: b.accepted_last_week?.map(row => ({ ...row, date: row.accepted_at, detail: `${row.community} · ${row.cancelled ? "Placement cancelled" : row.confirmed_admission_at ? `Admitted ${formatDate(row.confirmed_admission_at)}` : row.assumed_arrival_at ? `${DUE_AWAITING_CENSUS_LABEL} · planned ${formatDate(row.assumed_arrival_at)}` : row.planned_at ? `Planned ${formatDate(row.planned_at)}` : "Needs admit date"}` })) ?? [] },
    // Admitted = census-confirmed or staff-recorded arrivals only; due plans are listed separately with the reason.
    { label: "Admitted", tone: "admitted", complete: b.coverage.confirmed_admissions_last_week_complete,
      items: b.confirmed_admissions_last_week?.map(row => ({ ...row, date: row.admitted_at, detail: row.community })) ?? [] },
    { label: "Due — awaiting census", tone: "due", complete: b.coverage.assumed_arrivals_last_week_complete,
      items: b.assumed_arrivals_last_week?.map(row => ({ ...row, date: row.assumed_at, detail: `${row.community} · ${DUE_AWAITING_CENSUS_LABEL}`, blocker: row.confirmation_blocker?.label ?? null })) ?? [] },
  ];
  const group = groups[selected];
  const origins = [...new Set(group.items.map(row => row.source_name || "Origin not recorded"))].sort();
  const filter = origins.includes(origin) ? origin : "all";
  const rows = group.items.filter(row => filter === "all" || (row.source_name || "Origin not recorded") === filter);
  const dates = `${formatDate(b.last_week_start)}–${formatDate(b.last_week_end)}`;
  const assessed = b.assessed_last_week ?? [];
  const accepted = b.accepted_last_week ?? [];
  const assessedAccepted = assessed.filter(row => row.decision === "accepted").length;
  const assessedDenied = assessed.filter(row => row.decision === "declined").length;
  const assessedPending = assessed.length - assessedAccepted - assessedDenied;
  const needsDate = accepted.filter(row => !row.cancelled && !row.admitted_at && !row.planned_at).length;
  const missingOrigins = group.items.filter(row => !row.source_name).length;
  const interviews = b.upcoming_assessments?.length ?? 0;
  const moves = b.planned_move_ins.length;
  const upcoming = [
    ...(b.upcoming_assessments ?? []).map(row => ({ ...row, at: row.scheduled_at, kind: "Interview" })),
    ...b.planned_move_ins.map(row => ({ ...row, at: row.planned_at, kind: "Planned admit" })),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.client_name.localeCompare(b.client_name));
  return <>
    <section className={styles.weekPaper} aria-label="Last week">
      <header className={styles.periodHeading}><h2>Last week</h2><span>{dates}</span></header>
      <div className={styles.weekChoices} aria-label="Last week’s activity">
        {groups.map(({ label, items, tone, complete }, index) => <button key={label} type="button"
          data-tone={tone} aria-pressed={selected === index} onClick={() => { setSelected(index); setOrigin("all"); }}>
          <strong>{complete === undefined ? "—" : `${items.length}${complete ? "" : "+"}`}</strong>
          <span>{label}</span>
        </button>)}
      </div>
      {group.complete === true ? <p className={styles.weekNarrative} aria-live="polite">
        {selected === 0 ? <><strong>{assessed.length} {assessed.length === 1 ? "client was" : "clients were"} assessed.</strong>{assessed.length ? <> {assessedAccepted} accepted, {assessedDenied} denied, {assessedPending} awaiting a decision.</> : null}</>
          : selected === 1 ? <><strong>{accepted.length} {accepted.length === 1 ? "client received an acceptance decision" : "clients received acceptance decisions"}.</strong>{needsDate ? <> {needsDate} still {needsDate === 1 ? "needs" : "need"} an admit date.</> : null}</>
          : selected === 3 ? <><strong>{group.items.length} planned {group.items.length === 1 ? "admission is" : "admissions are"} due and awaiting census confirmation.</strong>{group.items.length ? " They are not counted as admissions; each shows why the census check has not confirmed it." : null}</>
          : <><strong>{group.items.length} {group.items.length === 1 ? "client was" : "clients were"} admitted</strong>{group.items.length ? <> across {new Set(group.items.map(row => row.community)).size} {new Set(group.items.map(row => row.community)).size === 1 ? "community" : "communities"}.</> : "."}</>}
        {missingOrigins ? <> {missingOrigins} {missingOrigins === 1 ? "origin" : "origins"} not recorded.</> : null}
      </p> : null}
      {group.complete !== undefined && origins.length > 1 ? <div className={styles.originFilter}><label>From <select aria-label="Referral origin" value={filter} onChange={e => setOrigin(e.target.value)}>
        <option value="all">All origins</option>{origins.map(source => <option key={source} value={source}>{source} · {group.items.filter(row => (row.source_name || "Origin not recorded") === source).length}</option>)}
      </select></label></div> : null}
      <section className={styles.weekEvidence} key={`${selected}-${filter}`} aria-label={group.label}>
        {group.complete === undefined ? <p className={styles.empty}>This activity is not available in the current report.</p>
          : rows.length ? <ul className={styles.weekList}>{rows.slice(0, 3).map(item => <li key={item.pipeline_path}>
            <div><a href={toPipelinePath(item.pipeline_path)}>{item.client_name}</a><span>{formatDate(item.date, false)}</span></div>
            <p>{item.detail} · {item.owner}</p><BlockerText item={item} /><ClientContextText item={item} />
          </li>)}</ul> : <p className={styles.empty}>No matching records last week.</p>}
        {rows.length > 3 ? <button type="button" className={styles.allClients} onClick={e => setExpanded(e.currentTarget.getBoundingClientRect())}>View all {rows.length} clients</button> : null}
        {group.complete === false ? <p className={styles.caption}>Showing the first {group.items.length} records; the report limit was reached.</p> : null}
      </section>

    </section>
    <section className={styles.weekPaper} aria-label="This week">
      <header className={styles.periodHeading}><h2>This week</h2><span>{formatDate(b.week_start)}–{formatDate(b.week_end)}</span></header>
      {b.coverage.assessments_complete && b.coverage.move_ins_complete ? <p className={styles.weekNarrative}><strong>{interviews} {interviews === 1 ? "interview" : "interviews"}</strong> and <strong>{moves} planned {moves === 1 ? "admission" : "admissions"}</strong>.{b.coverage.moving_through_complete && b.moving_through.some(row => row.phase === "needs_date") ? <> Another <strong>{b.moving_through.filter(row => row.phase === "needs_date").length} accepted {b.moving_through.filter(row => row.phase === "needs_date").length === 1 ? "client still needs" : "clients still need"} an admit date</strong>.</> : null}</p> : null}
      {upcoming.length ? <ol className={styles.agenda}>{upcoming.map(row => <li key={`${row.kind}-${row.pipeline_path}`} data-kind={row.kind}>
        <div className={styles.agendaDate}><CalendarDays size={19} aria-hidden="true" /><time dateTime={row.at}>{row.kind === "Interview" && row.at.includes("T") ? formatTimestamp(row.at) : formatDate(row.at)}</time></div>
        <div><span className={styles.agendaKind}>{row.kind}</span><a href={toPipelinePath(row.pipeline_path)}>{row.client_name}</a><p>{row.community} · {row.owner}</p><ClientContextText item={row} /></div>
        <ArrowUpRight size={18} aria-hidden="true" />
      </li>)}</ol> : <p className={styles.empty}>No remaining interviews or planned admissions this week.</p>}
      {(!b.coverage.assessments_complete || !b.coverage.move_ins_complete) ? <p className={styles.caption}>The schedule is incomplete; check Calendar for all appointments.</p> : null}
    </section>
    {expanded ? <HomeDialog label="Weekly client details" title={group.label} size="browser" expandFrom={expanded} onClose={() => setExpanded(null)} className={styles.detailDialog}>
      <WeekList title={group.label} dates={dates} items={rows} complete={group.complete === true} empty="No matching records." />
    </HomeDialog> : null}
  </>;
}

function CommunityFlow({ census, weekStart }: { census: ClinicalCensusResponse; weekStart?: string }) {
  const movement = census.weekly_movement?.find(week => week.week_start === weekStart);
  const complete = movement?.complete === true;
  const values = movement?.communities ?? [];
  const admissions = values.reduce((total, row) => total + (row.admissions ?? 0), 0);
  const discharges = values.reduce((total, row) => total + (row.discharges ?? 0), 0);
  const net = admissions - discharges;
  const operatingCapacity = (community: ClinicalCensusResponse["communities"][number]) =>
    community.operating_capacity && (!community.capacity_as_of || community.capacity_as_of <= census.data_as_of) ? community.operating_capacity : null;
  const capacityKnown = census.communities.length > 0 && census.communities.every(community => operatingCapacity(community) !== null);
  const capacity = capacityKnown ? census.communities.reduce((total, community) => total + operatingCapacity(community)!, 0) : null;
  return <section className={styles.weekPaper} aria-label="Admissions versus discharges">
    <header className={styles.periodHeading}><div><h2>Census &amp; movement</h2><p>{formatDate(census.data_as_of)} · occupied / operating beds</p></div>
      <div className={styles.censusTotal}><strong>{formatNumber(census.portfolio_census_total)}</strong>{capacity !== null ? <span> / {capacity} beds</span> : <span> residents</span>}</div>
    </header>
    {complete ? <p className={styles.weekNarrative}>Last week, <strong>{admissions} admissions</strong> and <strong>{discharges} discharges</strong> {net === 0 ? "balanced out." : <>meant <strong>{Math.abs(net)} {net > 0 ? "more" : "fewer"} {Math.abs(net) === 1 ? "resident" : "residents"}</strong>.</>}</p>
      : <p role="status" className={styles.caption}>Weekly flow unavailable{movement ? " · partial figures below" : ""}.</p>}
    <div>
      <div className={styles.flowTableHead}><span>Community</span><span>Census / capacity</span><span>Last week · admissions / discharges</span></div>
      {census.communities.map(community => {
        const row = values.find(row => row.community_id === community.community_id);
        const capacity = operatingCapacity(community);
        const current = community.current_census;
        const known = current !== null && capacity !== null;
        const excess = known ? Math.max(0, current - capacity) : 0;
        return <a key={community.community_id} className={styles.flowRow} href={`https://www.alamoplatform.com/communities/${encodeURIComponent(community.community_id)}?focus=census`} target="_blank" rel="noopener noreferrer"
          aria-label={`${community.community_name}: ${current ?? "unavailable"} residents of ${capacity ?? "unknown"} operating beds; ${row?.admissions ?? "unavailable"} admissions, ${row?.discharges ?? "unavailable"} discharges last week. Open in Alamo Platform`}>
          <span className={styles.communityName}>{community.community_name}{community.reconciliation_status === "mismatch" ? <small>Needs review</small> : null}</span>
          <span className={styles.occupancy}>
            <span className={styles.occupancyValue}><strong>{current ?? "—"}</strong><span> / {capacity ?? "—"}</span>{excess ? <small>{excess} above capacity</small> : null}</span>
            {known ? <span className={styles.occupancyTrack} role="meter" aria-label={`${community.community_name} occupancy`} aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={Math.min(current, capacity)} aria-valuetext={`${current} of ${capacity} operating beds${excess ? `, ${excess} above capacity` : ""}`}>
              <i data-over-capacity={excess > 0} style={{ width: `${Math.min(100, current / capacity * 100)}%` }} />
            </span> : <small>{current === null ? "Census unavailable" : "Capacity unavailable"}</small>}
          </span>
          <span className={styles.movementNumbers}><b>{row?.admissions == null ? "—" : row.admissions === 0 ? "0" : `+${row.admissions}`}</b><span>/</span><b>{row?.discharges == null ? "—" : row.discharges === 0 ? "0" : `−${row.discharges}`}</b></span>
        </a>;
      })}
    </div>
  </section>;
}

function formatNumber(value: number | null) { return value === null ? "Unavailable" : value.toLocaleString("en-US"); }
function formatDate(value: string, includeYear = true) { const calendar = /^\d{4}-\d{2}-\d{2}$/.test(value); const date = new Date(calendar ? value + "T00:00:00Z" : value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(includeYear ? { year: "numeric" as const } : {}), timeZone: calendar ? "UTC" : "America/Los_Angeles" }).format(date); }
function formatTimestamp(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", minute: "2-digit", hour: "numeric", timeZone: "America/Los_Angeles" }).format(date)} PT`; }
