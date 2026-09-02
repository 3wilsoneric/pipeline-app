"use client";

import { Check, ChevronDown, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getAssessmentFieldWritingSpec } from "@/lib/assessment/assessment-field-writing-spec";
import { isAssessmentIntakeInheritedField } from "@/lib/assessment/assessment-field-ownership";
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
  pickAssessmentToolData,
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

type PracticeAutosaveState = "loading" | "saving" | "saved" | "failed";

type StoredAssessmentPractice = {
  version: 1;
  activeSection: AssessmentToolSection;
  data: AssessmentToolData;
};

const assessmentPracticeStoragePrefix = "pipeline:assessment-practice:v1";

function readStoredAssessmentPractice(raw: string | null): StoredAssessmentPractice | null {
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.version !== 1 || !isAssessmentPracticeSection(parsed.activeSection) || !isRecord(parsed.data)) return null;
  return {
    version: 1,
    activeSection: parsed.activeSection,
    data: pickAssessmentToolData(parsed.data as Partial<AssessmentToolData>),
  };
}

function writeStoredAssessmentPractice(storageKey: string, state: StoredAssessmentPractice) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function isAssessmentPracticeSection(value: unknown): value is AssessmentToolSection {
  return typeof value === "string" && assessmentInterviewSections.some((section) => section.key === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function autosaveLabel(state: PracticeAutosaveState) {
  if (state === "loading") return "Loading saved practice...";
  if (state === "saving") return "Saving...";
  if (state === "failed") return "Autosave unavailable";
  return "Autosaved in this browser";
}

export default function AssessmentPracticeWorkspace({ traineeId, traineeName }: { traineeId: string; traineeName: string }) {
  const [data, setData] = useState(createAssessmentPracticeData);
  const [activeSection, setActiveSection] = useState<AssessmentToolSection>(assessmentInterviewSections[0].key);
  const [autosaveState, setAutosaveState] = useState<PracticeAutosaveState>("loading");
  const [storageReady, setStorageReady] = useState(false);
  const storageKey = useMemo(
    () => `${assessmentPracticeStoragePrefix}:${encodeURIComponent(traineeId.trim().toLowerCase() || traineeName.trim().toLowerCase() || "assessor")}`,
    [traineeId, traineeName],
  );
  const coverage = getAssessmentInterviewCoverage(data);
  const currentIndex = assessmentInterviewSections.findIndex((section) => section.key === activeSection);
  const section = assessmentInterviewSections[currentIndex] ?? assessmentInterviewSections[0];
  const questions = getAssessmentInterviewQuestions(section.key, data);
  const capturedHere = questions.filter((question) => hasAssessmentInterviewValue(data[question.field])).length;
  const requiredFields = useMemo(
    () => new Set(getRequiredAssessmentInterviewQuestions(data).map((question) => question.field)),
    [data],
  );
  useEffect(() => {
    setStorageReady(false);
    try {
      const stored = readStoredAssessmentPractice(window.localStorage.getItem(storageKey));
      if (stored) {
        setData(pickAssessmentToolData({ ...createAssessmentPracticeData(), ...stored.data }));
        setActiveSection(stored.activeSection);
      }
      setAutosaveState("saved");
    } catch {
      setAutosaveState("failed");
    } finally {
      setStorageReady(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageReady) return;
    setAutosaveState("saving");
    const timeout = window.setTimeout(() => {
      setAutosaveState(writeStoredAssessmentPractice(storageKey, { version: 1, activeSection, data }) ? "saved" : "failed");
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [activeSection, data, storageKey, storageReady]);

  const update = (field: AssessmentToolFieldKey, value: AssessmentToolData[AssessmentToolFieldKey]) => {
    setData((current) => ({ ...current, [field]: value }) as AssessmentToolData);
  };

  const reset = () => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      setAutosaveState("failed");
    }
    setData(createAssessmentPracticeData());
    setActiveSection(assessmentInterviewSections[0].key);
    document.querySelector<HTMLElement>("[data-assessment-practice-scroll]")?.scrollTo({ top: 0 });
  };

  const chooseSection = (sectionKey: AssessmentToolSection) => {
    setAutosaveState(writeStoredAssessmentPractice(storageKey, { version: 1, activeSection: sectionKey, data }) ? "saved" : "failed");
    setActiveSection(sectionKey);
    document.querySelector<HTMLElement>("[data-assessment-practice-scroll]")?.scrollTo({ top: 0 });
  };

  const moveSection = (offset: number) => {
    const nextIndex = Math.min(assessmentInterviewSections.length - 1, Math.max(0, currentIndex + offset));
    chooseSection(assessmentInterviewSections[nextIndex].key);
  };

  const saveAndContinue = () => {
    const nextIndex = Math.min(assessmentInterviewSections.length - 1, currentIndex + 1);
    const nextSection = assessmentInterviewSections[nextIndex].key;
    if (nextIndex !== currentIndex) {
      chooseSection(nextSection);
      return;
    }
    setAutosaveState(writeStoredAssessmentPractice(storageKey, { version: 1, activeSection, data }) ? "saved" : "failed");
  };

  return (
    <div aria-label={`${traineeName} practice assessment`} className="pipeline-route-enter flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-[#cfd8d4] bg-white px-4 py-2 sm:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-[17px] font-black text-[#202522]">Jordan Practice</h1>
            <span className="bg-[#e7f3ee] px-2 py-1 text-[9px] font-black uppercase text-[#0f6f5d]">Practice</span>
          </div>
          <p className="mt-0.5 text-[10px] text-[#737b77]">Synthetic training record</p>
        </div>
        <button type="button" onClick={reset} className="inline-flex h-9 shrink-0 items-center gap-2 border border-[#c9ceca] bg-white px-3 text-[10px] font-black text-[#4d5652] outline-none hover:border-[#0f8b73] hover:text-[#0f8b73] focus-visible:ring-2 focus-visible:ring-[#0f8b73]">
          <RotateCcw size={13} aria-hidden="true" />Reset
        </button>
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
              onUpdate={update}
            />

            <footer className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-[#d9dfdb] pt-5">
              <button type="button" disabled={currentIndex === 0} onClick={() => moveSection(-1)} className="flex h-10 items-center gap-2 border border-[#c9ceca] px-4 text-[11px] font-black text-[#4d5652] hover:border-[#0f8b73] hover:text-[#0f8b73] disabled:opacity-35"><ChevronLeft size={14} aria-hidden="true" />Back</button>
              <span aria-live="polite" className={`order-3 w-full text-center text-[9px] font-bold sm:order-none sm:w-auto ${autosaveState === "failed" ? "text-[#a33b32]" : "text-[#747d79]"}`}>
                {autosaveLabel(autosaveState)}
              </span>
              <button type="button" onClick={saveAndContinue} className="flex h-10 items-center gap-2 bg-[#111111] px-4 text-[11px] font-black text-white hover:bg-[#0f8b73] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2">
                {currentIndex === assessmentInterviewSections.length - 1 ? "Save" : "Save and continue"}
                {currentIndex < assessmentInterviewSections.length - 1 ? <ChevronRight size={14} aria-hidden="true" /> : null}
              </button>
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
  onUpdate,
}: {
  questions: readonly AssessmentInterviewQuestion[];
  data: AssessmentToolData;
  requiredFields: ReadonlySet<AssessmentToolFieldKey>;
  onUpdate: (field: AssessmentToolFieldKey, value: AssessmentToolData[AssessmentToolFieldKey]) => void;
}) {
  const groups = [...new Set(questions.map((question) => question.group))];
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
                inheritedFromIntake={isAssessmentIntakeInheritedField(question.field)}
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
  inheritedFromIntake,
  onUnableReasonChange,
  onUpdate,
}: {
  question: AssessmentInterviewQuestion;
  value: AssessmentToolData[AssessmentToolFieldKey];
  unableReason: string;
  required: boolean;
  inheritedFromIntake: boolean;
  onUnableReasonChange: (reason: string) => void;
  onUpdate: (value: AssessmentToolData[AssessmentToolFieldKey]) => void;
}) {
  const id = `practice-${question.field}`;
  const label = assessmentInterviewFieldLabel(question.field);
  const fullWidth = question.span === "full" || question.control === "multi_select";
  return (
    <div
      data-practice-field={question.field}
      title={inheritedFromIntake ? "This field carries forward from intake. Confirm or correct it during the assessment." : undefined}
      className={`relative scroll-mt-8 ${fullWidth ? "md:col-span-2" : ""} ${inheritedFromIntake ? "-mx-3 border-l-2 border-[#4f8da0] bg-[#f0f7f9] px-3 py-3" : ""}`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[11px] font-black text-[#444444]">{label}{required ? " *" : ""}</label>
        <div className="flex shrink-0 items-center gap-2">
          {inheritedFromIntake ? <span className="bg-[#dceef3] px-2 py-0.5 text-[9px] font-black uppercase text-[#2f6f82]">From intake</span> : null}
          {hasAssessmentInterviewValue(value) ? <Check size={12} className="text-[#0f8b73]" aria-label="Captured" /> : required ? <span className="text-[9px] font-semibold uppercase text-[#9a6115]">Required</span> : <span className="text-[9px] font-semibold uppercase text-[#999999]">Optional</span>}
        </div>
      </div>
      <PracticeControl question={question} value={value} unableReason={unableReason} onUnableReasonChange={onUnableReasonChange} onUpdate={onUpdate} />
      {question.help ? <p className="mt-1.5 text-[10px] leading-4 text-[#737373]">{question.help}</p> : null}
      {hasUsefulWritingGuidance(question) ? <PracticeQuestionGuide question={question} /> : null}
    </div>
  );
}

function PracticeQuestionGuide({ question }: { question: AssessmentInterviewQuestion }) {
  const specification = getAssessmentFieldWritingSpec(question.field);
  const narrativeGuide = getAssessmentNarrativeGuide(question.field);
  if (!specification || !narrativeGuide) return null;
  const label = assessmentInterviewFieldLabel(question.field);
  return (
    <details className="group mt-2">
      <summary aria-label={`Guide for ${label}`} className="flex w-fit cursor-pointer list-none items-center gap-1 text-[9px] font-black uppercase tracking-[0.06em] text-[#0f7d69] outline-none hover:text-[#0a6555] focus-visible:ring-2 focus-visible:ring-[#0f8b73] [&::-webkit-details-marker]:hidden">
        Guide <ChevronDown size={12} className="transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="mt-2 border-l-2 border-[#84b9aa] bg-white px-4 py-3 shadow-[0_8px_20px_rgba(28,52,45,0.10)]">
        <p className="text-[12px] leading-5 text-[#4f5954]">{narrativeGuide.purpose}</p>
        <div className="mt-3 grid gap-3 border-t border-[#e1e4e2] pt-3 lg:grid-cols-2">
          <div>
            <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#6b746f]">Use this order</div>
            <p className="mt-1 text-[11px] font-semibold leading-5 text-[#303a36]">{specification.formatTemplate}</p>
          </div>
          <div className="border-l-2 border-[#0f8b73] pl-3">
            <div className="text-[10px] font-black uppercase tracking-[0.08em] text-[#52615b]">Example</div>
            <p className="mt-1.5 text-[13px] font-semibold leading-6 text-[#24312c]">{specification.strongExample}</p>
          </div>
        </div>
      </div>
    </details>
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
  const hasLegacyValue = Boolean(stringValue) && !(question.options ?? []).some((option) => option.value === stringValue);
  return (
    <div className="relative">
      <select id={id} value={stringValue} onChange={(event) => onUpdate(event.target.value || null)} className="h-10 w-full appearance-none border border-[#c9ceca] bg-white px-3 pr-9 text-[12px] outline-none hover:border-[#8ca59c] focus:border-[#0f8b73]">
        <option value="">Select...</option>
        {hasLegacyValue ? <option value={stringValue}>{stringValue}</option> : null}
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
