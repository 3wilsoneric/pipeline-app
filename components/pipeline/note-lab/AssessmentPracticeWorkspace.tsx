"use client";

import { ChevronDown, ChevronLeft, ChevronRight, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getAssessmentFieldWritingSpec } from "@/lib/assessment/assessment-field-writing-spec";
import {
  assessmentInterviewFieldLabel,
  assessmentInterviewQuestions,
  assessmentInterviewSections,
  getAssessmentInterviewQuestions,
  getAssessmentUnableReason,
  getRequiredAssessmentInterviewQuestions,
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

const firstPracticeField = assessmentInterviewQuestions[0].field;

export default function AssessmentPracticeWorkspace({ traineeName }: { traineeName: string }) {
  const [data, setData] = useState(createAssessmentPracticeData);
  const [activeSection, setActiveSection] = useState<AssessmentToolSection>(assessmentInterviewSections[0].key);
  const [selectedField, setSelectedField] = useState<AssessmentToolFieldKey>(firstPracticeField);
  const [guidanceField, setGuidanceField] = useState<AssessmentToolFieldKey | null>(null);
  const [guidedField, setGuidedField] = useState<AssessmentToolFieldKey | null>(null);
  const currentIndex = assessmentInterviewSections.findIndex((section) => section.key === activeSection);
  const section = assessmentInterviewSections[currentIndex] ?? assessmentInterviewSections[0];
  const questions = getAssessmentInterviewQuestions(section.key, data);
  const requiredFields = useMemo(
    () => new Set(getRequiredAssessmentInterviewQuestions(data).map((question) => question.field)),
    [data],
  );
  const visibleQuestionSteps: readonly PracticeQuestionStep[] = useMemo(
    () => assessmentInterviewSections.flatMap((item) =>
      getAssessmentInterviewQuestions(item.key, data).map((question) => ({ section: item.key, question }))),
    [data],
  );
  const selectedQuestionIndex = Math.max(
    0,
    visibleQuestionSteps.findIndex((step) => step.question.field === selectedField),
  );
  const guidanceQuestion = guidanceField
    ? visibleQuestionSteps.find((step) => step.question.field === guidanceField)?.question ?? null
    : null;

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
    setSelectedField(firstPracticeField);
    setGuidanceField(null);
    setGuidedField(null);
    document.querySelector<HTMLElement>("[data-assessment-practice-scroll]")?.scrollTo({ top: 0 });
  };

  const chooseSection = (sectionKey: AssessmentToolSection) => {
    const nextQuestions = getAssessmentInterviewQuestions(sectionKey, data);
    setActiveSection(sectionKey);
    setSelectedField(nextQuestions[0]?.field ?? firstPracticeField);
    setGuidanceField(null);
    setGuidedField(null);
    document.querySelector<HTMLElement>("[data-assessment-practice-scroll]")?.scrollTo({ top: 0 });
  };

  const openQuestion = (field: AssessmentToolFieldKey) => {
    const step = visibleQuestionSteps.find((candidate) => candidate.question.field === field);
    if (!step) return;
    setActiveSection(step.section);
    setSelectedField(field);
    setGuidedField(null);
    setGuidanceField(field);
  };

  const startQuestion = () => {
    if (!guidanceField) return;
    setSelectedField(guidanceField);
    setGuidedField(guidanceField);
    setGuidanceField(null);
  };

  const moveQuestion = (field: AssessmentToolFieldKey) => {
    const index = visibleQuestionSteps.findIndex((step) => step.question.field === field);
    const next = visibleQuestionSteps[index + 1];
    if (!next) {
      setGuidedField(null);
      return;
    }
    openQuestion(next.question.field);
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
          <button type="button" onClick={() => openQuestion(firstPracticeField)} className="inline-flex h-9 items-center gap-2 bg-[#0f8b73] px-3 text-[10px] font-black text-white outline-none hover:bg-[#0c705f] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2">
            <Sparkles size={13} aria-hidden="true" />Start walkthrough
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 bg-white lg:grid lg:grid-cols-[270px_minmax(0,1fr)]">
        <aside aria-label="Assessment question navigation" className="hidden min-h-0 overflow-y-auto border-r border-[#d9dfdb] bg-[#f8faf9] px-3 py-4 lg:block">
          <div className="mb-4 px-2">
            <div className="flex items-end justify-between gap-3">
              <span className="text-[10px] font-black uppercase text-[#666666]">Question</span>
              <strong className="text-[13px]">{selectedQuestionIndex + 1} / {visibleQuestionSteps.length}</strong>
            </div>
            <div className="mt-2 h-1.5 bg-[#dfe5e1]">
              <div className="h-full bg-[#0f8b73]" style={{ width: `${((selectedQuestionIndex + 1) / visibleQuestionSteps.length) * 100}%` }} />
            </div>
          </div>

          <div className="border-t border-[#d9dfdb] px-2 pt-4">
            <label htmlFor="practice-section-desktop" className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.08em] text-[#8a8a8a]">Section</label>
            <div className="relative">
              <select id="practice-section-desktop" value={section.key} onChange={(event) => chooseSection(event.target.value as AssessmentToolSection)} className="h-10 w-full appearance-none border border-[#c9ceca] bg-white px-3 pr-9 text-[11px] font-black text-[#3e4743] outline-none focus:border-[#0f8b73]">
                {assessmentPracticeNavigationGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.sections.map((sectionKey) => {
                      const item = assessmentInterviewSections.find((candidate) => candidate.key === sectionKey);
                      return item ? <option key={item.key} value={item.key}>{item.label}</option> : null;
                    })}
                  </optgroup>
                ))}
              </select>
              <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#737373]" />
            </div>
          </div>

          <nav aria-label="Practice assessment questions" className="mt-4 border-t border-[#d9dfdb] pt-4">
            <div className="px-2 text-[9px] font-black uppercase tracking-[0.08em] text-[#8a8a8a]">{section.label} questions</div>
            <div className="mt-2 space-y-1">
              {questions.map((question) => {
                const active = question.field === selectedField;
                return (
                  <button
                    key={question.field}
                    type="button"
                    onClick={() => openQuestion(question.field)}
                    aria-current={active ? "step" : undefined}
                    className={`w-full border px-3 py-2.5 text-left text-[10px] font-bold leading-4 ${active ? "border-[#92c5b7] bg-white text-[#0f6f5d]" : "border-transparent text-[#5f6864] hover:border-[#d9dfdb] hover:bg-white"}`}
                  >
                    {assessmentInterviewFieldLabel(question.field)}
                  </button>
                );
              })}
            </div>
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
                <div className="text-[16px] font-black">{selectedQuestionIndex + 1} / {visibleQuestionSteps.length}</div>
                <div className="text-[9px] font-black uppercase text-[#8a8a8a]">question</div>
              </div>
            </div>

            <PracticeQuestions
              questions={questions}
              data={data}
              requiredFields={requiredFields}
              selectedField={selectedField}
              guidedField={guidedField}
              onOpenGuidance={openQuestion}
              onNextQuestion={moveQuestion}
              onUpdate={update}
            />

            <footer className="mt-7 flex items-center justify-between gap-3">
              <button type="button" disabled={currentIndex === 0} onClick={() => moveSection(-1)} className="flex h-10 items-center gap-2 border border-[#c9ceca] px-4 text-[11px] font-black text-[#4d5652] hover:border-[#0f8b73] hover:text-[#0f8b73] disabled:opacity-35"><ChevronLeft size={14} />Previous section</button>
              <button type="button" disabled={currentIndex === assessmentInterviewSections.length - 1} onClick={() => moveSection(1)} className="flex h-10 items-center gap-2 bg-[#111111] px-4 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:opacity-35">Next section<ChevronRight size={14} /></button>
            </footer>
          </div>
        </main>
      </div>

      {guidanceQuestion ? (
        <QuestionGuidanceDialog
          question={guidanceQuestion}
          onClose={() => setGuidanceField(null)}
          onStart={startQuestion}
        />
      ) : null}
    </div>
  );
}

function PracticeQuestions({
  questions,
  data,
  requiredFields,
  selectedField,
  guidedField,
  onOpenGuidance,
  onNextQuestion,
  onUpdate,
}: {
  questions: readonly AssessmentInterviewQuestion[];
  data: AssessmentToolData;
  requiredFields: ReadonlySet<AssessmentToolFieldKey>;
  selectedField: AssessmentToolFieldKey;
  guidedField: AssessmentToolFieldKey | null;
  onOpenGuidance: (field: AssessmentToolFieldKey) => void;
  onNextQuestion: (field: AssessmentToolFieldKey) => void;
  onUpdate: (field: AssessmentToolFieldKey, value: AssessmentToolData[AssessmentToolFieldKey]) => void;
}) {
  const groups = [...new Set(questions.map((question) => question.group))];
  return (
    <div className="divide-y divide-[#e1e4e2] border-y border-[#e1e4e2]">
      {groups.map((group) => (
        <section key={group} className="grid gap-4 py-5 lg:grid-cols-[190px_minmax(0,1fr)]">
          <h3 className="text-[11px] font-black text-[#333333]">{group}</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {questions.filter((question) => question.group === group).map((question) => (
              <PracticeField
                key={question.field}
                question={question}
                value={data[question.field]}
                unableReason={getAssessmentUnableReason(data, question.field)}
                required={requiredFields.has(question.field)}
                selected={question.field === selectedField}
                guided={question.field === guidedField}
                onOpenGuidance={() => onOpenGuidance(question.field)}
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
  selected,
  guided,
  onOpenGuidance,
  onNextQuestion,
  onUnableReasonChange,
  onUpdate,
}: {
  question: AssessmentInterviewQuestion;
  value: AssessmentToolData[AssessmentToolFieldKey];
  unableReason: string;
  required: boolean;
  selected: boolean;
  guided: boolean;
  onOpenGuidance: () => void;
  onNextQuestion: () => void;
  onUnableReasonChange: (reason: string) => void;
  onUpdate: (value: AssessmentToolData[AssessmentToolFieldKey]) => void;
}) {
  const id = `practice-${question.field}`;
  const label = assessmentInterviewFieldLabel(question.field);
  const fullWidth = question.span === "full" || question.control === "multi_select";
  return (
    <div
      data-practice-field={question.field}
      className={`relative scroll-mt-8 border p-4 ${fullWidth ? "md:col-span-2" : ""} ${selected ? "border-[#92c5b7] bg-[#fbfdfc]" : "border-[#e1e4e2] bg-white"}`}
    >
      <label htmlFor={id} className="sr-only">{label}{required ? " *" : ""}</label>
      <div className="mb-2 flex items-start justify-between gap-3">
        <button type="button" onClick={onOpenGuidance} aria-label={`Open guidance for ${label}`} className="text-left text-[11px] font-black text-[#333333] underline decoration-[#9bc7bb] decoration-1 underline-offset-4 hover:text-[#0f6f5d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73]">
          {label}{required ? " *" : ""}
        </button>
        <span className={`shrink-0 text-[9px] font-semibold uppercase ${required ? "text-[#9a6115]" : "text-[#999999]"}`}>{required ? "Required" : "Optional"}</span>
      </div>
      <PracticeControl question={question} value={value} unableReason={unableReason} onUnableReasonChange={onUnableReasonChange} onUpdate={onUpdate} />
      {question.help ? <p className="mt-1.5 text-[10px] leading-4 text-[#737373]">{question.help}</p> : null}
      {guided ? <PracticeQuestionTooltip question={question} onNext={onNextQuestion} /> : null}
    </div>
  );
}

function PracticeQuestionTooltip({ question, onNext }: { question: AssessmentInterviewQuestion; onNext: () => void }) {
  return (
    <aside role="dialog" aria-label={`Guided step for ${assessmentInterviewFieldLabel(question.field)}`} className="relative z-10 mt-4 border border-[#84b9aa] bg-white p-4 shadow-[0_12px_28px_rgba(28,52,45,0.16)]">
      <span className="absolute -top-2 left-6 h-4 w-4 rotate-45 border-l border-t border-[#84b9aa] bg-white" aria-hidden="true" />
      <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#0f6f5d]">Do this question</div>
      <p className="mt-1.5 text-[12px] font-semibold leading-5 text-[#303a36]">{questionAction(question)}</p>
      <div className="mt-3 flex justify-end">
        <button type="button" onClick={onNext} className="inline-flex h-9 items-center gap-2 bg-[#111111] px-4 text-[10px] font-black text-white hover:bg-[#0f8b73] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2">
          Next question <ChevronRight size={13} aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}

function QuestionGuidanceDialog({ question, onClose, onStart }: {
  question: AssessmentInterviewQuestion;
  onClose: () => void;
  onStart: () => void;
}) {
  const label = assessmentInterviewFieldLabel(question.field);
  const specification = getAssessmentFieldWritingSpec(question.field);
  const fallback = structuredQuestionGuidance(question);
  const steps = specification?.instructionSteps ?? fallback.steps;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#18201d]/45 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="question-guidance-title" className="max-h-[88vh] w-full max-w-[760px] overflow-y-auto border border-[#cfd8d4] bg-white shadow-[0_24px_70px_rgba(13,32,26,0.28)]">
        <header className="flex items-start justify-between gap-4 border-b border-[#d9dfdb] px-6 py-5">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f6f5d]">{question.group}</div>
            <h2 id="question-guidance-title" className="mt-1 text-[22px] font-black text-[#202522]">{label}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close guidance" className="grid h-9 w-9 place-items-center border border-[#d9dfdb] text-[#66706b] hover:border-[#0f8b73] hover:text-[#0f8b73] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73]">
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-6 px-6 py-6">
          <section>
            <h3 className="text-[11px] font-black uppercase tracking-[0.08em] text-[#5d6762]">What to capture</h3>
            <p className="mt-2 text-[14px] leading-6 text-[#303a36]">{specification ? fieldPurpose(question) : fallback.purpose}</p>
          </section>

          <section>
            <h3 className="text-[11px] font-black uppercase tracking-[0.08em] text-[#5d6762]">How to answer</h3>
            <ol className="mt-3 grid gap-2">
              {steps.map((step, index) => (
                <li key={`${step.title}-${index}`} className="grid grid-cols-[24px_minmax(0,1fr)] gap-3 border-t border-[#e1e4e2] pt-3 first:border-t-0 first:pt-0">
                  <span className="grid h-6 w-6 place-items-center bg-[#e7f3ee] text-[10px] font-black text-[#0f6f5d]">{index + 1}</span>
                  <div>
                    <div className="text-[12px] font-black text-[#303a36]">{step.title}</div>
                    <p className="mt-0.5 text-[12px] leading-5 text-[#626b67]">{step.instruction}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {specification ? (
            <section className="border border-[#d9dfdb] bg-[#f8faf9] p-4">
              <h3 className="text-[10px] font-black uppercase tracking-[0.08em] text-[#0f6f5d]">Note structure</h3>
              <p className="mt-2 text-[13px] font-semibold leading-6 text-[#303a36]">{specification.formatTemplate}</p>
            </section>
          ) : null}

          <section className="border-l-4 border-[#0f8b73] bg-white pl-4">
            <h3 className="text-[10px] font-black uppercase tracking-[0.08em] text-[#0f6f5d]">Example</h3>
            <p className="mt-2 text-[14px] leading-6 text-[#303a36]">{specification?.strongExample ?? fallback.example}</p>
          </section>

          <p className="border-t border-[#e1e4e2] pt-4 text-[11px] leading-5 text-[#6b746f]">{specification?.guardrail ?? fallback.guardrail}</p>
        </div>

        <footer className="flex justify-end border-t border-[#d9dfdb] bg-[#f8faf9] px-6 py-4">
          <button type="button" onClick={onStart} className="inline-flex h-10 items-center gap-2 bg-[#0f8b73] px-5 text-[11px] font-black text-white hover:bg-[#0c705f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2">
            OK, go to question <ChevronRight size={14} aria-hidden="true" />
          </button>
        </footer>
      </section>
    </div>
  );
}

function fieldPurpose(question: AssessmentInterviewQuestion) {
  if (question.help) return question.help;
  return `Document ${assessmentInterviewFieldLabel(question.field).toLowerCase()} with the source, timeframe, and current placement relevance made clear.`;
}

function questionAction(question: AssessmentInterviewQuestion) {
  if (question.control === "textarea") return "Write the answer using the structure you just reviewed. Keep source, timeframe, and current impact explicit.";
  if (question.control === "yes_no") return "Choose Yes, No, or Unable to assess. If the answer cannot be established, record the reason instead of guessing.";
  if (question.control === "multi_select") return "Select every option supported by the interview or source material. Do not add an option by inference.";
  if (question.control === "rating") return "Choose the rating supported by what was observed and reported during this assessment.";
  if (question.control === "select") return "Choose the most specific supported option. Review the source before selecting an assistance or status level.";
  if (question.control === "date") return "Enter the verified date. Leave it blank when the date is unknown rather than estimating.";
  if (question.control === "number") return "Enter the verified count. Do not convert an unclear history into an exact number.";
  return "Enter the specific value supported by the client, collateral contact, or supplied record.";
}

function structuredQuestionGuidance(question: AssessmentInterviewQuestion) {
  const action = questionAction(question);
  const optionLabels = question.options?.map((option) => option.label).join(", ");
  return {
    purpose: question.help ?? `Capture ${assessmentInterviewFieldLabel(question.field).toLowerCase()} as a specific assessment fact.`,
    steps: [
      { title: "Check the source", instruction: "Use the client interview, direct observation, collateral contact, or supplied record. Do not fill a gap by assumption." },
      { title: "Answer the control", instruction: action },
      { title: "Preserve uncertainty", instruction: "If sources disagree or the answer is not known, make that limitation visible instead of choosing the most likely answer." },
    ],
    example: optionLabels
      ? `Use the supported choice from: ${optionLabels}.`
      : `Enter the verified ${assessmentInterviewFieldLabel(question.field).toLowerCase()} exactly as supported by the source.`,
    guardrail: "This practice answer is synthetic and is never saved to a client record.",
  };
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
