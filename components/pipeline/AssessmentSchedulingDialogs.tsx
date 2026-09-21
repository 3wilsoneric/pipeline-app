
import { ChevronDown, X } from "lucide-react";
import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";

import type { AssessmentScheduleMethod, PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { formatClientIdentityTitle } from "@/lib/pipeline/client-identity-presentation.mjs";
import { useMobileViewport } from "./use-mobile-viewport";
import styles from "./AssessmentPreparation.module.css";

const scheduleDetailFields = {
  in_person: { label: "Assessment address", placeholder: "Street address, facility, and room", type: "text" },
  phone: { label: "Phone number to call", placeholder: "Phone number and extension, if needed", type: "tel" },
  zoom: { label: "Zoom meeting link", placeholder: "https://zoom.us/j/…", type: "url" },
  record_review: null,
} as const;

export function AssessmentSchedulingDialogs({
  assessment,
  showScheduleDialog,
  scheduleModal = true,
  showBeginDialog,
  canEditClinical,
  onCloseBegin,
  onBeginAssessment,
  isBusy,
  error,
  scheduleStart,
  scheduleDuration,
  scheduleMethod,
  scheduleLocation,
  draftStatus,
  onDraftBlur,
  onScheduleStartChange,
  onScheduleDurationChange,
  onScheduleMethodChange,
  onScheduleLocationChange,
  onCloseSchedule,
  onSaveSchedule,
}: {
  assessment: PipelineAssessmentRecord;
  showScheduleDialog: boolean;
  scheduleModal?: boolean;
  showBeginDialog: boolean;
  canEditClinical: boolean;
  onCloseBegin: () => void;
  onBeginAssessment: () => void;
  isBusy: boolean;
  error: string;
  scheduleStart: string;
  scheduleDuration: string;
  scheduleMethod: AssessmentScheduleMethod;
  scheduleLocation: string;
  draftStatus?: string;
  onDraftBlur?: () => void;
  onScheduleStartChange: (value: string) => void;
  onScheduleDurationChange: (value: string) => void;
  onScheduleMethodChange: (value: AssessmentScheduleMethod) => void;
  onScheduleLocationChange: (value: string) => void;
  onCloseSchedule: () => void;
  onSaveSchedule: () => void;
}) {
  return (
    <>
      {showScheduleDialog ? <ScheduleAssessmentDialog modal={scheduleModal} assessment={assessment} isBusy={isBusy} error={error} scheduleStart={scheduleStart} scheduleDuration={scheduleDuration} scheduleMethod={scheduleMethod} scheduleLocation={scheduleLocation} draftStatus={draftStatus} onDraftBlur={onDraftBlur} onScheduleStartChange={onScheduleStartChange} onScheduleDurationChange={onScheduleDurationChange} onScheduleMethodChange={onScheduleMethodChange} onScheduleLocationChange={onScheduleLocationChange} onClose={onCloseSchedule} onSave={onSaveSchedule} /> : null}
      {showBeginDialog ? <BeginAssessmentDialog assessment={assessment} isBusy={isBusy} error={error} canEditClinical={canEditClinical} onClose={onCloseBegin} onBegin={onBeginAssessment} /> : null}
    </>
  );
}

function ScheduleAssessmentDialog({ modal, assessment, isBusy, error, scheduleStart, scheduleDuration, scheduleMethod, scheduleLocation, draftStatus, onDraftBlur, onScheduleStartChange, onScheduleDurationChange, onScheduleMethodChange, onScheduleLocationChange, onClose, onSave }: {
  modal: boolean;
  assessment: PipelineAssessmentRecord;
  isBusy: boolean;
  error: string;
  scheduleStart: string;
  scheduleDuration: string;
  scheduleMethod: AssessmentScheduleMethod;
  scheduleLocation: string;
  draftStatus?: string;
  onDraftBlur?: () => void;
  onScheduleStartChange: (value: string) => void;
  onScheduleDurationChange: (value: string) => void;
  onScheduleMethodChange: (value: AssessmentScheduleMethod) => void;
  onScheduleLocationChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const detailField = scheduleDetailFields[scheduleMethod];
  const labels = assessment.scheduled_start_at
    ? { title: "Change appointment", save: "Save new time" }
    : { title: "Schedule interview", save: scheduleMethod === "record_review" ? "Schedule record review" : "Schedule interview" };
  const renderScheduleActions = () => (<>
        <button type="button" onClick={onClose} disabled={isBusy} className="min-h-12 px-4 font-bold text-[#59635d] hover:bg-[#f1f4f2] hover:text-[#0f7664] disabled:opacity-50">Back to assessment</button>
        <button type="button" data-guide-target="assessment-schedule-save" onClick={onSave} disabled={isBusy || !scheduleStart || Number(scheduleDuration) < 15} className="min-h-12 bg-[#08765e] px-6 font-bold text-white hover:bg-[#065c49] disabled:cursor-not-allowed disabled:bg-[#c9ceca]">{isBusy ? "Saving..." : labels.save}</button>
      </>);
  return (
    <AssessmentScheduleLayout
      modal={modal}
      label="Schedule interview"
      title={labels.title}
      context={<>{formatClientIdentityTitle({ name: assessment.resident_name || "Client", community: assessment.community })}<span className="text-[#626a66]">Assigned to {assessment.assessor || "Unassigned"}</span></>}
      closeLabel="Close schedule"
      isBusy={isBusy}
      error={error}
      onClose={onClose}
      footer={renderScheduleActions()}
    >
      <div data-guide-target="assessment-schedule-open" className="space-y-7" onBlur={onDraftBlur}>
        <p className="text-[14px] leading-6 text-[#59635d]">{assessment.scheduled_start_at ? "Your existing appointment stays booked until you save a new time." : "Not booked yet. Scheduling adds an appointment to the calendar; you can prepare answers before or after booking."}</p>
        {draftStatus ? <p role="status" className="text-[14px] leading-6 text-[#315e50]">{draftStatus}</p> : null}
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

export function AssessmentScheduleLayout({ modal = true, label, title, context, closeLabel, isBusy, error, onClose, children, footer }: {
  modal?: boolean;
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
  const viewportRef = useMobileViewport();
  const dialogRef = useRef<HTMLElement>(null);
  const handleModalKey = useEffectEvent((event: KeyboardEvent) => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const coach = document.querySelector<HTMLElement>('[data-testid="guided-coach-panel"]');
    const visibleCoach = coach?.getClientRects().length ? coach : null;
    if (event.key === "Tab") {
      if (modal) cycleSchedulingFocus(event, dialog, visibleCoach);
      return;
    }
    if (event.key !== "Escape") return;
    if (scheduleSelectIsOpen(dialog)) {
      event.stopImmediatePropagation();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (modal && visibleCoach) {
      visibleCoach.querySelector<HTMLButtonElement>('button[aria-label="Pause tutorial"]')?.click();
      (dialog.querySelector<HTMLElement>("[data-schedule-autofocus]:not(:disabled)") ?? dialog).focus();
      return;
    }
    onClose();
  });
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>("[data-schedule-autofocus]")?.focus();
    window.addEventListener("keydown", handleModalKey, true);
    return () => {
      window.removeEventListener("keydown", handleModalKey, true);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div data-assessment-scheduling-backdrop ref={viewportRef} className={`${styles.scheduleOverlay} z-[100] flex items-center justify-center bg-[#102c23]/35`}>
    <section ref={dialogRef} role="dialog" aria-modal={modal} aria-label={label} aria-busy={isBusy} tabIndex={-1} data-assessment-scheduling="modal" className="flex max-h-full w-full min-w-0 flex-col overflow-hidden bg-white text-[#202822] shadow-2xl max-sm:h-full sm:max-w-[660px] sm:rounded-xl">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#d9dfdb] px-5 py-5 sm:px-10 sm:py-6">
        <div className="min-w-0">
          <h2 className="text-[22px] font-black leading-7 sm:text-[24px]">{title}</h2>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[14px] font-semibold leading-6 [overflow-wrap:anywhere]">{context}</div>
        </div>
        <button type="button" onClick={onClose} aria-label={closeLabel} title={closeLabel} className="flex h-11 w-11 shrink-0 items-center justify-center text-[#4d534f] hover:bg-[#f1f4f2] hover:text-[#0f7664] focus-visible:outline-2 focus-visible:outline-[#0f8b73] disabled:opacity-50"><X size={22} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <fieldset disabled={isBusy} className="mx-auto w-full min-w-0 px-5 py-6 sm:px-10 [&_input]:h-12 [&_input]:w-full [&_input]:min-w-0 [&_input]:rounded-md [&_input]:border [&_input]:border-[#bac8c0] [&_input]:bg-white [&_input]:px-4 [&_input]:text-[16px] [&_input]:outline-none [&_input:focus]:border-[#0f8b73] [&_input:focus]:ring-1 [&_input:focus]:ring-[#0f8b73] [&_select]:h-12 [&_select]:w-full [&_select]:min-w-0 [&_select]:rounded-md [&_select]:border [&_select]:border-[#bac8c0] [&_select]:bg-white [&_select]:px-4 [&_select]:text-[16px] [&_select]:outline-none [&_select:focus]:border-[#0f8b73] [&_select:focus]:ring-1 [&_select:focus]:ring-[#0f8b73] disabled:opacity-60">{children}</fieldset>
      </div>
      {error ? <div role="alert" className="shrink-0 bg-[#f7faf9] px-5 py-3 text-[14px] font-semibold leading-6 text-[#59645e] sm:px-10">{error}</div> : null}
      <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[#d9dfdb] bg-white px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-[14px] sm:px-10 sm:pt-5 sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] [&_button]:max-w-full [&_button]:flex-1 [&_button]:rounded-[2px] [&_button]:leading-5 sm:[&_button]:flex-none [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-[#0f8b73]">{footer}</footer>
    </section>
    </div>
  );
}

function scheduleSelectIsOpen(dialog: HTMLElement) {
  return CSS.supports("selector(select:open)") && Boolean(dialog.querySelector("select:open"));
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return (
    <dialog ref={dialogRef} aria-label="Begin interview" aria-describedby="assessment-start-description" aria-busy={isBusy} className={styles.beginDialog}
      onCancel={(event) => { event.preventDefault(); if (!isBusy) onClose(); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!isBusy) onClose(); } }}>
      <h2>Begin interview</h2>
      <p id="assessment-start-description">Your prepared answers become the section reference. Continue with the remaining questions and check what has changed with the client.</p>
      <dl>
        <BeginAssessmentDetail label="Interview date and start time" value={assessment.assessment_date ? `Keeping recorded date: ${assessment.assessment_date}. Start time recorded when you confirm.` : "Recorded when you confirm (Pacific time)"} />
        <BeginAssessmentDetail label="Assessor" value={assessment.assessor || "Not assigned"} />
        {assessment.scheduled_start_at ? <BeginAssessmentDetail label="Appointment" value={new Date(assessment.scheduled_start_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "short" })} /> : null}
      </dl>
      {error ? <p role="alert">{error}</p> : null}
      <footer>
        <button type="button" onClick={onClose} disabled={isBusy}>Keep preparing</button>
        <button type="button" data-guide-target="assessment-begin-confirm" onClick={onBegin} disabled={isBusy || !canEditClinical}>{isBusy ? "Starting..." : "Begin interview"}</button>
      </footer>
    </dialog>
  );
}

function BeginAssessmentDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
