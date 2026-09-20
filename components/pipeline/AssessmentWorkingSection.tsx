"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Pencil, Play } from "lucide-react";
import {
  assessmentInterviewFieldLabel,
  getAssessmentUnableReason,
  hasAssessmentInterviewValue,
  type AssessmentInterviewQuestion,
} from "@/lib/assessment/assessment-interview-schema";
import {
  assessmentToolFieldDefinitions,
  type AssessmentToolData,
  type AssessmentToolFieldKey,
  type AssessmentToolSection,
} from "@/lib/assessment/assessment-tool-schema";
import { isAssessmentFinalized, type PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { AssessmentField } from "@/components/pipeline/AssessmentInterviewFields";
import { latestPendingProvenance } from "@/components/pipeline/assessment-workspace-state";
import {
  assessmentQuestionStatus,
  assessmentWorkingSections,
  assessmentAnswerOrigin,
  assessmentWorkingCounts,
  assessmentWorkingCountLabel,
  capturedAssessmentAnswer,
  groupWorkingQuestions,
} from "@/components/pipeline/assessment-working-view";
import styles from "@/components/pipeline/AssessmentWorkingSection.module.css";

type WorkingData = { data: AssessmentToolData; pending: readonly AssessmentToolFieldKey[] };
type QuestionTarget = { field: AssessmentToolFieldKey };

export function AssessmentWorkingNavigation({ data, pending, activeSection, guideTargets, onSectionChange, preparing = false }: WorkingData & {
  preparing?: boolean;
  activeSection: AssessmentToolSection;
  guideTargets: Readonly<Record<AssessmentToolSection, string>>;
  onSectionChange: (section: AssessmentToolSection) => void;
}) {
  const sections = assessmentWorkingSections(data, pending, preparing);
  const index = sections.findIndex((section) => section.key === activeSection);
  const counts = assessmentWorkingCounts(sections[index].questions, data, pending);
  return <nav aria-label="Assessment sections" className={styles.navigation}>
    <label className={styles.sectionPicker}>
      <span className={styles.sectionPosition}>{preparing ? "Record group" : "Section"} {index + 1} of {sections.length}</span>
      <select aria-label="Assessment section" data-guide-target={"assessment-section-nav " + Object.values(guideTargets).join(" ")} value={activeSection} onChange={(event) => onSectionChange(event.target.value as AssessmentToolSection)}>
        {sections.map((section) => <option key={section.key} value={section.key}>{section.label}</option>)}
      </select>
    </label>
    <span role="status" aria-live="polite" aria-atomic="true" className={styles.sectionProgress}>
      {assessmentWorkingCountLabel(counts)}
    </span>
  </nav>;
}

export function AssessmentWorkMode({ preparing, disabled, canBegin, startRecorded, onBegin }: { preparing: boolean; disabled: boolean; canBegin: boolean; startRecorded: boolean; onBegin: () => void }) {
  return <section className={styles.workMode} aria-label="Assessment progress">
    <div className={styles.phaseSummary}>
      <ol className={styles.phaseSteps} aria-label="Preparation and interview">
        <li aria-current={preparing ? "step" : undefined}><span aria-hidden="true">{preparing ? "1" : <Check size={14} />}</span>Prepare from records<ChevronRight size={15} aria-hidden="true" /></li>
        <li aria-current={!preparing ? "step" : undefined}><span aria-hidden="true">2</span>Interview</li>
      </ol>
      <p>{preparing ? "Before meeting the client, record what you know. Unknowns can wait." : "Use the section reference as you ask what is missing or has changed."}</p>
    </div>
    {canBegin ? <button type="button" data-guide-target="assessment-begin" className={styles.beginAssessment} disabled={disabled} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onBegin(); }}><Play size={16} aria-hidden="true" />{preparing ? "Begin assessment" : "Retry start time"}</button> : null}
    {!preparing && !startRecorded ? <p role="status" className={styles.startPending}>Start time not saved. You can keep answering.</p> : null}
  </section>;
}

export type WorkingSectionProps = WorkingData & {
  preparing?: boolean;
  section: AssessmentToolSection;
  assessment: PipelineAssessmentRecord;
  questions: readonly AssessmentInterviewQuestion[];
  required: ReadonlySet<AssessmentToolFieldKey>;
  disabled: boolean;
  reviewDisabled: boolean;
  target: QuestionTarget | null;
  questionNavigation?: React.ReactNode;
  onChange: (field: AssessmentToolFieldKey, value: AssessmentToolData[AssessmentToolFieldKey]) => void;
  onFieldFocus: (field: AssessmentToolFieldKey) => void;
  onFieldBlur: (field: AssessmentToolFieldKey) => void;
  onReview: (field: AssessmentToolFieldKey, action: "accept" | "reject") => void;
  onUnableReasonChange: (field: AssessmentToolFieldKey, reason: string) => void;
  onReferenceEdit?: (field: AssessmentToolFieldKey) => void;
};

export default function AssessmentWorkingSection(props: WorkingSectionProps) {
  const { data, pending, questions, target } = props;
  const [localTarget, setLocalTarget] = useState<QuestionTarget | null>(target);
  const [receivedTarget, setReceivedTarget] = useState(target);
  const [receivedSection, setReceivedSection] = useState(props.section);
  const [visited, setVisited] = useState<AssessmentToolFieldKey[]>([]);
  const [entryFields, setEntryFields] = useState(() => questions.map((question) => question.field));
  const [editing, setEditing] = useState<{ field: AssessmentToolFieldKey; value: AssessmentToolData[AssessmentToolFieldKey]; reason: string } | null>(null);
  const [recorded, setRecorded] = useState<{ field: AssessmentToolFieldKey; revision: number } | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const previousSection = useRef(props.section);

  if (props.section !== receivedSection || target !== receivedTarget) {
    if (props.section !== receivedSection) {
      setVisited([]);
      setEntryFields(questions.map((question) => question.field));
      setEditing(null);
      setRecorded(null);
    }
    setReceivedSection(props.section);
    setReceivedTarget(target);
    setLocalTarget(target);
  }

  // Keep edited fields in place for this section visit; never move a pointer's next target.
  const remaining = questions.filter((question) => assessmentQuestionStatus(question, data, pending) !== "captured" || visited.includes(question.field) || localTarget?.field === question.field || !entryFields.includes(question.field));
  const groups = groupWorkingQuestions(remaining);
  const referenceData = editing ? { ...data, [editing.field]: editing.value, unable_to_assess_reasons: { ...data.unable_to_assess_reasons, [editing.field]: editing.reason } } : data;
  const focusField = (field: AssessmentToolFieldKey) => {
    setVisited((current) => current.includes(field) ? current : [...current, field]);
    setEditing((current) => current?.field === field ? current : { field, value: data[field], reason: getAssessmentUnableReason(data, field) });
    props.onFieldFocus(field);
  };
  const finishReference = (field: AssessmentToolFieldKey) => {
    if (editing?.field === field && JSON.stringify(editing.value) !== JSON.stringify(data[field])) {
      setRecorded((previous) => ({ field, revision: (previous?.revision ?? 0) + 1 }));
    }
    setEditing(null);
  };
  useLayoutEffect(() => {
    if (editor.current) editor.current.scrollTop = 0;
    editor.current?.closest('[data-guide-target="packet-workspace"]')?.scrollTo({ top: 0, behavior: "instant" });
    if (previousSection.current !== props.section) {
      editor.current?.parentElement?.querySelector<HTMLSelectElement>('[aria-label="Assessment section"]')?.focus({ preventScroll: true });
    }
    previousSection.current = props.section;
  }, [props.section]);
  useLayoutEffect(() => {
    if (!localTarget) return;
    const field = editor.current?.querySelector<HTMLElement>("#assessment-" + localTarget.field);
    if (!field) return;
    field.closest("[data-working-field]")?.scrollIntoView({ block: "nearest" });
    const control = field.matches("input, textarea, select") ? field : field.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)");
    control?.focus({ preventScroll: true });
  }, [localTarget]);

  return <div data-assessment-working-section data-assessment-section={props.section} className={styles.book}>
    <CapturedAssessmentAnswers {...props} data={referenceData} recorded={recorded} onEdit={props.onReferenceEdit ?? ((field) => setLocalTarget({ field }))} />
    <div data-assessment-question-editor className={styles.editor}>
      {props.questionNavigation}
      <div ref={editor} className={styles.questionPage} data-assessment-question-page>
      {!groups.length ? <p className={styles.empty}>{isAssessmentFinalized(props.assessment) ? "Review this section in Current information." : "This section is complete. Continue to the next section, or select an answer in Current information to edit it."}</p> : null}
      {groups.map((group) => <section key={group.label} aria-label={group.label} className={styles.questionGroup}>
        <div className={styles.fields}>
          {group.questions.map((question) => <div key={question.field} className={question.span === "full" ? styles.fullField : undefined}>
            <WorkingAssessmentField {...props} question={question} onFieldFocus={focusField} onAnswerBlur={finishReference} />
            {assessmentQuestionStatus(question, data, pending) === "captured" ? <span className={styles.recorded}>Recorded</span> : null}
          </div>)}
        </div>
      </section>)}
      </div>
    </div>
  </div>;
}

export function WorkingAssessmentField({ question, data, assessment, required, pending, disabled, reviewDisabled, onChange, onReview, onUnableReasonChange, onFieldFocus, onFieldBlur, onAnswerBlur }: WorkingSectionProps & { question: AssessmentInterviewQuestion; onAnswerBlur?: (field: AssessmentToolFieldKey) => void }) {
  const definition = assessmentToolFieldDefinitions.find((definition) => definition.key === question.field)!;
  return <div data-working-field={question.field} onFocusCapture={() => onFieldFocus(question.field)} onBlur={(event) => {
    onAnswerBlur?.(question.field);
    if (!event.currentTarget.contains(event.relatedTarget)) onFieldBlur(question.field);
  }} className={question.span === "full" ? "sm:col-span-2" : "min-w-0"}>
    <AssessmentField definition={definition} question={question} value={data[question.field]} unableReason={getAssessmentUnableReason(data, question.field)} required={required.has(question.field)} pending={pending.includes(question.field)} pendingProvenance={latestPendingProvenance(assessment, question.field)} disabled={disabled} reviewDisabled={reviewDisabled} onChange={(value) => onChange(question.field, value)} onReview={(action) => onReview(question.field, action)} onUnableReasonChange={(reason) => onUnableReasonChange(question.field, reason)} />
  </div>;
}

function CapturedAssessmentAnswers({ section, data, pending, questions, onEdit, assessment, recorded, preparing }: WorkingSectionProps & { recorded: { field: AssessmentToolFieldKey; revision: number } | null; onEdit: (field: AssessmentToolFieldKey) => void }) {
  const [expanded, setExpanded] = useState(false);
  const readingPage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (readingPage.current) readingPage.current.scrollTop = 0;
  }, [section]);
  const captured = questions.filter((question) => hasAssessmentInterviewValue(data[question.field]) || pending.includes(question.field));
  const groups = groupWorkingQuestions(captured);
  const id = "captured-answers-" + section;
  return <aside aria-label="Current information" className={styles.reference}>
    <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)} className={styles.referenceToggle}><span>Current information</span><ChevronDown size={16} aria-hidden="true" /></button>
    <div id={id} data-expanded={expanded} className={styles.referenceContent}>
      <header className={styles.referenceHeader}>
      <h4>Current information</h4>
      <p>{preparing ? "These answers carry into the interview." : "Recorded answers for this section. Select any answer to update it."}</p>
      </header>
      <div key={section} ref={readingPage} className={styles.readingPage} data-assessment-reference-page>
      {!groups.length ? <p className={styles.empty}>No information recorded for this section yet.</p> : null}
      {groups.map((group) => <section key={group.label} aria-label={group.label} className={styles.referenceGroup}>
        {group.questions.map((question) => <CapturedAnswer key={question.field} question={question} data={data} pending={pending} assessment={assessment} recorded={recorded?.field === question.field ? recorded.revision : undefined} signed={isAssessmentFinalized(assessment)} onEdit={(field) => { setExpanded(false); onEdit(field); }} />)}
      </section>)}
      </div>
    </div>
  </aside>;
}

function CapturedAnswer({ question, data, pending, onEdit, signed, assessment, recorded }: WorkingData & { question: AssessmentInterviewQuestion; assessment: PipelineAssessmentRecord; recorded?: number; signed: boolean; onEdit: (field: AssessmentToolFieldKey) => void }) {
  const status = assessmentQuestionStatus(question, data, pending);
  const reason = getAssessmentUnableReason(data, question.field);
  return <button type="button" aria-label={(signed ? "Review " : "Edit ") + assessmentInterviewFieldLabel(question.field)} onClick={() => onEdit(question.field)} className={styles.answer}>
    {recorded ? <span key={recorded} aria-hidden="true" className={styles.answerUpdate} /> : null}
    <span className={styles.answerLabel}>{assessmentInterviewFieldLabel(question.field)}{!signed ? <Pencil size={15} aria-hidden="true" /> : null}</span>
    <span className={styles.answerValue}>{capturedAssessmentAnswer(question, data)}</span>
    {reason ? <span className={styles.answerReason}>{reason}</span> : null}
    <AssessmentAnswerSource assessment={assessment} data={data} field={question.field} />
    {status === "verify" ? <span className={styles.attention}>Needs verification</span> : status === "reason" ? <span className={styles.attention}>Reason missing</span> : null}
  </button>;
}

export function AssessmentAnswerSource({ assessment, data, field }: { assessment: PipelineAssessmentRecord; data: AssessmentToolData; field: AssessmentToolFieldKey }) {
  const source = assessmentAnswerOrigin(assessment, data, field);
  return source ? <span className={styles.answerSource}>{source}</span> : null;
}
