"use client";

import { useState, type CSSProperties } from "react";
import { ArrowUpRight, CalendarDays, ClipboardCheck, FolderOpen, Info, ListChecks, MousePointer2, Send, UsersRound } from "lucide-react";
import type { AssessorScorecard, AssessorScorecardPerson } from "@/lib/pipeline/assessor-scorecard-types";
import { scorecardAxisMaximum, scorecardDefinitions, scorecardDisplayLabels as labels, scorecardTrend, scorecardValue, type ScorecardBucket, type ScorecardMeasure } from "@/lib/pipeline/assessor-scorecard-presentation";
import styles from "./AssessorScorecard.module.css";

export type ScorecardSelection = { person: string; metric: ScorecardMeasure; bucket?: ScorecardBucket };
type Select = (selection: ScorecardSelection, trigger: HTMLButtonElement) => void;
type Highlight = (id: string | null, source: "pointer" | "focus") => void;
const number = (value: number) => value.toLocaleString("en-US");
const primary = [
  { measure: "confirmed", icon: ClipboardCheck, caption: "First chart confirmations" },
  { measure: "clients", icon: UsersRound, caption: "Workspaces contributed to" },
  { measure: "handoffs", icon: Send, caption: "First accepted email sends" },
  { measure: "interactions", icon: MousePointer2, caption: "Recorded app activity" },
] as const;

export default function AssessorScorecardCharts({ snapshot, people, onSelect }: { snapshot: AssessorScorecard; people: AssessorScorecardPerson[]; onSelect: Select }) {
  const [highlight, setHighlight] = useState<{ pointer: string | null; focus: string | null }>({ pointer: null, focus: null });
  const activePerson = highlight.pointer ?? highlight.focus;
  const setActivePerson: Highlight = (id, source) => setHighlight(current => ({ ...current, [source]: id }));
  const trend = scorecardTrend(snapshot);
  const maximum = Math.max(1, ...trend.buckets.flatMap(bucket => Object.values(bucket.counts)));
  const ticks = { "--buckets": trend.buckets.length } as CSSProperties;
  const shortDay = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" }).format(new Date(value));
  return <div className={styles.charts}>
    <div className={styles.primaryCharts} role="group" aria-label="Recorded work comparison">
      {primary.map(({ measure, icon: Icon, caption }) => <section className={styles.chart} data-measure={measure} aria-label={labels[measure]} key={measure}>
        <header className={styles.chartHeader}>
          <span className={styles.chartIcon}><Icon size={23} strokeWidth={1.8} aria-hidden="true" /></span>
          <div><h2>{labels[measure]}</h2><p>{caption}</p></div>
          <CountHelp measure={measure} />
        </header>
        <Comparison people={people} measure={measure} onSelect={onSelect} activePerson={activePerson} onActivePerson={setActivePerson} />
        {measure === "interactions" ? <p className={styles.chartNote}>{snapshot.usageSince ? <>Tracked since {shortDay(snapshot.usageSince)} · Earlier activity unavailable</> : "Historical click and active-time data are unavailable."}</p> : null}
      </section>)}
    </div>
    <section className={styles.currentWork} aria-label="Current follow-through">
      <header className={styles.sectionHeader}><h2>Still open</h2><span>As of {shortDay(snapshot.through)} · All dates</span></header>
      <div className={styles.chartPair}>
        <section className={styles.chart} data-measure="assigned" aria-label="Current assigned work">
          <header className={styles.chartHeader}><span className={styles.chartIcon}><FolderOpen size={23} aria-hidden="true" /></span><div><h3>Assigned now</h3><p><span className={styles.overdueKey} aria-hidden="true" /> Orange = overdue</p></div><CountHelp measure="assigned" /></header>
          <Comparison people={people} measure="assigned" onSelect={onSelect} activePerson={activePerson} onActivePerson={setActivePerson} />
        </section>
        <section className={styles.chart} data-measure="gaps" aria-label="Current completion gaps">
          <header className={styles.chartHeader}><span className={styles.chartIcon}><ListChecks size={23} aria-hidden="true" /></span><div><h3>Items to complete</h3><p>Includes admitted clients</p></div><CountHelp measure="gaps" /></header>
          <Comparison people={people} measure="gaps" onSelect={onSelect} activePerson={activePerson} onActivePerson={setActivePerson} />
        </section>
      </div>
    </section>
    <section className={styles.chart} data-measure="confirmed" aria-label="When assessments were confirmed">
      <header className={styles.chartHeader}><span className={styles.chartIcon}><CalendarDays size={23} aria-hidden="true" /></span><div><h2>Assessments over time</h2><p>Confirmations · {trend.unit.toLowerCase()} beginning · Pacific time</p></div></header>
      <div className={styles.timeline} style={ticks}>
        <div className={styles.weekHeading} aria-hidden="true"><span /><div>{trend.buckets.map(bucket => <span key={bucket.start}>{bucket.label}{bucket.partial ? " *" : ""}</span>)}</div></div>
        {people.map(person => <div className={styles.weekRow} key={person.id}>
          <span className={styles.weekName}>{person.name}</span>
          <div className={styles.weekCells}>{trend.buckets.map(bucket => {
            const count = bucket.counts[person.id] ?? 0;
            return <button key={bucket.start} type="button" className={styles.weekCell} data-tone={count === 0 ? 0 : Math.ceil(4 * count / maximum)}
              aria-label={`${person.name}: ${count} assessments confirmed, ${trend.unit.toLowerCase()} beginning ${bucket.label}${bucket.partial ? ', partial period' : ''}`}
              onClick={event => onSelect({ person: person.id, metric: "confirmed", bucket }, event.currentTarget)}>
              <strong>{count}</strong><span className={styles.mobileWeek}>{bucket.label}{bucket.partial ? " *" : ""}</span>
            </button>;
          })}</div>
        </div>)}
      </div>
      <footer className={styles.timelineLegend}><span>* Partial period</span><span className={styles.intensity}>Fewer <i aria-hidden="true" /> More</span></footer>
      {trend.undated ? <p className={styles.chartNote}>{number(trend.undated)} confirmations without a recorded date are included in totals, outside the timeline.</p> : null}
    </section>
  </div>;
}

function CountHelp({ measure }: { measure: ScorecardMeasure }) {
  return <details className={styles.countHelp}>
    <summary aria-label={`How ${labels[measure].toLowerCase()} are counted`}><Info size={18} aria-hidden="true" /></summary>
    <p>{scorecardDefinitions[measure]}</p>
  </details>;
}

function Comparison({ people, measure, onSelect, activePerson, onActivePerson }: { people: AssessorScorecardPerson[]; measure: ScorecardMeasure; onSelect: Select; activePerson: string | null; onActivePerson: Highlight }) {
  const maximum = scorecardAxisMaximum(people.map(person => scorecardValue(person, measure)));
  return <>
    <ul className={styles.bars} aria-label={labels[measure]}>
      {people.map(person => {
        const value = scorecardValue(person, measure);
        const overdue = measure === "assigned" ? person.evidence.overdue.length : 0;
        return <li key={person.id}>
          <button className={styles.barRow} type="button" data-highlighted={activePerson === person.id || undefined}
            onMouseEnter={() => onActivePerson(person.id, "pointer")} onMouseLeave={() => onActivePerson(null, "pointer")} onFocus={() => onActivePerson(person.id, "focus")} onBlur={() => onActivePerson(null, "focus")}
            aria-label={`${person.name}: ${value === null ? "not tracked" : `${number(value)} ${labels[measure].toLowerCase()}`}${overdue ? `, ${overdue} overdue assignments included` : ""}`}
            onClick={event => onSelect({ person: person.id, metric: measure }, event.currentTarget)}>
            <span className={styles.barName}>{person.name}{!person.active ? <span>Inactive account</span> : null}</span>
            <span className={styles.barPlot} aria-hidden="true"><span className={styles.barTrack}><span className={styles.barFill} style={{ width: `${100 * (value ?? 0) / maximum}%` }}>
              {overdue && value ? <span className={styles.overdueFill} style={{ width: `${100 * overdue / value}%` }} /> : null}
            </span></span><strong>{value === null ? "—" : number(value)}</strong></span>
            <ArrowUpRight className={styles.drillArrow} size={17} aria-hidden="true" />
            {overdue ? <span className={styles.overdueLabel}>{overdue} overdue</span> : null}
          </button>
        </li>;
      })}
    </ul>
    <div className={styles.axis} aria-hidden="true"><span>0</span><span>{number(maximum)}</span></div>
  </>;
}
