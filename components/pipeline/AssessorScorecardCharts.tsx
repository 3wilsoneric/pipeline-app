"use client";

import { useState } from "react";
import { ArrowUpRight, FolderOpen, Info, ListChecks, MousePointer2 } from "lucide-react";
import type { AssessorScorecard, AssessorScorecardPerson } from "@/lib/pipeline/assessor-scorecard-types";
import { scorecardAxisMaximum, scorecardDefinitions, scorecardDisplayLabels as labels, scorecardValue, type ScorecardBucket, type ScorecardMeasure, type ScorecardTrendMeasure } from "@/lib/pipeline/assessor-scorecard-presentation";
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
    <section className={styles.chart} data-measure="interactions" aria-label="Clicks / taps">
      <header className={styles.chartHeader}><span className={styles.chartIcon}><MousePointer2 size={23} aria-hidden="true" /></span><div><h2>Clicks / taps</h2><p>Recorded app activity</p></div><CountHelp measure="interactions" /></header>
      <Comparison people={people} measure="interactions" onSelect={onSelect} activePerson={activePerson} onActivePerson={setActivePerson} />
      <p className={styles.chartNote}>{snapshot.usageSince ? <>Tracked since {shortDay(snapshot.usageSince)} · Earlier activity unavailable</> : "Historical click and active-time data are unavailable."}</p>
    </section>
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
