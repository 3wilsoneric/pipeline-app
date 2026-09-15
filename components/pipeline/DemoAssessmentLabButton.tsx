"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const AssessmentLab = dynamic(() => import("@/components/pipeline/note-lab/AssessmentPracticeWorkspace"), {
  ssr: false,
  loading: () => <p role="status" className="p-6 text-sm">Opening assessment...</p>,
});

export default function DemoAssessmentLabButton({ className, children = "Assessment lab" }: { className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [returnLabel, setReturnLabel] = useState("Back to Pipeline");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);

  const closeLab = () => { dialog.current?.close(); setOpen(false); };

  return <>
    <button type="button" aria-label="Open assessment lab" onClick={() => {
      setReturnLabel(new URLSearchParams(window.location.search).get("screen") === "packet" ? "Back to referral" : "Back to Pipeline");
      setOpen(true);
    }} className={className ?? "flex h-10 shrink-0 items-center px-3 text-[12px] font-semibold text-[#08745f] hover:bg-[#eff8f5] focus-visible:outline-2 focus-visible:outline-[#0f8b73]"}>
      {children}
    </button>
    {open ? createPortal(
      <dialog ref={dialog} aria-label="Assessment lab" onCancel={(event) => { event.preventDefault(); closeLab(); }} className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none border-0 bg-white p-0 text-[#202522]">
        {/* Keep the real workspace mounted underneath. Lab answers never enter its save path. */}
        <AssessmentLab traineeId="practice-walkthrough" traineeName="Assessment lab" walkthroughOnly onExit={closeLab} returnLabel={returnLabel} />
      </dialog>, document.body,
    ) : null}
  </>;
}
