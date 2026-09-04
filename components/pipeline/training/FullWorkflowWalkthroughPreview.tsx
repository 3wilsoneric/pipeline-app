"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  Play,
  RotateCcw,
  ShieldCheck,
  UserCheck,
  X,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

type WalkthroughState = {
  step: number;
  appointment: {
    date: string;
    time: string;
    duration: string;
    method: string;
    location: string;
  };
  appointmentSaved: boolean;
  interviewStarted: boolean;
  assessment: {
    medicationCompliant: string;
    adlSupport: string;
    ambulatory: string;
    substanceUse: string;
    summary: string;
  };
  recommendation: string;
  recommendationReason: string;
  decision: string;
  decisionReason: string;
};

const stages = [
  { id: "referral", label: "Referral", icon: UserCheck },
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "begin", label: "Begin", icon: Play },
  { id: "assessment", label: "Assessment", icon: ClipboardCheck },
  { id: "recommendation", label: "Recommendation", icon: FileCheck2 },
  { id: "decision", label: "Decision", icon: ShieldCheck },
  { id: "complete", label: "Complete", icon: Check },
] as const;

const emptyState = (): WalkthroughState => ({
  step: 0,
  appointment: { date: "", time: "", duration: "60", method: "Video", location: "" },
  appointmentSaved: false,
  interviewStarted: false,
  assessment: {
    medicationCompliant: "",
    adlSupport: "",
    ambulatory: "",
    substanceUse: "",
    summary: "",
  },
  recommendation: "",
  recommendationReason: "",
  decision: "",
  decisionReason: "",
});

const subscribeToClient = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export default function FullWorkflowWalkthroughPreview({
  onClose,
  onStartGuide,
}: {
  onClose: () => void;
  onStartGuide?: () => void;
}) {
  const mounted = useSyncExternalStore(subscribeToClient, getClientSnapshot, getServerSnapshot);
  const [workflow, setWorkflow] = useState<WalkthroughState>(emptyState);
  const [error, setError] = useState("");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  if (!mounted) return null;

  const stage = stages[workflow.step];
  const finalStep = workflow.step === stages.length - 1;

  function continueWorkflow() {
    const validationError = validateStep(workflow);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setWorkflow((current) => advanceCompletedStep(current));
  }

  function skipStep() {
    setError("");
    setWorkflow((current) => advanceCompletedStep(completeSyntheticStep(current)));
  }

  function goBack() {
    setError("");
    setWorkflow((current) => ({ ...current, step: Math.max(0, current.step - 1) }));
  }

  return createPortal(
    <div className="fixed inset-0 z-[140] bg-white">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Full Pipeline walkthrough"
        className="flex h-dvh min-h-0 flex-col bg-white text-[#1d2421]"
      >
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-[#d5ddda] px-4 py-3 sm:px-7">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase text-[#0f7c68]">Synthetic practice</div>
            <h2 className="mt-1 truncate text-[20px] font-black sm:text-[24px]">Referral to decision</h2>
          </div>
          <button
            type="button"
            aria-label="Close full walkthrough"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center border border-[#cbd5d1] text-[#56615c] hover:border-[#0f8b73] hover:text-[#0f7c68]"
          >
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        <nav aria-label="Walkthrough progress" className="shrink-0 overflow-x-auto border-b border-[#d5ddda] bg-[#fafcfb]">
          <ol className="mx-auto flex min-w-max max-w-[1500px] px-3 sm:px-6">
            {stages.map((item, index) => {
              const Icon = item.icon;
              const reached = index <= workflow.step;
              return (
                <li key={item.id} className="flex items-center">
                  <button
                    type="button"
                    disabled={index > workflow.step}
                    aria-current={index === workflow.step ? "step" : undefined}
                    onClick={() => setWorkflow((current) => ({ ...current, step: index }))}
                    className={`flex h-14 items-center gap-2 border-b-2 px-3 text-[11px] font-black disabled:cursor-default sm:px-4 ${index === workflow.step ? "border-[#0f8b73] bg-[#eaf5f1] text-[#0c705f]" : reached ? "border-transparent text-[#42504a] hover:bg-[#f2f6f4]" : "border-transparent text-[#9aa39f]"}`}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                  {index < stages.length - 1 ? <ArrowRight size={12} className="text-[#b7c0bc]" aria-hidden="true" /> : null}
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto grid min-h-full w-full max-w-[1500px] lg:grid-cols-[minmax(0,1fr)_360px]">
            <main className="min-w-0 px-5 py-7 sm:px-9 sm:py-10 lg:px-12 xl:px-16">
              <div className="mx-auto max-w-[900px]">
                <div className="text-[10px] font-black uppercase text-[#0f7c68]">Step {workflow.step + 1} of {stages.length}</div>
                <h3 className="mt-2 text-[30px] font-black leading-9 sm:text-[38px] sm:leading-[44px]">{stageTitle(stage.id)}</h3>
                <p className="mt-3 max-w-[720px] text-[15px] font-medium leading-6 text-[#63706a]">{stageDescription(stage.id)}</p>
                <div className="mt-8 border-t border-[#d7dfdc] pt-7">
                  <StageContent workflow={workflow} setWorkflow={setWorkflow} />
                </div>
                {error ? <p role="alert" className="mt-5 border-l-2 border-[#b14b3f] pl-3 text-[13px] font-bold text-[#963f35]">{error}</p> : null}
              </div>
            </main>

            <aside className="border-t border-[#d5ddda] bg-[#f5f8f6] px-5 py-7 sm:px-8 lg:border-l lg:border-t-0 lg:py-10">
              <div className="lg:sticky lg:top-8">
                <div className="text-[10px] font-black uppercase text-[#0f7c68]">Do this</div>
                <p className="mt-2 text-[21px] font-black leading-7 text-[#244b40]">{stageInstruction(stage.id)}</p>
                <div className="mt-6 border-l-2 border-[#0f8b73] pl-4">
                  <div className="text-[10px] font-black uppercase text-[#5c6963]">What changes</div>
                  <p className="mt-2 text-[13px] font-semibold leading-5 text-[#56635d]">{stageOutcome(stage.id)}</p>
                </div>
                <div className="mt-7 flex items-start gap-3 border-t border-[#d5ddda] pt-5 text-[12px] font-semibold leading-5 text-[#66716d]">
                  <ShieldCheck size={17} className="mt-0.5 shrink-0 text-[#0f8b73]" aria-hidden="true" />
                  <p>This case is synthetic. Skipping completes only the current practice checkpoint and never changes a client record.</p>
                </div>
              </div>
            </aside>
          </div>
        </div>

        <footer className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-t border-[#cfd8d4] bg-white px-4 py-3 sm:px-7">
          <button type="button" disabled={workflow.step === 0} onClick={goBack} className="flex h-11 items-center gap-2 px-2 text-[12px] font-black text-[#5e6964] disabled:invisible">
            <ArrowLeft size={15} aria-hidden="true" /> Back
          </button>
          {finalStep ? (
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => { setWorkflow(emptyState()); setError(""); }} className="flex h-11 items-center gap-2 px-3 text-[12px] font-black text-[#5e6964] hover:text-[#0f7c68]">
                <RotateCcw size={15} aria-hidden="true" /> Run again
              </button>
              <button type="button" onClick={onStartGuide ?? onClose} className="flex h-11 items-center gap-2 bg-[#0f8b73] px-5 text-[12px] font-black text-white hover:bg-[#0b715e]">
                {onStartGuide ? "Start guided tour" : "Finish"}
                {onStartGuide ? <ArrowRight size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button type="button" onClick={skipStep} className="h-11 px-3 text-[12px] font-black text-[#65706b] hover:text-[#111111]">Skip and simulate</button>
              <button type="button" onClick={continueWorkflow} className="flex h-11 items-center gap-2 bg-[#0f8b73] px-5 text-[12px] font-black text-white hover:bg-[#0b715e]">
                {continueLabel(workflow.step)}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function StageContent({ workflow, setWorkflow }: { workflow: WalkthroughState; setWorkflow: React.Dispatch<React.SetStateAction<WalkthroughState>> }) {
  if (workflow.step === 0) {
    return (
      <div className="grid gap-5 sm:grid-cols-2">
        <Definition label="Client" value="Taylor Rivera" />
        <Definition label="Workspace" value="Synthetic referral" />
        <Definition label="Assigned assessor" value="Alex Morgan" />
        <Definition label="Referral source" value="County behavioral health" />
        <div className="sm:col-span-2"><Definition label="Initial packet" value="Face sheet and referral packet attached" /></div>
      </div>
    );
  }

  if (workflow.step === 1) {
    const updateAppointment = (field: keyof WalkthroughState["appointment"], value: string) => {
      setWorkflow((current) => ({ ...current, appointment: { ...current.appointment, [field]: value }, appointmentSaved: false }));
    };
    return (
      <div className="grid gap-5 sm:grid-cols-2" data-testid="workflow-schedule-form">
        <Field label="Date"><input aria-label="Assessment date" type="date" value={workflow.appointment.date} onChange={(event) => updateAppointment("date", event.target.value)} className={inputClass} /></Field>
        <Field label="Time"><input aria-label="Assessment time" type="time" value={workflow.appointment.time} onChange={(event) => updateAppointment("time", event.target.value)} className={inputClass} /></Field>
        <Field label="Duration"><select aria-label="Assessment duration" value={workflow.appointment.duration} onChange={(event) => updateAppointment("duration", event.target.value)} className={inputClass}><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option></select></Field>
        <Field label="Method"><select aria-label="Assessment method" value={workflow.appointment.method} onChange={(event) => updateAppointment("method", event.target.value)} className={inputClass}><option>Video</option><option>Phone</option><option>In person</option></select></Field>
        <div className="sm:col-span-2"><Field label={workflow.appointment.method === "Video" ? "Meeting link" : "Location or phone"}><input aria-label="Assessment location" value={workflow.appointment.location} onChange={(event) => updateAppointment("location", event.target.value)} placeholder="Add the link or location" className={inputClass} /></Field></div>
      </div>
    );
  }

  if (workflow.step === 2) {
    return (
      <div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Definition label="Client" value="Taylor Rivera" />
          <Definition label="Assessor" value="Alex Morgan" />
          <Definition label="Appointment" value={`${formatSyntheticDate(workflow.appointment.date)} at ${formatSyntheticTime(workflow.appointment.time)}`} />
          <Definition label="Method" value={`${workflow.appointment.method}${workflow.appointment.location ? ` · ${workflow.appointment.location}` : ""}`} />
        </div>
        <p className="mt-7 flex items-start gap-3 border-l-2 border-[#c9851b] pl-4 text-[13px] font-semibold leading-5 text-[#69552b]"><Clock3 size={17} className="mt-0.5 shrink-0" aria-hidden="true" />Beginning records the interview start and makes the assessment form editable.</p>
      </div>
    );
  }

  if (workflow.step === 3) {
    const updateAssessment = (field: keyof WalkthroughState["assessment"], value: string) => setWorkflow((current) => ({ ...current, assessment: { ...current.assessment, [field]: value } }));
    return (
      <div className="space-y-7" data-testid="workflow-assessment-form">
        <Question label="Medication compliant" value={workflow.assessment.medicationCompliant} onChange={(value) => updateAssessment("medicationCompliant", value)} options={["Yes", "No", "Unknown"]} />
        <Question label="ADL support required" value={workflow.assessment.adlSupport} onChange={(value) => updateAssessment("adlSupport", value)} options={["Independent", "Some assistance", "Total assistance"]} />
        <Question label="Ambulatory" value={workflow.assessment.ambulatory} onChange={(value) => updateAssessment("ambulatory", value)} options={["Yes", "No", "With support"]} />
        <Question label="Active substance use" value={workflow.assessment.substanceUse} onChange={(value) => updateAssessment("substanceUse", value)} options={["No", "Yes", "Unable to assess"]} />
        <Field label="Assessment summary"><textarea aria-label="Assessment summary" value={workflow.assessment.summary} onChange={(event) => updateAssessment("summary", event.target.value)} rows={5} placeholder="Record the current presentation, relevant history, support needs, and source." className={`${inputClass} min-h-32 resize-y py-3`} /></Field>
      </div>
    );
  }

  if (workflow.step === 4) {
    return (
      <div className="space-y-6">
        <Question label="Assessor recommendation" value={workflow.recommendation} onChange={(value) => setWorkflow((current) => ({ ...current, recommendation: value }))} options={["Recommend admission", "Need more information", "Do not recommend"]} />
        <Field label="Clinical rationale"><textarea aria-label="Recommendation rationale" value={workflow.recommendationReason} onChange={(event) => setWorkflow((current) => ({ ...current, recommendationReason: event.target.value }))} rows={4} placeholder="Summarize the evidence that supports the recommendation." className={`${inputClass} min-h-28 resize-y py-3`} /></Field>
      </div>
    );
  }

  if (workflow.step === 5) {
    return (
      <div className="space-y-7">
        <div className="border-l-2 border-[#0f8b73] pl-4"><div className="text-[10px] font-black uppercase text-[#0f7c68]">Assessor recommendation</div><p className="mt-1 text-[18px] font-black">{workflow.recommendation}</p><p className="mt-2 text-[13px] font-medium leading-5 text-[#65706b]">{workflow.recommendationReason}</p></div>
        <Question label="Supervisor decision" value={workflow.decision} onChange={(value) => setWorkflow((current) => ({ ...current, decision: value }))} options={["Accepted", "Declined"]} />
        {workflow.decision === "Declined" ? <Field label="Reason for no admission"><textarea aria-label="Decision reason" value={workflow.decisionReason} onChange={(event) => setWorkflow((current) => ({ ...current, decisionReason: event.target.value }))} rows={4} className={`${inputClass} min-h-28 resize-y py-3`} /></Field> : null}
      </div>
    );
  }

  return (
    <div data-testid="workflow-complete-summary">
      <div className="flex items-center gap-3 text-[#0f7c68]"><span className="flex h-11 w-11 items-center justify-center bg-[#e5f3ee]"><Check size={21} aria-hidden="true" /></span><p className="text-[22px] font-black">Practice case complete</p></div>
      <ol className="mt-7 border-y border-[#d7dfdc]">
        <TimelineRow label="Referral assigned" detail="Alex Morgan owns the assessment" />
        <TimelineRow label="Appointment scheduled" detail={`${formatSyntheticDate(workflow.appointment.date)} at ${formatSyntheticTime(workflow.appointment.time)}`} />
        <TimelineRow label="Assessment completed and signed" detail="Interview answers and summary recorded" />
        <TimelineRow label="Recommendation submitted" detail={workflow.recommendation} />
        <TimelineRow label="Decision recorded" detail={workflow.decision} />
      </ol>
    </div>
  );
}

function advanceCompletedStep(state: WalkthroughState): WalkthroughState {
  if (state.step === 1) return { ...state, appointmentSaved: true, step: 2 };
  if (state.step === 2) return { ...state, interviewStarted: true, step: 3 };
  return { ...state, step: Math.min(stages.length - 1, state.step + 1) };
}

function completeSyntheticStep(state: WalkthroughState): WalkthroughState {
  if (state.step === 1) return { ...state, appointment: { date: nextBusinessDate(), time: "10:00", duration: "60", method: "Video", location: "Synthetic meeting link" }, appointmentSaved: true };
  if (state.step === 2) return { ...state, interviewStarted: true };
  if (state.step === 3) return { ...state, assessment: { medicationCompliant: "Yes", adlSupport: "Some assistance", ambulatory: "With support", substanceUse: "No", summary: "Synthetic interview completed. Current presentation, history, support needs, and source were reviewed with the client." } };
  if (state.step === 4) return { ...state, recommendation: "Recommend admission", recommendationReason: "The synthetic assessment supports admission with the documented support plan." };
  if (state.step === 5) return { ...state, decision: "Accepted", decisionReason: "" };
  return state;
}

function validateStep(state: WalkthroughState) {
  if (state.step === 1 && (!state.appointment.date || !state.appointment.time || !state.appointment.method || !state.appointment.location.trim())) return "Add a date, time, method, and meeting link or location.";
  if (state.step === 3 && (!state.assessment.medicationCompliant || !state.assessment.adlSupport || !state.assessment.ambulatory || !state.assessment.substanceUse || !state.assessment.summary.trim())) return "Answer each practice question and add a short assessment summary.";
  if (state.step === 4 && (!state.recommendation || !state.recommendationReason.trim())) return "Choose a recommendation and record its clinical rationale.";
  if (state.step === 5 && (!state.decision || (state.decision === "Declined" && !state.decisionReason.trim()))) return "Record the supervisor decision and explain a declined outcome.";
  return "";
}

function stageTitle(id: (typeof stages)[number]["id"]) {
  return ({ referral: "Start with one assigned referral", schedule: "Schedule the interview", begin: "Verify before you begin", assessment: "Document the assessment", recommendation: "Submit the assessor recommendation", decision: "Record the supervisor decision", complete: "The record moved as one workflow" } as const)[id];
}

function stageDescription(id: (typeof stages)[number]["id"]) {
  return ({ referral: "The initial packet, client identity, and one accountable assessor stay connected in a single workspace.", schedule: "The appointment belongs to this referral and appears on the assigned assessor’s calendar.", begin: "Starting the interview establishes who is documenting and when the assessment began.", assessment: "This abbreviated practice form demonstrates conditional answers and a source-aware narrative. The real assessment contains the full questionnaire.", recommendation: "The assessor completes and signs the assessment before recommending an outcome.", decision: "A supervisor reviews the signed assessment and recommendation, then records the admission outcome.", complete: "Scheduling, assessment, recommendation, and decision are now traceable to the same synthetic referral." } as const)[id];
}

function stageInstruction(id: (typeof stages)[number]["id"]) {
  return ({ referral: "Confirm the client and assignment.", schedule: "Set a complete appointment.", begin: "Check the appointment, then begin.", assessment: "Answer every visible question.", recommendation: "Choose an outcome and explain it.", decision: "Accept or decline the referral.", complete: "Review the recorded timeline." } as const)[id];
}

function stageOutcome(id: (typeof stages)[number]["id"]) {
  return ({ referral: "The referral has one owner and one source record.", schedule: "The assessor and calendar share one appointment.", begin: "The assessment becomes active and editable.", assessment: "The signed clinical record has the facts needed for review.", recommendation: "Supervisor review receives a clear recommendation.", decision: "The workspace receives its final admission outcome.", complete: "Every checkpoint remains attached to this one referral." } as const)[id];
}

function continueLabel(step: number) {
  if (step === 2) return "Begin assessment";
  if (step === 3) return "Complete assessment";
  if (step === 4) return "Submit recommendation";
  if (step === 5) return "Record decision";
  return "Continue";
}

function Definition({ label, value }: { label: string; value: string }) {
  return <div className="border-b border-[#d7dfdc] pb-4"><div className="text-[10px] font-black uppercase text-[#69746f]">{label}</div><div className="mt-2 text-[17px] font-black leading-6 text-[#29312d]">{value}</div></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-2 block text-[11px] font-black uppercase text-[#4f5b56]">{label}</span>{children}</label>;
}

function Question({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <fieldset><legend className="text-[14px] font-black text-[#303834]">{label}</legend><div className="mt-3 flex flex-wrap gap-2">{options.map((option) => <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)} className={`min-h-11 border px-4 text-[12px] font-black ${value === option ? "border-[#0f8b73] bg-[#e5f3ee] text-[#0c705f]" : "border-[#cbd5d1] bg-white text-[#58645e] hover:border-[#7ca99b]"}`}>{option}</button>)}</div></fieldset>;
}

function TimelineRow({ label, detail }: { label: string; detail: string }) {
  return <li className="grid gap-1 border-b border-[#e0e6e3] py-4 last:border-b-0 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-6"><span className="flex items-center gap-2 text-[13px] font-black text-[#27302c]"><Check size={14} className="text-[#0f8b73]" aria-hidden="true" />{label}</span><span className="text-[13px] font-semibold text-[#66716d]">{detail}</span></li>;
}

function nextBusinessDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatSyntheticDate(value: string) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function formatSyntheticTime(value: string) {
  if (!value) return "time pending";
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 1, hour, minute)));
}

const inputClass = "h-12 w-full border border-[#bfcac6] bg-white px-3 text-[14px] font-semibold text-[#26302c] outline-none focus:border-[#0f8b73] focus:ring-1 focus:ring-[#0f8b73]";
