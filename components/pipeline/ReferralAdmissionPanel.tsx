"use client";

import { useState } from "react";
import { actualAdmissionDateError } from "@/lib/pipeline/admission-lifecycle";
import { calendarToday } from "@/lib/pipeline/calendar-date";
import { formatProfileDate } from "@/lib/pipeline/client-profile-presentation";
import type { Referral } from "@/lib/pipeline/referral-types";

type Props = {
  referral: Referral;
  packetSentAt?: string | null;
  admissionDate: string;
  disabled: boolean;
  onAdmissionDateChange: (value: string) => void;
  onSaveAdmissionDate: () => void;
  onConfirmAdmission: (date: string) => void;
};

export default function ReferralAdmissionPanel({ referral, packetSentAt, admissionDate, disabled, onAdmissionDateChange, onSaveAdmissionDate, onConfirmAdmission }: Props) {
  const [actualDate, setActualDate] = useState(referral.actualAdmissionDate || calendarToday());
  const admitted = referral.stage === "Accepted / Admitted";
  const dateError = actualAdmissionDateError(actualDate);
  const inputClass = "mt-1 block h-10 w-full border border-[#c9ceca] bg-white px-3 text-[12px] text-[#202320] focus-visible:outline-[#0f8b73] disabled:bg-[#f4f6f5]";
  const buttonClass = "min-h-10 border border-[#0f8b73] px-3 py-2 text-[12px] font-semibold text-[#0f6f5e] disabled:opacity-50 focus-visible:outline-[#0f8b73]";
  return <section aria-label="Admission follow-through" className="mb-4 space-y-4 border-b border-[#e3e6e4] pb-4">
    <div className="flex flex-wrap items-end gap-3">
      <label className="block min-w-[180px] flex-1 text-[11px] font-bold text-[#303b34]" htmlFor="workflow-admit-date">
        Planned admission date
        <input data-guide-target="workspace-admit-date" id="workflow-admit-date" type="date" value={admissionDate} onChange={(event) => onAdmissionDateChange(event.target.value)} disabled={disabled} className={inputClass} aria-describedby="planned-admission-help" />
      </label>
      <span data-guide-target="workspace-finish-send"><button type="button" disabled={disabled} onClick={onSaveAdmissionDate} className={buttonClass}>Review email &amp; packet</button></span>
    </div>
    <p id="planned-admission-help" className="text-[11px] text-[#68716c]">Required for sending Meet the Client. You can preview without a date. Changing this date does not resend a packet or confirm arrival.</p>
    {packetSentAt ? <p role="status" className="text-[12px] font-semibold text-[#0f6f5e]">Packet sent {formatProfileDate(packetSentAt)}{admitted ? "" : " · Awaiting admission"}</p> : null}
    {admitted ? <p role="status" className="text-[12px] text-[#303b34]">Admission confirmed{referral.actualAdmissionDate ? ` · ${formatProfileDate(referral.actualAdmissionDate)}` : " · Actual date not recorded"}. This workspace remains available in Finished referrals and All Workspaces.</p> : <div className="space-y-2">
      <p className="text-[12px] text-[#303b34]">After the client arrives, confirm admission to move this referral into Finished referrals.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[180px] flex-1 text-[11px] font-bold text-[#303b34]" htmlFor="workflow-actual-admit-date">Actual admission date
          <input id="workflow-actual-admit-date" type="date" max={calendarToday()} value={actualDate} onChange={(event) => setActualDate(event.target.value)} disabled={disabled} className={inputClass} aria-describedby={dateError ? "actual-admission-help" : undefined} />
        </label>
        <button type="button" disabled={disabled || Boolean(dateError)} onClick={() => onConfirmAdmission(actualDate)} className={buttonClass}>Confirm admitted</button>
      </div>
      {dateError ? <p id="actual-admission-help" className="text-[11px] text-[#68716c]">{dateError}</p> : null}
    </div>}
  </section>;
}
