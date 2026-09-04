"use client";

import { ArrowRight, Check, MousePointer2, Route, ShieldCheck, X } from "lucide-react";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { operatorGuideChapters, type OperatorGuidedTutorial } from "@/lib/training/operator-guided-tutorials";

const subscribeToClient = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export default function FullWorkflowWalkthroughPreview({
  tutorials,
  onClose,
  onStart,
}: {
  tutorials: readonly OperatorGuidedTutorial[];
  onClose: () => void;
  onStart: () => void;
}) {
  const mounted = useSyncExternalStore(subscribeToClient, getClientSnapshot, getServerSnapshot);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-[#10251f]/25 p-2 sm:p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Full Pipeline walkthrough"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-[1060px] flex-col overflow-hidden border border-[#aebcb7] bg-white sm:max-h-[calc(100dvh-2rem)]"
      >
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-[#d2dad7] px-5 py-3 sm:px-8">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#0f7c68]">Full workflow</div>
            <h2 className="mt-1 text-[20px] font-black text-[#1d2421] sm:text-[24px]">Before the tour</h2>
          </div>
          <button
            type="button"
            aria-label="Close full walkthrough"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#cbd5d1] text-[#56615c] hover:border-[#0f8b73] hover:text-[#0f7c68]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-7 sm:px-9 sm:py-9 lg:px-12">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
            <div>
              <h3 className="max-w-[650px] text-[34px] font-black leading-[38px] text-[#18201d] sm:text-[44px] sm:leading-[48px]">
                Follow the work in Pipeline.
              </h3>
              <p className="mt-5 max-w-[650px] text-[17px] font-medium leading-7 text-[#52605a]">
                A referral enters once. Its packet, owner, assessment, chart, files, and handoff stay connected while different people move the work forward.
              </p>

              <div className="mt-8 space-y-5 border-y border-[#d8dfdc] py-6">
                <OrientationPoint icon={<MousePointer2 size={20} aria-hidden="true" />} title="Work in the real interface">
                  The guide opens each Pipeline page and highlights the exact control to use.
                </OrientationPoint>
                <OrientationPoint icon={<Route size={20} aria-hidden="true" />} title="Move through every module">
                  The tour continues through the lessons shown here, in order, without turning them into a separate fake workflow.
                </OrientationPoint>
                <OrientationPoint icon={<ShieldCheck size={20} aria-hidden="true" />} title="Stay in control">
                  Skip any action. Pipeline never submits, signs, sends, schedules, or exports on your behalf.
                </OrientationPoint>
              </div>
            </div>

            <section aria-labelledby="tour-route-title" className="border-l border-[#d8dfdc] pl-6 sm:pl-8">
              <h4 id="tour-route-title" className="text-[10px] font-black uppercase tracking-[0.1em] text-[#6d7773]">Your tour</h4>
              <ol className="mt-4">
                {tutorials.map((tutorial, index) => (
                  <li key={tutorial.id} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3 border-t border-[#e0e6e3] py-3 first:border-t-0 first:pt-0">
                    <span className="flex h-6 w-6 items-center justify-center border border-[#b9cec7] text-[9px] font-black tabular-nums text-[#0f7c68]">{index + 1}</span>
                    <div>
                      <div className="text-[14px] font-black leading-5 text-[#27302c]">{tutorial.title}</div>
                      <div className="mt-0.5 text-[11px] font-bold text-[#7b8581]">{operatorGuideChapters(tutorial).length} chapters</div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </div>

        <footer className="flex shrink-0 flex-col gap-3 border-t border-[#d2dad7] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p className="text-[12px] font-semibold leading-5 text-[#66716d]">You can pause and resume from the Guide button.</p>
          <button
            type="button"
            onClick={onStart}
            className="flex h-12 items-center justify-center gap-3 bg-[#0f8b73] px-6 text-[12px] font-black text-white hover:bg-[#0b715e]"
          >
            Start guided tour <ArrowRight size={16} aria-hidden="true" />
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function OrientationPoint({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
      <span className="pt-0.5 text-[#0f8b73]">{icon}</span>
      <div>
        <div className="flex items-center gap-2 text-[15px] font-black text-[#27302c]"><Check size={13} className="text-[#0f8b73]" aria-hidden="true" />{title}</div>
        <p className="mt-1 text-[13px] font-medium leading-5 text-[#68736e]">{children}</p>
      </div>
    </div>
  );
}
