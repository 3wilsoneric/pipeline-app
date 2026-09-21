"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, Pencil, X } from "lucide-react";
import { assessmentInterviewFieldLabel, getAssessmentUnableReason, hasAssessmentInterviewValue } from "@/lib/assessment/assessment-interview-schema";
import type { AssessmentToolFieldKey, AssessmentToolSection } from "@/lib/assessment/assessment-tool-schema";
import { AssessmentAnswerSource, WorkingAssessmentField, type WorkingSectionProps } from "@/components/pipeline/AssessmentWorkingSection";
import { assessmentQuestionStatus, assessmentWorkingSections, capturedAssessmentAnswer, assessmentWorkingCounts, assessmentWorkingCountLabel } from "@/components/pipeline/assessment-working-view";
import styles from "./AssessmentPhoneInterview.module.css";
import readingStyles from "./AssessmentWorkingSection.module.css";

type Props = WorkingSectionProps & {
  preparing: boolean;
  onSectionChange: (section: AssessmentToolSection) => void;
  onFinish: () => void;
  onQuestionChange: (field: AssessmentToolFieldKey) => void;
};

export default function AssessmentPhoneInterview(props: Props) {
  const { questions, data, pending, target } = props;
  const { onQuestionChange } = props;
  const sections = assessmentWorkingSections(data, pending, props.preparing);
  const section = sections.find((section) => section.questions.some((q) => questions.some((question) => question.field === q.field))) ?? sections.find((section) => section.key === props.section) ?? sections[0];
  const initial = () => target?.field ?? questions.find((question) => assessmentQuestionStatus(question, data, pending) !== "captured")?.field;
  const [field, setField] = useState<AssessmentToolFieldKey | undefined>(initial);
  const [entryFields, setEntryFields] = useState(() => questions.map((question) => question.field));
  const [visitGaps, setVisitGaps] = useState(() => questions.filter((question) => assessmentQuestionStatus(question, data, pending) !== "captured").map((question) => question.field));
  const [received, setReceived] = useState({ section: section.key, target });
  const [panel, setPanel] = useState<"sections" | "reference">("sections");
  const [search, setSearch] = useState("");
  const [referenceScope, setReferenceScope] = useState("section");
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
  const steps = questions.filter((question) => assessmentQuestionStatus(question, data, pending) !== "captured" || visitGaps.includes(question.field) || question.field === field || target?.field === question.field || !entryFields.includes(question.field));
  const index = Math.max(0, steps.findIndex((question) => question.field === field));
  const question = steps[index];
  const questionField = question?.field;
  const sectionIndex = sections.findIndex((item) => item.key === section.key);
  const nextSection = sections[sectionIndex + 1];
  const counts = assessmentWorkingCounts(questions, data, pending);
  const allQuestions = sections.flatMap((section) => section.questions);
  const matchedQuestions = allQuestions.filter((question) => assessmentInterviewFieldLabel(question.field).toLowerCase().includes(search.trim().toLowerCase()));
  const shownReference = (referenceScope === "all" ? allQuestions : questions)
    .filter((question) => hasAssessmentInterviewValue(data[question.field]) || pending.includes(question.field))
    .filter((question) => `${assessmentInterviewFieldLabel(question.field)} ${capturedAssessmentAnswer(question, data)}`.toLowerCase().includes(search.trim().toLowerCase()));

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
    setSearch("");
    // Safari touch does not focus buttons; give the native dialog a return target.
    opener.focus({ preventScroll: true });
    dialog.current?.showModal();
  };
  useLayoutEffect(() => {
    if (questionField) onQuestionChange(questionField);
    if (scroller.current) scroller.current.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [questionField, target, onQuestionChange]);

  const renderSectionChoices = () => (
<>
          <p>Go in any order. Unknown answers can stay blank.</p>
          <input type="search" aria-label="Find a question" placeholder="Find a question…" value={search} onChange={(event) => setSearch(event.target.value)} className={styles.sheetSearch} />
          {search.trim() ? matchedQuestions.map((question) => <button type="button" key={question.field} onClick={() => {
            const destination = sections.find((item) => item.questions.some((q) => q.field === question.field));
            if (destination) chooseSection(destination.key, question.field);
          }}><strong>{assessmentInterviewFieldLabel(question.field)}</strong><span>{capturedAssessmentAnswer(question, data)}</span></button>) : <>
          {sections.map((item, index) => {
            const count = assessmentWorkingCounts(item.questions, data, pending);
            return <button type="button" key={item.key} aria-current={item.key === section.key ? "step" : undefined} onClick={() => chooseSection(item.key)}><strong>{index + 1}. {item.label}</strong><span>{assessmentWorkingCountLabel(count)}</span><ChevronRight size={17} aria-hidden="true" /></button>;
          })}
          </>}
          {search.trim() && !matchedQuestions.length ? <p>No matching questions.</p> : null}
          <button type="button" disabled={props.preparing && props.disabled} onClick={() => { dialog.current?.close(); props.onFinish(); }}><strong>{props.preparing ? "Begin assessment" : "Review assessment"}</strong><span>{props.preparing ? "Keep prepared answers beside the remaining questions" : "Review recorded answers before signing"}</span><ChevronRight size={17} aria-hidden="true" /></button>
        </>
  );
  const renderReferenceChoices = () => (
<> <label className={styles.sheetScope}>Reference information<select aria-label="Reference information" value={referenceScope} onChange={(event) => setReferenceScope(event.target.value)}><option value="section">This section</option><option value="all">All sections</option></select></label>
          <input type="search" aria-label="Find recorded information" placeholder="Find a detail or answer…" value={search} onChange={(event) => setSearch(event.target.value)} className={styles.sheetSearch} />
          {!shownReference.length ? <p>{search.trim() ? "No matching information. Try another search or choose All sections." : referenceScope === "all" ? "No information recorded yet." : "No information recorded for this section yet."}</p> : shownReference.map((item) => <button type="button" key={item.field} className={readingStyles.answer} aria-label={`Review ${assessmentInterviewFieldLabel(item.field)}`} onClick={() => {
            const destination = sections.find((section) => section.questions.some((question) => question.field === item.field));
            if (destination) chooseSection(destination.key, item.field);
          }} disabled={!sections.some((section) => section.questions.some((question) => question.field === item.field))}>
            <strong className={readingStyles.answerLabel}>{assessmentInterviewFieldLabel(item.field)}{!props.disabled ? <Pencil size={15} aria-hidden="true" /> : null}</strong><span className={readingStyles.answerValue}>{capturedAssessmentAnswer(item, data)}</span><AssessmentAnswerSource assessment={props.assessment} data={data} field={item.field} />{getAssessmentUnableReason(data, item.field) ? <span className={readingStyles.answerReason}>{getAssessmentUnableReason(data, item.field)}</span> : null}{pending.includes(item.field) ? <small className={readingStyles.attention}>Needs verification</small> : null}
          </button>)}
        </>
  );

  const renderQuestionSheet = () => (
    <dialog ref={dialog} className={styles.sheet} aria-label={panel === "sections" ? "Questionnaire sections" : "Client information"} onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <header><h3>{panel === "sections" ? "Assessment sections" : "Client information"}</h3><button type="button" aria-label="Close information panel" onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button></header>
      <div className={`${styles.sheetBody} ${panel === "reference" ? readingStyles.referenceSheet : ""}`}>
        {panel === "sections" ? renderSectionChoices() : renderReferenceChoices()}
      </div>
    </dialog>
  );

  const renderQuestionSteps = () => (
    <nav className={styles.paging} aria-label="Question steps">
      <button type="button" aria-label="Previous question" title="Previous question" onClick={() => move(-1)} disabled={index === 0 && sectionIndex === 0}><ChevronLeft size={22} aria-hidden="true" /></button>
      <span className={styles.stepCount} aria-hidden="true">{question ? <><strong>{index + 1}</strong> / {steps.length}</> : "Complete"}</span>
      <button type="button" data-guide-target="assessment-next-section" disabled={props.preparing && props.disabled && index >= steps.length - 1 && !nextSection} onClick={() => move(1)}>{index < steps.length - 1 ? "Next" : nextSection ? "Next section" : props.preparing ? "Begin assessment" : "Review assessment"}<ChevronRight size={20} aria-hidden="true" /></button>
    </nav>
  );

  const renderQuestion = () => (
      <div className={styles.question} key={question?.field ?? section.key}>
        <p ref={heading} tabIndex={-1} className={styles.position} aria-live="polite">{question ? `Question ${index + 1} of ${steps.length}` : "Section complete"}</p>
        {question ? <WorkingAssessmentField {...props} question={question} /> : <p>Continue to the next section, or open Client info to review an answer.</p>}
      </div>
  );

  return <section className={styles.interview} data-phone-interview aria-label={props.preparing ? "Guided questionnaire" : "Guided assessment"}>
    <nav className={styles.toolbar} aria-label="Question navigation">
      <button type="button" data-guide-target="assessment-section-nav" onClick={(event) => openPanel("sections", event.currentTarget)} aria-haspopup="dialog" aria-label="Choose questionnaire section" title={`Section ${sectionIndex + 1} of ${sections.length}: ${section.label}`}><span><small>{sectionIndex + 1}/{sections.length}</small><strong>{section.label}</strong></span><ChevronDown size={16} aria-hidden="true" /></button>
      <button type="button" data-guide-target="assessment-recorded" onClick={(event) => openPanel("reference", event.currentTarget)} aria-haspopup="dialog"><BookOpen size={17} aria-hidden="true" /><span>Client info</span></button>
    </nav>
    <div className={styles.progress} role="progressbar" aria-label="Recorded in this section" aria-valuemin={0} aria-valuemax={questions.length || 1} aria-valuenow={counts.captured}><span style={{ width: `${counts.captured / (questions.length || 1) * 100}%` }} /></div>
    <div ref={scroller} className={styles.scroller} data-guide-target="assessment-fields" data-phone-question-scroll onTouchStart={(event) => {
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
      {renderQuestion()}
    </div>
    {renderQuestionSteps()}
    {renderQuestionSheet()}
  </section>;
}
