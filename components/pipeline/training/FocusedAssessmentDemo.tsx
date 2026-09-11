"use client";

import { Check, ChevronLeft, X } from "lucide-react";
import { useEffect, useState } from "react";

import PipelineLogoMark from "@/components/pipeline/PipelineLogoMark";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import {
  assessmentInterviewQuestions,
  getAssessmentUnableReason,
  setAssessmentUnableReason,
  type AssessmentQuestionOption,
} from "@/lib/assessment/assessment-interview-schema";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import { buildTrainingAssessment } from "@/lib/training/mock-assessment";

const medicationSteps = ["Adherence", "Medication list", "Support", "Review"] as const;
const questionByField = new Map(assessmentInterviewQuestions.map((question) => [question.field, question]));

function optionsFor(field: "medication_adherence" | "lai_vs_oral" | "im_injections") {
  return questionByField.get(field)?.options ?? [];
}

function buildMedicationDemoAssessment(): PipelineAssessmentRecord {
  return {
    ...buildTrainingAssessment("interview"),
    last_medication_refusal_date: "2026-09-02",
    medication_refused: "Synthetic medication A",
    lai_vs_oral: "oral_only",
    prn_patterns: "PRN anxiety medication was used twice in the last 30 days with reported benefit.",
  };
}

function canContinueMedicationStep(stepIndex: number, answers: PipelineAssessmentRecord, medicationText: string) {
  switch (stepIndex) {
    case 0:
      return canContinueMedicationAdherence(answers);
    case 1:
      return Boolean(medicationText.trim() && answers.lai_vs_oral);
    case 2:
      return canContinueInjectionSupport(answers);
    default:
      return true;
  }
}

function canContinueMedicationAdherence(answers: PipelineAssessmentRecord) {
  if (answers.medication_adherence === "no") {
    return Boolean(
      answers.last_medication_refusal_date
      && answers.medication_refused?.trim()
      && answers.medication_refusals_30_days !== null,
    );
  }
  if (answers.medication_adherence === "unable_to_assess") {
    return Boolean(getAssessmentUnableReason(answers, "medication_adherence").trim());
  }
  return answers.medication_adherence === "yes";
}

function canContinueInjectionSupport(answers: PipelineAssessmentRecord) {
  if (answers.im_injections === "unable_to_assess") {
    return Boolean(getAssessmentUnableReason(answers, "im_injections").trim());
  }
  return answers.im_injections === "yes" || answers.im_injections === "no";
}

export default function FocusedAssessmentDemo() {
  const [answers, setAnswers] = useState(buildMedicationDemoAssessment);
  const [medicationText, setMedicationText] = useState(() => answers.medications_at_intake.join("\n"));
  const [stepIndex, setStepIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const progress = finished ? 100 : ((stepIndex + 1) / medicationSteps.length) * 100;
  const close = () => window.location.assign(toPipelinePath("/training/demo"));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const updateYesNo = (field: "medication_adherence" | "im_injections", value: string) => {
    setAnswers((current) => ({
      ...current,
      [field]: value,
      unable_to_assess_reasons: value === "unable_to_assess"
        ? current.unable_to_assess_reasons
        : setAssessmentUnableReason(current.unable_to_assess_reasons, field, ""),
    }));
  };

  const updateUnableReason = (field: "medication_adherence" | "im_injections", reason: string) => {
    setAnswers((current) => ({
      ...current,
      unable_to_assess_reasons: setAssessmentUnableReason(current.unable_to_assess_reasons, field, reason),
    }));
  };

  const canContinue = canContinueMedicationStep(stepIndex, answers, medicationText);

  const continueSection = () => {
    if (!canContinue) return;
    if (stepIndex === medicationSteps.length - 1) {
      setFinished(true);
      return;
    }
    setStepIndex((current) => current + 1);
  };

  const goBack = () => {
    if (finished) {
      setFinished(false);
      return;
    }
    setStepIndex((current) => Math.max(0, current - 1));
  };

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label="Focused assessment preview"
      className="fixed inset-0 z-[120] flex h-[100dvh] flex-col overflow-hidden bg-white text-[#151917]"
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-[#e1e7e4]" aria-hidden="true">
        <div className="h-full bg-[#0f8b73] transition-[width] duration-300 ease-out" style={{ width: `${progress}%` }} />
      </div>

      <header className="relative z-10 flex h-16 shrink-0 items-center justify-between px-5 sm:h-24 sm:px-8">
        <div className="flex items-center gap-3" aria-label="Pipeline assessment">
          <PipelineLogoMark size={31} />
          <span className="text-[13px] font-black uppercase tracking-[0.08em] text-[#174c40]">Assessment</span>
        </div>
        <div className="hidden text-[12px] font-bold text-[#69716d] sm:block">Taylor Rivera · Practice case</div>
        <button
          type="button"
          onClick={close}
          aria-label="Close assessment preview"
          className="flex size-11 items-center justify-center text-[#59615d] transition-colors hover:bg-[#f1f5f3] hover:text-[#151917] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73]"
        >
          <X size={22} aria-hidden="true" />
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 sm:px-8">
        {finished ? (
          <SectionComplete onBack={goBack} onClose={close} />
        ) : (
          <div className="mx-auto flex w-full max-w-[660px] flex-col pt-2 sm:pt-[clamp(1.5rem,5vh,3.5rem)]">
            <div className="mb-4 flex items-center justify-between gap-4 text-[11px] font-black uppercase tracking-[0.08em] text-[#68716d] sm:mb-6">
              <span>Medication</span>
              <span className="tabular-nums">{stepIndex + 1} of {medicationSteps.length}</span>
            </div>

            {stepIndex === 0 ? (
              <AdherenceStep
                adherence={answers.medication_adherence}
                lastRefusalDate={answers.last_medication_refusal_date}
                medicationRefused={answers.medication_refused}
                refusalCount={answers.medication_refusals_30_days}
                unableReason={getAssessmentUnableReason(answers, "medication_adherence")}
                onAdherenceChange={(value) => updateYesNo("medication_adherence", value)}
                onLastRefusalDateChange={(value) => setAnswers((current) => ({ ...current, last_medication_refusal_date: value || null }))}
                onMedicationRefusedChange={(value) => setAnswers((current) => ({ ...current, medication_refused: value || null }))}
                onRefusalCountChange={(value) => setAnswers((current) => ({ ...current, medication_refusals_30_days: value }))}
                onUnableReasonChange={(value) => updateUnableReason("medication_adherence", value)}
              />
            ) : null}

            {stepIndex === 1 ? (
              <MedicationListStep
                medicationText={medicationText}
                route={answers.lai_vs_oral}
                onMedicationTextChange={(value) => {
                  setMedicationText(value);
                  setAnswers((current) => ({
                    ...current,
                    medications_at_intake: value.split("\n").map((item) => item.trim()).filter(Boolean),
                  }));
                }}
                onRouteChange={(value) => setAnswers((current) => ({ ...current, lai_vs_oral: value }))}
              />
            ) : null}

            {stepIndex === 2 ? (
              <MedicationSupportStep
                injections={answers.im_injections}
                prnPatterns={answers.prn_patterns}
                unableReason={getAssessmentUnableReason(answers, "im_injections")}
                onInjectionsChange={(value) => updateYesNo("im_injections", value)}
                onPrnPatternsChange={(value) => setAnswers((current) => ({ ...current, prn_patterns: value || null }))}
                onUnableReasonChange={(value) => updateUnableReason("im_injections", value)}
              />
            ) : null}

            {stepIndex === 3 ? (
              <MedicationSectionReview answers={answers} onEdit={setStepIndex} />
            ) : null}
          </div>
        )}
      </main>

      {!finished ? (
        <footer className="shrink-0 bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-8 sm:pb-7 sm:pt-4">
          <div className="mx-auto flex w-full max-w-[660px] items-center gap-4">
            <button
              type="button"
              onClick={goBack}
              disabled={stepIndex === 0}
              className="flex h-11 items-center gap-2 px-2 text-[13px] font-black text-[#4f5854] hover:text-[#0f8b73] disabled:invisible sm:h-12"
            >
              <ChevronLeft size={18} aria-hidden="true" />
              Back
            </button>
            <button
              type="button"
              onClick={continueSection}
              disabled={!canContinue}
              className="ml-auto h-11 min-w-[210px] flex-1 bg-[#111412] px-6 text-[13px] font-black text-white transition-colors hover:bg-[#0f8b73] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73] disabled:cursor-not-allowed disabled:bg-[#d6d9d7] sm:h-12"
            >
              {stepIndex === medicationSteps.length - 1 ? "Finish section" : "Continue"}
            </button>
          </div>
        </footer>
      ) : null}
    </section>
  );
}

function AdherenceStep({
  adherence,
  lastRefusalDate,
  medicationRefused,
  refusalCount,
  unableReason,
  onAdherenceChange,
  onLastRefusalDateChange,
  onMedicationRefusedChange,
  onRefusalCountChange,
  onUnableReasonChange,
}: {
  adherence: string | null;
  lastRefusalDate: string | null;
  medicationRefused: string | null;
  refusalCount: number | null;
  unableReason: string;
  onAdherenceChange: (value: string) => void;
  onLastRefusalDateChange: (value: string) => void;
  onMedicationRefusedChange: (value: string) => void;
  onRefusalCountChange: (value: number | null) => void;
  onUnableReasonChange: (value: string) => void;
}) {
  return (
    <>
      <StepHeading
        title="Is the client taking medication as prescribed?"
        context="Use the current medication record and the client interview together."
      />
      <div className="mt-6 sm:mt-8">
        <ChoiceList label="Medication adherence" options={optionsFor("medication_adherence")} value={adherence} onChange={onAdherenceChange} />
      </div>

      {adherence === "no" ? (
        <div className="mt-8 border-t border-[#dfe4e1] pt-7">
          <h2 className="text-[19px] font-black text-[#171b19]">Record the refusals</h2>
          <p className="mt-2 text-[13px] font-medium leading-5 text-[#69716d]">These details stay with the adherence answer instead of becoming separate screens.</p>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <LabeledInput label="Most recent refusal" type="date" value={lastRefusalDate ?? ""} onChange={onLastRefusalDateChange} />
            <LabeledInput label="Medication refused" value={medicationRefused ?? ""} onChange={onMedicationRefusedChange} />
            <LabeledInput
              label="Refusals in the last 30 days"
              type="number"
              value={refusalCount === null ? "" : String(refusalCount)}
              onChange={(value) => onRefusalCountChange(value === "" ? null : Number(value))}
            />
          </div>
        </div>
      ) : null}

      {adherence === "unable_to_assess" ? (
        <UnableReason value={unableReason} onChange={onUnableReasonChange} />
      ) : null}
    </>
  );
}

function MedicationListStep({ medicationText, route, onMedicationTextChange, onRouteChange }: { medicationText: string; route: string | null; onMedicationTextChange: (value: string) => void; onRouteChange: (value: string) => void }) {
  return (
    <>
      <StepHeading
        title="What medications is the client currently taking?"
        context="Keep one medication per line. Confirm the name and dose when the source supports it."
      />
      <textarea
        aria-label="Medications at intake"
        value={medicationText}
        onChange={(event) => onMedicationTextChange(event.target.value)}
        rows={4}
        className="mt-6 min-h-[130px] w-full resize-y border border-[#d9dddb] bg-white px-5 py-4 text-[16px] font-medium leading-7 text-[#202522] outline-none focus:border-2 focus:border-[#0f8b73] sm:mt-8"
      />
      <div className="mt-8 border-t border-[#dfe4e1] pt-7">
        <h2 className="text-[19px] font-black text-[#171b19]">How are medications administered?</h2>
        <div className="mt-5">
          <ChoiceList label="Medication route" options={optionsFor("lai_vs_oral")} value={route} onChange={onRouteChange} compact />
        </div>
      </div>
    </>
  );
}

function MedicationSupportStep({ injections, prnPatterns, unableReason, onInjectionsChange, onPrnPatternsChange, onUnableReasonChange }: { injections: string | null; prnPatterns: string | null; unableReason: string; onInjectionsChange: (value: string) => void; onPrnPatternsChange: (value: string) => void; onUnableReasonChange: (value: string) => void }) {
  return (
    <>
      <StepHeading
        title="Does the client receive IM injections?"
        context="Record current injection needs before describing any PRN medication pattern."
      />
      <div className="mt-6 sm:mt-8">
        <ChoiceList label="IM injections" options={optionsFor("im_injections")} value={injections} onChange={onInjectionsChange} />
      </div>
      {injections === "unable_to_assess" ? <UnableReason value={unableReason} onChange={onUnableReasonChange} /> : null}
      <div className="mt-8 border-t border-[#dfe4e1] pt-7">
        <label htmlFor="prn-patterns" className="text-[13px] font-black text-[#303733]">PRN medication pattern <span className="font-semibold text-[#848b87]">Optional</span></label>
        <textarea
          id="prn-patterns"
          value={prnPatterns ?? ""}
          onChange={(event) => onPrnPatternsChange(event.target.value)}
          rows={4}
          placeholder="What is given, how often, and with what effect?"
          className="mt-2 min-h-[120px] w-full resize-y border border-[#d9dddb] bg-white px-5 py-4 text-[15px] font-medium leading-6 text-[#202522] outline-none placeholder:text-[#9aa09d] focus:border-2 focus:border-[#0f8b73]"
        />
      </div>
    </>
  );
}

function MedicationSectionReview({ answers, onEdit }: { answers: ReturnType<typeof buildMedicationDemoAssessment>; onEdit: (step: number) => void }) {
  const route = optionsFor("lai_vs_oral").find((option) => option.value === answers.lai_vs_oral)?.label ?? "Not recorded";
  const adherence = answers.medication_adherence === "no"
    ? `No · ${answers.medication_refusals_30_days ?? 0} refusals in the last 30 days`
    : optionsFor("medication_adherence").find((option) => option.value === answers.medication_adherence)?.label ?? "Not recorded";
  const injections = optionsFor("im_injections").find((option) => option.value === answers.im_injections)?.label ?? "Not recorded";
  const rows = [
    { label: "Adherence", value: adherence, step: 0 },
    { label: "Current medications", value: `${answers.medications_at_intake.length} listed · ${route}`, step: 1 },
    { label: "Injection support", value: `${injections}${answers.prn_patterns ? " · PRN pattern recorded" : ""}`, step: 2 },
  ];

  return (
    <>
      <StepHeading title="Review the Medication section" context="Check the section as one clinical unit before moving forward." />
      <div className="mt-8 border-y border-[#dfe4e1]">
        {rows.map((row) => (
          <div key={row.label} className="flex items-start justify-between gap-5 border-b border-[#e5e9e7] py-5 last:border-b-0">
            <div>
              <div className="text-[12px] font-black text-[#303733]">{row.label}</div>
              <div className="mt-1 text-[14px] font-medium leading-6 text-[#626b66]">{row.value}</div>
            </div>
            <button type="button" onClick={() => onEdit(row.step)} className="shrink-0 text-[12px] font-black text-[#0f7b67] hover:text-[#0b5e4f]">Edit</button>
          </div>
        ))}
      </div>
    </>
  );
}

function StepHeading({ title, context }: { title: string; context: string }) {
  return (
    <>
      <h1 className="max-w-[640px] text-[1.8rem] font-black leading-[1.08] text-[#111412] sm:text-[2.65rem]">{title}</h1>
      <p className="mt-3 max-w-[590px] text-[15px] font-medium leading-6 text-[#69716d] sm:mt-4 sm:text-[16px]">{context}</p>
    </>
  );
}

function ChoiceList({ label, options, value, onChange, compact = false }: { label: string; options: readonly AssessmentQuestionOption[]; value: string | null; onChange: (value: string) => void; compact?: boolean }) {
  return (
    <div className={compact ? "grid gap-2 sm:grid-cols-2" : "grid gap-2 sm:gap-3"} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`flex min-h-14 w-full items-center justify-between border px-4 text-left text-[15px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73] sm:min-h-[62px] sm:px-5 ${selected ? "border-2 border-[#0f8b73] bg-[#f7fbf9] text-[#0b5f50]" : "border-[#d9dddb] bg-white text-[#222724] hover:border-[#91ada3] hover:bg-[#fafcfb]"}`}
          >
            <span>{option.label}</span>
            {selected ? <Check size={18} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function LabeledInput({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: "text" | "date" | "number" }) {
  const id = `medication-${label.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <label htmlFor={id} className="block">
      <span className="text-[12px] font-black text-[#303733]">{label}</span>
      <input id={id} type={type} min={type === "number" ? 0 : undefined} value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 h-13 w-full border border-[#d9dddb] bg-white px-4 text-[15px] font-bold text-[#202522] outline-none focus:border-2 focus:border-[#0f8b73]" />
    </label>
  );
}

function UnableReason({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="mt-8 border-t border-[#dfe4e1] pt-7">
      <label htmlFor="unable-reason" className="text-[13px] font-black text-[#303733]">Why can’t this be assessed?</label>
      <textarea id="unable-reason" value={value} onChange={(event) => onChange(event.target.value)} rows={3} className="mt-2 min-h-[100px] w-full resize-y border border-[#d9dddb] bg-white px-4 py-3 text-[15px] font-medium leading-6 outline-none focus:border-2 focus:border-[#0f8b73]" />
    </div>
  );
}

function SectionComplete({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[660px] flex-col justify-center py-8">
      <span className="flex size-12 items-center justify-center bg-[#e8f5f0] text-[#0f8b73]"><Check size={24} aria-hidden="true" /></span>
      <div className="mt-7 text-[11px] font-black uppercase tracking-[0.08em] text-[#0f8b73]">Medication</div>
      <h1 className="mt-3 text-[clamp(2rem,4vw,2.65rem)] font-black leading-[1.08]">Section complete</h1>
      <p className="mt-4 max-w-[540px] text-[16px] font-medium leading-7 text-[#69716d]">The answers are ready to join the rest of Taylor Rivera’s assessment. The live version would autosave after every change.</p>
      <div className="mt-9 grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={onBack} className="h-13 border border-[#cdd4d1] px-5 text-[13px] font-black text-[#36403b] hover:border-[#0f8b73] hover:text-[#0f8b73]">Back to review</button>
        <button type="button" onClick={onClose} className="h-13 bg-[#111412] px-5 text-[13px] font-black text-white hover:bg-[#0f8b73]">Back to Learning Center</button>
      </div>
    </div>
  );
}
