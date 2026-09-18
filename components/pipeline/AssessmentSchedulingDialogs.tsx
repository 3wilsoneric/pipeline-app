import { ChevronDown, Play, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";

import type { AssessmentScheduleMethod, PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";

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
      {showScheduleDialog ? <ScheduleAssessmentDialog assessment={assessment} isBusy={isBusy} error={error} canEditClinical={canEditClinical} scheduleStart={scheduleStart} scheduleDuration={scheduleDuration} scheduleMethod={scheduleMethod} scheduleLocation={scheduleLocation} onScheduleStartChange={onScheduleStartChange} onScheduleDurationChange={onScheduleDurationChange} onScheduleMethodChange={onScheduleMethodChange} onScheduleLocationChange={onScheduleLocationChange} onClose={onCloseSchedule} onSave={onSaveSchedule} onBegin={onBeginAssessment} /> : null}
      {showBeginDialog ? <BeginAssessmentDialog assessment={assessment} isBusy={isBusy} error={error} canEditClinical={canEditClinical} onClose={onCloseBegin} onBegin={onBeginAssessment} /> : null}
    </>
  );
}

function ScheduleAssessmentDialog({ assessment, isBusy, error, canEditClinical, scheduleStart, scheduleDuration, scheduleMethod, scheduleLocation, onScheduleStartChange, onScheduleDurationChange, onScheduleMethodChange, onScheduleLocationChange, onClose, onSave, onBegin }: {
  assessment: PipelineAssessmentRecord;
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
  onClose: () => void;
  onSave: () => void;
  onBegin: () => void;
}) {
  const detailField = scheduleDetailFields[scheduleMethod];
  return (
    <AssessmentScheduleLayout
      label="Schedule assessment"
      title={assessment.scheduled_start_at ? "Reschedule assessment" : "Schedule assessment"}
      context={<>{formatClientIdentityTitle({ name: assessment.resident_name || "Client", community: assessment.community })}<span className="text-[#626a66]">Assigned to {assessment.assessor || "Unassigned"}</span></>}
      closeLabel="Close schedule"
      isBusy={isBusy}
      error={error}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className="min-h-12 px-4 font-bold text-[#59635d] hover:bg-[#f1f4f2] hover:text-[#0f7664] disabled:opacity-50">Back to questionnaire</button>
        {!assessment.started_at && !assessment.signed_at && canEditClinical ? <button type="button" onClick={onBegin} disabled={isBusy} className="min-h-12 border border-[#bac8c0] px-4 font-bold text-[#0f7664] hover:bg-[#f1f4f2] disabled:opacity-50">Continue without appointment</button> : null}
        <button type="button" data-guide-target="assessment-schedule-save" onClick={onSave} disabled={isBusy || !scheduleStart || Number(scheduleDuration) < 15} className="min-h-12 bg-[#111111] px-6 font-bold text-white hover:bg-[#0f8b73] disabled:cursor-not-allowed disabled:bg-[#c9ceca]">{isBusy ? "Saving..." : assessment.scheduled_start_at ? "Save new time" : "Schedule assessment"}</button>
      </>}
    >
      <div data-guide-target="assessment-schedule-open" className="space-y-7">
        {assessment.scheduled_start_at ? <p className="border-l-2 border-[#0f8b73] bg-[#f4f8f6] px-4 py-3 text-[14px] leading-6 text-[#315e50]">Currently scheduled for <strong>{new Date(assessment.scheduled_start_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "short" })}</strong>.</p> : null}
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_200px]">
          <label className="min-w-0"><span className="mb-2 block text-[14px] font-bold text-[#303a34]">Date and time <span className="font-normal text-[#626a66]">(Pacific)</span></span><input data-guide-target="assessment-schedule-fields" data-schedule-autofocus aria-label="Assessment date and time" type="datetime-local" value={scheduleStart} onChange={(event) => onScheduleStartChange(event.target.value)} /></label>
          <label className="min-w-0"><span className="mb-2 block text-[14px] font-bold text-[#303a34]">Duration</span><span className="relative block"><select aria-label="Assessment duration" value={scheduleDuration} onChange={(event) => onScheduleDurationChange(event.target.value)} className="appearance-none pr-10"><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option><option value="120">2 hours</option></select><ChevronDown size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#737373]" /></span></label>
        </div>
        <label className="block"><span className="mb-2 block text-[14px] font-bold text-[#303a34]">Method</span><span className="relative block"><select data-guide-target="assessment-schedule-method" aria-label="Assessment method" value={scheduleMethod} onChange={(event) => onScheduleMethodChange(event.target.value as AssessmentScheduleMethod)} className="appearance-none pr-10"><option value="in_person">In person</option><option value="zoom">Zoom</option><option value="phone">Phone</option><option value="record_review">Record review</option></select><ChevronDown size={18} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[#737373]" /></span></label>
        {detailField ? <label className="block"><span className="mb-2 block text-[14px] font-bold text-[#303a34]">{detailField.label}</span><input aria-label={detailField.label} type={detailField.type} placeholder={detailField.placeholder} value={scheduleLocation} maxLength={500} onChange={(event) => onScheduleLocationChange(event.target.value)} /></label> : null}
      </div>
    </AssessmentScheduleLayout>
  );
}

export function AssessmentScheduleLayout({ label, title, context, closeLabel, isBusy, error, onClose, children, footer }: {
  label: string;
  title: string;
  context: ReactNode;
  closeLabel: string;
  isBusy: boolean;
  error: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const handleModalKey = useEffectEvent((event: KeyboardEvent) => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const coach = document.querySelector<HTMLElement>('[data-testid="guided-coach-panel"]');
    const visibleCoach = coach?.getClientRects().length ? coach : null;
    if (event.key === "Tab") {
      cycleSchedulingFocus(event, dialog, visibleCoach);
      return;
    }
    if (event.key !== "Escape") return;
    if (CSS.supports("selector(select:open)") && dialog.querySelector("select:open")) {
      event.stopImmediatePropagation();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (visibleCoach) {
      visibleCoach.querySelector<HTMLButtonElement>('button[aria-label="Pause tutorial"]')?.click();
      (dialog.querySelector<HTMLElement>("[data-schedule-autofocus]:not(:disabled)") ?? dialog).focus();
      return;
    }
    onClose();
  });
  useEffect(() => {
    const previousFocus = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>("[data-schedule-autofocus]")?.focus();
    window.addEventListener("keydown", handleModalKey, true);
    return () => {
      window.removeEventListener("keydown", handleModalKey, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-label={label} aria-busy={isBusy} tabIndex={-1} data-assessment-scheduling="fullscreen" className="fixed inset-0 z-[100] flex h-[100dvh] min-w-0 flex-col overflow-hidden bg-white text-[#202822]">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#d9dfdb] px-5 py-5 sm:px-10 sm:py-6">
        <div className="min-w-0">
          <h2 className="text-[22px] font-black leading-7 sm:text-[24px]">{title}</h2>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[14px] font-semibold leading-6 [overflow-wrap:anywhere]">{context}</div>
        </div>
        <button type="button" onClick={onClose} aria-label={closeLabel} title={closeLabel} className="flex h-11 w-11 shrink-0 items-center justify-center text-[#4d534f] hover:bg-[#f1f4f2] hover:text-[#0f7664] focus-visible:outline-2 focus-visible:outline-[#0f8b73] disabled:opacity-50"><X size={22} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <fieldset disabled={isBusy} className="mx-auto w-full min-w-0 max-w-[840px] px-5 py-7 sm:px-10 sm:py-12 [&_input]:h-14 [&_input]:w-full [&_input]:min-w-0 [&_input]:rounded-[2px] [&_input]:border [&_input]:border-[#bac8c0] [&_input]:bg-white [&_input]:px-4 [&_input]:text-[16px] [&_input]:outline-none [&_input:focus]:border-[#0f8b73] [&_input:focus]:ring-1 [&_input:focus]:ring-[#0f8b73] [&_select]:h-14 [&_select]:w-full [&_select]:min-w-0 [&_select]:rounded-[2px] [&_select]:border [&_select]:border-[#bac8c0] [&_select]:bg-white [&_select]:px-4 [&_select]:text-[16px] [&_select]:outline-none [&_select:focus]:border-[#0f8b73] [&_select:focus]:ring-1 [&_select:focus]:ring-[#0f8b73] disabled:opacity-60">{children}</fieldset>
      </div>
      {error ? <div role="alert" className="shrink-0 bg-[#f7faf9] px-5 py-3 text-[14px] font-semibold leading-6 text-[#59645e] sm:px-10">{error}</div> : null}
      <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[#d9dfdb] bg-white px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-[14px] sm:px-10 sm:pt-5 sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] [&_button]:max-w-full [&_button]:flex-1 [&_button]:rounded-[2px] [&_button]:leading-5 sm:[&_button]:flex-none [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-[#0f8b73]">{footer}</footer>
    </section>
  );
}

function cycleSchedulingFocus(event: KeyboardEvent, dialog: HTMLElement, coach: HTMLElement | null) {
  const roots = coach ? [dialog, coach] : [dialog];
  const groups = roots.map((root) => [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]')].filter((control) => !control.closest("fieldset:disabled") && control.getClientRects().length > 0)).filter((group) => group.length > 0);
  const activeGroup = groups.find((group) => group.includes(document.activeElement as HTMLElement));
  // Only intercept group boundaries, preserving native date/time field tab stops.
  if (activeGroup && document.activeElement !== (event.shiftKey ? activeGroup[0] : activeGroup.at(-1))) return;
  event.preventDefault();
  const direction = event.shiftKey ? -1 : 1;
  const groupIndex = activeGroup ? (groups.indexOf(activeGroup) + direction + groups.length) % groups.length : 0;
  const nextGroup = groups[groupIndex] ?? [];
  ((event.shiftKey ? nextGroup.at(-1) : nextGroup[0]) ?? dialog).focus();
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
              <p className="mt-2 text-[13px] leading-5 text-[#737373]">Your prepared answers stay here. Begin when the interview starts; complete or update them as you go.</p>
            </header>
            <div className="px-6 py-5">
              <dl className="divide-y divide-[#e1e4e2] border-y border-[#e1e4e2]">
                <BeginAssessmentDetail label="Scheduled" value={assessment.scheduled_start_at ? new Date(assessment.scheduled_start_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "short" }) : "Not scheduled"} />
                <BeginAssessmentDetail label="Method" value={formatScheduleMethod(assessment.scheduled_method)} />
                {assessment.scheduled_location && detailField ? <BeginAssessmentDetail label={detailField.label} value={assessment.scheduled_location} /> : null}
              </dl>
              {error ? <div role="alert" className="mt-4 text-[11px] font-semibold text-[#9aa7a0]">{error}</div> : null}
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-[#d9dfdb] bg-[#f8faf9] px-6 py-4">
              <button type="button" onClick={onClose} className="h-10 border border-[#c9ceca] bg-white px-4 text-[11px] font-black hover:border-[#0f8b73] hover:text-[#0f8b73] disabled:opacity-50">Back to questionnaire</button>
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
