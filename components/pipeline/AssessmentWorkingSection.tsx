"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Pencil, Search } from "lucide-react";
import {
  assessmentInterviewFieldLabel,
  assessmentInterviewSections,
  getAssessmentInterviewQuestions,
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
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { AssessmentField } from "@/components/pipeline/AssessmentInterviewFields";
import { latestPendingProvenance } from "@/components/pipeline/assessment-workspace-state";
import {
  assessmentQuestionStatus,
  assessmentWorkingCountLabel,
  assessmentWorkingCounts,
  capturedAssessmentAnswer,
  groupWorkingQuestions,
  matchesAssessmentQuestion,
} from "@/components/pipeline/assessment-working-view";

type WorkingData = { data: AssessmentToolData; pending: readonly AssessmentToolFieldKey[] };
type QuestionTarget = { field: AssessmentToolFieldKey };

export function AssessmentWorkingNavigation({ data, pending, activeSection, groups, guideTargets, onSectionChange, onJump }: WorkingData & {
  activeSection: AssessmentToolSection;
  groups: ReadonlyArray<{ label: string; sections: readonly AssessmentToolSection[] }>;
  guideTargets: Readonly<Record<AssessmentToolSection, string>>;
  onSectionChange: (section: AssessmentToolSection) => void;
  onJump: (section: AssessmentToolSection, field: AssessmentToolFieldKey) => void;
}) {
  const [query, setQuery] = useState("");
  const sections = assessmentInterviewSections.map((section) => ({ ...section, questions: getAssessmentInterviewQuestions(section.key, data) }));
  const matches = sections.flatMap((section) => section.questions.filter((question) => matchesAssessmentQuestion(question, query)).map((question) => ({ section, question })));
  const interviewGroups = groups.filter((group) => group.label !== "Intake");
  const intakeGroup = groups.find((group) => group.label === "Intake");
  const renderSections = (keys: readonly AssessmentToolSection[]) => keys.map((key) => {
    const section = sections.find((section) => section.key === key)!;
    const counts = assessmentWorkingCounts(section.questions, data, pending);
    const active = activeSection === key;
    return <div key={key}>
      <button type="button" data-guide-target={`assessment-section-nav ${guideTargets[key]}`} onClick={() => onSectionChange(key)} aria-current={active ? "step" : undefined} className={`flex min-h-11 w-full items-center justify-between gap-2 py-2 text-left focus-visible:outline-2 focus-visible:outline-[#0f8b73] ${active ? "text-[#173b28]" : "text-[#45654d] hover:text-[#0f7664]"}`}>
        <span className="min-w-0"><span className="block text-[13px] font-bold">{section.label}</span><span className="mt-0.5 block text-[10px] font-normal leading-4 text-[#657967]">{assessmentWorkingCountLabel(counts)}</span></span>
        {counts.captured === section.questions.length ? <Check size={14} aria-hidden="true" className="shrink-0" /> : active ? <ChevronRight size={14} aria-hidden="true" className="shrink-0" /> : null}
      </button>
      {active ? <div className="mb-2 border-l border-[#cad9c8] pl-3">
        {groupWorkingQuestions(section.questions).map((subsection) => {
          const counts = assessmentWorkingCounts(subsection.questions, data, pending);
          return <button key={subsection.label} type="button" aria-label={`Jump to ${subsection.label}`} onClick={() => onJump(key, subsection.questions[0].field)} className="flex min-h-8 w-full items-center justify-between gap-2 py-1 text-left text-[12px] font-medium leading-4 text-[#45654d] hover:text-[#0f7664] focus-visible:outline-2 focus-visible:outline-[#0f8b73]"><span>{subsection.label}</span>{counts.unanswered + counts.verify + counts.reasons > 0 ? <span title={assessmentWorkingCountLabel(counts)} className="shrink-0 text-[10px] text-[#7a6742]">{counts.unanswered + counts.verify + counts.reasons}</span> : <Check size={12} aria-label="Complete" className="shrink-0" />}</button>;
        })}
      </div> : null}
    </div>;
  });
  return (
    <>
      <div className="relative mb-5">
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-0 top-2.5 text-[#657967]" />
        <input type="search" aria-label="Find assessment question" placeholder="Find a question" value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 w-full bg-transparent pl-6 pr-1 text-[12px] text-[#234c36] outline-none placeholder:text-[#657967] focus-visible:outline-2 focus-visible:outline-[#0f8b73]" />
      </div>
      {query.trim() ? (
        <nav aria-label="Matching assessment questions" className="mb-5 space-y-1">
          {matches.map(({ section, question }) => <button key={question.field} type="button" onClick={() => { onJump(section.key, question.field); setQuery(""); }} className="w-full py-2 text-left text-[12px] font-semibold text-[#234c36] hover:text-[#0f7664] focus-visible:outline-2 focus-visible:outline-[#0f8b73]"><span className="block">{assessmentInterviewFieldLabel(question.field)}</span><span className="mt-0.5 block text-[10px] font-normal text-[#657967]">{section.label}</span></button>)}
          {!matches.length ? <p role="status" className="text-[12px] text-[#657967]">No matching questions.</p> : null}
        </nav>
      ) : null}
      <AssessmentRemainingQuestions section={activeSection} data={data} pending={pending} onJump={onJump} />
      <nav data-guide-target="assessment-section-nav" aria-label="Assessment sections" className="space-y-5">
        {interviewGroups.map((group) => <div key={group.label}>
          <h3 className="text-[10px] font-semibold text-[#657967]">{group.label}</h3>
          <div className="mt-1 space-y-1">
            {renderSections(group.sections)}
          </div>
        </div>)}
        {intakeGroup ? <details key={intakeGroup.sections.includes(activeSection) ? "intake-active" : "intake-collapsed"} open={intakeGroup.sections.includes(activeSection)}>
          <summary className="cursor-pointer py-2 text-[12px] font-semibold text-[#45654d] focus-visible:outline-2 focus-visible:outline-[#0f8b73]">Referral details</summary>
          {renderSections(intakeGroup.sections)}
        </details> : null}
      </nav>
    </>
  );
}

export function AssessmentRemainingQuestions({ section, data, pending, onJump, expandedByDefault = true }: WorkingData & {
  section: AssessmentToolSection;
  onJump: (section: AssessmentToolSection, field: AssessmentToolFieldKey) => void;
  expandedByDefault?: boolean;
}) {
  const questions = getAssessmentInterviewQuestions(section, data).filter((question) => assessmentQuestionStatus(question, data, pending) !== "captured");
  return <details key={section} open={expandedByDefault} className="mb-5 border-b border-[#d9dfdb] pb-4">
    <summary className="cursor-pointer py-2 text-[13px] font-bold text-[#294735]">Remaining in this section · {questions.length}</summary>
    <nav aria-label="Remaining assessment questions" className="max-h-[35dvh] overflow-y-auto">
      {questions.map((question) => {
        const status = assessmentQuestionStatus(question, data, pending);
        return <button key={question.field} type="button" onClick={() => onJump(section, question.field)} className="block min-h-11 w-full py-2 text-left text-[12px] font-semibold text-[#315d41] hover:text-[#0f7664] focus-visible:outline-2 focus-visible:outline-[#0f8b73]">
          <span className="block">{assessmentInterviewFieldLabel(question.field)}</span>
          <span className="mt-0.5 block text-[10px] font-normal text-[#69756b]">{status === "verify" ? "Needs verification" : status === "reason" ? "Reason missing" : "Unanswered"}</span>
        </button>;
      })}
      {!questions.length ? <p className="py-2 text-[12px] text-[#657167]">No unanswered questions in this section.</p> : null}
    </nav>
  </details>;
}

type WorkingSectionProps = WorkingData & {
  section: AssessmentToolSection;
  assessment: PipelineAssessmentRecord;
  questions: readonly AssessmentInterviewQuestion[];
  required: ReadonlySet<AssessmentToolFieldKey>;
  disabled: boolean;
  reviewDisabled: boolean;
  target: QuestionTarget | null;
  onChange: (field: AssessmentToolFieldKey, value: AssessmentToolData[AssessmentToolFieldKey]) => void;
  onReview: (field: AssessmentToolFieldKey, action: "accept" | "reject") => void;
  onUnableReasonChange: (field: AssessmentToolFieldKey, reason: string) => void;
};

export default function AssessmentWorkingSection(props: WorkingSectionProps) {
  const { data, pending, questions, target } = props;
  const groups = groupWorkingQuestions(questions);
  const targetGroup = questions.find((question) => question.field === target?.field)?.group;
  const [openGroup, setOpenGroup] = useState(() => targetGroup ?? groups.find((group) => group.questions.some((question) => assessmentQuestionStatus(question, data, pending) !== "captured"))?.label ?? null);
  const [localTarget, setLocalTarget] = useState<QuestionTarget | null>(target);
  const [receivedTarget, setReceivedTarget] = useState(target);
  const editor = useRef<HTMLDivElement>(null);

  if (target !== receivedTarget) {
    setReceivedTarget(target);
    setLocalTarget(target);
    if (targetGroup) setOpenGroup(targetGroup);
  }

  useLayoutEffect(() => {
    if (!localTarget) return;
    const field = editor.current?.querySelector<HTMLElement>(`#assessment-${localTarget.field}`);
    if (!field) return;
    field.closest("[data-working-field]")?.scrollIntoView({ block: "nearest" });
    const control = field.matches("input, textarea, select") ? field : field.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)");
    control?.focus({ preventScroll: true });
  }, [localTarget, openGroup]);

  return (
    <div data-assessment-working-section className="space-y-5">
      <CapturedAssessmentAnswers section={props.section} data={data} pending={pending} questions={questions} onEdit={(field) => { setOpenGroup(questions.find((question) => question.field === field)!.group); setLocalTarget({ field }); }} />
      <div ref={editor} data-assessment-question-editor className="min-w-0">
        <div className="divide-y divide-[#d8e2d7]">
          {groups.map((group, index) => <WorkingQuestionGroup key={group.label} {...props} group={group} index={index} open={openGroup === group.label} onToggle={() => { setLocalTarget(null); setOpenGroup(openGroup === group.label ? null : group.label); }} />)}
        </div>
        {openGroup ? <button type="button" onClick={() => { setLocalTarget(null); setOpenGroup(nextWorkingGroup(groups, openGroup, data, pending)); }} className="mt-4 flex min-h-10 items-center gap-2 rounded bg-[#234c36] px-4 text-[12px] font-bold text-white hover:bg-[#173b28]">Next group <ChevronRight size={15} aria-hidden="true" /></button> : null}
      </div>
    </div>
  );
}

function nextWorkingGroup(groups: ReturnType<typeof groupWorkingQuestions>, current: string, data: AssessmentToolData, pending: readonly AssessmentToolFieldKey[]) {
  const index = groups.findIndex((group) => group.label === current);
  const remaining = [...groups.slice(index + 1), ...groups.slice(0, index)];
  return remaining.find((group) => group.questions.some((question) => assessmentQuestionStatus(question, data, pending) !== "captured"))?.label ?? null;
}

function WorkingQuestionGroup(props: WorkingSectionProps & { group: ReturnType<typeof groupWorkingQuestions>[number]; index: number; open: boolean; onToggle: () => void }) {
  const { group, index, open, onToggle, data, pending, section } = props;
  const counts = assessmentWorkingCounts(group.questions, data, pending);
  const id = `working-group-${section}-${index}`;
  return (
    <section aria-label={group.label} className="py-1">
      <h5><button type="button" aria-expanded={open} aria-controls={id} onClick={onToggle} className="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-[#0f8b73]">
        <span><span className="block text-[14px] font-bold text-[#213629]">{group.label}</span><span className="mt-1 block text-[11px] text-[#69756b]">{assessmentWorkingCountLabel(counts)}</span></span>
        <ChevronDown size={18} aria-hidden="true" className={`shrink-0 text-[#58715e] transition-transform ${open ? "rotate-180" : ""}`} />
      </button></h5>
      <div id={id} hidden={!open} className="pb-6">
        {open ? <div className="grid gap-x-5 gap-y-5 rounded bg-white p-4 sm:grid-cols-2">
          {group.questions.map((question) => <WorkingAssessmentField key={question.field} {...props} question={question} />)}
        </div> : null}
      </div>
    </section>
  );
}

function WorkingAssessmentField({ question, data, assessment, required, pending, disabled, reviewDisabled, onChange, onReview, onUnableReasonChange }: WorkingSectionProps & { question: AssessmentInterviewQuestion }) {
  const definition = assessmentToolFieldDefinitions.find((definition) => definition.key === question.field)!;
  return <div data-working-field={question.field} className={question.span === "full" ? "sm:col-span-2" : "min-w-0"}>
    <AssessmentField definition={definition} question={question} value={data[question.field]} unableReason={getAssessmentUnableReason(data, question.field)} required={required.has(question.field)} pending={pending.includes(question.field)} pendingProvenance={latestPendingProvenance(assessment, question.field)} disabled={disabled} reviewDisabled={reviewDisabled} onChange={(value) => onChange(question.field, value)} onReview={(action) => onReview(question.field, action)} onUnableReasonChange={(reason) => onUnableReasonChange(question.field, reason)} />
  </div>;
}

function CapturedAssessmentAnswers({ section, data, pending, questions, onEdit }: WorkingData & { section: AssessmentToolSection; questions: readonly AssessmentInterviewQuestion[]; onEdit: (field: AssessmentToolFieldKey) => void }) {
  const [expanded, setExpanded] = useState(false);
  const captured = questions.filter((question) => hasAssessmentInterviewValue(data[question.field]) || pending.includes(question.field));
  const groups = groupWorkingQuestions(captured);
  const id = `captured-answers-${section}`;
  return (
    <aside aria-label="Captured assessment answers" className="min-w-0 border border-[#d8e2d7] bg-white px-4 py-4">
      <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)} className="flex w-full items-center justify-between gap-3 text-left text-[13px] font-bold text-[#294735] focus-visible:outline-2 focus-visible:outline-[#0f8b73] min-[1200px]:hidden"><span>Captured answers · {captured.length}</span><ChevronDown size={16} aria-hidden="true" className={expanded ? "rotate-180" : ""} /></button>
      <h4 className="hidden text-[14px] font-bold text-[#294735] min-[1200px]:block">Captured answers</h4>
      <div id={id} className={expanded ? "max-h-[45dvh] overflow-y-auto min-[1200px]:max-h-none min-[1200px]:overflow-visible min-[1200px]:grid min-[1200px]:grid-cols-2 min-[1200px]:gap-x-6" : "hidden min-[1200px]:grid min-[1200px]:grid-cols-2 min-[1200px]:gap-x-6"}>
      {!captured.length ? <p className="mt-4 text-[12px] text-[#667364]">No answers captured in this section.</p> : null}
      {groups.map((group) => <section key={group.label} className="mt-5"><h5 className="mb-1 text-[11px] font-bold text-[#5e705c]">{group.label}</h5>
        <div className="divide-y divide-[#d8e1d2]">{group.questions.map((question) => <CapturedAnswer key={question.field} question={question} data={data} pending={pending} onEdit={onEdit} />)}</div>
      </section>)}
      </div>
    </aside>
  );
}

function CapturedAnswer({ question, data, pending, onEdit }: WorkingData & { question: AssessmentInterviewQuestion; onEdit: (field: AssessmentToolFieldKey) => void }) {
  const status = assessmentQuestionStatus(question, data, pending);
  const reason = getAssessmentUnableReason(data, question.field);
  return <button type="button" aria-label={`Edit ${assessmentInterviewFieldLabel(question.field)}`} onClick={() => onEdit(question.field)} className="group block w-full py-3 text-left focus-visible:outline-2 focus-visible:outline-[#0f8b73]">
    <span className="flex items-start justify-between gap-2 text-[11px] font-semibold text-[#5d6b5a]"><span>{assessmentInterviewFieldLabel(question.field)}</span><Pencil size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-[#6a8069] group-hover:text-[#0f7664]" /></span>
    <span className="mt-1 block whitespace-pre-wrap break-words text-[14px] font-semibold leading-6 text-[#253a2a]">{capturedAssessmentAnswer(question, data)}</span>
    {reason ? <span className="mt-1 block break-words text-[11px] leading-4 text-[#667364]">{reason}</span> : null}
    {status === "verify" ? <span className="mt-1 block text-[10px] font-bold text-[#916118]">Needs verification</span> : status === "reason" ? <span className="mt-1 block text-[10px] font-bold text-[#916118]">Reason missing</span> : null}
  </button>;
}
