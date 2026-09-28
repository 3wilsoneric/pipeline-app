"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { assessmentInterviewFieldLabel, getAssessmentUnableReason, hasAssessmentInterviewValue, type AssessmentInterviewQuestion } from "@/lib/assessment/assessment-interview-schema";
import type { AssessmentToolData, AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";
import { capturedAssessmentAnswer } from "@/components/pipeline/assessment-working-view";
import styles from "./InterviewSplit.module.css";

// Split interview (docs/design/DECISIONS.md, "Split interview"): beside the questions, the information already
// filled in for the topic being asked (owner, 2026-09-27: "relevant to the information already filled out in that
// section during the pre-interview"), with that topic's notes docked at its foot. The line can be dragged (or moved with the arrow keys) and
// double-clicked back to half; the width is remembered on this device.

const widthKey = "pipeline:interview-split";
const [minWidth, maxWidth, defaultWidth] = [28, 70, 38];
const serverWidth = () => defaultWidth;
const readWidth = () => {
  try {
    const saved = Number(window.localStorage.getItem(widthKey));
    return saved >= minWidth && saved <= maxWidth ? saved : defaultWidth;
  } catch { return defaultWidth; }
};
const subscribeWidth = (changed: () => void) => {
  const storage = (event: StorageEvent) => { if (!event.key || event.key === widthKey) changed(); };
  window.addEventListener("storage", storage);
  return () => window.removeEventListener("storage", storage);
};

type Topic = { key: AssessmentToolSection; label: string; questions: readonly AssessmentInterviewQuestion[] };

export default function InterviewSplit({ topics, data, currentTopic, notes }: {
  topics: readonly Topic[];
  data: AssessmentToolData;
  currentTopic: AssessmentToolSection;
  /** The current topic's notes, docked at the foot of the left side. */
  notes?: ReactNode;
}) {
  const pane = useRef<HTMLElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const rememberedWidth = useSyncExternalStore(subscribeWidth, readWidth, serverWidth);
  const [adjustedWidth, setWidth] = useState<number>();
  const width = adjustedWidth ?? rememberedWidth;

  // The remembered width, and the column it sets on the page grid.
  useLayoutEffect(() => {
    pane.current?.closest<HTMLElement>("[data-assessment-working-section]")?.style.setProperty("--split", `${width}%`);
  }, [width]);
  const commit = useCallback((next: number) => {
    const clamped = Math.round(Math.min(maxWidth, Math.max(minWidth, next)));
    setWidth(clamped);
    try { window.localStorage.setItem(widthKey, String(clamped)); } catch { /* not remembered */ }
  }, []);

  // Fill the space between the pinned header and the save bar, wherever the page is scrolled.
  useEffect(() => {
    const element = pane.current;
    if (!element) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!window.matchMedia("(min-width: 1024px)").matches) { element.style.height = ""; return; }
        const footer = element.closest("[data-assessment-view]")?.querySelector<HTMLElement>('[aria-label="Assessment actions"]');
        const bottom = footer ? footer.getBoundingClientRect().top : window.innerHeight;
        element.style.height = `${Math.max(320, bottom - element.getBoundingClientRect().top)}px`;
      });
    };
    fit();
    window.addEventListener("scroll", fit, true);
    window.addEventListener("resize", fit);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", fit, true); window.removeEventListener("resize", fit); };
  }, []);

  // A new topic starts at the top of its information.
  useLayoutEffect(() => { text.current?.scrollTo({ top: 0 }); }, [currentTopic]);

  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    const grid = pane.current?.parentElement;
    if (!grid || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const bounds = grid.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => commit((moveEvent.clientX - bounds.left) / bounds.width * 100);
    const end = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end); handle.removeEventListener("pointercancel", end); };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  // Only this topic's information that is already filled in (from preparing, intake, or earlier in the interview).
  const topic = topics.find((item) => item.key === currentTopic) ?? topics[0];
  const answered = topic ? topic.questions.filter((question) => hasAssessmentInterviewValue(data[question.field]) || getAssessmentUnableReason(data, question.field)) : [];

  return <aside ref={pane} aria-label="Current information" className={styles.pane} data-interview-split>
    <div ref={text} className={styles.text} data-split-chart>
      {/* One lined page: what is already known for this topic, then the notes written below it on the same ruling. */}
      <div className={styles.page}>
      {topic ? <section key={topic.key} data-split-topic={topic.key} data-current aria-label={topic.label} className={styles.topic}>
        {answered.length ? <dl>{answered.map((question) => {
          const reason = getAssessmentUnableReason(data, question.field);
          const answer = capturedAssessmentAnswer(question, data);
          // A written answer runs the full width under its label; short facts keep the two columns.
          return <div key={question.field} data-long={answer.length > 60 || answer.includes("\n") || undefined}><dt>{assessmentInterviewFieldLabel(question.field)}</dt><dd>{answer}{reason ? <span>{reason}</span> : null}</dd></div>;
        })}</dl> : <p className={styles.empty}>No information recorded for this section yet.</p>}
      </section> : null}
      {notes ? <div className={styles.notes}>{notes}</div> : null}
      </div>
    </div>
    <div role="separator" aria-orientation="vertical" aria-label="Current information" aria-valuemin={minWidth} aria-valuemax={maxWidth} aria-valuenow={width} tabIndex={0}
      className={styles.divider} onPointerDown={drag} onDoubleClick={() => commit(defaultWidth)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 10 : 2;
        if (event.key === "ArrowLeft") { event.preventDefault(); commit(width - step); }
        else if (event.key === "ArrowRight") { event.preventDefault(); commit(width + step); }
        else if (event.key === "Home") { event.preventDefault(); commit(minWidth); }
        else if (event.key === "End") { event.preventDefault(); commit(maxWidth); }
        else if (event.key === "Enter") { event.preventDefault(); commit(defaultWidth); }
      }} />
  </aside>;
}
