"use client";

import { useState } from "react";
import { formatProfileDate } from "@/lib/pipeline/client-profile-presentation";
import { assumedAdmissionDate, getPlannedAdmissionDate } from "@/lib/pipeline/admission-lifecycle";
import type { Referral } from "@/lib/pipeline/referral-types";

type Props = {
  referral: Referral;
  packetSentAt?: string | null;
  admissionDate: string;
  disabled: boolean;
  onAdmissionDateChange: (value: string) => void;
  onSaveAdmissionDate: () => void;
  onSavePlacementCancellation?: (reason: string) => Promise<boolean>;
  showReviewButton?: boolean;
  showDateEditor?: boolean;
  showCancellation?: boolean;
};

const inputClass = "mt-1 block h-10 w-full border border-[#c9ceca] bg-white px-3 text-[12px] text-[#202320] focus-visible:outline-[#0f8b73] disabled:bg-[#f4f6f5]";

export default function ReferralAdmissionPanel({ referral, packetSentAt, admissionDate, disabled, onAdmissionDateChange, onSaveAdmissionDate, onSavePlacementCancellation, showReviewButton = true, showDateEditor = true, showCancellation = true }: Props) {
  const admitted = referral.stage === "Accepted / Admitted";
  const assumedDate = assumedAdmissionDate(referral);
  const cancelled = Boolean(referral.placementCancellation);
  const [cancellationReasonDraft, setCancellationReasonDraft] = useState<string | null>(null);
  const [editingCancellation, setEditingCancellation] = useState(false);
  const [savingCancellation, setSavingCancellation] = useState(false);
  const cancellationReason = cancellationReasonDraft ?? referral.placementCancellation?.reason ?? "";
  const cancellationDirty = cancellationReasonDraft !== null && cancellationReasonDraft !== (referral.placementCancellation?.reason ?? "");
  const buttonClass = packetSentAt || cancelled
    ? "min-h-10 border border-[#0f8b73] px-3 py-2 text-[12px] font-semibold text-[#0f6f5e] disabled:opacity-50 focus-visible:outline-[#0f8b73]"
    : "min-h-10 rounded-md bg-[#08775e] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#065f4b] disabled:cursor-not-allowed disabled:bg-[#e8ecea] disabled:text-[#5b6660] focus-visible:outline-2 focus-visible:outline-offset-2";
  const cancellationButton = showCancellation && onSavePlacementCancellation && !admitted ? <button type="button" aria-expanded={editingCancellation} aria-controls={editingCancellation ? "placement-cancellation-form" : undefined} disabled={disabled || savingCancellation} onClick={() => setEditingCancellation((open) => !open)} className="min-h-10 rounded-md border border-[#c9ceca] bg-white px-3 py-2 text-[12px] font-semibold text-[#6b443a] hover:border-[#a06a5c] hover:bg-[#faf6f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f8b73] disabled:opacity-50">{cancelled ? "Edit cancellation reason" : "Placement did not happen"}</button> : null;
  return <section aria-label="Admission follow-through" className="space-y-4">
    <div className={`flex flex-wrap items-end gap-3 ${showDateEditor ? "" : "justify-end"}`}>
      {showDateEditor ? <div className="min-w-[180px] flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-[11px] font-bold text-[#303b34]" htmlFor="workflow-admit-date">Planned admission date</label>
          {cancellationButton}
        </div>
        <input data-guide-target="workspace-admit-date" id="workflow-admit-date" type="date" value={admissionDate} onChange={(event) => onAdmissionDateChange(event.target.value)} disabled={disabled || cancelled} className={inputClass} aria-describedby="planned-admission-help" />
      </div> : cancellationButton}
      {showDateEditor && (showReviewButton || admissionDate !== getPlannedAdmissionDate(referral)) ? <span data-guide-target="workspace-finish-send"><button type="button" disabled={disabled} onClick={onSaveAdmissionDate} className={buttonClass}>{showReviewButton ? cancelled && packetSentAt ? "Review sent email & packet" : "Review email & packet" : "Save planned date"}</button></span> : null}
    </div>
    {editingCancellation && onSavePlacementCancellation ? <form id="placement-cancellation-form" className="space-y-3 rounded-md border border-[#dce4df] bg-[#f8faf9] p-3" onSubmit={(event) => {
      event.preventDefault();
      if (savingCancellation || disabled || !cancellationReason.trim()) return;
      setSavingCancellation(true);
      void onSavePlacementCancellation(cancellationReason.trim()).then((saved) => {
        if (saved) { setCancellationReasonDraft(null); setEditingCancellation(false); }
      }).finally(() => setSavingCancellation(false));
    }}>
      <label className="block text-sm font-semibold" htmlFor="placement-cancellation-reason">Why was placement cancelled?</label>
      <textarea id="placement-cancellation-reason" value={cancellationReason} onChange={(event) => setCancellationReasonDraft(event.target.value)} required maxLength={2_000} rows={3} disabled={disabled || savingCancellation} className="block w-full border bg-white p-3 text-sm" />
      <p className="text-sm">Recording this change does not email the community. The acceptance and any sent handoff stay in the record.</p>
      <button type="submit" disabled={disabled || savingCancellation || !cancellationReason.trim() || cancelled && !cancellationDirty} className="min-h-10 border px-3 py-2 text-sm font-semibold disabled:opacity-50">{savingCancellation ? "Saving…" : cancelled ? "Save explanation" : "Record placement cancellation"}</button>
    </form> : null}
    {showDateEditor ? <p id="planned-admission-help" className="text-[11px] text-[#68716c]">{cancelled ? packetSentAt ? "The planned date and sent handoff remain in history. No new handoff can be sent for this cancelled placement." : "The planned date remains in history. No handoff can be sent for this cancelled placement." : packetSentAt ? "The packet has been sent. Reviewing it or changing the planned date does not send another email." : showReviewButton ? "You can review the email and packet now. Add a planned admit date before sending; it will populate the email automatically." : "Save a date change here. Meet the Client uses the planned date below."}</p> : null}
    {cancelled ? <p role="status" className="text-[12px] font-semibold text-[#6b443a]">Did not move in · {referral.placementCancellation?.reason}</p> : null}
    {showReviewButton && packetSentAt ? <p role="status" className="text-[12px] font-semibold text-[var(--color-link)]">Packet sent {formatProfileDate(packetSentAt)}{admitted || cancelled ? "" : assumedDate ? " · Census check pending" : " · Awaiting admission"}</p> : null}
    {assumedDate ? <p role="status" className="text-[12px] text-[var(--color-ink-2)]">Admitted based on the planned date · {formatProfileDate(assumedDate)}. Census verification is pending; staff can still record that the move-in did not happen.</p> : null}
    {showReviewButton && admitted ? <p role="status" className="text-[12px] text-[var(--color-ink-2)]">Admission confirmed{referral.actualAdmissionDate ? ` · ${formatProfileDate(referral.actualAdmissionDate)}` : " · Actual date not recorded"}. This workspace remains available in Finished referrals and All Workspaces.</p> : null}
  </section>;
}
