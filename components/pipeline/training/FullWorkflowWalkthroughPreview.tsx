"use client";

import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useEffect, useState } from "react";

type WalkthroughFrame = {
  label: string;
  title: string;
  instruction: string;
  target: string;
};

const frames: readonly WalkthroughFrame[] = [
  { label: "Home", title: "Find the work that needs attention", instruction: "Start with assigned referrals, today's assessments, and anything blocked or overdue.", target: "Current work" },
  { label: "Referral", title: "Create the referral workspace", instruction: "Attach the packet first, verify the intake facts, and assign an accountable owner.", target: "New referral" },
  { label: "Intake", title: "Verify the source information", instruction: "Compare proposed values with the packet before the referral enters active work.", target: "Packet and intake" },
  { label: "Assessment", title: "Schedule and complete the assessment", instruction: "Work through each section, use Answer Help when needed, and confirm the draft is saved.", target: "Assessment" },
  { label: "Chart", title: "Review the completed Chart", instruction: "Resolve missing information and review the signed assessment as one complete record.", target: "Complete chart" },
  { label: "Handoff", title: "Prepare the accepted referral handoff", instruction: "Review the Chart, Meet the Client summary, admission packet, and authorized recipient before sending.", target: "Chart and handoff" },
];

export default function FullWorkflowWalkthroughPreview({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const frame = frames[index];

  return (
    <section role="dialog" aria-modal="true" aria-label="Full Pipeline walkthrough preview" className="fixed inset-0 z-[140] flex min-h-0 flex-col bg-[#f3f6f5] text-[#171b19]">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#cbd5d1] bg-white px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden text-[10px] font-black uppercase tracking-[0.1em] text-[#0f7c68] sm:inline">Preview</span>
          <h2 className="truncate text-[17px] font-black tracking-[-0.02em]">Full Pipeline walkthrough</h2>
        </div>
        <button type="button" aria-label="Close full walkthrough preview" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#d2dad7] bg-white text-[#59635f] hover:border-[#91aaa1] hover:text-[#171b19]">
          <X size={18} aria-hidden="true" />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[250px_minmax(0,1fr)]">
        <nav aria-label="Walkthrough sections" className="hidden border-r border-[#cbd5d1] bg-white p-5 lg:block">
          <div className="mb-4 text-[10px] font-black uppercase tracking-[0.1em] text-[#737d79]">{index + 1} of {frames.length}</div>
          <ol className="space-y-1">
            {frames.map((item, frameIndex) => (
              <li key={item.label}>
                <button type="button" onClick={() => setIndex(frameIndex)} aria-current={frameIndex === index ? "step" : undefined} className={`flex min-h-12 w-full items-center gap-3 border-l-[3px] px-3 text-left text-[12px] font-bold ${frameIndex === index ? "border-l-[#0f8b73] bg-[#edf7f3] text-[#174c40]" : "border-l-transparent text-[#68726e] hover:bg-[#f5f7f6]"}`}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center border text-[9px] font-black ${frameIndex < index ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#cbd5d1] bg-white"}`}>
                    {frameIndex < index ? <Check size={12} aria-hidden="true" /> : frameIndex + 1}
                  </span>
                  {item.label}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-h-0 overflow-y-auto p-3 sm:p-6 lg:p-8">
          <div className="mx-auto flex min-h-full max-w-[1180px] flex-col">
            <div className="mb-3 flex gap-1 lg:hidden" aria-label={`Step ${index + 1} of ${frames.length}`}>
              {frames.map((item, frameIndex) => <span key={item.label} className={`h-1 flex-1 ${frameIndex <= index ? "bg-[#0f8b73]" : "bg-[#d5ddda]"}`} />)}
            </div>

            <div className="relative min-h-0 flex-1 overflow-y-auto border border-[#bac7c2] bg-white shadow-[0_18px_45px_rgba(24,45,38,0.11)] sm:min-h-[440px] sm:overflow-hidden">
              <div className="hidden h-full sm:block">
                <MockApplication frame={frame} index={index} />
                <div className="absolute inset-0 bg-[#173029]/35" aria-hidden="true" />
                <div className="absolute left-[24%] top-[28%] h-16 w-[58%] border-2 border-[#19a686] bg-white/10 shadow-[0_0_0_5px_rgba(255,255,255,0.92)]" aria-hidden="true" />
              </div>

              <article className="border-[#0f7c68] bg-white p-5 sm:absolute sm:bottom-8 sm:right-8 sm:w-[390px] sm:border sm:p-6 sm:shadow-[0_16px_40px_rgba(11,35,29,0.28)]">
                <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f7c68]">{frame.label} · Step {index + 1}</div>
                <h3 className="mt-2 text-[22px] font-black leading-7 tracking-[-0.03em] text-[#1d2421]">{frame.title}</h3>
                <p className="mt-3 text-[13px] leading-5 text-[#58635e]">{frame.instruction}</p>
                <div className="mt-4 border-l-2 border-[#0f8b73] bg-[#edf7f3] px-3 py-2 text-[11px] font-bold text-[#245549]">Highlighted control: {frame.target}</div>
              </article>
            </div>

            <footer className="mt-4 flex shrink-0 items-center justify-between gap-3">
              <button type="button" disabled={index === 0} onClick={() => setIndex((current) => Math.max(0, current - 1))} className="flex h-11 items-center gap-2 border border-[#cbd5d1] bg-white px-4 text-[11px] font-black text-[#59635f] disabled:invisible">
                <ArrowLeft size={14} aria-hidden="true" /> Back
              </button>
              {index < frames.length - 1 ? (
                <button type="button" onClick={() => setIndex((current) => Math.min(frames.length - 1, current + 1))} className="flex h-11 items-center gap-2 bg-[#0f8b73] px-5 text-[11px] font-black text-white hover:bg-[#0b715e]">
                  Next <ArrowRight size={14} aria-hidden="true" />
                </button>
              ) : (
                <button type="button" onClick={onClose} className="h-11 bg-[#0f8b73] px-5 text-[11px] font-black text-white hover:bg-[#0b715e]">Close preview</button>
              )}
            </footer>
          </div>
        </div>
      </div>
    </section>
  );
}

function MockApplication({ frame, index }: { frame: WalkthroughFrame; index: number }) {
  return (
    <div className="h-full min-h-[440px] bg-[#f6f8f7]" aria-hidden="true">
      <div className="flex h-14 items-center justify-between border-b border-[#d7dfdc] bg-white px-4 sm:px-6">
        <span className="text-[17px] font-black tracking-[-0.035em] text-[#0b4439]">Pipeline</span>
        <div className="h-8 w-1/3 border border-[#d7dfdc] bg-[#fafbfa]" />
      </div>
      <div className="grid min-h-[386px] grid-cols-[72px_minmax(0,1fr)] sm:grid-cols-[190px_minmax(0,1fr)]">
        <aside className="border-r border-[#d7dfdc] bg-[#f1f4f3] p-3 sm:p-4">
          {["Home", "Workspaces", "Calendar", "Reports"].map((item, itemIndex) => (
            <div key={item} className={`mb-2 h-10 px-3 py-3 text-[10px] font-bold ${itemIndex === Math.min(index, 3) ? "bg-white text-[#174c40]" : "text-transparent sm:text-[#68726e]"}`}>{item}</div>
          ))}
        </aside>
        <main className="p-5 sm:p-8">
          <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#7a8580]">{frame.label}</div>
          <div className="mt-2 h-8 w-2/5 bg-[#27312d]" />
          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <div className="h-24 border border-[#d7dfdc] bg-white" />
            <div className="h-24 border border-[#d7dfdc] bg-white" />
            <div className="h-24 border border-[#d7dfdc] bg-white" />
          </div>
          <div className="mt-4 h-36 border border-[#d7dfdc] bg-white" />
        </main>
      </div>
    </div>
  );
}
