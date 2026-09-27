"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { assessmentInterviewFieldLabel, getAssessmentUnableReason, hasAssessmentInterviewValue, type AssessmentInterviewQuestion } from "@/lib/assessment/assessment-interview-schema";
import type { AssessmentToolData, AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";
import type { Referral } from "@/lib/pipeline/referral-types";
import { referralCanvasValue, type PersistedCanvasFieldKey } from "@/lib/pipeline/referral-canvas-persistence";
import { formatProfileDate } from "@/lib/pipeline/client-profile-presentation";
import { presentClientName } from "@/lib/pipeline/client-identity-presentation.mjs";
import { capturedAssessmentAnswer } from "@/components/pipeline/assessment-working-view";
import styles from "./InterviewSplit.module.css";

// Split interview (docs/design/DECISIONS.md, "Split interview"): the Chart as plain text on the left, a single
// line, the interview on the right. The left side scrolls on its own, follows the topic being asked, and keeps
// the notes for that topic docked at its foot. The line can be dragged (or moved with the arrow keys) and
// double-clicked back to half; the width is remembered on this device.

const widthKey = "pipeline:interview-split";
const [minWidth, maxWidth, defaultWidth] = [30, 70, 45];

type Topic = { key: AssessmentToolSection; label: string; questions: readonly AssessmentInterviewQuestion[] };

export default function InterviewSplit({ referral, topics, data, currentTopic, context, notes }: {
  referral: Referral;
  topics: readonly Topic[];
  data: AssessmentToolData;
  currentTopic: AssessmentToolSection;
  /** Referral summary and documents, shown at the top of the chart text. */
  context?: ReactNode;
  /** The current topic's notes, docked at the foot of the left side. */
  notes?: ReactNode;
}) {
  const pane = useRef<HTMLElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(defaultWidth);

  // The remembered width, and the column it sets on the page grid.
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(widthKey));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a per-device preference read once after mount
      if (saved >= minWidth && saved <= maxWidth) setWidth(saved);
    } catch { /* storage unavailable: keep half */ }
  }, []);
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
        element.style.height = `${Math.max(320, bottom - element.getBoundingClientRect().top - 16)}px`;
      });
    };
    fit();
    window.addEventListener("scroll", fit, true);
    window.addEventListener("resize", fit);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", fit, true); window.removeEventListener("resize", fit); };
  }, []);

  // Follow the interview: bring the current topic to the top of the chart text.
  useLayoutEffect(() => {
    const scroller = text.current;
    const block = scroller?.querySelector<HTMLElement>(`[data-split-topic="${currentTopic}"]`);
    if (!scroller || !block) return;
    const top = block.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({ top: Math.max(0, top - 12), behavior: "smooth" });
  }, [currentTopic]);

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

  const value = (key: PersistedCanvasFieldKey) => {
    const raw = referralCanvasValue(referral, key)?.trim() ?? "";
    return raw && (key === "dob" || key === "referralReceived") ? formatProfileDate(raw) ?? raw : raw;
  };
  const chartGroups: { title: string; facts: [string, string][] }[] = [
    { title: "", facts: [["Date of birth", value("dob")], ["Gender", value("gender")]] },
    { title: "Referral details", facts: [["Assigned assessor", value("owner")], ["Referral received", value("referralReceived")], ["Community", value("community")], ["County", value("county")], ["Referral source", value("referent")], ["Responsible person", value("responsiblePerson")]] },
    { title: "Contact information", facts: [["Referrer name", value("referrerName")], ["Phone", value("phone")], ["Email", value("email")]] },
    { title: "Intake information", facts: [["Medications on record", value("currentMedications")], ["Conserved status", referral.conserved === "yes" ? "Yes" : referral.conserved === "no" ? "No" : ""]] },
  ];

  return <aside ref={pane} aria-label="Chart" className={styles.pane} data-interview-split>
    <div ref={text} className={styles.text} data-split-chart>
      <h3 className={styles.name}>{presentClientName(referralCanvasValue(referral, "name"), referral.id)}</h3>
      {chartGroups.map((group) => {
        const facts = group.facts.filter(([, fact]) => fact);
        return facts.length ? <section key={group.title || "identity"} aria-label={group.title || undefined} className={styles.group}>
          {group.title ? <h4>{group.title}</h4> : null}
          <dl>{facts.map(([label, fact]) => <div key={label}><dt>{label}</dt><dd>{fact}</dd></div>)}</dl>
        </section> : null;
      })}
      {context ? <div className={styles.context}>{context}</div> : null}
      {topics.some((topic) => topic.questions.some((question) => hasAssessmentInterviewValue(data[question.field]) || getAssessmentUnableReason(data, question.field))) ? <section aria-label="Assessment" className={styles.assessment}>
        <h4>Assessment</h4>
        {topics.map((topic) => {
          const answered = topic.questions.filter((question) => hasAssessmentInterviewValue(data[question.field]) || getAssessmentUnableReason(data, question.field));
          // Only what is filled in; a topic with nothing recorded yet stays out, so this never reads as a list to navigate.
          if (!answered.length) return null;
          return <section key={topic.key} data-split-topic={topic.key} data-current={topic.key === currentTopic || undefined} aria-label={topic.label} className={styles.topic}>
            <h5>{topic.label}</h5>
            <dl>{answered.map((question) => {
              const reason = getAssessmentUnableReason(data, question.field);
              return <div key={question.field}><dt>{assessmentInterviewFieldLabel(question.field)}</dt><dd>{capturedAssessmentAnswer(question, data)}{reason ? <span>{reason}</span> : null}</dd></div>;
            })}</dl>
          </section>;
        })}
      </section> : null}
    </div>
    {notes ? <div className={styles.notes}>{notes}</div> : null}
    <div role="separator" aria-orientation="vertical" aria-label="Chart" aria-valuemin={minWidth} aria-valuemax={maxWidth} aria-valuenow={width} tabIndex={0}
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
