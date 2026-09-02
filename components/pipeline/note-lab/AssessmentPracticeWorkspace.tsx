"use client";

import { Check, ChevronDown, ChevronLeft, ChevronRight, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getAssessmentFieldWritingSpec } from "@/lib/assessment/assessment-field-writing-spec";
import { getAssessmentNarrativeGuide } from "@/lib/assessment/assessment-narrative-guide";
import {
  assessmentInterviewFieldLabel,
  assessmentInterviewSections,
  getAssessmentInterviewCoverage,
  getAssessmentInterviewQuestions,
  getAssessmentUnableReason,
  getRequiredAssessmentInterviewQuestions,
  hasAssessmentInterviewValue,
  setAssessmentUnableReason,
  type AssessmentInterviewQuestion,
} from "@/lib/assessment/assessment-interview-schema";
import {
  type AssessmentToolData,
  type AssessmentToolFieldKey,
  type AssessmentToolSection,
} from "@/lib/assessment/assessment-tool-schema";
import { createAssessmentPracticeData } from "@/lib/note-lab/assessment-practice-scenario";

const assessmentPracticeNavigationGroups: ReadonlyArray<{
  label: string;
  sections: readonly AssessmentToolSection[];
}> = [
  { label: "Intake", sections: ["identity", "prior_placement", "prior_history"] },
  { label: "Clinical interview", sections: ["diagnosis_clinical", "functional_adl", "medication", "substance_use"] },
  { label: "Safety and care", sections: ["behavioral_risk", "physical_health", "legal_conservatorship"] },
  { label: "Plan and review", sections: ["social_support", "provenance_qc"] },
];

type PracticeQuestionStep = {
  section: AssessmentToolSection;
  question: AssessmentInterviewQuestion;
};

export default function AssessmentPracticeWorkspace({ traineeName }: { traineeName: string }) {
  const [data, setData] = useState(createAssessmentPracticeData);
  const [activeSection, setActiveSection] = useState<AssessmentToolSection>(assessmentInterviewSections[0].key);
  const [guidedField, setGuidedField] = useState<AssessmentToolFieldKey | null>(null);
  const coverage = getAssessmentInterviewCoverage(data);
  const currentIndex = assessmentInterviewSections.findIndex((section) => section.key === activeSection);
  const section = assessmentInterviewSections[currentIndex] ?? assessmentInterviewSections[0];
  const questions = getAssessmentInterviewQuestions(section.key, data);
  const capturedHere = questions.filter((question) => hasAssessmentInterviewValue(data[question.field])).length;
  const requiredFields = useMemo(
    () => new Set(getRequiredAssessmentInterviewQuestions(data).map((question) => question.field)),
    [data],
  );
  const guidedQuestionSteps: readonly PracticeQuestionStep[] = useMemo(
    () => assessmentInterviewSections.flatMap((item) =>
      getAssessmentInterviewQuestions(item.key, data)
        .filter(hasUsefulWritingGuidance)
        .map((question) => ({ section: item.key, question }))),
    [data],
  );
  const firstGuidedStepInSection = guidedQuestionSteps.find((step) => step.section === section.key) ?? null;

  useEffect(() => {
    if (!guidedField) return;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-practice-field="${guidedField}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSection, guidedField]);

  const update = (field: AssessmentToolFieldKey, value: AssessmentToolData[AssessmentToolFieldKey]) => {
    setData((current) => ({ ...current, [field]: value }) as AssessmentToolData);
  };

  const reset = () => {
    setData(createAssessmentPracticeData());
    setActiveSection(assessmentInterviewSections[0].key);
    setGuidedField(null);
    document.querySelector<HTMLElement>("[data-assessment-practice-scroll]")?.scrollTo({ top: 0 });
  };

  const chooseSection = (sectionKey: AssessmentToolSection) => {
    setActiveSection(sectionKey);
    setGuidedField(null);
    document.querySelector<HTMLElement>("[data-assessment-practice-scroll]")?.scrollTo({ top: 0 });
  };

  const startSectionWalkthrough = () => {
    if (!firstGuidedStepInSection) return;
    setGuidedField(firstGuidedStepInSection.question.field);
  };

  const moveGuidedQuestion = (field: AssessmentToolFieldKey) => {
    const currentStep = guidedQuestionSteps.find((step) => step.question.field === field);
    if (!currentStep) {
      setGuidedField(null);
      return;
    }
    const sectionSteps = guidedQuestionSteps.filter((step) => step.section === currentStep.section);
    const index = sectionSteps.findIndex((step) => step.question.field === field);
    const next = sectionSteps[index + 1];
    if (!next) {
      setGuidedField(null);
      return;
    }
    setGuidedField(next.question.field);
  };

  const moveSection = (offset: number) => {
    const nextIndex = Math.min(assessmentInterviewSections.length - 1, Math.max(0, currentIndex + offset));
    chooseSection(assessmentInterviewSections[nextIndex].key);
  };

  return (
    <div aria-label={`${traineeName} practice assessment`} className="pipeline-route-enter flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-[#cfd8d4] bg-white px-4 py-2 sm:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[17px] font-black text-[#202522]">Jordan Practice</h1>
            <span className="bg-[#e7f3ee] px-2 py-1 text-[9px] font-black uppercase text-[#0f6f5d]">Practice</span>
          </div>
          <p className="mt-0.5 text-[10px] text-[#737b77]">Synthetic record - not saved</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={reset} className="inline-flex h-9 items-center gap-2 border border-[#c9ceca] bg-white px-3 text-[10px] font-black text-[#4d5652] outline-none hover:border-[#0f8b73] hover:text-[#0f8b73] focus-visible:ring-2 focus-visible:ring-[#0f8b73]">
            <RotateCcw size={13} aria-hidden="true" />Reset
          </button>
          <button
            type="button"
            onClick={startSectionWalkthrough}
            disabled={!firstGuidedStepInSection}
            aria-label={`Begin walkthrough for ${section.label}`}
            title={firstGuidedStepInSection ? `Begin the ${section.label} walkthrough` : `No guided narrative fields in ${section.label}`}
            className="inline-flex h-9 items-center gap-2 bg-[#0f8b73] px-3 text-[10px] font-black text-white outline-none hover:bg-[#0c705f] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[#d9dfdb] disabled:text-[#737b77]"
          >
            <Sparkles size={13} aria-hidden="true" />Begin walkthrough
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 bg-white lg:grid lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside aria-label="Assessment section navigation" className="hidden min-h-0 overflow-y-auto border-r border-[#d9dfdb] bg-[#f8faf9] px-3 py-4 lg:block">
          <div className="mb-5 px-2">
            <div className="flex items-end justify-between">
              <span className="text-[10px] font-black uppercase text-[#666666]">Captured</span>
              <strong className="text-[15px]">{coverage.captured}/{coverage.total}</strong>
            </div>
            <div className="mt-2 h-1.5 bg-[#dfe5e1]"><div className="h-full bg-[#0f8b73]" style={{ width: `${coverage.percent}%` }} /></div>
          </div>
          <nav aria-label="Practice assessment sections" className="space-y-5">
            {assessmentPracticeNavigationGroups.map((group) => (
              <div key={group.label}>
                <div className="px-2 text-[9px] font-black uppercase tracking-[0.08em] text-[#8a8a8a]">{group.label}</div>
                <div className="mt-1 space-y-0.5">
                  {group.sections.map((sectionKey) => {
                    const item = assessmentInterviewSections.find((candidate) => candidate.key === sectionKey);
                    if (!item) return null;
                    const sectionQuestions = getAssessmentInterviewQuestions(item.key, data);
                    const captured = sectionQuestions.filter((question) => hasAssessmentInterviewValue(data[question.field])).length;
                    const active = item.key === section.key;
                    return (
                      <button key={item.key} type="button" onClick={() => chooseSection(item.key)} aria-current={active ? "step" : undefined} className={`flex w-full min-w-0 items-center justify-between gap-2 border-l-2 px-3 py-2.5 text-left text-[11px] font-black outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73] ${active ? "border-[#0f8b73] bg-[#e7f3ee] text-[#0f6f5d]" : "border-transparent text-[#595959] hover:bg-white hover:text-[#0f8b73]"}`}>
                        <span className="truncate">{item.label}</span>
                        <span className="shrink-0 text-[9px] font-semibold opacity-65">{captured}/{sectionQuestions.length}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <main data-assessment-practice-scroll className="min-h-0 overflow-y-auto bg-white">
          <div className="border-b border-[#d9dfdb] px-4 py-3 lg:hidden">
            <label htmlFor="practice-section" className="mb-1 block text-[9px] font-black uppercase text-[#737373]">Assessment section</label>
            <div className="relative">
              <select id="practice-section" value={section.key} onChange={(event) => chooseSection(event.target.value as AssessmentToolSection)} className="h-11 w-full appearance-none border border-[#c9ceca] bg-white px-3 pr-10 text-[12px] font-black outline-none focus:border-[#0f8b73]">
                {assessmentPracticeNavigationGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.sections.map((sectionKey) => {
                      const item = assessmentInterviewSections.find((candidate) => candidate.key === sectionKey);
                      return item ? <option key={item.key} value={item.key}>{item.label}</option> : null;
                    })}
                  </optgroup>
                ))}
              </select>
              <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#737373]" />
            </div>
          </div>

          <div className="w-full px-5 py-6 sm:px-8 lg:px-10">
            <div className="mb-7 flex items-start justify-between gap-4 border-b border-[#d9dfdb] pb-5">
              <div>
                <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">Section {currentIndex + 1} of {assessmentInterviewSections.length}</div>
                <h2 className="mt-1 text-[22px] font-black text-[#202522]">{section.label}</h2>
              </div>
              <div className="text-right">
                <div className="text-[18px] font-black">{capturedHere}/{questions.length}</div>
                <div className="text-[9px] font-black uppercase text-[#8a8a8a]">captured here</div>
              </div>
            </div>

            <PracticeQuestions
              questions={questions}
              data={data}
              requiredFields={requiredFields}
              guidedField={guidedField}
              onNextQuestion={moveGuidedQuestion}
              onUpdate={update}
            />

            <footer className="mt-7 flex items-center justify-between gap-3">
              <button type="button" disabled={currentIndex === 0} onClick={() => moveSection(-1)} className="flex h-10 items-center gap-2 border border-[#c9ceca] px-4 text-[11px] font-black text-[#4d5652] hover:border-[#0f8b73] hover:text-[#0f8b73] disabled:opacity-35"><ChevronLeft size={14} />Previous section</button>
              <button type="button" disabled={currentIndex === assessmentInterviewSections.length - 1} onClick={() => moveSection(1)} className="flex h-10 items-center gap-2 bg-[#111111] px-4 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:opacity-35">Next section<ChevronRight size={14} /></button>
            </footer>
          </div>
        </main>
      </div>

    </div>
  );
}

function PracticeQuestions({
  questions,
  data,
  requiredFields,
  guidedField,
  onNextQuestion,
  onUpdate,
}: {
  questions: readonly AssessmentInterviewQuestion[];
  data: AssessmentToolData;
  requiredFields: ReadonlySet<AssessmentToolFieldKey>;
  guidedField: AssessmentToolFieldKey | null;
  onNextQuestion: (field: AssessmentToolFieldKey) => void;
  onUpdate: (field: AssessmentToolFieldKey, value: AssessmentToolData[AssessmentToolFieldKey]) => void;
}) {
  const groups = [...new Set(questions.map((question) => question.group))];
  const guidedQuestions = questions.filter(hasUsefulWritingGuidance);
  return (
    <div className="divide-y divide-[#e1e4e2] border-y border-[#e1e4e2]">
      {groups.map((group) => (
        <section key={group} className="grid gap-4 py-5 lg:grid-cols-[190px_minmax(0,1fr)]">
          <h3 className="text-[11px] font-black text-[#333333]">{group}</h3>
          <div className="grid gap-x-5 gap-y-4 md:grid-cols-2">
            {questions.filter((question) => question.group === group).map((question) => (
              <PracticeField
                key={question.field}
                question={question}
                value={data[question.field]}
                unableReason={getAssessmentUnableReason(data, question.field)}
                required={requiredFields.has(question.field)}
                guided={question.field === guidedField}
                lastGuidedField={guidedQuestions.at(-1)?.field === question.field}
                onNextQuestion={() => onNextQuestion(question.field)}
                onUnableReasonChange={(reason) => onUpdate("unable_to_assess_reasons", setAssessmentUnableReason(data.unable_to_assess_reasons, question.field, reason))}
                onUpdate={(value) => onUpdate(question.field, value)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PracticeField({
  question,
  value,
  unableReason,
  required,
  guided,
  lastGuidedField,
  onNextQuestion,
  onUnableReasonChange,
  onUpdate,
}: {
  question: AssessmentInterviewQuestion;
  value: AssessmentToolData[AssessmentToolFieldKey];
  unableReason: string;
  required: boolean;
  guided: boolean;
  lastGuidedField: boolean;
  onNextQuestion: () => void;
  onUnableReasonChange: (reason: string) => void;
  onUpdate: (value: AssessmentToolData[AssessmentToolFieldKey]) => void;
}) {
  const id = `practice-${question.field}`;
  const label = assessmentInterviewFieldLabel(question.field);
  const fullWidth = question.span === "full" || question.control === "multi_select";
  return (
    <div data-practice-field={question.field} className={`relative scroll-mt-8 ${fullWidth ? "md:col-span-2" : ""}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[11px] font-black text-[#444444]">{label}{required ? " *" : ""}</label>
        <div className="flex shrink-0 items-center gap-2">
          {hasAssessmentInterviewValue(value) ? <Check size={12} className="text-[#0f8b73]" aria-label="Captured" /> : required ? <span className="text-[9px] font-semibold uppercase text-[#9a6115]">Required</span> : <span className="text-[9px] font-semibold uppercase text-[#999999]">Optional</span>}
        </div>
      </div>
      <PracticeControl question={question} value={value} unableReason={unableReason} onUnableReasonChange={onUnableReasonChange} onUpdate={onUpdate} />
      {question.help ? <p className="mt-1.5 text-[10px] leading-4 text-[#737373]">{question.help}</p> : null}
      {guided ? <PracticeQuestionTooltip question={question} lastGuidedField={lastGuidedField} onNext={onNextQuestion} /> : null}
    </div>
  );
}

function PracticeQuestionTooltip({ question, lastGuidedField, onNext }: {
  question: AssessmentInterviewQuestion;
  lastGuidedField: boolean;
  onNext: () => void;
}) {
  const specification = getAssessmentFieldWritingSpec(question.field);
  const narrativeGuide = getAssessmentNarrativeGuide(question.field);
  if (!specification || !narrativeGuide) return null;
  const label = assessmentInterviewFieldLabel(question.field);
  return (
    <aside role="dialog" aria-label={`Guided step for ${label}`} className="relative z-10 mt-4 border border-[#84b9aa] bg-white p-4 shadow-[0_12px_28px_rgba(28,52,45,0.16)]">
      <span className="absolute -top-2 left-6 h-4 w-4 rotate-45 border-l border-t border-[#84b9aa] bg-white" aria-hidden="true" />
      <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#0f6f5d]">{label}</div>
      <p className="mt-1.5 text-[12px] leading-5 text-[#4f5954]">{narrativeGuide.purpose}</p>
      <div className="mt-3 grid gap-3 border-t border-[#e1e4e2] pt-3 lg:grid-cols-2">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#6b746f]">Use this order</div>
          <p className="mt-1 text-[11px] font-semibold leading-5 text-[#303a36]">{specification.formatTemplate}</p>
        </div>
        <div className="border-l-2 border-[#0f8b73] pl-3">
          <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#6b746f]">Example</div>
          <p className="mt-1 text-[11px] leading-5 text-[#303a36]">{specification.strongExample}</p>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={onNext} className="inline-flex h-9 items-center gap-2 bg-[#111111] px-4 text-[10px] font-black text-white hover:bg-[#0f8b73] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2">
          {lastGuidedField ? "Finish walkthrough" : "Next field"} <ChevronRight size={13} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}

function hasUsefulWritingGuidance(question: AssessmentInterviewQuestion) {
  return question.control === "textarea" && Boolean(getAssessmentFieldWritingSpec(question.field));
}

type PracticeControlProps = {
  question: AssessmentInterviewQuestion;
  value: AssessmentToolData[AssessmentToolFieldKey];
  unableReason: string;
  onUnableReasonChange: (reason: string) => void;
  onUpdate: (value: AssessmentToolData[AssessmentToolFieldKey]) => void;
};

function PracticeControl({ question, value, unableReason, onUnableReasonChange, onUpdate }: PracticeControlProps) {
  if (question.control === "yes_no") return <PracticeYesNo {...{ question, value, unableReason, onUnableReasonChange, onUpdate }} />;
  if (question.control === "rating") return <PracticeRating {...{ question, value, onUpdate }} />;
  if (question.control === "select") return <PracticeSelect {...{ question, value, onUpdate }} />;
  if (question.control === "multi_select") return <PracticeMultiSelect {...{ question, value, onUpdate }} />;
  if (question.control === "textarea") return <PracticeTextarea {...{ question, value, onUpdate }} />;
  return <PracticeInput {...{ question, value, onUpdate }} />;
}

type SimplePracticeControlProps = Pick<PracticeControlProps, "question" | "value" | "onUpdate">;

function PracticeYesNo({ question, value, unableReason, onUnableReasonChange, onUpdate }: PracticeControlProps) {
  const id = `practice-${question.field}`;
  return (
    <>
      <div id={id} className="grid min-h-10 grid-cols-[0.7fr_0.7fr_1.35fr]" role="group" aria-label={assessmentInterviewFieldLabel(question.field)}>
        {(question.options ?? []).map((option) => {
          const active = value === option.value;
          return <button key={option.value} type="button" aria-pressed={active} onClick={() => { if (option.value !== "unable_to_assess" && value === "unable_to_assess") onUnableReasonChange(""); onUpdate(option.value); }} className={`border border-r-0 px-2 py-2 text-[10px] font-black leading-4 last:border-r ${active ? "border-[#0f8b73] bg-[#e7f3ee] text-[#0f6f5d]" : "border-[#c9ceca] bg-white text-[#737373] hover:bg-[#f4f7f5]"}`}>{option.label}</button>;
        })}
      </div>
      {value === "unable_to_assess" ? (
        <div className="mt-2 border-l-2 border-[#c9892a] bg-[#fffaf0] px-3 py-2.5">
          <label htmlFor={`${id}-unable-reason`} className="text-[10px] font-black text-[#70480d]">Reason *</label>
          <textarea id={`${id}-unable-reason`} value={unableReason} rows={3} maxLength={2000} onChange={(event) => onUnableReasonChange(event.target.value)} className="mt-1.5 w-full resize-y border border-[#d7bd8e] bg-white px-3 py-2 text-[11px] leading-5 outline-none focus:border-[#9a6115]" />
        </div>
      ) : null}
    </>
  );
}

function PracticeRating({ question, value, onUpdate }: SimplePracticeControlProps) {
  const id = `practice-${question.field}`;
  return <div id={id} className="grid h-10 grid-cols-5" role="group" aria-label={`${assessmentInterviewFieldLabel(question.field)}, 1 through 5`}>{[1, 2, 3, 4, 5].map((rating) => <button key={rating} type="button" aria-pressed={value === rating} onClick={() => onUpdate(rating)} className={`border border-r-0 text-[11px] font-black last:border-r ${value === rating ? "border-[#0f8b73] bg-[#e7f3ee] text-[#0f6f5d]" : "border-[#c9ceca] bg-white text-[#737373] hover:bg-[#f4f7f5]"}`}>{rating}</button>)}</div>;
}

function PracticeSelect({ question, value, onUpdate }: SimplePracticeControlProps) {
  const id = `practice-${question.field}`;
  const stringValue = value === null ? "" : String(value);
  return (
    <div className="relative">
      <select id={id} value={stringValue} onChange={(event) => onUpdate(event.target.value || null)} className="h-10 w-full appearance-none border border-[#c9ceca] bg-white px-3 pr-9 text-[12px] outline-none hover:border-[#8ca59c] focus:border-[#0f8b73]">
        <option value="">Select...</option>
        {(question.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#737373]" />
    </div>
  );
}

function PracticeMultiSelect({ question, value, onUpdate }: SimplePracticeControlProps) {
  const id = `practice-${question.field}`;
  const selected = Array.isArray(value) ? value : [];
  return (
    <div id={id} className="grid gap-px border border-[#c9ceca] bg-[#d9dfdb] sm:grid-cols-2 lg:grid-cols-3" role="group" aria-label={assessmentInterviewFieldLabel(question.field)}>
      {(question.options ?? []).map((option) => {
        const active = selected.includes(option.value);
        return <label key={option.value} className="flex min-h-10 cursor-pointer items-center gap-2 bg-white px-3 text-[11px] font-semibold hover:bg-[#f4f7f5]"><input type="checkbox" checked={active} onChange={() => onUpdate(active ? selected.filter((item) => item !== option.value) : [...selected, option.value])} className="h-4 w-4 accent-[#0f8b73]" /><span>{option.label}</span></label>;
      })}
    </div>
  );
}

function PracticeTextarea({ question, value, onUpdate }: SimplePracticeControlProps) {
  const listValue = Array.isArray(value);
  const stringValue = listValue ? value.join("\n") : value === null ? "" : String(value);
  return <textarea id={`practice-${question.field}`} value={stringValue} rows={listValue ? 3 : 4} onChange={(event) => onUpdate(listValue ? event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) : event.target.value || null)} placeholder={question.placeholder ?? (listValue ? "One item per line" : "Enter assessment detail")} className="w-full resize-y border border-[#c9ceca] bg-white px-3 py-2 text-[12px] leading-5 outline-none placeholder:text-[#a3a3a3] focus:border-[#0f8b73]" />;
}

function PracticeInput({ question, value, onUpdate }: SimplePracticeControlProps) {
  const numeric = question.control === "number";
  return <input id={`practice-${question.field}`} type={question.control === "date" ? "date" : numeric ? "number" : "text"} min={question.min} max={question.max} value={value === null ? "" : String(value)} placeholder={question.placeholder} onChange={(event) => onUpdate(numeric ? event.target.value === "" ? null : Number(event.target.value) : event.target.value || null)} className="h-10 w-full border border-[#c9ceca] bg-white px-3 text-[12px] outline-none placeholder:text-[#a3a3a3] focus:border-[#0f8b73]" />;
}
