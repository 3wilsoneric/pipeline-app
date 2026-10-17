"use client";

import { useRef, useState } from "react";
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

type PlacementUpdatesProps = {
  referral: Referral;
  disabled: boolean;
  onMarkAdmitted?: (actualAdmissionDate: string) => void;
  onSavePlacementCancellation?: (reason: string) => Promise<boolean>;
};

const inputClass = "mt-1 block h-10 w-full border border-[#c9ceca] bg-white px-3 text-[12px] text-[#202320] focus-visible:outline-[#0f8b73] disabled:bg-[#f4f6f5]";

export default function ReferralAdmissionPanel({ referral, packetSentAt, admissionDate, disabled, onAdmissionDateChange, onSaveAdmissionDate }: Props) {
  const admitted = referral.stage === "Accepted / Admitted";
  const cancelled = Boolean(referral.placementCancellation);
  // After acceptance the packet review is this page's one main action until it has been sent.
  const buttonClass = packetSentAt || cancelled
    ? "min-h-10 border border-[#0f8b73] px-3 py-2 text-[12px] font-semibold text-[#0f6f5e] disabled:opacity-50 focus-visible:outline-[#0f8b73]"
    : "min-h-10 rounded-md bg-[#08775e] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#065f4b] disabled:cursor-not-allowed disabled:bg-[#e8ecea] disabled:text-[#5b6660] focus-visible:outline-2 focus-visible:outline-offset-2";
  return <section aria-label="Admission follow-through" className="space-y-4">
    <div className="flex flex-wrap items-end gap-3">
      <label className="block min-w-[180px] flex-1 text-[11px] font-bold text-[#303b34]" htmlFor="workflow-admit-date">
        Planned admission date
        <input data-guide-target="workspace-admit-date" id="workflow-admit-date" type="date" value={admissionDate} onChange={(event) => onAdmissionDateChange(event.target.value)} disabled={disabled || cancelled} className={inputClass} aria-describedby="planned-admission-help" />
      </label>
      <span data-guide-target="workspace-finish-send"><button type="button" disabled={disabled} onClick={onSaveAdmissionDate} className={buttonClass}>{cancelled && packetSentAt ? "Review sent email & packet" : "Review email & packet"}</button></span>
    </div>
    <p id="planned-admission-help" className="text-[11px] text-[#68716c]">{cancelled ? packetSentAt ? "The planned date and sent handoff remain in history. No new handoff can be sent for this cancelled placement." : "The planned date remains in history. No handoff can be sent for this cancelled placement." : packetSentAt ? "The packet has been sent. Reviewing it or changing the planned date does not send another email." : "You can review the email and packet now. Add a planned admit date before sending; it will populate the email automatically."}</p>
    {packetSentAt ? <p role="status" className="text-[12px] font-semibold text-[#0f6f5e]">Packet sent {formatProfileDate(packetSentAt)}{admitted || cancelled ? "" : " · Awaiting admission"}</p> : null}
    {admitted ? <p role="status" className="text-[12px] text-[#303b34]">Admission confirmed{referral.actualAdmissionDate ? ` · ${formatProfileDate(referral.actualAdmissionDate)}` : " · Actual date not recorded"}. This workspace remains available in Finished referrals and All Workspaces.</p> : null}
  </section>;
}

export function ReferralPlacementUpdates({ referral, disabled, onMarkAdmitted, onSavePlacementCancellation }: PlacementUpdatesProps) {
  const admitted = referral.stage === "Accepted / Admitted";
  const cancelled = Boolean(referral.placementCancellation);
  const [actualAdmissionDate, setActualAdmissionDate] = useState(referral.actualAdmissionDate ?? "");
  const [dateNeeded, setDateNeeded] = useState(false);
  const [cancellationReasonDraft, setCancellationReasonDraft] = useState<string | null>(null);
  const [editingCancellation, setEditingCancellation] = useState(false);
  const cancellationReason = cancellationReasonDraft ?? referral.placementCancellation?.reason ?? "";
  const cancellationDirty = cancellationReasonDraft !== null && cancellationReasonDraft !== (referral.placementCancellation?.reason ?? "");
  const [savingCancellation, setSavingCancellation] = useState(false);
  const actualDateInput = useRef<HTMLInputElement>(null);
  if (admitted) return null;
  return <section aria-label="Placement updates" className="border-b border-[#dce4df] pb-5">
      <h5 className="text-[16px] font-semibold text-[#25372d]">Placement updates</h5>
      {cancelled ? <p role="status" className="mt-2 text-sm font-semibold">Placement cancelled · {referral.placementCancellation?.reason}</p> : null}
      {!cancelled && onMarkAdmitted ? <div className="mt-4 rounded-md border border-[#dce4df] bg-[#f8faf9] p-3 sm:p-4">
      <h6 className="text-[14px] font-semibold text-[var(--color-ink-2)]">Confirm admission after arrival</h6>
      <p className="mb-3 text-[13px] text-[#52675d]">The daily census can confirm arrival automatically. Coordinators and admins can record it here when needed.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[180px] flex-1 text-[11px] font-bold text-[#303b34]" htmlFor="workflow-actual-admit-date">
          Actual admission date
          <input ref={actualDateInput} id="workflow-actual-admit-date" type="date" value={actualAdmissionDate} onChange={(event) => { setActualAdmissionDate(event.target.value); setDateNeeded(false); }} disabled={disabled} className={inputClass} aria-describedby="actual-admission-help" />
        </label>
        <button type="button" disabled={disabled} onClick={() => {
          if (!actualAdmissionDate) { setDateNeeded(true); actualDateInput.current?.focus(); return; }
          onMarkAdmitted(actualAdmissionDate);
        }} className="min-h-10 border border-[#0f8b73] px-3 py-2 text-[12px] font-semibold text-[#0f6f5e] disabled:opacity-50">Confirm admission</button>
      </div>
      <p id="actual-admission-help" role={dateNeeded ? "status" : undefined} className="mt-2 text-[11px] text-[#68716c]">{dateNeeded ? "Enter the client's actual arrival date before recording admission." : "Use this if the client arrived but no verified census match is available yet. Open paperwork can still be completed afterward."}</p>
    </div> : !cancelled ? <p role="status" className="mt-3 text-[12px] text-[var(--color-ink-muted)]">Awaiting arrival confirmation from the daily census or an admissions coordinator. You can continue the handoff and paperwork.</p> : null}
    {onSavePlacementCancellation ? <div className="mt-4 border-t border-[#dce4df] pt-4">
      <button type="button" aria-expanded={editingCancellation} onClick={() => setEditingCancellation((open) => !open)} className="min-h-11 text-left text-[14px] font-semibold text-[#35473c] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">{cancelled ? "Edit cancellation explanation" : "Placement did not happen"}</button>
      {editingCancellation ? <form id="placement-cancellation-form" className="mt-3 space-y-3" onSubmit={(event) => {
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
    </div> : null}
  </section>;
}
