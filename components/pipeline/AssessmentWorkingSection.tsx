"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Play } from "lucide-react";
import {
  assessmentInterviewFieldLabel,
  assessmentInterviewOptionLabel,
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
  capturedAssessmentAnswer,
  groupWorkingQuestions,
} from "@/components/pipeline/assessment-working-view";
import styles from "@/components/pipeline/AssessmentWorkingSection.module.css";

type WorkingData = { data: AssessmentToolData; pending: readonly AssessmentToolFieldKey[] };
type QuestionTarget = { field: AssessmentToolFieldKey };

export function AssessmentWorkingNavigation({ data, pending, activeSection, guideTargets, onSectionChange, preparing = false, recordedAnswers }: WorkingData & {
  recordedAnswers?: React.ReactNode;
  preparing?: boolean;
  activeSection: AssessmentToolSection;
  guideTargets: Readonly<Record<AssessmentToolSection, string>>;
  onSectionChange: (section: AssessmentToolSection) => void;
}) {
  const sections = assessmentWorkingSections(data, pending, preparing);
  const index = sections.findIndex((section) => section.key === activeSection);
  const counts = assessmentWorkingCounts(sections[index].questions, data, pending);
  const total = sections[index].questions.length;
  return <nav aria-label="Assessment sections" className={styles.navigation}>
    <label className={styles.sectionPicker}>
      <span className={styles.sectionPosition} aria-label={`Section ${index + 1} of ${sections.length}`}>{index + 1} / {sections.length}</span>
      <select aria-label="Assessment section" data-guide-target={["assessment-section-nav", ...Object.values(guideTargets)].join(" ")} value={activeSection} onChange={(event) => onSectionChange(event.target.value as AssessmentToolSection)}>
        {sections.map((section) => <option key={section.key} value={section.key}>{section.label}</option>)}
      </select>
    </label>
    <div className={styles.sectionProgress}>
      {recordedAnswers ?? <span role="status" aria-live="polite" aria-atomic="true"><strong>{counts.captured}</strong> / {total} recorded{counts.verify ? <small>{counts.verify} to verify</small> : null}{counts.reasons ? <small>{counts.reasons} {counts.reasons === 1 ? "needs" : "need"} a reason</small> : null}</span>}
      <div className={styles.progressTrack} role="progressbar" aria-label="Recorded in this section" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={counts.captured}><span style={{ width: `${counts.captured / (total || 1) * 100}%` }} /></div>
    </div>
  </nav>;
}

export function AssessmentWorkMode({ preparing, disabled, canBegin, startAttemptFailed, onChange, onBegin, scheduleAction, appointment }: { preparing: boolean; disabled: boolean; canBegin: boolean; startAttemptFailed: boolean; onChange: (prepare: boolean) => void; onBegin: () => void; scheduleAction?: React.ReactNode; appointment?: string }) {
  const renderPhaseSteps = () => (<div className={styles.phaseSummary}>
      <ol className={styles.phaseSteps} aria-label="Preparation and interview">
        <li aria-current={preparing ? "step" : undefined}><span aria-hidden="true">1</span><button type="button" aria-pressed={preparing} disabled={disabled} onClick={() => onChange(true)}>{preparing ? "Prepare assessment" : "All questions"}</button><ChevronRight size={15} aria-hidden="true" /></li>
        <li aria-current={!preparing ? "step" : undefined}><span aria-hidden="true">2</span><button type="button" aria-pressed={!preparing} disabled={disabled} onClick={() => onChange(false)}>Interview</button></li>
      </ol>
      <p>{preparing ? "All assessment questions. Add or update what you know before, during, or after the interview." : "Focused questions for the conversation. Open All questions to add or update any other detail, then return here."}</p>
    </div>);
  const renderAppointment = () => (preparing && appointment ? <div className={styles.appointment} aria-label="Assessment appointment"><span>Scheduled</span><strong>{appointment}</strong>{scheduleAction ? <div className={styles.editAppointment}>{scheduleAction}</div> : null}</div> : scheduleAction ? <div className={styles.scheduleAction}>{scheduleAction}</div> : null);
  return <section className={styles.workMode} aria-label="Assessment progress" data-phase={preparing ? "preparation" : "interview"}>
    {renderPhaseSteps()}
    {preparing || canBegin || scheduleAction ? <div className={styles.prepActions}>
      {renderAppointment()}
      {canBegin ? <button type="button" data-guide-target="assessment-begin" className={styles.beginAssessment} disabled={disabled} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onBegin(); }}><Play size={16} aria-hidden="true" />{startAttemptFailed ? "Retry start time" : "Begin interview"}</button> : null}
    </div> : null}
    {startAttemptFailed && canBegin ? <p role="status" className={styles.startPending}>Start time not saved. You can keep answering.</p> : null}
  </section>;
}

export type WorkingSectionProps = WorkingData & {
  preparing?: boolean;
  referenceQuestions?: readonly AssessmentInterviewQuestion[];
  section: AssessmentToolSection;
  sectionLabel?: string;
  assessment: PipelineAssessmentRecord;
  questions: readonly AssessmentInterviewQuestion[];
  required: ReadonlySet<AssessmentToolFieldKey>;
  disabled: boolean;
  reviewDisabled: boolean;
  target: QuestionTarget | null;
  questionNavigation?: (recordedAnswers?: React.ReactNode) => React.ReactNode;
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
  const sectionHeading = useRef<HTMLHeadingElement>(null);
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
  const remaining = questions.filter((question) => props.preparing || assessmentQuestionStatus(question, data, pending) !== "captured" || visited.includes(question.field) || localTarget?.field === question.field || !entryFields.includes(question.field));
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
    if (props.preparing) editor.current?.closest("main")?.scrollTo({ top: 0, behavior: "instant" });
    editor.current?.closest('[data-guide-target="packet-workspace"]')?.scrollTo({ top: 0, behavior: "instant" });
    // Keep focus in the section picker while it is being used. Otherwise move
    // directly to the first interview question instead of a repeated title.
    if (previousSection.current !== props.section && !document.activeElement?.matches('[aria-label="Assessment section"]')) {
      if (props.preparing) sectionHeading.current?.focus({ preventScroll: true });
      else (editor.current?.querySelector<HTMLElement>('[data-working-field] :is(input, textarea, select, button):not(:disabled)') ?? editor.current)?.focus({ preventScroll: true });
    }
    previousSection.current = props.section;
  }, [props.section, props.preparing]);
  useLayoutEffect(() => {
    if (!localTarget) return;
    const field = editor.current?.querySelector<HTMLElement>("#assessment-" + localTarget.field);
    if (!field) return;
    field.closest("[data-working-field]")?.scrollIntoView({ block: "nearest" });
    const control = field.matches("input, textarea, select") ? field : field.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)");
    control?.focus({ preventScroll: true });
  }, [localTarget]);

  const renderReference = () => <>
    {props.questionNavigation?.(props.preparing ? <CapturedAssessmentAnswers {...props} data={referenceData} recorded={recorded} onEdit={props.onReferenceEdit ?? ((field) => setLocalTarget({ field }))} /> : undefined)}
    {!props.preparing ? <CapturedAssessmentAnswers {...props} questions={props.referenceQuestions ?? questions} data={referenceData} recorded={recorded} onEdit={props.onReferenceEdit ?? ((field) => setLocalTarget({ field }))} /> : null}
  </>;

  return <div data-assessment-working-section data-assessment-section={props.section} data-assessment-phase={props.preparing ? "preparation" : "interview"} className={`${styles.book} ${props.preparing ? styles.preparing : ""}`}>
    {renderReference()}
    <div data-guide-target="assessment-fields" data-assessment-question-editor className={styles.editor}>
      <div ref={editor} tabIndex={-1} role="region" aria-label={`${props.sectionLabel ?? "Assessment"} questions`} className={styles.questionPage} data-assessment-question-page>
      {props.preparing && props.sectionLabel ? <h3 ref={sectionHeading} tabIndex={-1} data-assessment-section-heading className={styles.sectionHeading}>{props.sectionLabel}</h3> : null}
      {!groups.length ? <p className={styles.empty}>{isAssessmentFinalized(props.assessment) ? "Review this section in Current information." : "This section is complete. Review the reference, or continue to the next section."}</p> : null}
      {groups.map((group) => <section key={group.label} aria-label={group.label} className={styles.questionGroup}>
        <div className={styles.fields}>
          {group.questions.map((question) => <div key={question.field} className={question.span === "full" ? styles.fullField : undefined}>
            <WorkingAssessmentField {...props} question={question} onFieldFocus={focusField} onAnswerBlur={finishReference} />
            {assessmentQuestionStatus(question, data, pending) === "captured" ? <span className={styles.recorded}>Recorded</span> : null}
            {props.preparing && hasAssessmentInterviewValue(data[question.field]) ? <AssessmentAnswerSource assessment={props.assessment} data={data} field={question.field} /> : null}
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

function CapturedAssessmentAnswers({ section, preparing, data, pending, questions, onEdit, assessment, recorded }: WorkingSectionProps & { recorded: { field: AssessmentToolFieldKey; revision: number } | null; onEdit: (field: AssessmentToolFieldKey) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [wide, setWide] = useState(false);
  const readingPage = useRef<HTMLDivElement>(null);
  const preparedAnswers = useRef<HTMLDivElement>(null);
  const preparedAnswersId = useId();
  useLayoutEffect(() => {
    if (readingPage.current) readingPage.current.scrollTop = 0;
  }, [section]);
  const captured = questions.filter((question) => hasAssessmentInterviewValue(data[question.field]) || pending.includes(question.field));
  const groups = groupWorkingQuestions(captured);
  const id = "captured-answers-" + section;
  const counts = assessmentWorkingCounts(questions, data, pending);
  if (preparing && !captured.length) return <span role="status"><strong>0</strong> / {questions.length} recorded</span>;
  if (preparing) return <div key={section} className={styles.preparedAnswers}>
    <button type="button" popoverTarget={preparedAnswersId} aria-label={`Recorded answers: ${counts.captured} of ${questions.length}`}><span><strong>{counts.captured}</strong> / {questions.length} recorded{counts.verify ? <small>{counts.verify} to verify</small> : null}{counts.reasons ? <small>{counts.reasons} {counts.reasons === 1 ? "needs" : "need"} a reason</small> : null}</span><ChevronDown size={16} aria-hidden="true" /></button>
    <div ref={preparedAnswers} id={preparedAnswersId} data-guide-target="assessment-recorded" popover="auto" role="region" aria-label="Recorded answers" className={styles.referenceSheet} onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}>
      {captured.map((question) => <CapturedAnswer key={question.field} question={question} data={data} pending={pending} assessment={assessment} signed={isAssessmentFinalized(assessment)} onEdit={(field) => { preparedAnswers.current?.hidePopover(); onEdit(field); }} />)}
    </div>
  </div>;
  return <aside data-guide-target="assessment-recorded" aria-label="Current information" data-wide={wide} className={styles.reference}>
    <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)} className={styles.referenceToggle}>
      <span>Current information</span>
      <span aria-hidden="true" className={styles.referenceSummary}>{counts.captured} of {questions.length} recorded</span>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    <div id={id} data-expanded={expanded} className={styles.referenceContent}>
      <header className={styles.referenceHeader}>
      <h4>Current information</h4>
      <button type="button" className={styles.referenceWidth} aria-pressed={wide} onClick={() => setWide(!wide)}>{wide ? "Narrow" : "Expand"}</button>
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
  return <button type="button" data-answer-control={question.control} aria-label={(signed ? "Review " : "Edit ") + assessmentInterviewFieldLabel(question.field)} onClick={() => onEdit(question.field)} className={styles.answer}>
    {recorded ? <span key={recorded} aria-hidden="true" className={styles.answerUpdate} /> : null}
    <span className={styles.answerLabel}>{assessmentInterviewFieldLabel(question.field)}{!signed ? <Pencil size={15} aria-hidden="true" /> : null}</span>
    <AssessmentReferenceValue question={question} data={data} />
    {reason ? <span className={styles.answerReason}>{reason}</span> : null}
    <AssessmentAnswerSource assessment={assessment} data={data} field={question.field} />
    {status === "verify" ? <span className={styles.attention}>Needs verification</span> : status === "reason" ? <span className={styles.attention}>Reason missing</span> : null}
  </button>;
}

export function AssessmentReferenceValue({ question, data }: { question: AssessmentInterviewQuestion; data: AssessmentToolData }) {
  const value = data[question.field];
  return <span className={styles.answerValue}>{Array.isArray(value)
    ? value.map((item, index) => <span key={index} className={styles.answerEntry}>{assessmentInterviewOptionLabel(question.field, item) ?? item}</span>)
    : capturedAssessmentAnswer(question, data)}</span>;
}

export function AssessmentAnswerSource({ assessment, data, field }: { assessment: PipelineAssessmentRecord; data: AssessmentToolData; field: AssessmentToolFieldKey }) {
  const source = assessmentAnswerOrigin(assessment, data, field);
  return source ? <span className={styles.answerSource}>{source}</span> : null;
}
