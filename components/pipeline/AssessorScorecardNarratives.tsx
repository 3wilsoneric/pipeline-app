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
        <header><h2 style={{ color: `var(--color-${scorecardPersonColor(snapshot.people, person.id)})` }}>{person.name}</h2>{!person.active ? <span>Inactive account</span> : null}</header>
        <div className={styles.narrativeBody}>
          <h3>{review.lead}</h3>
          {review.paragraphs.map((paragraph, i) => <p key={i}>{paragraph.map((part, j) => typeof part === "string" ? part : <button key={j} type="button" className={styles.narrativeFact}
            aria-label={`View evidence: ${person.name}: ${part.text}${part.bucket ? ` · ${part.bucket.label}` : ""}`}
            onClick={event => onSelect({ person: person.id, metric: part.metric, bucket: part.bucket }, event.currentTarget)}>{part.text}</button>)}</p>)}
          <p className={styles.narrativeQuestion}><strong>Follow-up</strong>{review.question}</p>
        </div>
      </article>;
    })}
  </section>;
}
