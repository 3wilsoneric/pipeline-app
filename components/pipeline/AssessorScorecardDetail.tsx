"use client";

import { useState } from "react";
import { ArrowUpRight, CalendarDays, Clock3, MousePointer2 } from "lucide-react";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import type { AssessorScorecard, AssessorScorecardPerson, ScorecardEvidence } from "@/lib/pipeline/assessor-scorecard-types";
import { scorecardRecentWindow, scorecardSelection, scorecardDefinitions, scorecardDisplayLabels as labels, scorecardValue, type ScorecardMeasure } from "@/lib/pipeline/assessor-scorecard-presentation";
import HomeDialog, { type HomeDialogOrigin } from "./HomeDialog";
import type { ScorecardSelection } from "./AssessorScorecardCharts";
import styles from "./AssessorScorecard.module.css";

const day = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric" }).format(new Date(value));

export default function AssessorScorecardDetail({ person, snapshot, selection, origin, onSelect, onClose }: {
  person: AssessorScorecardPerson; snapshot: AssessorScorecard; selection: ScorecardSelection; origin: HomeDialogOrigin;
  onSelect: (selection: ScorecardSelection) => void; onClose: () => void;
}) {
  const metric = selection.metric;
  const usage = metric === "interactions" || metric === "activeMinutes";
  const { evidence, value } = scorecardSelection(person, metric, selection.bucket);
  const recent = scorecardRecentWindow(snapshot);
  const recentCount = (measure: ScorecardMeasure) => scorecardSelection(person, measure, recent).value;
  return <HomeDialog label={`${person.name} breakdown`} title={person.name} size="browser" className={styles.detailDialog} expandFrom={origin} onClose={onClose}>
    <div className={styles.detailBody}>
      <div className={styles.detailToolbar}>
        <label className={styles.detailMeasure}><span className="sr-only">Work measures</span><select value={metric} onChange={event => onSelect({ person: person.id, metric: event.target.value as ScorecardMeasure })}>
          {(Object.keys(labels) as ScorecardMeasure[]).map(key => <option key={key} value={key}>{labels[key]} · {scorecardValue(person, key) ?? "Not tracked"}</option>)}
        </select></label>
        <span>{selection.bucket ? `${selection.bucket.label}${selection.bucket.partial ? " · Partial period" : ""}` : ["assigned", "overdue", "gaps"].includes(metric) ? `As of ${day(snapshot.through)}` : `${day(snapshot.since)}–${day(snapshot.through)}`}</span>
      </div>
      <div className={styles.detailSummary}>
        <strong>{value === null ? "—" : value.toLocaleString("en-US")}</strong>
        <div><h3>{labels[metric]}{selection.bucket ? ` · ${selection.bucket.label}` : ""}</h3><p>{scorecardDefinitions[metric]}</p></div>
      </div>
      {selection.bucket ? <button type="button" className={styles.back} onClick={() => onSelect({ person: person.id, metric })}>Show full period</button> : null}
      <details className={styles.recentContext}>
        <summary>Recent activity &amp; current workload</summary>
        <p>{day(`${recent.start}T12:00:00Z`)}–{day(snapshot.through)}: {recentCount("days")} days with recorded work across {recentCount("clients")} workspaces; {recentCount("confirmed")} first chart confirmations and {recentCount("handoffs")} first handoffs.</p>
        <button type="button" className={styles.back} onClick={() => onSelect({ person: person.id, metric: "assigned" })}>{person.evidence.assigned.length} assigned now</button>
        <p>Activity is credited to the person who recorded it. Preparation and handoff may be shared; current assignments do not measure past workload.</p>
      </details>
      {usage ? <>
        <div className={styles.usageFacts}>
          {[
            { icon: MousePointer2, value: person.usage?.interactions, label: "Clicks / taps" },
            { icon: Clock3, value: person.usage?.activeMinutes, label: "Active minutes" },
            { icon: CalendarDays, value: person.usage?.days, label: "Days with tracked activity" },
          ].map(({ icon: Icon, value: total, label }) => <div key={label}><Icon size={22} aria-hidden="true" /><strong>{total === undefined ? "Not tracked" : total.toLocaleString("en-US")}</strong><span>{label}</span></div>)}
        </div>
        <p className={styles.coverage}>{snapshot.usageSince ? `Tracking began ${day(snapshot.usageSince)}. Earlier activity is unavailable.` : "Historical click and active-time data are unavailable."} Usage is not linked to client records.</p>
      </> : <EvidenceList key={`${person.id}:${metric}:${selection.bucket?.start ?? ""}`} evidence={evidence} />}
      {metric === "interviews" ? <p className={styles.coverage}>Median start-to-finish interval: {person.interviewSpanHours === null ? "not available" : `${person.interviewSpanHours.toFixed(1)} hours (${person.interviewSpanSamples} interviews)`}. Includes pauses; not time worked.</p> : null}
      <p className={styles.coverage}>{person.activeDays} days with recorded work{person.active ? "" : " · Inactive account"}</p>
    </div>
  </HomeDialog>;
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
      <div><a href={toPipelinePath(`/?view=referrals&screen=packet&referralId=${first.referralId}&workspaceStage=chart`)}>{first.client}<ArrowUpRight size={16} aria-hidden="true" /></a><span>{first.community} · Workspace #{first.referralId}</span></div>
      {items.length === 1 ? <p>{first.detail}{first.at ? <time dateTime={first.at}>{day(first.at)}</time> : null}</p> : <details><summary>{items.length} records</summary><ul>{items.map(item => <li key={item.key}>{item.detail}{item.at ? <time dateTime={item.at}>{day(item.at)}</time> : null}</li>)}</ul></details>}
    </li>)}</ul>
    {groups.length > limit ? <button type="button" className={styles.more} onClick={() => setLimit(value => value + 20)}>Show more clients</button> : null}
  </>;
}
