"use client";

import { useEffect, useRef } from "react";
import PipelineLogoMark from "@/components/pipeline/PipelineLogoMark";

export default function PipelineMaintenanceCover() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // The server-rendered cover is already open; promote it to the modal layer
    // so existing application portals cannot appear or receive input above it.
    dialog.close();
    dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      open
      aria-labelledby="maintenance-title"
      aria-describedby="maintenance-description"
      onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => event.stopPropagation()}
      className="fixed inset-0 z-[2147483647] m-0 flex h-[100dvh] max-h-none w-screen max-w-none items-center justify-center border-0 bg-[#eef1ee]/85 p-6 text-[#202522] backdrop-blur-[2px] backdrop:bg-transparent"
    >
      <div className="w-full max-w-[440px] border border-[#d5dcd6] bg-white px-7 py-9 shadow-[0_18px_70px_rgba(24,40,31,0.12)] sm:px-10 sm:py-11">
        <div className="mb-8 flex items-center gap-3 text-[13px] font-bold tracking-[0.02em] text-[#42604e]">
          <PipelineLogoMark size={27} />
          <span>Pipeline</span>
        </div>
        <h1 id="maintenance-title" className="text-[27px] font-semibold leading-tight tracking-[-0.025em]">Temporarily disabled</h1>
        <p id="maintenance-description" className="mt-4 text-[15px] leading-6 text-[#647069]">Pipeline is under construction. Please check back later.</p>
      </div>
    </dialog>
  );
}
