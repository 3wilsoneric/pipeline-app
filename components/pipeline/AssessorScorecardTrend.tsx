"use client";

import { useState } from "react";
import type { AssessorScorecard, AssessorScorecardPerson } from "@/lib/pipeline/assessor-scorecard-types";
import { scorecardPersonColor, scorecardAxisMaximum, scorecardDisplayLabels, scorecardTrend, type ScorecardTrendMeasure } from "@/lib/pipeline/assessor-scorecard-presentation";
import type { ScorecardSelection } from "./AssessorScorecardCharts";
import styles from "./AssessorScorecard.module.css";

export default function AssessorScorecardTrend({ snapshot, people, measure, onSelect }: {
  snapshot: AssessorScorecard; people: AssessorScorecardPerson[]; measure: ScorecardTrendMeasure;
  onSelect: (selection: ScorecardSelection, trigger: HTMLButtonElement) => void;
}) {
  const [selectedId, setSelectedId] = useState(people[0]?.id);
  const selected = people.find(person => person.id === selectedId) ?? people[0];
  const trend = scorecardTrend(snapshot, measure);
  const maximum = scorecardAxisMaximum(trend.buckets.flatMap(bucket => Object.values(bucket.counts)));
  const color = (id: string) => `var(--color-${scorecardPersonColor(snapshot.people, id)})`;
  const x = (index: number) => trend.buckets.length === 1 ? 50 : 4 + 92 * index / (trend.buckets.length - 1);
  const y = (value: number) => 8 + 84 * (1 - value / maximum);
  const label = scorecardDisplayLabels[measure];
  return <section className={styles.chart} aria-label="Recorded work over time">
    <header className={styles.chartHeader}><div><h2>Work over time</h2><p>{label} · {trend.unit.toLowerCase()} beginning · Pacific time</p></div></header>
    <div className={styles.trendLegend} role="group" aria-label="Assessor to explore">
      {people.map(person => <button key={person.id} type="button" aria-pressed={selected?.id === person.id} onClick={() => setSelectedId(person.id)}>
        <span style={{ background: color(person.id) }} aria-hidden="true" />{person.name}
      </button>)}
    </div>
    <div className={styles.lineChart}>
      <span className={styles.yMaximum} aria-hidden="true">{maximum}</span><span className={styles.yZero} aria-hidden="true">0</span>
      <div className={styles.linePlot}>
        <svg viewBox="0 0 1000 220" preserveAspectRatio="none" role="img" aria-label={`${label} by ${trend.unit.toLowerCase()}. Select an assessor and a period to explore the recorded work.`}>
          {[0, maximum / 2, maximum].map(value => <line key={value} x1="40" x2="960" y1={y(value) * 2.2} y2={y(value) * 2.2} stroke="var(--color-report-rule)" vectorEffect="non-scaling-stroke" />)}
          {[...people].sort((a, b) => Number(a.id === selected?.id) - Number(b.id === selected?.id)).map(person => <polyline key={person.id} fill="none" stroke={color(person.id)} strokeWidth={selected?.id === person.id ? 3 : 1.5} opacity={selected?.id === person.id ? 1 : .65} vectorEffect="non-scaling-stroke"
            points={trend.buckets.map((bucket, index) => `${x(index) * 10},${y(bucket.counts[person.id] ?? 0) * 2.2}`).join(" ")} />)}
        </svg>
        {selected ? trend.buckets.map((bucket, index) => {
          const count = bucket.counts[selected.id] ?? 0;
          return <button className={styles.trendPoint} key={bucket.start} type="button" style={{ left: `${x(index)}%`, top: `${y(count)}%`, color: color(selected.id) }}
            data-value={count} aria-label={`${selected.name}: ${count} ${label.toLowerCase()}, ${trend.unit.toLowerCase()} beginning ${bucket.label}${bucket.partial ? ", partial period" : ""}`}
            onClick={event => onSelect({ person: selected.id, metric: measure, bucket }, event.currentTarget)}><span aria-hidden="true" /><span className="sr-only">{count}</span></button>;
        }) : null}
      </div>
      <div className={styles.lineDates} aria-hidden="true">{trend.buckets.map((bucket, index) => <span key={bucket.start} style={{ left: `${x(index)}%` }}>{bucket.label}{bucket.partial ? " *" : ""}</span>)}</div>
    </div>
    {selected ? <div className={styles.trendPeriods} aria-label={`${selected.name} periods`}>
      {trend.buckets.map(bucket => <button type="button" key={bucket.start} onClick={event => onSelect({ person: selected.id, metric: measure, bucket }, event.currentTarget)}
        aria-label={`${selected.name}: ${bucket.counts[selected.id] ?? 0} ${label.toLowerCase()}, ${trend.unit.toLowerCase()} beginning ${bucket.label}${bucket.partial ? ", partial period" : ""}`}>
        <span>{bucket.label}{bucket.partial ? " *" : ""}</span><strong>{bucket.counts[selected.id] ?? 0}</strong>
      </button>)}
    </div> : null}
    <footer className={styles.timelineLegend}><span>* Partial period</span><span>Select a period for client details</span></footer>
    {trend.undated ? <p className={styles.chartNote}>{trend.undated} undated records are included in totals, outside the timeline.</p> : null}
  </section>;
}
