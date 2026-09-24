"use client";

import { formatProfileDate } from "@/lib/pipeline/client-profile-presentation";
import type { Referral } from "@/lib/pipeline/referral-types";

type Props = {
  referral: Referral;
  packetSentAt?: string | null;
  admissionDate: string;
  disabled: boolean;
  onAdmissionDateChange: (value: string) => void;
  onSaveAdmissionDate: () => void;
};

export default function ReferralAdmissionPanel({ referral, packetSentAt, admissionDate, disabled, onAdmissionDateChange, onSaveAdmissionDate }: Props) {
  const admitted = referral.stage === "Accepted / Admitted";
  const inputClass = "mt-1 block h-10 w-full border border-[#c9ceca] bg-white px-3 text-[12px] text-[#202320] focus-visible:outline-[#0f8b73] disabled:bg-[#f4f6f5]";
  // After acceptance the packet review is this page's one main action until it has been sent.
  const buttonClass = packetSentAt
    ? "min-h-10 border border-[#0f8b73] px-3 py-2 text-[12px] font-semibold text-[#0f6f5e] disabled:opacity-50 focus-visible:outline-[#0f8b73]"
    : "min-h-10 rounded-md bg-[#08775e] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#065f4b] disabled:cursor-not-allowed disabled:bg-[#e8ecea] disabled:text-[#5b6660] focus-visible:outline-2 focus-visible:outline-offset-2";
  return <section aria-label="Admission follow-through" className="mb-4 space-y-4 border-b border-[#e3e6e4] pb-4">
    <div className="flex flex-wrap items-end gap-3">
      <label className="block min-w-[180px] flex-1 text-[11px] font-bold text-[#303b34]" htmlFor="workflow-admit-date">
        Planned admission date
        <input data-guide-target="workspace-admit-date" id="workflow-admit-date" type="date" value={admissionDate} onChange={(event) => onAdmissionDateChange(event.target.value)} disabled={disabled} className={inputClass} aria-describedby="planned-admission-help" />
      </label>
      <span data-guide-target="workspace-finish-send"><button type="button" disabled={disabled} onClick={onSaveAdmissionDate} className={buttonClass}>Review email &amp; packet</button></span>
    </div>
    <p id="planned-admission-help" className="text-[11px] text-[#68716c]">{packetSentAt ? "The packet has been sent. Reviewing it or changing the planned date does not send another email." : "You can review the email and packet now. Add a planned admit date before sending; it will populate the email automatically."}</p>
    {packetSentAt ? <p role="status" className="text-[12px] font-semibold text-[#0f6f5e]">Packet sent {formatProfileDate(packetSentAt)}{admitted ? "" : " · Awaiting admission"}</p> : null}
    {admitted ? <p role="status" className="text-[12px] text-[#303b34]">Admission confirmed{referral.actualAdmissionDate ? ` · ${formatProfileDate(referral.actualAdmissionDate)}` : " · Actual date not recorded"}. This workspace remains available in Finished referrals and All Workspaces.</p> : null}
  </section>;
}
