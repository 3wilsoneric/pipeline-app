"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

import { getAssessmentFieldWritingSpec } from "@/lib/assessment/assessment-field-writing-spec";
import {
  assessmentInterviewFieldLabel,
  assessmentInterviewSections,
  getAssessmentInterviewCoverage,
  getAssessmentInterviewQuestions,
  getRequiredAssessmentInterviewQuestions,
  hasAssessmentInterviewValue,
  type AssessmentInterviewQuestion,
} from "@/lib/assessment/assessment-interview-schema";
import {
  type AssessmentToolData,
  type AssessmentToolFieldKey,
  type AssessmentToolSection,
} from "@/lib/assessment/assessment-tool-schema";
import {
  ASSESSMENT_PRACTICE_TUTORIAL_ID,
  createAssessmentPracticeData,
} from "@/lib/note-lab/assessment-practice-scenario";
import { dispatchOperatorGuide } from "@/lib/training/operator-guided-tour-state";

export default function AssessmentPracticeWorkspace({ traineeName }: { traineeName: string }) {
  const [data, setData] = useState(createAssessmentPracticeData);
  const [activeSection, setActiveSection] = useState<AssessmentToolSection>(assessmentInterviewSections[0].key);
  const [openWritingHelp, setOpenWritingHelp] = useState<AssessmentToolFieldKey | null>(null);
  const [practiceComplete, setPracticeComplete] = useState(false);
  const coverage = getAssessmentInterviewCoverage(data);
  const currentIndex = assessmentInterviewSections.findIndex((section) => section.key === activeSection);
  const section = assessmentInterviewSections[currentIndex] ?? assessmentInterviewSections[0];
  const questions = getAssessmentInterviewQuestions(section.key, data);
  const requiredFields = useMemo(
    () => new Set(getRequiredAssessmentInterviewQuestions(data).map((question) => question.field)),
    [data],
  );

  const update = (field: AssessmentToolFieldKey, value: AssessmentToolData[AssessmentToolFieldKey]) => {
    setData((current) => ({ ...current, [field]: value }) as AssessmentToolData);
    setPracticeComplete(false);
  };

  const reset = () => {
    setData(createAssessmentPracticeData());
    setActiveSection(assessmentInterviewSections[0].key);
    setOpenWritingHelp(null);
    setPracticeComplete(false);
  };

  const move = (offset: number) => {
    const next = assessmentInterviewSections[Math.min(assessmentInterviewSections.length - 1, Math.max(0, currentIndex + offset))];
    setActiveSection(next.key);
    setOpenWritingHelp(null);
    document.querySelector<HTMLElement>("[data-assessment-practice-scroll]")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div aria-label={`${traineeName} practice assessment`} className="pipeline-route-enter h-full overflow-hidden bg-[#f4f6f5]">
      <div className="mx-auto flex h-full max-w-[1500px] flex-col px-3 py-3 sm:px-5 sm:py-5">
        <header data-guide-target="practice-overview" className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#cfd8d4] bg-white px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-black text-[#28332e]">
              <span className="h-2 w-2 bg-[#0f8b73]" aria-hidden="true" />
              Jordan Practice
              <span className="font-semibold text-[#77817d]">Synthetic</span>
            </div>
            <div className="mt-1 text-[9px] font-semibold text-[#77817d]">{coverage.captured} of {coverage.total} visible fields captured</div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={reset} className="inline-flex h-9 items-center gap-2 border border-[#cbd4d0] bg-white px-3 text-[9px] font-black text-[#5a6560] outline-none hover:border-[#8fa39b] focus-visible:ring-2 focus-visible:ring-[#0f8b73]">
              <RotateCcw size={13} aria-hidden="true" />Reset
            </button>
            <button type="button" onClick={() => dispatchOperatorGuide({ type: "start", tutorialId: ASSESSMENT_PRACTICE_TUTORIAL_ID })} className="inline-flex h-9 items-center gap-2 bg-[#0f8b73] px-3 text-[9px] font-black text-white outline-none hover:bg-[#0c705f] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2">
              <Sparkles size={13} aria-hidden="true" />Guided practice
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 border-x border-b border-[#cfd8d4] bg-white lg:grid lg:grid-cols-[230px_minmax(0,1fr)]">
          <aside data-guide-target="practice-sections" className="hidden min-h-0 border-r border-[#d6ddda] lg:block lg:overflow-y-auto">
            <nav aria-label="Practice assessment sections" className="divide-y divide-[#e2e7e5]">
              {assessmentInterviewSections.map((item, index) => {
                const sectionQuestions = getAssessmentInterviewQuestions(item.key, data);
                const captured = sectionQuestions.filter((question) => hasAssessmentInterviewValue(data[question.field])).length;
                const active = item.key === section.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => { setActiveSection(item.key); setOpenWritingHelp(null); }}
                    data-guide-target={item.key === "functional_adl" ? "practice-function-section" : item.key === "diagnosis_clinical" ? "practice-clinical-section" : undefined}
                    className={`grid w-full grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2 border-l-3 px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73] ${active ? "border-l-[#0f8b73] bg-[#f0f7f4]" : "border-l-transparent hover:bg-[#f8faf9]"}`}
                  >
                    <span className="text-[9px] font-black text-[#98a29d]">{String(index + 1).padStart(2, "0")}</span>
                    <span className={`truncate text-[10px] font-black ${active ? "text-[#0b705f]" : "text-[#46514c]"}`}>{item.label}</span>
                    <span className="text-[8px] font-bold text-[#8a948f]">{captured}/{sectionQuestions.length}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          <main data-assessment-practice-scroll className="min-h-0 overflow-y-auto">
            <div className="border-b border-[#d9e0dd] px-4 py-4 sm:px-7 lg:hidden">
              <label htmlFor="practice-section" className="block text-[8px] font-black uppercase tracking-[0.08em] text-[#6d7873]">Section</label>
              <select id="practice-section" value={section.key} onChange={(event) => setActiveSection(event.target.value as AssessmentToolSection)} className="mt-2 h-11 w-full border border-[#bfc9c5] bg-white px-3 text-[12px] font-bold text-[#27312c] outline-none focus:border-[#0f8b73] focus:ring-1 focus:ring-[#0f8b73]">
                {assessmentInterviewSections.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </select>
            </div>

            <div className="mx-auto max-w-[1080px] px-4 py-6 sm:px-7 sm:py-8">
              <div className="flex items-start justify-between gap-5 border-b border-[#d5ddda] pb-5">
                <div>
                  <div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#0d7c68]">{currentIndex + 1} of {assessmentInterviewSections.length}</div>
                  <h1 className="mt-1 text-[25px] font-black text-[#202522] sm:text-[30px]">{section.label}</h1>
                  <p className="mt-2 max-w-[680px] text-[12px] leading-5 text-[#68736e]">{section.description}</p>
                </div>
                <div data-guide-target="practice-progress" className="shrink-0 text-right">
                  <div className="text-[18px] font-black text-[#26302b]">{coverage.percent}%</div>
                  <div className="text-[8px] font-bold uppercase tracking-[0.08em] text-[#89938f]">captured</div>
                </div>
              </div>

              {practiceComplete ? (
                <section className="py-14 text-center" data-guide-target="practice-finish">
                  <span className="mx-auto flex h-10 w-10 items-center justify-center bg-[#0f8b73] text-white"><Check size={19} aria-hidden="true" /></span>
                  <h2 className="mt-4 text-[20px] font-black text-[#27312c]">Practice complete</h2>
                  <p className="mx-auto mt-2 max-w-[420px] text-[11px] leading-5 text-[#68736e]">Nothing was saved to Pipeline. Reset when you want another pass.</p>
                  <button type="button" onClick={reset} className="mt-5 h-10 border border-[#0f8b73] px-4 text-[10px] font-black text-[#0b705f] hover:bg-[#f0f7f4]">Practice again</button>
                </section>
              ) : (
                <PracticeQuestions
                  questions={questions}
                  data={data}
                  requiredFields={requiredFields}
                  openWritingHelp={openWritingHelp}
                  onWritingHelp={setOpenWritingHelp}
                  onUpdate={update}
                />
              )}

              {!practiceComplete ? (
                <footer className="mt-9 flex flex-wrap items-center justify-between gap-3 border-t border-[#d5ddda] pt-5">
                  <button type="button" disabled={currentIndex === 0} onClick={() => move(-1)} className="inline-flex h-10 items-center gap-2 px-2 text-[10px] font-black text-[#56615c] disabled:opacity-30"><ChevronLeft size={15} />Previous</button>
                  {currentIndex < assessmentInterviewSections.length - 1 ? (
                    <button type="button" onClick={() => move(1)} className="inline-flex h-10 items-center gap-2 bg-[#202522] px-4 text-[10px] font-black text-white hover:bg-black">Next section<ChevronRight size={15} /></button>
                  ) : (
                    <button data-guide-target="practice-finish" type="button" onClick={() => setPracticeComplete(true)} className="inline-flex h-10 items-center gap-2 bg-[#0f8b73] px-4 text-[10px] font-black text-white hover:bg-[#0c705f]"><Check size={14} />Finish practice</button>
                  )}
                </footer>
              ) : null}
            </div>
          </main>
        </div>
        <p className="mt-2 shrink-0 text-right text-[8px] font-semibold text-[#7e8984]">Practice answers stay in this tab and are cleared when it closes.</p>
      </div>
    </div>
  );
}

function PracticeQuestions({
  questions,
  data,
  requiredFields,
  openWritingHelp,
  onWritingHelp,
  onUpdate,
}: {
  questions: readonly AssessmentInterviewQuestion[];
  data: AssessmentToolData;
  requiredFields: ReadonlySet<AssessmentToolFieldKey>;
  openWritingHelp: AssessmentToolFieldKey | null;
  onWritingHelp: (field: AssessmentToolFieldKey | null) => void;
  onUpdate: (field: AssessmentToolFieldKey, value: AssessmentToolData[AssessmentToolFieldKey]) => void;
}) {
  const groups = [...new Set(questions.map((question) => question.group))];
  return (
    <div className="divide-y divide-[#dfe5e2]">
      {groups.map((group) => (
        <section key={group} className="py-7 first:pt-6">
          <h2 className="text-[11px] font-black text-[#313b36]">{group}</h2>
          <div className="mt-4 grid gap-x-5 gap-y-5 sm:grid-cols-2">
            {questions.filter((question) => question.group === group).map((question) => (
              <PracticeField
                key={question.field}
                question={question}
                value={data[question.field]}
                required={requiredFields.has(question.field)}
                writingHelpOpen={openWritingHelp === question.field}
                onWritingHelp={() => onWritingHelp(openWritingHelp === question.field ? null : question.field)}
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
  required,
  writingHelpOpen,
  onWritingHelp,
  onUpdate,
}: {
  question: AssessmentInterviewQuestion;
  value: AssessmentToolData[AssessmentToolFieldKey];
  required: boolean;
  writingHelpOpen: boolean;
  onWritingHelp: () => void;
  onUpdate: (value: AssessmentToolData[AssessmentToolFieldKey]) => void;
}) {
  const writingSpec = getAssessmentFieldWritingSpec(question.field);
  return (
    <div data-guide-target={practiceGuideTarget(question.field)} className={practiceFieldClassName(question)}>
      <div className="flex min-h-5 items-start justify-between gap-3">
        <label htmlFor={`practice-${question.field}`} className="text-[9px] font-black uppercase tracking-[0.06em] text-[#4e5954]">
          {assessmentInterviewFieldLabel(question.field)}{required ? <span className="ml-1 text-[#a44d3d]">*</span> : null}
        </label>
        {writingSpec ? (
          <button type="button" onClick={onWritingHelp} aria-expanded={writingHelpOpen} className="inline-flex shrink-0 items-center gap-1 text-[8px] font-black text-[#0b705f] hover:underline">
            <CircleHelp size={11} aria-hidden="true" />Writing help
          </button>
        ) : null}
      </div>
      <QuestionControl question={question} value={value} onUpdate={onUpdate} />
      {question.help ? <p className="mt-1.5 text-[8px] leading-4 text-[#78827e]">{question.help}</p> : null}
      {writingSpec && writingHelpOpen ? <WritingHelp field={question.field} /> : null}
    </div>
  );
}

function practiceGuideTarget(field: AssessmentToolFieldKey) {
  const targets: Partial<Record<AssessmentToolFieldKey, string>> = {
    dress_assistance_level: "practice-assistance-level",
    dress_assistance_details: "practice-assistance-details",
    current_symptoms: "practice-current-symptoms",
  };
  return targets[field];
}

function practiceFieldClassName(question: AssessmentInterviewQuestion) {
  return question.span === "full" || question.control === "multi_select" ? "sm:col-span-2" : undefined;
}

function QuestionControl({ question, value, onUpdate }: { question: AssessmentInterviewQuestion; value: AssessmentToolData[AssessmentToolFieldKey]; onUpdate: (value: AssessmentToolData[AssessmentToolFieldKey]) => void }) {
  const id = `practice-${question.field}`;
  const controlClass = "mt-2 w-full border border-[#bcc8c3] bg-white px-3 text-[12px] text-[#27312c] outline-none transition-colors focus:border-[#0f8b73] focus:ring-1 focus:ring-[#0f8b73]";
  if (question.control === "textarea") return <PracticeTextarea id={id} question={question} value={value} onUpdate={onUpdate} className={controlClass} />;
  if (question.control === "multi_select") return <PracticeMultiSelect id={id} question={question} value={value} onUpdate={onUpdate} />;
  if (["select", "yes_no", "rating"].includes(question.control)) return <PracticeSelect id={id} question={question} value={value} onUpdate={onUpdate} className={controlClass} />;
  return <PracticeInput id={id} question={question} value={value} onUpdate={onUpdate} className={controlClass} />;
}

type PracticeControlProps = {
  id: string;
  question: AssessmentInterviewQuestion;
  value: AssessmentToolData[AssessmentToolFieldKey];
  onUpdate: (value: AssessmentToolData[AssessmentToolFieldKey]) => void;
  className?: string;
};

function PracticeTextarea({ id, question, value, onUpdate, className }: PracticeControlProps) {
  const text = Array.isArray(value) ? value.join("\n") : String(value ?? "");
  const update = (next: string) => onUpdate(Array.isArray(value) ? next.split("\n").filter(Boolean) : next);
  return <textarea id={id} rows={4} value={text} placeholder={question.placeholder} onChange={(event) => update(event.target.value)} className={`${className} min-h-28 resize-y py-3 leading-5`} />;
}

function PracticeMultiSelect({ id, question, value, onUpdate }: PracticeControlProps) {
  const selected = Array.isArray(value) ? value : [];
  return (
    <div id={id} className="mt-2 flex flex-wrap gap-2" role="group" aria-label={assessmentInterviewFieldLabel(question.field)}>
      {(question.options ?? []).map((option) => {
        const checked = selected.includes(option.value);
        const next = checked ? selected.filter((item) => item !== option.value) : [...selected, option.value];
        return <button key={option.value} type="button" aria-pressed={checked} onClick={() => onUpdate(next)} className={`min-h-9 border px-3 text-[9px] font-bold ${checked ? "border-[#0f8b73] bg-[#edf7f3] text-[#0b705f]" : "border-[#c8d1cd] bg-white text-[#5f6a65] hover:border-[#8da198]"}`}>{option.label}</button>;
      })}
    </div>
  );
}

function PracticeSelect({ id, question, value, onUpdate, className }: PracticeControlProps) {
  const options = question.control === "rating"
    ? Array.from({ length: (question.max ?? 5) - (question.min ?? 1) + 1 }, (_, index) => ({ value: String((question.min ?? 1) + index), label: String((question.min ?? 1) + index) }))
    : question.options ?? [];
  const update = (next: string) => onUpdate(question.control === "rating" ? (next ? Number(next) : null) : next || null);
  return (
    <select id={id} value={value === null ? "" : String(value)} onChange={(event) => update(event.target.value)} className={`${className} h-11 appearance-none`}>
      <option value="">Select</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

function PracticeInput({ id, question, value, onUpdate, className }: PracticeControlProps) {
  const inputType = question.control === "date" ? "date" : question.control === "number" ? "number" : "text";
  const update = (next: string) => onUpdate(question.control === "number" ? (next ? Number(next) : null) : next);
  return <input id={id} type={inputType} min={question.min} max={question.max} value={value === null ? "" : String(value)} placeholder={question.placeholder} onChange={(event) => update(event.target.value)} className={`${className} h-11`} />;
}

function WritingHelp({ field }: { field: AssessmentToolFieldKey }) {
  const spec = getAssessmentFieldWritingSpec(field);
  if (!spec) return null;
  return (
    <div data-guide-target={field === "current_symptoms" ? "practice-writing-help" : undefined} className="mt-3 border-l-2 border-[#0f8b73] px-4 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong className="text-[10px] text-[#29332e]">{spec.formatLabel}</strong>
        <span className="text-[8px] font-bold text-[#7a847f]">{spec.lengthGuidance}</span>
      </div>
      <p className="mt-2 text-[10px] font-semibold leading-5 text-[#53605a]">{spec.formatTemplate}</p>
      <ol className="mt-2 space-y-1 text-[9px] leading-4 text-[#66716c]">
        {spec.instructionSteps.slice(0, 4).map((step, index) => <li key={step.title}><span className="font-black text-[#33403a]">{index + 1}. {step.title}:</span> {step.instruction}</li>)}
      </ol>
      <p className="mt-2 border-t border-[#dbe2df] pt-2 text-[9px] leading-4 text-[#68736e]"><span className="font-black text-[#33403a]">Example:</span> {spec.strongExample}</p>
      <p className="mt-2 text-[8px] leading-4 text-[#8a5f24]">{spec.guardrail}</p>
    </div>
  );
}
