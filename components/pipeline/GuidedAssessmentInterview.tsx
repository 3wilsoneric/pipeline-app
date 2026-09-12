"use client";

import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import PipelineLogoMark from "@/components/pipeline/PipelineLogoMark";
import { AssessmentFieldWritingGuidePanel } from "@/components/pipeline/AssessmentInterviewFields";
import { extractionOwnedFields, latestPendingProvenance } from "@/components/pipeline/assessment-workspace-state";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import {
  assessmentInterviewFieldLabel,
  assessmentInterviewQuestions,
  assessmentInterviewSections,
  getAssessmentInterviewCoverage,
  getAssessmentUnableReason,
  hasAssessmentInterviewValue,
  isAssessmentQuestionVisible,
  setAssessmentUnableReason,
  type AssessmentInterviewQuestion,
  type AssessmentQuestionOption,
} from "@/lib/assessment/assessment-interview-schema";
import {
  assessmentToolFieldDefinitions,
  type AssessmentFieldProvenance,
  type AssessmentToolData,
  type AssessmentToolFieldDefinition,
  type AssessmentToolFieldKey,
  type AssessmentToolSection,
} from "@/lib/assessment/assessment-tool-schema";

type GuidedAssessmentInterviewProps = {
  assessment: PipelineAssessmentRecord;
  data: AssessmentToolData;
  activeSection: AssessmentToolSection;
  requiredFields: ReadonlySet<AssessmentToolFieldKey>;
  disabled: boolean;
  reviewDisabled: boolean;
  saveStatus: string;
  saveTone: "error" | "pending" | "saved";
  error: string;
  hasConflicts: boolean;
  onChange: (field: AssessmentToolFieldKey, value: AssessmentToolData[AssessmentToolFieldKey]) => void;
  onReview: (field: AssessmentToolFieldKey, action: "accept" | "reject") => void;
  onSectionChange: (section: AssessmentToolSection) => void;
  onExitToChart: () => void;
  onDone: () => void;
};

type GuidedAssessmentScreen = {
  id: string;
  section: AssessmentToolSection;
  group: string;
  questions: readonly AssessmentInterviewQuestion[];
};

const definitionByField = new Map(assessmentToolFieldDefinitions.map((definition) => [definition.key, definition]));
const sectionByKey = new Map(assessmentInterviewSections.map((section) => [section.key, section]));
const guidedAssessmentScreens = buildGuidedAssessmentScreens();
const guidedAssessmentQuestionCount = guidedAssessmentScreens.reduce((total, screen) => total + screen.questions.length, 0);

export default function GuidedAssessmentInterview({
  assessment,
  data,
  activeSection,
  requiredFields,
  disabled,
  reviewDisabled,
  saveStatus,
  saveTone,
  error,
  hasConflicts,
  onChange,
  onReview,
  onSectionChange,
  onExitToChart,
  onDone,
}: GuidedAssessmentInterviewProps) {
  const visibleScreens = useMemo(
    () => guidedAssessmentScreens.filter((screen) => screen.questions.some((question) => isAssessmentQuestionVisible(question, data))),
    [data],
  );
  const [activeScreenId, setActiveScreenId] = useState(() => visibleScreens[initialScreenIndex(visibleScreens, activeSection, data)]?.id);
  const currentIndex = visibleScreens.findIndex((candidate) => candidate.id === activeScreenId);
  const originalIndex = guidedAssessmentScreens.findIndex((candidate) => candidate.id === activeScreenId);
  const nextVisibleIndex = visibleScreens.findIndex((candidate) => guidedAssessmentScreens.indexOf(candidate) >= originalIndex);
  const boundedIndex = currentIndex >= 0 ? currentIndex : nextVisibleIndex >= 0 ? nextVisibleIndex : Math.max(visibleScreens.length - 1, 0);
  const screen = visibleScreens[boundedIndex];
  const section = screen ? sectionByKey.get(screen.section) : undefined;
  const visibleQuestions = screen?.questions.filter((question) => isAssessmentQuestionVisible(question, data)) ?? [];
  const coverage = getAssessmentInterviewCoverage(data);
  const answeredHere = visibleQuestions.filter((question) => hasAssessmentInterviewValue(data[question.field])).length;
  const isLastScreen = boundedIndex >= visibleScreens.length - 1;

  useEffect(() => {
    if (screen) onSectionChange(screen.section);
  }, [onSectionChange, screen]);

  if (!screen || !section) return null;

  const title = screenTitle(screen, visibleQuestions);
  const primaryQuestion = visibleQuestions.length === 1;

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label="Assessment interview"
      data-guided-assessment="true"
      data-total-questions={guidedAssessmentQuestionCount}
      data-visible-screens={visibleScreens.length}
      data-screen-index={boundedIndex}
      data-screen-section={screen.section}
      className="fixed inset-0 z-[90] flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-white text-[#181b19]"
    >
      <header className="relative flex min-h-14 shrink-0 flex-wrap items-center gap-y-1 border-b border-[#e0e4e1] px-4 py-2 sm:h-16 sm:flex-nowrap sm:px-6 lg:px-9">
        <div className="flex min-w-0 items-center gap-2.5">
          <PipelineLogoMark size={23} />
          <span className="hidden text-[11px] font-black uppercase tracking-[0.08em] text-[#0f7664] sm:inline">Assessment</span>
        </div>
        <div className="pointer-events-none absolute inset-x-16 top-7 -translate-y-1/2 text-center sm:top-1/2">
          <div className="truncate text-[11px] font-bold text-[#454b47] sm:text-[12px]">
            {assessment.resident_name || "Client assessment"}
          </div>
          <div className="mt-0.5 hidden text-[9px] font-semibold uppercase tracking-[0.08em] text-[#8a918d] sm:block">
            {section.label}
          </div>
        </div>
        <span data-guide-target="assessment-save-status" aria-live="polite" className={`order-last flex min-w-0 basis-full items-center justify-end gap-1.5 text-[10px] font-semibold sm:order-none sm:ml-auto sm:max-w-[180px] sm:basis-auto ${saveToneClass(saveTone)}`}>
          {saveTone === "saved" ? <Check size={12} className="shrink-0" aria-hidden="true" /> : null}<span className="truncate">{saveStatus}</span>
        </span>
        <div className="ml-auto flex items-center gap-3 sm:ml-3">
          <button
            type="button"
            onClick={onExitToChart}
            aria-label="Exit guided interview"
            title="View full assessment"
            className="flex h-10 w-10 items-center justify-center text-[#4d534f] transition-colors hover:bg-[#f1f4f2] hover:text-[#0f7664]"
          >
            <X size={20} />
          </button>
        </div>
      </header>
      <div className="h-1 shrink-0 bg-[#e7ebe8]" aria-hidden="true">
        <div className="h-full bg-[#0f8b73] transition-[width] duration-200" style={{ width: `${coverage.percent}%` }} />
      </div>

      <GuidedAssessmentStatusBanner error={error} hasConflicts={hasConflicts} onExitToChart={onExitToChart} />

      <main key={screen.id} className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8 lg:py-10">
        <div className="mx-auto w-full max-w-[650px] pb-5">
          <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#0f7664]">
            {section.label} <span className="text-[#a1a7a3]">·</span> {boundedIndex + 1} of {visibleScreens.length}
          </div>
          <h1 className="mt-2 max-w-[620px] text-[24px] font-black leading-[1.18] sm:text-[28px]">{title}</h1>
          <GuidedAssessmentSupportingCopy sectionDescription={section.description} questions={visibleQuestions} />
          <GuidedAssessmentFields
            assessment={assessment}
            data={data}
            questions={visibleQuestions}
            requiredFields={requiredFields}
            primaryQuestion={primaryQuestion}
            disabled={disabled}
            reviewDisabled={reviewDisabled}
            onChange={onChange}
            onReview={onReview}
          />
        </div>
      </main>

      <GuidedAssessmentFooter
        screenIndex={boundedIndex}
        screenCount={visibleScreens.length}
        answeredHere={answeredHere}
        questionCount={visibleQuestions.length}
        captured={coverage.captured}
        total={coverage.total}
        isLastScreen={isLastScreen}
        setScreenIndex={(index) => setActiveScreenId(visibleScreens[index]?.id)}
        onDone={onDone}
      />
    </section>
  );
}

function GuidedAssessmentStatusBanner({ error, hasConflicts, onExitToChart }: Pick<GuidedAssessmentInterviewProps, "error" | "hasConflicts" | "onExitToChart">) {
  if (!error && !hasConflicts) return null;
  return (
    <div className={`flex shrink-0 items-center justify-between gap-4 px-4 py-2.5 text-[11px] font-semibold sm:px-6 lg:px-9 ${error ? "bg-[#fff1ee] text-[#9d382b]" : "bg-[#fff8e8] text-[#795016]"}`}>
      <span>{error || "Another editor changed answers you were working on."}</span>
      <button type="button" onClick={onExitToChart} className="shrink-0 font-black underline underline-offset-2">Review changes</button>
    </div>
  );
}

function GuidedAssessmentSupportingCopy({ sectionDescription, questions }: { sectionDescription: string; questions: readonly AssessmentInterviewQuestion[] }) {
  const copy = questions.length > 1 ? sectionDescription : questions[0]?.help;
  return copy ? <p className="mt-2 max-w-[580px] text-[12px] leading-5 text-[#6c746f]">{copy}</p> : null;
}

function GuidedAssessmentFields({ assessment, data, questions, requiredFields, primaryQuestion, disabled, reviewDisabled, onChange, onReview }: {
  assessment: PipelineAssessmentRecord;
  data: AssessmentToolData;
  questions: readonly AssessmentInterviewQuestion[];
  requiredFields: ReadonlySet<AssessmentToolFieldKey>;
  primaryQuestion: boolean;
  disabled: boolean;
  reviewDisabled: boolean;
  onChange: GuidedAssessmentInterviewProps["onChange"];
  onReview: GuidedAssessmentInterviewProps["onReview"];
}) {
  return (
    <div className={`mt-6 grid gap-5 ${questions.length > 1 ? "sm:grid-cols-2" : ""}`}>
      {questions.map((question) => {
        const definition = definitionByField.get(question.field);
        if (!definition) return null;
        return (
          <GuidedAssessmentField
            key={question.field}
            question={question}
            definition={definition}
            value={data[question.field]}
            unableReason={getAssessmentUnableReason(data, question.field)}
            required={requiredFields.has(question.field)}
            primary={primaryQuestion}
            disabled={disabled || extractionOwnedFields.has(question.field)}
            reviewDisabled={reviewDisabled}
            pendingProvenance={latestPendingProvenance(assessment, question.field)}
            onChange={(value) => onChange(question.field, value)}
            onReview={(action) => onReview(question.field, action)}
            onUnableReasonChange={(reason) => onChange(
              "unable_to_assess_reasons",
              setAssessmentUnableReason(data.unable_to_assess_reasons, question.field, reason),
            )}
          />
        );
      })}
    </div>
  );
}

function GuidedAssessmentFooter({ screenIndex, screenCount, answeredHere, questionCount, captured, total, isLastScreen, setScreenIndex, onDone }: {
  screenIndex: number;
  screenCount: number;
  answeredHere: number;
  questionCount: number;
  captured: number;
  total: number;
  isLastScreen: boolean;
  setScreenIndex: (index: number) => void;
  onDone: () => void;
}) {
  const advance = () => isLastScreen ? onDone() : setScreenIndex(Math.min(screenCount - 1, screenIndex + 1));
  return (
    <footer className="flex min-h-[68px] shrink-0 items-center justify-between gap-3 border-t border-[#e0e4e1] bg-white px-4 py-3 sm:min-h-[76px] sm:px-7 lg:px-10">
      <button type="button" onClick={() => setScreenIndex(Math.max(0, screenIndex - 1))} disabled={screenIndex === 0} className="flex h-11 min-w-[106px] items-center justify-center gap-2 border border-[#cfd5d1] px-4 text-[12px] font-black text-[#4a514d] transition-colors hover:border-[#0f8b73] hover:text-[#0f7664] disabled:invisible">
        <ChevronLeft size={16} /> Back
      </button>
      <div className="hidden text-center text-[10px] font-semibold text-[#7c837f] sm:block">
        {answeredHere} of {questionCount} answered here <span aria-hidden="true">·</span> {captured} of {total} overall
      </div>
      <button type="button" onClick={advance} className="flex h-11 min-w-[112px] items-center justify-center gap-2 bg-[#111311] px-5 text-[12px] font-black text-white transition-colors hover:bg-[#0f7664]">
        {isLastScreen ? "Done" : "Next"} {isLastScreen ? <Check size={16} /> : <ChevronRight size={16} />}
      </button>
    </footer>
  );
}

export function GuidedAssessmentField({
  question,
  definition,
  value,
  unableReason,
  required,
  primary,
  disabled,
  reviewDisabled,
  pendingProvenance,
  onChange,
  onReview,
  onUnableReasonChange,
  writingGuideInitiallyOpen,
}: {
  question: AssessmentInterviewQuestion;
  definition: AssessmentToolFieldDefinition;
  value: AssessmentToolData[AssessmentToolFieldKey];
  unableReason: string;
  required: boolean;
  primary: boolean;
  disabled: boolean;
  reviewDisabled: boolean;
  pendingProvenance?: AssessmentFieldProvenance;
  onChange: (value: AssessmentToolData[AssessmentToolFieldKey]) => void;
  onReview: (action: "accept" | "reject") => void;
  onUnableReasonChange: (reason: string) => void;
  writingGuideInitiallyOpen?: boolean;
}) {
  const id = `guided-assessment-${definition.key}`;

  return (
    <div className={guidedFieldSpanClass(question, primary)} data-assessment-field={definition.key}>
      <GuidedFieldHeading id={id} question={question} definition={definition} value={value} required={required} primary={primary} />
      <GuidedProvenanceReview provenance={pendingProvenance} reviewDisabled={reviewDisabled} onReview={onReview} />

      <GuidedAssessmentControl
        id={id}
        question={question}
        definition={definition}
        value={value}
        unableReason={unableReason}
        prominent={primary}
        disabled={disabled}
        onChange={onChange}
        onUnableReasonChange={onUnableReasonChange}
      />
      <GuidedFieldHelp primary={primary} help={question.help} />
      {question.control === "textarea" ? <AssessmentFieldWritingGuidePanel field={definition.key} initiallyOpen={writingGuideInitiallyOpen} /> : null}
    </div>
  );
}

function GuidedFieldHeading({ id, question, definition, value, required, primary }: {
  id: string;
  question: AssessmentInterviewQuestion;
  definition: AssessmentToolFieldDefinition;
  value: AssessmentToolData[AssessmentToolFieldKey];
  required: boolean;
  primary: boolean;
}) {
  if (primary) return <label htmlFor={id} className="sr-only">{definition.label}</label>;
  const status = guidedFieldStatus(value, required);
  return (
    <div className="mb-2 flex items-start justify-between gap-3">
      <label htmlFor={id} className="text-[12px] font-black leading-5 text-[#303531]">{questionPrompt(question)}</label>
      <span className={`shrink-0 text-[9px] font-bold uppercase tracking-[0.06em] ${status.className}`}>{status.label}</span>
    </div>
  );
}

function GuidedProvenanceReview({ provenance, reviewDisabled, onReview }: {
  provenance?: AssessmentFieldProvenance;
  reviewDisabled: boolean;
  onReview: (action: "accept" | "reject") => void;
}) {
  if (!provenance) return null;
  return (
    <div className="mb-3 border-l-2 border-[#c98b31] bg-[#fff9ec] px-3 py-2.5 text-[10px] leading-4 text-[#74501b]">
      <div>
        Suggested from <strong>{provenance.source_file || "uploaded records"}</strong>
        {Number.isFinite(provenance.confidence) ? ` · ${Math.round(provenance.confidence * 100)}% confidence` : ""}
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={reviewDisabled} onClick={() => onReview("accept")} className="h-8 bg-[#0f8b73] px-3 font-black text-white disabled:opacity-45">Use</button>
        <button type="button" disabled={reviewDisabled} onClick={() => onReview("reject")} className="h-8 border border-[#c9a978] bg-white px-3 font-black disabled:opacity-45">Reject</button>
      </div>
    </div>
  );
}

function GuidedFieldHelp({ primary, help }: { primary: boolean; help?: string }) {
  return !primary && help ? <p className="mt-1.5 text-[10px] leading-4 text-[#777f7a]">{help}</p> : null;
}

function guidedFieldSpanClass(question: AssessmentInterviewQuestion, primary: boolean) {
  return question.span === "full" || primary || question.control === "multi_select" ? "sm:col-span-2" : "";
}

function guidedFieldStatus(value: AssessmentToolData[AssessmentToolFieldKey], required: boolean) {
  if (hasAssessmentInterviewValue(value)) return { label: "Answered", className: "text-[#0f7664]" };
  if (required) return { label: "Required", className: "text-[#97621b]" };
  return { label: "Optional", className: "text-[#a0a5a2]" };
}

type GuidedAssessmentControlProps = {
  id: string;
  question: AssessmentInterviewQuestion;
  definition: AssessmentToolFieldDefinition;
  value: AssessmentToolData[AssessmentToolFieldKey];
  unableReason: string;
  prominent: boolean;
  disabled: boolean;
  onChange: (value: AssessmentToolData[AssessmentToolFieldKey]) => void;
  onUnableReasonChange: (reason: string) => void;
};

function GuidedAssessmentControl(props: GuidedAssessmentControlProps) {
  switch (props.question.control) {
    case "yes_no":
      return <GuidedYesNoControl {...props} />;
    case "select":
      return <GuidedSelectControl {...props} />;
    case "multi_select":
      return <GuidedMultiSelectControl {...props} />;
    case "rating":
      return <GuidedRatingControl {...props} />;
    case "textarea":
      return <GuidedTextareaControl {...props} />;
    default:
      return <GuidedTextInputControl {...props} />;
  }
}

function GuidedYesNoControl({ id, question, definition, value, unableReason, prominent, disabled, onChange, onUnableReasonChange }: GuidedAssessmentControlProps) {
  return (
    <>
      <OptionButtons
        id={id}
        label={definition.label}
        options={question.options ?? []}
        value={stringValue(value)}
        disabled={disabled}
        prominent={prominent}
        onChange={(next) => applyGuidedYesNoChange(next, value, onChange, onUnableReasonChange)}
      />
      {value === "unable_to_assess" ? (
        <div className="mt-3 border-l-2 border-[#c98b31] bg-[#fff9ec] px-3 py-3">
          <label htmlFor={`${id}-reason`} className="text-[11px] font-black text-[#694716]">Why could this not be assessed?</label>
          <textarea id={`${id}-reason`} value={unableReason} disabled={disabled} rows={3} maxLength={2000} onChange={(event) => onUnableReasonChange(event.target.value)} className="mt-2 w-full resize-y rounded-[6px] border border-[#d4bb90] bg-white px-3 py-2 text-[12px] leading-5 outline-none focus:border-[#9b691f] disabled:bg-[#f1f3f2]" />
        </div>
      ) : null}
    </>
  );
}

function GuidedSelectControl({ id, question, definition, value, prominent, disabled, onChange }: GuidedAssessmentControlProps) {
  const options = withCurrentOption(question.options ?? [], value);
  return <OptionButtons id={id} label={definition.label} options={options} value={stringValue(value)} disabled={disabled} prominent={prominent} columns={options.length > 5 ? 2 : 1} onChange={onChange} />;
}

function GuidedMultiSelectControl({ id, question, definition, value, disabled, onChange }: GuidedAssessmentControlProps) {
  const selected = Array.isArray(value) ? value : [];
  const options = withCurrentOptions(question.options ?? [], selected);
  return (
    <div id={id} role="group" aria-label={definition.label} className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <label key={option.value} className={`flex min-h-12 items-center gap-3 rounded-[6px] border px-3 py-2.5 text-[12px] font-bold transition-colors ${active ? "border-[#0f8b73] bg-[#eef8f4] text-[#0f6f5e]" : "border-[#d8ddda] bg-white text-[#3f4541] hover:border-[#aab5af]"} ${disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}>
            <input type="checkbox" checked={active} disabled={disabled} onChange={() => onChange(toggleSelectedOption(selected, option.value))} className="h-4 w-4 accent-[#0f8b73]" />
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

function GuidedRatingControl({ id, question, definition, value, disabled, onChange }: GuidedAssessmentControlProps) {
  const minimum = question.min ?? 1;
  const maximum = question.max ?? 5;
  const ratings = Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index);
  return (
    <div id={id} role="group" aria-label={`${definition.label}, ${minimum} through ${maximum}`} className="grid grid-cols-5 gap-2">
      {ratings.map((rating) => <button key={rating} type="button" disabled={disabled} aria-pressed={value === rating} onClick={() => onChange(rating)} className={`h-12 rounded-[6px] border text-[13px] font-black ${value === rating ? "border-[#0f8b73] bg-[#eef8f4] text-[#0f6f5e]" : "border-[#d8ddda] bg-white text-[#525a55] hover:border-[#9eaaa4]"} disabled:opacity-55`}>{rating}</button>)}
    </div>
  );
}

function GuidedTextareaControl({ id, question, definition, value, prominent, disabled, onChange }: GuidedAssessmentControlProps) {
  if (definition.value_type === "string_list") {
    return <StringListTextarea id={id} value={Array.isArray(value) ? value : []} disabled={disabled} placeholder={question.placeholder ?? "One item per line"} onChange={onChange} />;
  }
  return <textarea id={id} value={stringValue(value)} disabled={disabled} rows={prominent ? 6 : 4} maxLength={20_000} placeholder={question.placeholder ?? "Enter assessment detail"} onChange={(event) => onChange(event.target.value || null)} className="w-full resize-y rounded-[6px] border border-[#d4d9d6] bg-white px-4 py-3 text-[13px] leading-5 outline-none transition-colors placeholder:text-[#9da39f] hover:border-[#aab3ae] focus:border-[#0f8b73] disabled:bg-[#f1f3f2]" />;
}

function GuidedTextInputControl({ id, question, definition, value, disabled, onChange }: GuidedAssessmentControlProps) {
  const numeric = isNumericDefinition(definition);
  return (
    <input
      id={id}
      type={guidedInputType(question.control)}
      value={fieldStringValue(value)}
      disabled={disabled}
      min={question.min ?? (numeric ? 0 : undefined)}
      max={question.max ?? (definition.value_type === "confidence" ? 1 : undefined)}
      step={guidedInputStep(definition)}
      placeholder={question.placeholder}
      onChange={(event) => onChange(guidedInputValue(event.target.value, numeric))}
      className="h-12 w-full rounded-[6px] border border-[#d4d9d6] bg-white px-4 text-[13px] font-semibold outline-none transition-colors placeholder:font-normal placeholder:text-[#9da39f] hover:border-[#aab3ae] focus:border-[#0f8b73] disabled:bg-[#f1f3f2]"
    />
  );
}

function applyGuidedYesNoChange(next: string, current: AssessmentToolData[AssessmentToolFieldKey], onChange: GuidedAssessmentControlProps["onChange"], onUnableReasonChange: GuidedAssessmentControlProps["onUnableReasonChange"]) {
  if (next !== "unable_to_assess" && current === "unable_to_assess") onUnableReasonChange("");
  onChange(next);
}

function toggleSelectedOption(selected: readonly string[], option: string) {
  return selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option];
}

function stringValue(value: AssessmentToolData[AssessmentToolFieldKey]) {
  return typeof value === "string" ? value : "";
}

function isNumericDefinition(definition: AssessmentToolFieldDefinition) {
  return definition.value_type === "integer" || definition.value_type === "confidence";
}

function guidedInputType(control: AssessmentInterviewQuestion["control"]) {
  if (control === "date") return "date";
  if (control === "number") return "number";
  return "text";
}

function guidedInputStep(definition: AssessmentToolFieldDefinition) {
  if (definition.value_type === "confidence") return 0.01;
  if (definition.value_type === "integer") return 1;
  return undefined;
}

function guidedInputValue(value: string, numeric: boolean) {
  if (!value) return null;
  return numeric ? Number(value) : value;
}

function OptionButtons({ id, label, options, value, disabled, prominent, columns = 1, onChange }: {
  id: string;
  label: string;
  options: readonly AssessmentQuestionOption[];
  value: string;
  disabled: boolean;
  prominent: boolean;
  columns?: 1 | 2;
  onChange: (value: string) => void;
}) {
  return (
    <div id={id} role="group" aria-label={label} className={`grid gap-2 ${columns === 2 ? "sm:grid-cols-2" : ""}`}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`flex items-center justify-between gap-4 rounded-[6px] border px-4 text-left font-bold transition-colors ${prominent ? "min-h-14 text-[13px]" : "min-h-11 text-[12px]"} ${active ? "border-[#0f8b73] bg-[#eef8f4] text-[#0f6f5e]" : "border-[#d8ddda] bg-white text-[#3f4541] hover:border-[#aab5af]"} disabled:cursor-not-allowed disabled:opacity-55`}
          >
            <span>{option.label}</span>
            {active ? <Check size={16} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function StringListTextarea({ id, value, disabled, placeholder, onChange }: {
  id: string;
  value: readonly string[];
  disabled: boolean;
  placeholder: string;
  onChange: (value: AssessmentToolData[AssessmentToolFieldKey]) => void;
}) {
  const [text, setText] = useState(() => value.join("\n"));

  return (
    <textarea
      id={id}
      value={text}
      disabled={disabled}
      rows={5}
      placeholder={placeholder}
      onBlur={() => setText(valueFromLines(text).join("\n"))}
      onChange={(event) => {
        setText(event.target.value);
        onChange(valueFromLines(event.target.value));
      }}
      className="w-full resize-y rounded-[6px] border border-[#d4d9d6] bg-white px-4 py-3 text-[13px] leading-5 outline-none transition-colors placeholder:text-[#9da39f] hover:border-[#aab3ae] focus:border-[#0f8b73] disabled:bg-[#f1f3f2]"
    />
  );
}

function buildGuidedAssessmentScreens() {
  const screens: GuidedAssessmentScreen[] = [];
  let current: { section: AssessmentToolSection; group: string; questions: AssessmentInterviewQuestion[]; weight: number } | null = null;

  const orderedQuestions = assessmentInterviewSections.flatMap((section) => (
    assessmentInterviewQuestions.filter((question) => definitionByField.get(question.field)?.section === section.key)
  ));
  for (const question of orderedQuestions) {
    const section = definitionByField.get(question.field)?.section;
    if (!section) continue;
    const weight = guidedQuestionWeight(question);
    if (!current || current.section !== section || current.weight + weight > 6) {
      if (current) screens.push(finalizeScreen(current, screens.length));
      current = { section, group: question.group, questions: [question], weight };
    } else {
      current.questions.push(question);
      current.weight += weight;
    }
  }
  if (current) screens.push(finalizeScreen(current, screens.length));
  return screens;
}

function finalizeScreen(screen: { section: AssessmentToolSection; group: string; questions: AssessmentInterviewQuestion[] }, index: number): GuidedAssessmentScreen {
  return {
    id: `${screen.section}-${screen.group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index}`,
    section: screen.section,
    group: screen.group,
    questions: screen.questions,
  };
}

function guidedQuestionWeight(question: AssessmentInterviewQuestion) {
  if (question.control === "textarea" || question.control === "multi_select") return 2;
  if ((question.options?.length ?? 0) > 5) return 2;
  return 1;
}

function initialScreenIndex(screens: readonly GuidedAssessmentScreen[], section: AssessmentToolSection, data: AssessmentToolData) {
  const unansweredInSection = screens.findIndex((screen) => screen.section === section && screen.questions.some((question) => (
    isAssessmentQuestionVisible(question, data) && !hasAssessmentInterviewValue(data[question.field])
  )));
  if (unansweredInSection >= 0) return unansweredInSection;
  const firstInSection = screens.findIndex((screen) => screen.section === section);
  if (firstInSection >= 0) return firstInSection;
  const firstUnanswered = screens.findIndex((screen) => screen.questions.some((question) => !hasAssessmentInterviewValue(data[question.field])));
  return Math.max(firstUnanswered, 0);
}

function screenTitle(screen: GuidedAssessmentScreen, visibleQuestions: readonly AssessmentInterviewQuestion[]) {
  if (visibleQuestions.length === 1) return questionPrompt(visibleQuestions[0]);
  const groups = new Set(visibleQuestions.map((question) => question.group));
  return groups.size === 1 ? visibleQuestions[0].group : sectionByKey.get(screen.section)?.label ?? screen.group;
}

function questionPrompt(question: AssessmentInterviewQuestion) {
  const label = assessmentInterviewFieldLabel(question.field);
  if (question.control === "yes_no") return `${label}?`;
  if (question.control === "multi_select") return `Select all ${label.toLowerCase()} that apply`;
  return label;
}

function withCurrentOption(options: readonly AssessmentQuestionOption[], value: AssessmentToolData[AssessmentToolFieldKey]) {
  if (typeof value !== "string" || !value || options.some((option) => option.value === value)) return options;
  return [...options, { value, label: value }];
}

function withCurrentOptions(options: readonly AssessmentQuestionOption[], values: readonly string[]) {
  const extras = values.filter((value) => !options.some((option) => option.value === value)).map((value) => ({ value, label: value }));
  return [...options, ...extras];
}

function fieldStringValue(value: AssessmentToolData[AssessmentToolFieldKey]) {
  if (Array.isArray(value)) return value.join("\n");
  if (value === null || typeof value === "object") return "";
  return String(value);
}

function valueFromLines(value: string) {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function saveToneClass(tone: GuidedAssessmentInterviewProps["saveTone"]) {
  if (tone === "error") return "text-[#9d382b]";
  if (tone === "pending") return "text-[#8b5c18]";
  return "text-[#747b77]";
}
