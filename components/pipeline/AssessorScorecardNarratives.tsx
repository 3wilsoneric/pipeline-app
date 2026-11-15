"use client";

import type { AssessorScorecard, AssessorScorecardPerson } from "@/lib/pipeline/assessor-scorecard-types";
import { scorecardNarrative } from "@/lib/pipeline/assessor-scorecard-narrative";
import { scorecardPersonColor } from "@/lib/pipeline/assessor-scorecard-presentation";
import type { ScorecardSelection } from "./AssessorScorecardCharts";
import styles from "./AssessorScorecard.module.css";

export default function AssessorScorecardNarratives({ snapshot, people, onSelect }: {
  snapshot: AssessorScorecard; people: AssessorScorecardPerson[];
  onSelect: (selection: ScorecardSelection, trigger: HTMLButtonElement) => void;
}) {
  return <section aria-label="Assessor usage review" className={styles.narratives}>
    {people.map(person => {
      const review = scorecardNarrative(snapshot, person);
      return <article key={person.id} aria-label={`${person.name} usage review`} className={styles.assessorNarrative}>
        <header><h2 style={{ color: `var(--color-${scorecardPersonColor(snapshot.people, person.id)})` }}>{person.name}</h2>{!person.active ? <span>Inactive account</span> : null}<p className={styles.narrativeLead}>{review.lead}</p></header>
        <div className={styles.narrativeBody}>
          {review.sections.map(section => <div key={section.kind} data-kind={section.kind} className={styles.narrativeSection}>
            {section.paragraphs.map((paragraph, i) => <p key={i}>{paragraph.map((part, j) => {
              if (typeof part === "string") return section.kind === "recent" && i === 0 && j === 0
                ? <strong key={j} className={styles.narrativeDates}>{part.replace(/: $/, "")}</strong>
                : j > 0 && typeof paragraph[j - 1] !== "string" ? part.replace(/^[,.;:!?]+/, "") : part;
              // Keep punctuation with the inline control so it cannot start a line on a phone.
              const next = paragraph[j + 1];
              const punctuation = typeof next === "string" ? next.match(/^[,.;:!?]+/)?.[0] ?? "" : "";
              return <button key={j} type="button" className={styles.narrativeFact}
                aria-label={`View evidence: ${person.name}: ${part.text}${part.bucket ? ` · ${part.bucket.label}` : ""}`}
                onClick={event => onSelect({ person: person.id, metric: part.metric, bucket: part.bucket }, event.currentTarget)}>{part.text}{punctuation}</button>;
            })}</p>)}
          </div>)}
          <p className={styles.narrativeQuestion}><strong>Follow-up</strong>{review.question}</p>
        </div>
      </article>;
    })}
  </section>;
}
