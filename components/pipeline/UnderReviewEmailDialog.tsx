"use client";

import { createPortal } from "react-dom";
import { useState } from "react";
import HomeDialog from "./HomeDialog";

export function defaultUnderReviewMessage(referralId: number, note: string) {
  const workspaceUrl = `https://alamo-pipeline.com/?view=referrals&screen=packet&referralId=${referralId}&workspaceView=workflow`;
  return `An assessor marked this referral Under Review.\n\n${note.trim() ? `Context:\n${note.trim()}\n\n` : ""}Open the Pipeline workspace to review and follow up:\n${workspaceUrl}`;
}

export default function UnderReviewEmailDialog({ referralId, initialMessage, sending, error, onSend, onClose }: {
  referralId: number;
  initialMessage: string;
  sending: boolean;
  error: string;
  onSend: (message: string) => void;
  onClose: () => void;
}) {
  const [message, setMessage] = useState(initialMessage);
  return createPortal(
    <HomeDialog label="Under Review email" title="Email Andrew and Sandeep" description="Review the message and add context. Saving Under Review did not send an email." onClose={() => { if (!sending) onClose(); }}>
      <div className="space-y-4 px-5 py-5 text-[14px] text-[#34453d]">
        <div><span className="font-semibold">To</span><p>andrew@aaahealthservices.com; sandeep@aaahealthservices.com</p></div>
        <div><span className="font-semibold">Subject</span><p>Pipeline referral under review</p></div>
        <div><span className="font-semibold">Workspace</span><p>Referral #{referralId}</p></div>
        <label className="block font-semibold" htmlFor="under-review-email-message">Message</label>
        <textarea id="under-review-email-message" autoFocus value={message} onChange={(event) => setMessage(event.target.value)} rows={9} maxLength={4000} className="w-full resize-y rounded-md border border-[#cbd6d2] px-3 py-2 font-normal leading-6 focus-visible:outline-2 focus-visible:outline-[#087d66]" />
        {error ? <p role="alert" className="text-[#9b433b]">{error}</p> : null}
      </div>
      <footer className="flex justify-end gap-3 border-t border-[#dfe5e2] px-5 py-4">
        <button type="button" disabled={sending} onClick={onClose} className="min-h-11 rounded-md border border-[#cbd6d2] px-4 font-semibold">Not now</button>
        <button type="button" disabled={sending || !message.trim()} onClick={() => onSend(message.trim())} className="min-h-11 rounded-md bg-[#087d66] px-4 font-semibold text-white disabled:opacity-50">{sending ? "Sending…" : "Send email"}</button>
      </footer>
    </HomeDialog>, document.body
  );
}
