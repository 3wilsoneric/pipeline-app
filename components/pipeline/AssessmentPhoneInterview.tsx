"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { assessmentInterviewFieldLabel, assessmentInterviewSections, getAssessmentInterviewQuestions, getAssessmentUnableReason, hasAssessmentInterviewValue } from "@/lib/assessment/assessment-interview-schema";
import { assessmentPreparationGroups, preparationQuestions } from "@/lib/assessment/assessment-preparation";
import type { AssessmentToolFieldKey, AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";
import { WorkingAssessmentField, type WorkingSectionProps } from "@/components/pipeline/AssessmentWorkingSection";
import { assessmentQuestionStatus, capturedAssessmentAnswer, assessmentWorkingCounts, matchesAssessmentQuestion } from "@/components/pipeline/assessment-working-view";
import styles from "./AssessmentPhoneInterview.module.css";

const phoneQuery = "(max-width: 639px), (max-width: 959px) and (max-height: 500px) and (pointer: coarse)";
function subscribePhone(onChange: () => void) {
  const query = window.matchMedia(phoneQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
export function usePhoneAssessment() {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(phoneQuery).matches, () => false);
}

type Props = WorkingSectionProps & {
  preparing: boolean;
  onSectionChange: (section: AssessmentToolSection) => void;
  onFinish: () => void;
};

export default function AssessmentPhoneInterview(props: Props) {
  const { questions, data, pending, target } = props;
  const sections = props.preparing
    ? assessmentPreparationGroups.map((group) => ({ ...group, questions: preparationQuestions(group, data) }))
    : assessmentInterviewSections.map((section) => ({ ...section, questions: getAssessmentInterviewQuestions(section.key, data) }));
  const section = sections.find((section) => section.questions.some((q) => questions.some((question) => question.field === q.field))) ?? sections.find((section) => section.key === props.section) ?? sections[0];
  const initial = () => target?.field ?? questions.find((question) => assessmentQuestionStatus(question, data, pending) !== "captured")?.field ?? questions[0]?.field;
  const [field, setField] = useState<AssessmentToolFieldKey | undefined>(initial);
  const [received, setReceived] = useState({ section: section.key, target });
  const [panel, setPanel] = useState<"sections" | "reference">("sections");
  const [query, setQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLParagraphElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  if (received.section !== section.key || received.target !== target) {
    setReceived({ section: section.key, target });
    setField(initial());
  }
  const index = Math.max(0, questions.findIndex((question) => question.field === field));
  const question = questions[index];
  const sectionIndex = sections.findIndex((item) => item.key === section.key);
  const counts = assessmentWorkingCounts(questions, data, pending);
  const reference = assessmentInterviewSections.flatMap((section) => getAssessmentInterviewQuestions(section.key, data))
    .filter((question) => hasAssessmentInterviewValue(data[question.field]) || pending.includes(question.field));

  // Unmounting a focused input does not reliably emit blur. Commit through the
  // same field-save owner before every swipe, section jump, or reference edit.
  const commit = () => {
    if (question) props.onFieldBlur(question.field);
    if (document.activeElement instanceof HTMLElement && scroller.current?.contains(document.activeElement)) document.activeElement.blur();
  };
  const chooseSection = (key: AssessmentToolSection, nextField?: AssessmentToolFieldKey) => {
    commit();
    dialog.current?.close();
    if (nextField) props.onReferenceEdit?.(nextField);
    else props.onSectionChange(key);
  };
  const move = (direction: -1 | 1) => {
    commit();
    const next = questions[index + direction];
    if (next) setField(next.field);
    else if (sections[sectionIndex + direction]) {
      const destination = sections[sectionIndex + direction];
      const previous = destination.questions.at(-1);
      if (direction === -1 && previous && props.onReferenceEdit) props.onReferenceEdit(previous.field);
      else props.onSectionChange(destination.key);
    }
    else if (direction === 1) props.onFinish();
  };
  const openPanel = (next: typeof panel, opener: HTMLButtonElement) => {
    commit();
    setQuery("");
    setPanel(next);
    // Safari touch does not focus buttons; give the native dialog a return target.
    opener.focus({ preventScroll: true });
    dialog.current?.showModal();
  };
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [question?.field, target]);

  return <section className={styles.interview} data-phone-interview aria-label={props.preparing ? "Guided questionnaire" : "Guided assessment"}>
    <nav className={styles.toolbar} aria-label="Question navigation">
      <button type="button" onClick={(event) => openPanel("sections", event.currentTarget)} aria-haspopup="dialog" aria-label="Choose questionnaire section"><span>{section.label}</span><ChevronDown size={16} aria-hidden="true" /></button>
      <button type="button" onClick={(event) => openPanel("reference", event.currentTarget)} aria-haspopup="dialog"><BookOpen size={17} aria-hidden="true" /><span>Client info</span></button>
    </nav>
    <div className={styles.progress} role="progressbar" aria-label="Recorded in this section" aria-valuemin={0} aria-valuemax={questions.length || 1} aria-valuenow={counts.captured}><span style={{ width: `${counts.captured / (questions.length || 1) * 100}%` }} /></div>
    <div ref={scroller} className={styles.scroller} data-phone-question-scroll onTouchStart={(event) => {
      const el = event.target as HTMLElement;
      touch.current = event.touches.length === 1 && event.touches[0].clientX > 24 && event.touches[0].clientX < window.innerWidth - 24 && !el.closest("input, textarea, select, button, label, summary, a, [contenteditable]")
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
    }} onTouchCancel={() => { touch.current = null; }} onTouchEnd={(event) => {
      const start = touch.current;
      touch.current = null;
      if (!start || event.changedTouches.length !== 1) return;
      const dx = event.changedTouches[0].clientX - start.x;
      const dy = event.changedTouches[0].clientY - start.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) move(dx < 0 ? 1 : -1);
    }}>
      <div className={styles.question} key={question?.field ?? section.key}>
        <p ref={heading} tabIndex={-1} className={styles.position} aria-live="polite">{question ? `${index + 1} of ${questions.length} in this section` : "No questions here"}<span>{counts.captured} recorded</span></p>
        {question ? <WorkingAssessmentField {...props} question={question} /> : <p>Continue to the next section.</p>}
      </div>
    </div>
    <nav className={styles.paging} aria-label="Question steps">
      <button type="button" aria-label="Previous question" onClick={() => move(-1)} disabled={index === 0 && sectionIndex === 0}><ChevronLeft size={20} aria-hidden="true" />Back</button>
      <button type="button" onClick={() => move(1)}>{index < questions.length - 1 ? "Next" : sectionIndex < sections.length - 1 ? "Next section" : "Review & finish"}<ChevronRight size={20} aria-hidden="true" /></button>
    </nav>
    <dialog ref={dialog} className={styles.sheet} aria-label={panel === "sections" ? "Questionnaire sections" : "Client information"} onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <header><h3>{panel === "sections" ? "Your questionnaire" : "Client information"}</h3><button type="button" aria-label="Close information panel" onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button></header>
      <div className={styles.sheetBody}>
        {panel === "sections" ? <>
          <p>Go in any order. Unknown answers can stay blank.</p>
          <input type="search" aria-label="Find a question" placeholder="Find a question" value={query} onChange={(event) => setQuery(event.target.value)} />
          {query.trim() ? sections.flatMap((item) => item.questions.filter((question) => matchesAssessmentQuestion(question, query)).map((question) => <button type="button" key={question.field} onClick={() => chooseSection(item.key, question.field)}><strong>{assessmentInterviewFieldLabel(question.field)}</strong><span>{item.label}</span><ChevronRight size={17} aria-hidden="true" /></button>)) : sections.map((item) => {
            const count = assessmentWorkingCounts(item.questions, data, pending);
            return <button type="button" key={item.key} aria-current={item.key === section.key ? "step" : undefined} onClick={() => chooseSection(item.key)}><strong>{item.label}</strong><span>{count.captured} / {item.questions.length} recorded{count.verify ? ` · ${count.verify} to verify` : ""}</span><ChevronRight size={17} aria-hidden="true" /></button>;
          })}
          {query.trim() && !sections.some((item) => item.questions.some((question) => matchesAssessmentQuestion(question, query))) ? <p role="status">No matching questions.</p> : null}
          <button type="button" onClick={() => { dialog.current?.close(); props.onFinish(); }}><strong>Review & finish</strong><span>Scheduling and assessment actions</span><ChevronRight size={17} aria-hidden="true" /></button>
        </> : <>
          <p>Recorded answers from this client file. Tap an answer to review it.</p>
          {!reference.length ? <p>No information recorded yet.</p> : reference.map((item) => <button type="button" key={item.field} aria-label={`Review ${assessmentInterviewFieldLabel(item.field)}`} onClick={() => {
            const destination = sections.find((section) => section.questions.some((question) => question.field === item.field));
            if (destination) chooseSection(destination.key, item.field);
          }} disabled={!sections.some((section) => section.questions.some((question) => question.field === item.field))}>
            <strong>{assessmentInterviewFieldLabel(item.field)}</strong><span>{capturedAssessmentAnswer(item, data)}</span>{getAssessmentUnableReason(data, item.field) ? <span>{getAssessmentUnableReason(data, item.field)}</span> : null}{pending.includes(item.field) ? <small>Needs verification</small> : null}
          </button>)}
        </>}
      </div>
    </dialog>
  </section>;
}
