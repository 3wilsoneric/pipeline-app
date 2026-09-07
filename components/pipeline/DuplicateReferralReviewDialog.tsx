"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

import type { Referral } from "@/lib/pipeline/referral-types";

export type ReferralDuplicateCandidate = {
  referral_id: number;
  name: string;
  county: string;
  community: Referral["community"];
  date_of_birth: string;
  referral_received: string;
  owner: string;
  stage: string;
  in_trash: boolean;
};

export type ReferralDuplicateReview = {
  canConfirmDistinctPerson: boolean;
  confirmationReferralIds: number[];
  candidates: ReferralDuplicateCandidate[];
};

export default function DuplicateReferralReviewDialog({
  review,
  busy,
  onOpenExisting,
  onConfirmDistinctPerson,
  onClose,
}: {
  review: ReferralDuplicateReview | null;
  busy: boolean;
  onOpenExisting: (candidate: ReferralDuplicateCandidate) => void;
  onConfirmDistinctPerson: (referralIds: number[]) => void;
  onClose: () => void;
}) {
  const [reviewed, setReviewed] = useState(false);
  if (!review) return null;
  const close = () => {
    setReviewed(false);
    onClose();
  };
  const openExisting = (candidate: ReferralDuplicateCandidate) => {
    setReviewed(false);
    onOpenExisting(candidate);
  };
  const confirmDistinctPerson = () => {
    setReviewed(false);
    onConfirmDistinctPerson(review.confirmationReferralIds);
  };

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) close();
      }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="duplicate-referral-title"
        aria-describedby="duplicate-referral-detail"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-[#cfcfcf] border-t-[3px] border-t-[#b07b21] bg-white p-5 shadow-xl"
      >
        <h2 id="duplicate-referral-title" className="text-[16px] font-black text-[#111111]">Possible duplicate referral</h2>
        <p id="duplicate-referral-detail" className="mt-2 text-[12px] leading-5 text-[#595959]">
          No workspace was created. The client name and county match {review.candidates.length === 1 ? "this referral" : "existing referrals"}. Compare the identity details before continuing.
        </p>

        {review.candidates.length > 0 ? (
          <div className="mt-4 divide-y divide-[#e2e5e3] border-y border-[#d4d9d6]">
            {review.candidates.map((candidate, index) => (
              <article key={candidate.referral_id} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div>
                  <div className="text-[13px] font-black text-[#111111]">{candidate.name}</div>
                  <div className="mt-1 text-[11px] text-[#595959]">
                    {candidate.county || "County not recorded"} · {candidate.community} · DOB {candidate.date_of_birth || "not recorded"}
                  </div>
                  <div className="mt-1 text-[10px] text-[#737373]">
                    Referral #{candidate.referral_id} · Received {candidate.referral_received || "not recorded"} · {candidate.owner || "Unassigned"} · {candidate.in_trash ? "In Trash" : candidate.stage}
                  </div>
                </div>
                <button
                  type="button"
                  autoFocus={index === 0}
                  disabled={busy}
                  onClick={() => openExisting(candidate)}
                  className="h-9 border border-[#0f8b73] px-3 text-[10px] font-black text-[#0c705f] hover:bg-[#eff8f4] disabled:opacity-50"
                >
                  Open workspace
                </button>
              </article>
            ))}
          </div>
        ) : null}

        {review.canConfirmDistinctPerson ? (
          <label className="mt-4 flex cursor-pointer items-start gap-3 border border-[#e2d4b7] bg-[#fffaf0] p-3 text-[11px] leading-5 text-[#4d4432]">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(event) => setReviewed(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#0f8b73]"
            />
            <span>I reviewed every possible match and confirmed this is a different person who needs a separate workspace.</span>
          </label>
        ) : (
          <p className="mt-4 border border-[#e2d4b7] bg-[#fffaf0] p-3 text-[11px] leading-5 text-[#6b541d]">
            Your account cannot review every possible match. Ask a supervisor to verify the identity before creating another workspace.
          </p>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={close}
            className="h-10 border border-[#c9ceca] px-4 text-[11px] font-black text-[#595959] hover:bg-[#f7faf9] disabled:opacity-50"
          >
            Cancel
          </button>
          {review.canConfirmDistinctPerson ? (
            <button
              type="button"
              disabled={busy || !reviewed}
              onClick={confirmDistinctPerson}
              className="h-10 bg-[#111111] px-4 text-[11px] font-black text-white hover:bg-[#0f8b73] disabled:cursor-not-allowed disabled:bg-[#d2d2d2]"
            >
              {busy ? "Creating..." : "Create different person"}
            </button>
          ) : null}
        </div>
      </section>
    </div>,
    document.body,
  );
}
