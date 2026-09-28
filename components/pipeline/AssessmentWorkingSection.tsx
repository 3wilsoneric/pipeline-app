"use client";

import { intakeAnswerSource, type PriorAnswers } from "@/lib/assessment/assessment-prior-answers";
import { Fragment, useId, useLayoutEffect, useRef, useState } from "react";
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
  formatPriorDate,
  groupWorkingQuestions,
} from "@/components/pipeline/assessment-working-view";
import styles from "@/components/pipeline/AssessmentWorkingSection.module.css";
import { useDesignV2 } from "@/components/design/DesignSwitch";

type WorkingData = { data: AssessmentToolData; pending: readonly AssessmentToolFieldKey[] };
type QuestionTarget = { field: AssessmentToolFieldKey };

const allQuestionsChoice = "all-questions";

export function AssessmentWorkingNavigation({ data, pending, activeSection, guideTargets, onSectionChange, preparing = false, recordedAnswers, lead, onAllQuestions }: WorkingData & {
  recordedAnswers?: React.ReactNode;
  /** Redesign interview: All questions as the first choice in the section dropdown, in place of the trail. */
  onAllQuestions?: () => void;
  /** Redesign interview: the All questions / Interview switch and its actions, placed in this row. */
  lead?: React.ReactNode;
  preparing?: boolean;
  activeSection: AssessmentToolSection;
  guideTargets: Readonly<Record<AssessmentToolSection, string>>;
  onSectionChange: (section: AssessmentToolSection) => void;
}) {
  const designV2 = useDesignV2();
  const sections = assessmentWorkingSections(data, pending, preparing);
  const index = sections.findIndex((section) => section.key === activeSection);
  const counts = assessmentWorkingCounts(sections[index].questions, data, pending);
  const total = sections[index].questions.length;
  const picker = <label className={styles.sectionPicker}>
      <span className={styles.sectionPosition} aria-label={`Section ${index + 1} of ${sections.length}`}>{index + 1} / {sections.length}</span>
      <select aria-label="Assessment section" data-guide-target={["assessment-section-nav", ...Object.values(guideTargets)].join(" ")} value={activeSection} onChange={(event) => {
        if (onAllQuestions && event.target.value === allQuestionsChoice) { onAllQuestions(); return; }
        onSectionChange(event.target.value as AssessmentToolSection);
      }}>
        {onAllQuestions ? <option value={allQuestionsChoice}>All questions</option> : null}
        {sections.map((section) => <option key={section.key} value={section.key}>{section.label}</option>)}
      </select>
    </label>;
  return <nav aria-label="Assessment sections" className={styles.navigation} data-with-work-mode={lead ? true : undefined}>
    {lead}
    {designV2 ? <div className={styles.sectionTitle}>{picker}<div className={styles.sectionRail} aria-hidden="true">{sections.map((section, position) => <span key={section.key} data-state={position < index ? "past" : position === index ? "current" : "upcoming"} />)}</div></div> : picker}
    <div className={styles.sectionProgress}>
      {recordedAnswers ?? <span role="status" aria-live="polite" aria-atomic="true"><strong>{counts.captured}</strong> / {total} recorded{counts.verify ? <small>{counts.verify} to verify</small> : null}{counts.reasons ? <small>{counts.reasons} {counts.reasons === 1 ? "needs" : "need"} a reason</small> : null}</span>}
      <div className={styles.progressTrack} role="progressbar" aria-label="Recorded in this section" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={counts.captured} style={designV2 ? { "--recorded": `${counts.captured / (total || 1) * 100}%` } as React.CSSProperties : undefined}><span style={{ width: `${counts.captured / (total || 1) * 100}%` }} /></div>
    </div>
  </nav>;
}

export function AssessmentWorkMode({ preparing, disabled, canBegin, startAttemptFailed, onChange, onBegin, scheduleAction, appointment, chartAction }: { preparing: boolean; disabled: boolean; canBegin: boolean; startAttemptFailed: boolean; onChange: (prepare: boolean) => void; onBegin: () => void; scheduleAction?: React.ReactNode; appointment?: string; chartAction?: React.ReactNode }) {
  const designV2 = useDesignV2();
  const renderPhaseSteps = () => (<div className={styles.phaseSummary}>
      <ol className={styles.phaseSteps} aria-label="Preparation and interview">
        <li aria-current={preparing ? "step" : undefined}><span aria-hidden="true">1</span><button type="button" aria-pressed={preparing} disabled={disabled} onClick={() => onChange(true)}>{preparing ? "Prepare assessment" : "All questions"}</button><ChevronRight size={15} aria-hidden="true" /></li>
        <li aria-current={!preparing ? "step" : undefined}><span aria-hidden="true">2</span><button type="button" aria-pressed={!preparing} disabled={disabled} onClick={() => onChange(false)}>Interview</button></li>
      </ol>
      {designV2 && !preparing ? null : <p>{preparing ? "All assessment questions. Add or update what you know before, during, or after the interview." : "Focused questions for the conversation. Open All questions to add or update any other detail, then return here."}</p>}
    </div>);
  const renderAppointment = () => (preparing && appointment ? <div className={styles.appointment} aria-label="Assessment appointment"><span>Scheduled</span><strong>{appointment}</strong>{scheduleAction ? <div className={styles.editAppointment}>{scheduleAction}</div> : null}</div> : scheduleAction ? <div className={styles.scheduleAction}>{scheduleAction}</div> : null);
  return <section className={styles.workMode} aria-label="Assessment progress" data-phase={preparing ? "preparation" : "interview"}>
    {renderPhaseSteps()}
    {preparing || canBegin || scheduleAction || chartAction ? <div className={styles.prepActions}>
      {renderAppointment()}
      {chartAction}
      {canBegin ? <button type="button" data-guide-target="assessment-begin" className={styles.beginAssessment} disabled={disabled} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onBegin(); }}><Play size={16} aria-hidden="true" />{startAttemptFailed ? "Retry start time" : "Begin interview"}</button> : null}
    </div> : null}
    {startAttemptFailed && canBegin ? <p role="status" className={styles.startPending}>Start time not saved. You can keep answering.</p> : null}
  </section>;
}

export type WorkingSectionProps = WorkingData & {
  workspaceActive?: boolean;
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
  /** Redesign: the client's last signed assessment, offered per question while it is empty. */
  priorAnswers?: PriorAnswers;
  /** Interview: the client's notes, shown as a tab beside Current information. */
  notebook?: React.ReactNode;
  /** Redesign interview: the Chart as text beside the questions, in place of the tabs (docs/design/DECISIONS.md, "Split interview"). */
  split?: React.ReactNode;
  /** One page of groups: each question's group (preparation group or interview topic), for headings. */
  groupHeadings?: ReadonlyMap<AssessmentToolFieldKey, { key: string; label: string }>;
  /** The referral intake's current answers, offered where this assessment is still empty. */
  intakeAnswers?: Partial<AssessmentToolData>;
  /** Redesign: referral summary and documents shown at the top of Current information. */
  interviewContext?: React.ReactNode;
  onUsePriorAnswer?: (field: AssessmentToolFieldKey, value: AssessmentToolData[AssessmentToolFieldKey], assessmentId: string) => void;
  onUnableReasonChange: (field: AssessmentToolFieldKey, reason: string) => void;
  onReferenceEdit?: (field: AssessmentToolFieldKey) => void;
};

export default function AssessmentWorkingSection(props: WorkingSectionProps) {
  const designV2 = useDesignV2();
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
    if (props.workspaceActive === false) return;
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
  }, [props.section, props.preparing, props.workspaceActive]);
  useLayoutEffect(() => {
    if (!localTarget || props.workspaceActive === false) return;
    const field = editor.current?.querySelector<HTMLElement>("#assessment-" + localTarget.field);
    if (!field) return;
    field.closest("[data-working-field]")?.scrollIntoView({ block: "nearest" });
    const control = field.matches("input, textarea, select") ? field : field.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)");
    control?.focus({ preventScroll: true });
  }, [localTarget, props.workspaceActive]);

  const renderReference = () => <>
    {props.questionNavigation?.(props.preparing ? <CapturedAssessmentAnswers {...props} data={referenceData} recorded={recorded} onEdit={props.onReferenceEdit ?? ((field) => setLocalTarget({ field }))} /> : undefined)}
    {!props.preparing ? props.split ?? (props.notebook
      ? <ReferenceTabs notebook={props.notebook} information={<CapturedAssessmentAnswers {...props} questions={props.referenceQuestions ?? questions} data={referenceData} recorded={recorded} onEdit={props.onReferenceEdit ?? ((field) => setLocalTarget({ field }))} />} />
      : <CapturedAssessmentAnswers {...props} questions={props.referenceQuestions ?? questions} data={referenceData} recorded={recorded} onEdit={props.onReferenceEdit ?? ((field) => setLocalTarget({ field }))} />) : null}
  </>;

  return <div data-assessment-working-section data-split={props.split && !props.preparing ? true : undefined} data-assessment-stacked={props.groupHeadings ? true : undefined} data-assessment-section={props.section} data-assessment-phase={props.preparing ? "preparation" : "interview"} className={`${styles.book} ${props.preparing ? styles.preparing : ""}`}>
    {renderReference()}
    <div data-guide-target="assessment-fields" data-assessment-question-editor className={styles.editor}>
      <div ref={editor} tabIndex={-1} role="region" aria-label={`${props.sectionLabel ?? "Assessment"} questions`} className={styles.questionPage} data-assessment-question-page>
      {props.preparing && props.sectionLabel ? <h3 ref={sectionHeading} tabIndex={-1} data-assessment-section-heading className={styles.sectionHeading}>{props.sectionLabel}</h3> : null}
      {!groups.length ? <p className={styles.empty}>{isAssessmentFinalized(props.assessment) ? "Review this section in Current information." : "This section is complete. Review the reference, or continue to the next section."}</p> : null}
      {groups.map((group, position) => {
        // One page of groups: a heading wherever the group (preparation group or interview topic) changes.
        const heading = props.groupHeadings?.get(group.questions[0].field);
        const showHeading = heading && heading.key !== (position > 0 ? props.groupHeadings?.get(groups[position - 1].questions[0].field)?.key : undefined);
        return <Fragment key={group.label}>
      {showHeading ? <h3 tabIndex={-1} data-assessment-group-heading={heading.key} className={`${styles.sectionHeading} ${styles.groupHeading}`}>{heading.label}</h3> : null}
      <section aria-label={group.label} className={styles.questionGroup}>
        <div className={styles.fields}>
          {group.questions.map((question) => {
            const answer = <>
            <WorkingAssessmentField {...props} question={question} onFieldFocus={focusField} onAnswerBlur={finishReference} />
            {assessmentQuestionStatus(question, data, pending) === "captured" ? <span className={styles.recorded}>Recorded</span> : null}
            {props.preparing && hasAssessmentInterviewValue(data[question.field]) ? <AssessmentAnswerSource assessment={props.assessment} data={data} field={question.field} /> : null}
            </>;
            // Redesign: a status circle beside each question (dashed until recorded).
            return designV2
              ? <div key={question.field} className={`${styles.questionRow} ${question.span === "full" ? styles.fullField : ""}`}><span aria-hidden="true" className={styles.questionStatus} data-status={assessmentQuestionStatus(question, data, pending)} /><div className="min-w-0">{answer}</div></div>
              : <div key={question.field} className={question.span === "full" ? styles.fullField : undefined}>{answer}</div>;
          })}
        </div>
      </section>
      </Fragment>;
      })}
      </div>
    </div>
  </div>;
}

export function WorkingAssessmentField({ question, data, assessment, required, pending, disabled, reviewDisabled, onChange, onReview, onUnableReasonChange, onFieldFocus, onFieldBlur, onAnswerBlur, priorAnswers, intakeAnswers, onUsePriorAnswer }: WorkingSectionProps & { question: AssessmentInterviewQuestion; onAnswerBlur?: (field: AssessmentToolFieldKey) => void }) {
  const definition = assessmentToolFieldDefinitions.find((definition) => definition.key === question.field)!;
  const priorValue = priorAnswers?.answers[question.field];
  const intakeValue = intakeAnswers?.[question.field];
  // Intake first: it is this referral's own information; the last assessment is older.
  const priorSuggestion = onUsePriorAnswer && intakeValue !== undefined ? {
    text: priorAnswerText(question, data, intakeValue),
    source: "referral records",
    onUse: () => onUsePriorAnswer(question.field, intakeValue, intakeAnswerSource),
  } : priorAnswers && onUsePriorAnswer && priorValue !== undefined ? {
    text: priorAnswerText(question, data, priorValue),
    source: `last assessment (${formatPriorDate(priorAnswers.source.signed_at)})`,
    onUse: () => onUsePriorAnswer(question.field, priorValue, priorAnswers.source.assessment_id),
  } : undefined;
  return <div data-working-field={question.field} onFocusCapture={() => onFieldFocus(question.field)} onBlur={(event) => {
    onAnswerBlur?.(question.field);
    if (!event.currentTarget.contains(event.relatedTarget)) onFieldBlur(question.field);
  }} className={question.span === "full" ? "sm:col-span-2" : "min-w-0"}>
    <AssessmentField definition={definition} question={question} value={data[question.field]} unableReason={getAssessmentUnableReason(data, question.field)} required={required.has(question.field)} pending={pending.includes(question.field)} pendingProvenance={latestPendingProvenance(assessment, question.field)} disabled={disabled} reviewDisabled={reviewDisabled} onChange={(value) => onChange(question.field, value)} onReview={(action) => onReview(question.field, action)} onUnableReasonChange={(reason) => onUnableReasonChange(question.field, reason)} priorSuggestion={priorSuggestion} />
  </div>;
}

function priorAnswerText(question: AssessmentInterviewQuestion, data: AssessmentToolData, value: AssessmentToolData[AssessmentToolFieldKey]) {
  if (Array.isArray(value)) return value.map((item) => assessmentInterviewOptionLabel(question.field, item) ?? String(item)).join(", ");
  return capturedAssessmentAnswer(question, { ...data, [question.field]: value }) || String(value);
}

function CapturedAssessmentAnswers({ section, preparing, data, pending, questions, onEdit, assessment, recorded, interviewContext }: WorkingSectionProps & { recorded: { field: AssessmentToolFieldKey; revision: number } | null; onEdit: (field: AssessmentToolFieldKey) => void }) {
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
      {interviewContext}
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

// Interview: notes and Current information share the column beside the questions, one at a time, so the
// questions keep their width (docs/design/DECISIONS.md, "Interview notebook"). Notes show first.
function ReferenceTabs({ notebook, information }: { notebook: React.ReactNode; information: React.ReactNode }) {
  const [tab, setTab] = useState<"notes" | "information">("notes");
  const id = useId();
  return <div className={styles.referenceTabs} data-reference-tab={tab}>
    <div role="tablist" aria-label="Beside the questions" className={styles.referenceTabList}>
      <button type="button" role="tab" id={`${id}-notes`} aria-selected={tab === "notes"} aria-controls={`${id}-notes-panel`} onClick={() => setTab("notes")}>Notes</button>
      <button type="button" role="tab" id={`${id}-information`} aria-selected={tab === "information"} aria-controls={`${id}-information-panel`} onClick={() => setTab("information")}>Current information</button>
    </div>
    <div role="tabpanel" id={`${id}-notes-panel`} aria-labelledby={`${id}-notes`} hidden={tab !== "notes"}>{notebook}</div>
    <div role="tabpanel" id={`${id}-information-panel`} aria-labelledby={`${id}-information`} hidden={tab !== "information"}>{information}</div>
  </div>;
}
