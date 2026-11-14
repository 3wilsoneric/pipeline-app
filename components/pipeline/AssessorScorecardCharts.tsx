"use client";

import { useState, type CSSProperties } from "react";
import type { AssessorScorecard, AssessorScorecardPerson, ScorecardMetric } from "@/lib/pipeline/assessor-scorecard-types";
import { scorecardAxisMaximum, scorecardMeasures, scorecardTrend, scorecardValue, type ScorecardBucket, type ScorecardMeasure } from "@/lib/pipeline/assessor-scorecard-presentation";
import styles from "./AssessorScorecard.module.css";

export type ScorecardSelection = { person: string; metric: ScorecardMetric; bucket?: ScorecardBucket };
type Select = (selection: ScorecardSelection, trigger: HTMLButtonElement) => void;
const number = (value: number) => value.toLocaleString("en-US");

export default function AssessorScorecardCharts({ snapshot, people, onSelect }: { snapshot: AssessorScorecard; people: AssessorScorecardPerson[]; onSelect: Select }) {
  const [measure, setMeasure] = useState<ScorecardMeasure>("confirmed");
  const trend = scorecardTrend(snapshot);
  const maximum = Math.max(1, ...trend.buckets.flatMap(bucket => Object.values(bucket.counts)));
  const ticks = { "--buckets": trend.buckets.length } as CSSProperties;
  return <div className={styles.charts}>
    <section className={styles.chart} aria-label="Recorded work comparison">
      <header className={styles.chartHeader}>
        <h2>{scorecardMeasures[measure]}</h2>
        <label className={styles.measure}><span className="sr-only">Compare recorded work</span><select value={measure} onChange={event => setMeasure(event.target.value as ScorecardMeasure)}>
          {Object.entries(scorecardMeasures).filter(([key]) => !["assigned", "overdue", "gaps"].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
      </header>
      <Comparison people={people} measure={measure} onSelect={onSelect} showDays />
      {measure === "interviews" ? <p className={styles.chartNote}>Explicit finish events only; an absent event does not mean no interview occurred.</p> : null}
      {measure === "interactions" || measure === "activeMinutes" ? <p className={styles.chartNote}>Approximate foreground usage, not hours worked. Earlier activity is unavailable.</p> : null}
    </section>
    <section className={styles.chart} aria-label="When charts were confirmed">
      <header className={styles.chartHeader}><h2>When charts were confirmed</h2><span>{trend.unit} beginning · Pacific time</span></header>
      <div className={styles.timeline} style={ticks}>
        <div className={styles.weekHeading} aria-hidden="true"><span /><div>{trend.buckets.map(bucket => <span key={bucket.start}>{bucket.label}{bucket.partial ? " *" : ""}</span>)}</div></div>
        {people.map(person => <div className={styles.weekRow} key={person.id}>
          <span className={styles.weekName}>{person.name}</span>
          <div className={styles.weekCells}>{trend.buckets.map(bucket => {
            const count = bucket.counts[person.id] ?? 0;
            return <button key={bucket.start} type="button" className={styles.weekCell} data-tone={count === 0 ? 0 : Math.ceil(4 * count / maximum)}
              aria-label={`${person.name}: ${count} charts confirmed, ${trend.unit.toLowerCase()} beginning ${bucket.label}${bucket.partial ? ', partial period' : ''}`}
              onClick={event => onSelect({ person: person.id, metric: "confirmed", bucket }, event.currentTarget)}>
              <strong>{count}</strong><span className={styles.mobileWeek}>{bucket.label}{bucket.partial ? " *" : ""}</span>
            </button>;
          })}</div>
        </div>)}
      </div>
      <footer className={styles.timelineLegend}><span>* Partial period</span><span className={styles.intensity}>Fewer <i aria-hidden="true" /> More</span></footer>
      {trend.undated ? <p className={styles.chartNote}>{number(trend.undated)} confirmations without a recorded date are included in totals, outside the timeline.</p> : null}
    </section>
    <div className={styles.chartPair}>
      <section className={styles.chart} aria-label="Current assigned work">
        <header className={styles.chartHeader}><h2>Assigned now</h2></header>
        <Comparison people={people} measure="assigned" onSelect={onSelect} />
        <p className={styles.chartNote}><span className={styles.overdueKey} aria-hidden="true" /> Overdue assignments are part of the total.</p>
      </section>
      <section className={styles.chart} aria-label="Current completion gaps">
        <header className={styles.chartHeader}><h2>Open completion items</h2></header>
        <Comparison people={people} measure="gaps" onSelect={onSelect} />
        <p className={styles.chartNote}>Includes admitted clients · Items, not clients or a quality grade</p>
      </section>
    </div>
  </div>;
}

function Comparison({ people, measure, onSelect, showDays = false }: { people: AssessorScorecardPerson[]; measure: ScorecardMeasure; onSelect: Select; showDays?: boolean }) {
  const maximum = scorecardAxisMaximum(people.map(person => scorecardValue(person, measure)));
  const usage = measure === "interactions" || measure === "activeMinutes";
  return <>
    <ul className={styles.bars} aria-label={scorecardMeasures[measure]}>
      {people.map(person => {
        const value = scorecardValue(person, measure);
        const overdue = measure === "assigned" ? person.evidence.overdue.length : 0;
        const content = <>
          <span className={styles.barName}><strong>{person.name}</strong>{showDays ? <span>{person.activeDays} days with recorded work{person.active ? "" : " · Inactive account"}</span> : null}</span>
          <span className={styles.barPlot} aria-hidden="true"><span className={styles.barTrack}><span className={styles.barFill} style={{ width: `${100 * (value ?? 0) / maximum}%` }}>
            {overdue && value ? <span className={styles.overdueFill} style={{ width: `${100 * overdue / value}%` }} /> : null}
          </span></span><strong>{value === null ? "—" : number(value)}{overdue ? <span>{overdue} overdue</span> : null}</strong></span>
        </>;
        return <li key={person.id}>
          {usage ? <div className={styles.barRow}>{content}<span className="sr-only">{value === null ? "Not tracked" : `${number(value)} ${scorecardMeasures[measure].toLowerCase()}`}</span></div>
            : <button className={styles.barRow} type="button" aria-label={`${person.name}: ${value} ${scorecardMeasures[measure].toLowerCase()}${overdue ? `, ${overdue} overdue assignments included` : ""}`} onClick={event => onSelect({ person: person.id, metric: measure }, event.currentTarget)}>{content}</button>}
        </li>;
      })}
    </ul>
    <div className={styles.axis} aria-hidden="true"><span /><div><span>0</span><span>{number(maximum / 2)}</span><span>{number(maximum)}</span></div></div>
  </>;
}
