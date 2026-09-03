"use client";

import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const subscribeToClient = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

type WalkthroughStep = {
  label: string;
  title: string;
  instruction: string;
  location: string;
};

const steps: readonly WalkthroughStep[] = [
  {
    label: "Home",
    title: "Check what needs attention",
    instruction: "Review your assigned referrals, today's assessments, and anything overdue.",
    location: "Home > My work",
  },
  {
    label: "Referral",
    title: "Create a referral",
    instruction: "Add the packet, enter the basic details, and assign an assessor.",
    location: "New referral",
  },
  {
    label: "Intake",
    title: "Check the intake",
    instruction: "Compare the entered information with the packet before moving on.",
    location: "Workspace > Intake",
  },
  {
    label: "Assessment",
    title: "Complete the assessment",
    instruction: "Schedule it, answer each section, and sign it when it is ready.",
    location: "Workspace > Assessment",
  },
  {
    label: "Chart",
    title: "Review the Chart",
    instruction: "Check the signed assessment and fix anything that is missing.",
    location: "Workspace > Chart",
  },
  {
    label: "Handoff",
    title: "Send the handoff",
    instruction: "Check the Meet the Client summary, documents, and recipient before sending.",
    location: "Chart > Meet the Client",
  },
];

export default function FullWorkflowWalkthroughPreview({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
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

  const step = steps[index];
  const isLastStep = index === steps.length - 1;

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-[#10251f]/25 p-2 sm:p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Full Pipeline walkthrough"
        className="flex h-[calc(100dvh-1rem)] w-full max-w-[1180px] min-w-0 flex-col overflow-hidden border border-[#aebcb7] bg-white sm:h-[calc(100dvh-2rem)]"
      >
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-[#d2dad7] px-5 py-3 sm:px-7">
          <h2 className="min-w-0 truncate text-[20px] font-black text-[#1d2421] sm:text-[24px]">Full walkthrough</h2>
          <button
            type="button"
            aria-label="Close full walkthrough"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#cbd5d1] text-[#56615c] hover:border-[#0f8b73] hover:text-[#0f7c68]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[230px_minmax(0,1fr)]">
          <nav aria-label="Workflow steps" className="hidden border-r border-[#d2dad7] px-4 py-5 md:block">
            <ol className="space-y-1">
              {steps.map((item, stepIndex) => (
                <li key={item.label}>
                  <button
                    type="button"
                    onClick={() => setIndex(stepIndex)}
                    aria-current={stepIndex === index ? "step" : undefined}
                    className={`flex min-h-12 w-full items-center gap-3 border-l-2 px-3 text-left ${stepIndex === index ? "border-[#0f8b73] text-[#123f35]" : "border-transparent text-[#68726e] hover:border-[#a8c7bd] hover:text-[#26302c]"}`}
                  >
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center border text-[9px] font-black ${stepIndex < index ? "border-[#0f8b73] bg-[#0f8b73] text-white" : stepIndex === index ? "border-[#0f8b73] text-[#0f7c68]" : "border-[#cbd5d1]"}`}>
                      {stepIndex < index ? <Check size={12} aria-hidden="true" /> : stepIndex + 1}
                    </span>
                    <span className="text-[12px] font-bold">{item.label}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="border-b border-[#d9dfdc] px-5 py-4 md:hidden">
              <div className="flex items-center justify-between gap-4 text-[9px] font-black uppercase tracking-[0.09em] text-[#6e7874]">
                <span>{step.label}</span>
                <span>Step {index + 1} of {steps.length}</span>
              </div>
              <div className="mt-3 flex gap-1" aria-hidden="true">
                {steps.map((item, stepIndex) => <span key={item.label} className={`h-1 flex-1 ${stepIndex <= index ? "bg-[#0f8b73]" : "bg-[#d5ddda]"}`} />)}
              </div>
            </div>

            <article className="flex min-h-0 flex-1 flex-col justify-start overflow-y-auto px-5 py-7 sm:justify-center sm:px-10 sm:py-10 lg:px-14">
              <div className="text-[10px] font-black uppercase tracking-[0.11em] text-[#0f7c68]">{step.label} · {String(index + 1).padStart(2, "0")}</div>
              <h3 className="mt-3 max-w-[650px] text-[30px] font-black leading-[34px] text-[#1b211e] sm:text-[38px] sm:leading-[42px]">{step.title}</h3>
              <p className="mt-5 max-w-[620px] text-[14px] leading-6 text-[#5d6863]">{step.instruction}</p>

              <dl className="mt-8 max-w-[620px] border-y border-[#d9dfdc]">
                <div className="grid gap-1 py-4 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
                  <dt className="text-[9px] font-black uppercase tracking-[0.1em] text-[#7a8480]">Go to</dt>
                  <dd className="text-[13px] font-black text-[#27302c]">{step.location}</dd>
                </div>
              </dl>
            </article>

            <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[#d2dad7] px-5 py-4 sm:px-8">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => setIndex((current) => Math.max(0, current - 1))}
                className="flex h-10 items-center gap-2 px-1 text-[11px] font-black text-[#59635f] hover:text-[#0f7c68] disabled:invisible"
              >
                <ArrowLeft size={14} aria-hidden="true" /> Back
              </button>
              <button
                type="button"
                onClick={() => isLastStep ? onClose() : setIndex((current) => Math.min(steps.length - 1, current + 1))}
                className="flex h-11 items-center gap-2 bg-[#0f8b73] px-5 text-[11px] font-black text-white hover:bg-[#0b715e]"
              >
                {isLastStep ? "Done" : "Next"}
                {!isLastStep ? <ArrowRight size={14} aria-hidden="true" /> : null}
              </button>
            </footer>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
