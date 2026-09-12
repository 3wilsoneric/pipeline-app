import { ChevronDown, Play, X } from "lucide-react";

import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";

type AssessmentScheduleMethod = "in_person" | "phone" | "zoom" | "record_review";

const scheduleDetailFields = {
  in_person: { label: "Assessment address", placeholder: "Street address, facility, and room", type: "text" },
  phone: { label: "Phone number to call", placeholder: "Phone number and extension, if needed", type: "tel" },
  zoom: { label: "Zoom meeting link", placeholder: "https://zoom.us/j/…", type: "url" },
  record_review: null,
} as const;

export function AssessmentSchedulingDialogs({
  assessment,
  showScheduleDialog,
  showBeginDialog,
  isBusy,
  error,
  canEditClinical,
  scheduleStart,
  scheduleDuration,
  scheduleMethod,
  scheduleLocation,
  onScheduleStartChange,
  onScheduleDurationChange,
  onScheduleMethodChange,
  onScheduleLocationChange,
  onCloseSchedule,
  onSaveSchedule,
  onCloseBegin,
  onBeginAssessment,
}: {
  assessment: PipelineAssessmentRecord;
  showScheduleDialog: boolean;
  showBeginDialog: boolean;
  isBusy: boolean;
  error: string;
  canEditClinical: boolean;
  scheduleStart: string;
  scheduleDuration: string;
  scheduleMethod: AssessmentScheduleMethod;
  scheduleLocation: string;
  onScheduleStartChange: (value: string) => void;
  onScheduleDurationChange: (value: string) => void;
  onScheduleMethodChange: (value: AssessmentScheduleMethod) => void;
  onScheduleLocationChange: (value: string) => void;
  onCloseSchedule: () => void;
  onSaveSchedule: () => void;
  onCloseBegin: () => void;
  onBeginAssessment: () => void;
}) {
  return (
    <>
      {showScheduleDialog ? <ScheduleAssessmentDialog assessment={assessment} isBusy={isBusy} error={error} scheduleStart={scheduleStart} scheduleDuration={scheduleDuration} scheduleMethod={scheduleMethod} scheduleLocation={scheduleLocation} onScheduleStartChange={onScheduleStartChange} onScheduleDurationChange={onScheduleDurationChange} onScheduleMethodChange={onScheduleMethodChange} onScheduleLocationChange={onScheduleLocationChange} onClose={onCloseSchedule} onSave={onSaveSchedule} /> : null}
      {showBeginDialog ? <BeginAssessmentDialog assessment={assessment} isBusy={isBusy} error={error} canEditClinical={canEditClinical} onClose={onCloseBegin} onBegin={onBeginAssessment} /> : null}
    </>
  );
}

function ScheduleAssessmentDialog({ assessment, isBusy, error, scheduleStart, scheduleDuration, scheduleMethod, scheduleLocation, onScheduleStartChange, onScheduleDurationChange, onScheduleMethodChange, onScheduleLocationChange, onClose, onSave }: {
  assessment: PipelineAssessmentRecord;
  isBusy: boolean;
  error: string;
  scheduleStart: string;
  scheduleDuration: string;
  scheduleMethod: AssessmentScheduleMethod;
  scheduleLocation: string;
  onScheduleStartChange: (value: string) => void;
  onScheduleDurationChange: (value: string) => void;
  onScheduleMethodChange: (value: AssessmentScheduleMethod) => void;
  onScheduleLocationChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const detailField = scheduleDetailFields[scheduleMethod];
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-0 sm:p-5">
          <section role="dialog" aria-modal="true" aria-label="Schedule assessment" className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-[0_24px_80px_rgba(17,17,17,0.24)] sm:h-auto sm:max-w-[640px]">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#d9dfdb] px-5 py-4 sm:px-7 sm:py-5">
              <div>
                <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">Assigned to {assessment.assessor || "Unassigned"}</div>
                <h3 className="mt-1 text-[22px] font-black">{assessment.scheduled_start_at ? "Reschedule assessment" : "Schedule assessment"}</h3>
                <p className="mt-1 max-w-[520px] text-[11px] leading-5 text-[#737373]">Set the interview time once. It will appear on the assigned assessor calendar and remain attached to this referral.</p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close schedule" className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#d6ddd9] text-[#444444] hover:border-[#0f8b73] hover:text-[#0f8b73]"><X size={18} /></button>
            </header>

            <div data-guide-target="assessment-schedule-open" className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
              {assessment.scheduled_start_at ? <div className="mb-5 border-l-2 border-[#0f8b73] bg-[#f4f8f6] px-4 py-3 text-[11px] text-[#315e50]">Currently scheduled for <strong>{new Date(assessment.scheduled_start_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "short" })}</strong>.</div> : null}
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
                <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Date and time (Pacific)</span><input data-guide-target="assessment-schedule-fields" aria-label="Assessment date and time" type="datetime-local" value={scheduleStart} onChange={(event) => onScheduleStartChange(event.target.value)} className="mt-1 h-11 w-full border border-[#c9ceca] bg-white px-3 text-[12px] outline-none focus:border-[#0f8b73]" /></label>
                <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Duration</span><span className="relative mt-1 block"><select aria-label="Assessment duration" value={scheduleDuration} onChange={(event) => onScheduleDurationChange(event.target.value)} className="h-11 w-full appearance-none border border-[#c9ceca] bg-white px-3 pr-9 text-[12px] outline-none hover:border-[#8ca59c] focus:border-[#0f8b73]"><option value="30">30 min</option><option value="45">45 min</option><option value="60">60 min</option><option value="90">90 min</option><option value="120">2 hours</option></select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#737373]" /></span></label>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">Method</span><span className="relative mt-1 block"><select data-guide-target="assessment-schedule-method" aria-label="Assessment method" value={scheduleMethod} onChange={(event) => onScheduleMethodChange(event.target.value as AssessmentScheduleMethod)} className="h-11 w-full appearance-none border border-[#c9ceca] bg-white px-3 pr-9 text-[12px] outline-none hover:border-[#8ca59c] focus:border-[#0f8b73]"><option value="in_person">In person</option><option value="zoom">Zoom</option><option value="phone">Phone</option><option value="record_review">Record review</option></select><ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#737373]" /></span></label>
                {detailField ? <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#595959]">{detailField.label}</span><input aria-label={detailField.label} type={detailField.type} placeholder={detailField.placeholder} value={scheduleLocation} maxLength={500} onChange={(event) => onScheduleLocationChange(event.target.value)} className="mt-1 h-11 w-full border border-[#c9ceca] bg-white px-3 text-[12px] outline-none focus:border-[#0f8b73]" /></label> : null}
              </div>
              {error ? <div role="alert" className="mt-4 text-[11px] font-semibold text-[#a63d2f]">{error}</div> : null}
            </div>

            <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-[#d9dfdb] bg-[#f8faf9] px-5 py-4 sm:px-7">
              <button type="button" onClick={onClose} className="h-10 border border-[#c9ceca] bg-white px-4 text-[11px] font-black hover:border-[#0f8b73] hover:text-[#0f8b73]">Back to workspace</button>
              <button type="button" data-guide-target="assessment-schedule-save" onClick={onSave} disabled={isBusy || !scheduleStart || Number(scheduleDuration) < 15} className="h-10 bg-[#111111] px-5 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:bg-[#c9ceca]">{isBusy ? "Saving..." : assessment.scheduled_start_at ? "Save new time" : "Schedule assessment"}</button>
            </footer>
          </section>
    </div>
  );
}

function BeginAssessmentDialog({ assessment, isBusy, error, canEditClinical, onClose, onBegin }: {
  assessment: PipelineAssessmentRecord;
  isBusy: boolean;
  error: string;
  canEditClinical: boolean;
  onClose: () => void;
  onBegin: () => void;
}) {
  const detailField = assessment.scheduled_method ? scheduleDetailFields[assessment.scheduled_method] : null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4">
          <section role="dialog" aria-modal="true" aria-label="Begin assessment" className="w-full max-w-[500px] bg-white shadow-[0_24px_80px_rgba(17,17,17,0.24)]">
            <header className="border-b border-[#d9dfdb] px-6 py-5">
              <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f8b73]">{assessment.assessor || "Assigned assessor"}</div>
              <h3 className="mt-1 text-[23px] font-black">Begin assessment</h3>
              <p className="mt-2 text-[11px] leading-5 text-[#737373]">Starting records the interview start time and unlocks the questionnaire. Every answer saves back to this assessment as you work.</p>
            </header>
            <div className="px-6 py-5">
              <dl className="divide-y divide-[#e1e4e2] border-y border-[#e1e4e2]">
                <BeginAssessmentDetail label="Scheduled" value={assessment.scheduled_start_at ? new Date(assessment.scheduled_start_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "short" }) : "Not scheduled"} />
                <BeginAssessmentDetail label="Method" value={formatScheduleMethod(assessment.scheduled_method)} />
                {assessment.scheduled_location && detailField ? <BeginAssessmentDetail label={detailField.label} value={assessment.scheduled_location} /> : null}
              </dl>
              {error ? <div role="alert" className="mt-4 text-[11px] font-semibold text-[#a63d2f]">{error}</div> : null}
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-[#d9dfdb] bg-[#f8faf9] px-6 py-4">
              <button type="button" onClick={onClose} className="h-10 border border-[#c9ceca] bg-white px-4 text-[11px] font-black hover:border-[#0f8b73] hover:text-[#0f8b73]">Back to workspace</button>
              <button type="button" data-guide-target="assessment-begin-confirm" onClick={onBegin} disabled={isBusy || !canEditClinical} className="flex h-10 items-center gap-2 bg-[#111111] px-5 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:opacity-45"><Play size={13} fill="currentColor" /> {isBusy ? "Starting..." : "Begin assessment"}</button>
            </footer>
          </section>
    </div>
  );
}

function BeginAssessmentDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-[10px] font-black uppercase tracking-[0.08em] text-[#737373]">{label}</dt>
      <dd className="max-w-[68%] text-right text-[11px] font-semibold text-[#303638]">{value}</dd>
    </div>
  );
}

function formatScheduleMethod(method: PipelineAssessmentRecord["scheduled_method"]) {
  if (!method) return "Not recorded";
  if (method === "in_person") return "In person";
  if (method === "zoom") return "Zoom";
  if (method === "record_review") return "Record review";
  return method[0].toUpperCase() + method.slice(1);
}
