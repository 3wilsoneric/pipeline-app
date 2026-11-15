"use client";

import { useState, type CSSProperties } from "react";
import { ArrowUpRight, Info, MousePointer2 } from "lucide-react";
import type { AssessorScorecard, AssessorScorecardPerson } from "@/lib/pipeline/assessor-scorecard-types";
import { scorecardAxisMaximum, scorecardRecentDays, scorecardPersonColor, scorecardDefinitions, scorecardDisplayLabels as labels, scorecardValue, type ScorecardBucket, type ScorecardMeasure, type ScorecardTrendMeasure } from "@/lib/pipeline/assessor-scorecard-presentation";
import styles from "./AssessorScorecard.module.css";
import AssessorScorecardTrend from "./AssessorScorecardTrend";

export type ScorecardSelection = { person: string; metric: ScorecardMeasure; bucket?: ScorecardBucket };
type Select = (selection: ScorecardSelection, trigger: HTMLButtonElement) => void;
type Highlight = (id: string | null, source: "pointer" | "focus") => void;
const number = (value: number) => value.toLocaleString("en-US");
export default function AssessorScorecardCharts({ snapshot, people, measure, onSelect }: { snapshot: AssessorScorecard; measure: ScorecardTrendMeasure; people: AssessorScorecardPerson[]; onSelect: Select }) {
  const [highlight, setHighlight] = useState<{ pointer: string | null; focus: string | null }>({ pointer: null, focus: null });
  const activePerson = highlight.pointer ?? highlight.focus;
  const setActivePerson: Highlight = (id, source) => setHighlight(current => ({ ...current, [source]: id }));
  const shortDay = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" }).format(new Date(value));
  return <div className={styles.charts}>
    <div className={styles.usageComparison} role="group" aria-label="Recorded work comparison">
      <section className={styles.chart} data-measure={measure} aria-label={labels[measure]}>
        <header className={styles.chartHeader}><div><h2>{labels[measure]}</h2><p>Selected period</p></div><CountHelp measure={measure} /></header>
        <Comparison people={people} measure={measure} onSelect={onSelect} activePerson={activePerson} onActivePerson={setActivePerson} />
      </section>
      <AssessorScorecardTrend snapshot={snapshot} people={people} measure={measure} onSelect={onSelect} />
    </div>
    <div className={styles.activityPair}>
      <RecentActivity snapshot={snapshot} people={people} onSelect={onSelect} />
      <section className={styles.chart} data-measure="interactions" aria-label="Clicks / taps">
        <header className={styles.chartHeader}><span className={styles.chartIcon}><MousePointer2 size={23} aria-hidden="true" /></span><div><h2>Clicks / taps</h2><p>Recorded app activity</p></div><CountHelp measure="interactions" /></header>
        <ul className={styles.activityReadout}>
          {people.map(person => <li key={person.id}>
            <button type="button" data-highlighted={activePerson === person.id || undefined}
              onMouseEnter={() => setActivePerson(person.id, "pointer")} onMouseLeave={() => setActivePerson(null, "pointer")} onFocus={() => setActivePerson(person.id, "focus")} onBlur={() => setActivePerson(null, "focus")}
              aria-label={`${person.name}: ${person.usage === null ? "not tracked" : `${number(person.usage.interactions)} clicks / taps`}`}
              onClick={event => onSelect({ person: person.id, metric: "interactions" }, event.currentTarget)}>
              <span>{person.name}{!person.active ? <small>Inactive account</small> : null}</span>
              <strong>{person.usage === null ? "—" : number(person.usage.interactions)}</strong><ArrowUpRight size={17} aria-hidden="true" />
            </button>
          </li>)}
        </ul>
        <p className={styles.chartNote}>{snapshot.usageSince ? <>Tracked since {shortDay(snapshot.usageSince)} · Earlier activity unavailable</> : "Historical click and active-time data are unavailable."}</p>
      </section>
    </div>
    <section className={styles.chart} aria-label="Current follow-through">
      <header className={styles.sectionHeader}><h2>Still open</h2><span>As of {shortDay(snapshot.through)} · All dates</span></header>
      <div className={styles.workloadHead} aria-hidden="true"><span /><span>Assigned now</span><span>Items to complete</span></div>
      <ul className={styles.workload}>
        {people.map(person => <li key={person.id}>
          <strong className={styles.workloadName}>{person.name}{!person.active ? <small>Inactive account</small> : null}</strong>
          <button type="button" aria-label={`${person.name}: ${person.evidence.assigned.length} assigned now${person.evidence.overdue.length ? `, ${person.evidence.overdue.length} overdue assignments included` : ""}`}
            onClick={event => onSelect({ person: person.id, metric: "assigned" }, event.currentTarget)}>
            <span className={styles.mobileMetric}>Assigned now</span><strong>{person.evidence.assigned.length}</strong><ArrowUpRight size={16} aria-hidden="true" />
            {person.evidence.overdue.length ? <small className={styles.overdueLabel}>{person.evidence.overdue.length} overdue</small> : null}
          </button>
          <button type="button" aria-label={`${person.name}: ${person.evidence.gaps.length} items to complete`}
            onClick={event => onSelect({ person: person.id, metric: "gaps" }, event.currentTarget)}>
            <span className={styles.mobileMetric}>Items to complete</span><strong>{person.evidence.gaps.length}</strong><ArrowUpRight size={16} aria-hidden="true" />
          </button>
        </li>)}
      </ul>
      <p className={styles.chartNote}>Completion items include admitted clients.</p>
    </section>
  </div>;
}

function RecentActivity({ snapshot, people, onSelect }: { snapshot: AssessorScorecard; people: AssessorScorecardPerson[]; onSelect: Select }) {
  const days = scorecardRecentDays(snapshot);
  return <section className={styles.chart} aria-label="Recent recorded work">
    <header className={styles.chartHeader}><div><h2>Recent activity</h2><p>{days[0]?.label}–{days.at(-1)?.label} · Pacific time</p></div><CountHelp measure="days" /></header>
    <ul className={styles.activityCalendar}>
      {people.map(person => <li key={person.id}>
        <strong>{person.name}</strong>
        <div className={styles.activityDays} role="group" aria-label={`${person.name} recorded-work days`}>
          {days.map(day => <button type="button" key={day.start} data-recorded={day.counts[person.id] > 0 || undefined}
            style={{ "--day-color": `var(--color-${scorecardPersonColor(snapshot.people, person.id)})` } as CSSProperties}
            aria-label={`${person.name}: ${day.counts[person.id]} clients worked on ${day.label}`}
            title={`${day.label}: ${day.counts[person.id]} clients worked`}
            onClick={event => onSelect({ person: person.id, metric: "clients", bucket: day }, event.currentTarget)}>
            <span aria-hidden="true">{Number(day.start.slice(-2))}</span>
          </button>)}
        </div>
      </li>)}
    </ul>
    <p className={styles.chartNote}><span className={styles.calendarKey} aria-hidden="true" /> Saved work · Select a day for clients</p>
  </section>;
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

        return <li key={person.id}>
          <button className={styles.barRow} type="button" data-highlighted={activePerson === person.id || undefined}
            onMouseEnter={() => onActivePerson(person.id, "pointer")} onMouseLeave={() => onActivePerson(null, "pointer")} onFocus={() => onActivePerson(person.id, "focus")} onBlur={() => onActivePerson(null, "focus")}
            aria-label={`${person.name}: ${value === null ? "not tracked" : `${number(value)} ${labels[measure].toLowerCase()}`}`}
            onClick={event => onSelect({ person: person.id, metric: measure }, event.currentTarget)}>
            <span className={styles.barName}>{person.name}{!person.active ? <span>Inactive account</span> : null}</span>
            <span className={styles.barPlot} aria-hidden="true"><span className={styles.barTrack}><span className={styles.barFill} style={{ width: `${100 * (value ?? 0) / maximum}%` }}>
            </span></span><strong>{value === null ? "—" : number(value)}</strong></span>
            <ArrowUpRight className={styles.drillArrow} size={17} aria-hidden="true" />
          </button>
        </li>;
      })}
    </ul>
    <div className={styles.axis} aria-hidden="true"><span>0</span><span>{number(maximum)}</span></div>
  </>;
}
