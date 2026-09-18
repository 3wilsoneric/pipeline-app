"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { assessmentInterviewFieldLabel, getAssessmentUnableReason, hasAssessmentInterviewValue } from "@/lib/assessment/assessment-interview-schema";
import { assessmentPreparationGroups, preparationQuestions } from "@/lib/assessment/assessment-preparation";
import type { AssessmentToolFieldKey, AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";
import { WorkingAssessmentField, type WorkingSectionProps } from "@/components/pipeline/AssessmentWorkingSection";
import { assessmentQuestionStatus, assessmentGapSections, capturedAssessmentAnswer, assessmentWorkingCounts, assessmentWorkingCountLabel } from "@/components/pipeline/assessment-working-view";
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
  onQuestionChange: (field: AssessmentToolFieldKey) => void;
};

export default function AssessmentPhoneInterview(props: Props) {
  const { questions, data, pending, target } = props;
  const { onQuestionChange } = props;
  const sections = props.preparing
    ? assessmentPreparationGroups.map((group) => ({ ...group, questions: preparationQuestions(group, data), remaining: preparationQuestions(group, data) }))
    : assessmentGapSections(data, pending);
  const section = sections.find((section) => section.questions.some((q) => questions.some((question) => question.field === q.field))) ?? sections.find((section) => section.key === props.section) ?? sections[0];
  const initial = () => target?.field ?? questions.find((question) => assessmentQuestionStatus(question, data, pending) !== "captured")?.field ?? (props.preparing ? questions[0]?.field : undefined);
  const [field, setField] = useState<AssessmentToolFieldKey | undefined>(initial);
  const [entryFields, setEntryFields] = useState(() => questions.map((question) => question.field));
  const [visitGaps, setVisitGaps] = useState(() => questions.filter((question) => assessmentQuestionStatus(question, data, pending) !== "captured").map((question) => question.field));
  const [received, setReceived] = useState({ section: section.key, target });
  const [panel, setPanel] = useState<"sections" | "reference">("sections");
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLParagraphElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  if (received.section !== section.key || received.target !== target) {
    if (received.section !== section.key) {
      setEntryFields(questions.map((question) => question.field));
      setVisitGaps(questions.filter((question) => assessmentQuestionStatus(question, data, pending) !== "captured").map((question) => question.field));
    }
    setReceived({ section: section.key, target });
    setField(initial());
  }
  const steps = props.preparing ? questions : questions.filter((question) => assessmentQuestionStatus(question, data, pending) !== "captured" || visitGaps.includes(question.field) || question.field === field || target?.field === question.field || !entryFields.includes(question.field));
  const index = Math.max(0, steps.findIndex((question) => question.field === field));
  const question = steps[index];
  const questionField = question?.field;
  const sectionIndex = sections.findIndex((item) => item.key === section.key);
  const nextSection = sections[sectionIndex + 1];
  const counts = assessmentWorkingCounts(questions, data, pending);
  const shownReference = questions
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
    const next = steps[index + direction];
    if (next) setField(next.field);
    else if (direction === 1 ? nextSection : sections[sectionIndex - 1]) {
      const destination = (direction === 1 ? nextSection : sections[sectionIndex - 1])!;
      const previous = destination.questions.at(-1);
      if (direction === -1 && previous && props.onReferenceEdit) props.onReferenceEdit(previous.field);
      else props.onSectionChange(destination.key);
    }
    else if (direction === 1) props.onFinish();
  };
  const openPanel = (next: typeof panel, opener: HTMLButtonElement) => {
    commit();
    setPanel(next);
    // Safari touch does not focus buttons; give the native dialog a return target.
    opener.focus({ preventScroll: true });
    dialog.current?.showModal();
  };
  useLayoutEffect(() => {
    if (questionField) onQuestionChange(questionField);
    if (scroller.current) scroller.current.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [questionField, target, onQuestionChange]);

  return <section className={styles.interview} data-phone-interview aria-label={props.preparing ? "Guided questionnaire" : "Guided assessment"}>
    <nav className={styles.toolbar} aria-label="Question navigation">
      <button type="button" onClick={(event) => openPanel("sections", event.currentTarget)} aria-haspopup="dialog" aria-label="Choose questionnaire section"><span><small>Section {sectionIndex + 1} of {sections.length}</small>{section.label}</span><ChevronDown size={16} aria-hidden="true" /></button>
      <button type="button" onClick={(event) => openPanel("reference", event.currentTarget)} aria-haspopup="dialog"><BookOpen size={17} aria-hidden="true" /><span>Current info</span></button>
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
        <p ref={heading} tabIndex={-1} className={styles.position} aria-live="polite">{question ? `Question ${index + 1} of ${steps.length}` : "Section complete"}</p>
        {question ? <WorkingAssessmentField {...props} question={question} /> : <p>Continue to the next section, or open Current info to review an answer.</p>}
      </div>
    </div>
    <nav className={styles.paging} aria-label="Question steps">
      <button type="button" aria-label="Previous question" onClick={() => move(-1)} disabled={index === 0 && sectionIndex === 0}><ChevronLeft size={20} aria-hidden="true" />Back</button>
      <button type="button" onClick={() => move(1)}>{index < steps.length - 1 ? "Next" : nextSection ? "Next section" : props.preparing ? "Open assessment" : "Review chart"}<ChevronRight size={20} aria-hidden="true" /></button>
    </nav>
    <dialog ref={dialog} className={styles.sheet} aria-label={panel === "sections" ? "Questionnaire sections" : "Current information"} onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <header><h3>{panel === "sections" ? "Assessment sections" : "Current information"}</h3><button type="button" aria-label="Close information panel" onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button></header>
      <div className={styles.sheetBody}>
        {panel === "sections" ? <>
          <p>Go in any order. Unknown answers can stay blank.</p>
          {sections.map((item, index) => {
            const count = assessmentWorkingCounts(item.questions, data, pending);
            return <button type="button" key={item.key} aria-current={item.key === section.key ? "step" : undefined} onClick={() => chooseSection(item.key)}><strong>{index + 1}. {item.label}</strong><span>{assessmentWorkingCountLabel(count)}</span><ChevronRight size={17} aria-hidden="true" /></button>;
          })}
          <button type="button" onClick={() => { dialog.current?.close(); props.onFinish(); }}><strong>{props.preparing ? "Open assessment" : "Review chart"}</strong><span>{props.preparing ? "Continue with the client interview" : "Review recorded answers before signing"}</span><ChevronRight size={17} aria-hidden="true" /></button>
        </> : <>
          <p>{section.label}</p>
          {!shownReference.length ? <p>No information recorded for this section yet.</p> : shownReference.map((item) => <button type="button" key={item.field} aria-label={`Review ${assessmentInterviewFieldLabel(item.field)}`} onClick={() => {
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
