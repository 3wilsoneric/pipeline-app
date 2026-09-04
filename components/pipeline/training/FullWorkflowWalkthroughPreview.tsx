"use client";

import { ArrowLeft, ArrowRight, Check, ChevronRight, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import {
  operatorGuideStepTitle,
  type OperatorGuidedTutorial,
} from "@/lib/training/operator-guided-tutorials";

const subscribeToClient = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

type WalkthroughSlide =
  | { id: "overview"; kind: "overview"; label: "Overview" }
  | { id: string; kind: "module"; label: string; tutorial: OperatorGuidedTutorial; moduleIndex: number };

export default function FullWorkflowWalkthroughPreview({
  tutorials,
  onClose,
}: {
  tutorials: readonly OperatorGuidedTutorial[];
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const mounted = useSyncExternalStore(subscribeToClient, getClientSnapshot, getServerSnapshot);
  const slides: readonly WalkthroughSlide[] = [
    { id: "overview", kind: "overview", label: "Overview" },
    ...tutorials.map((tutorial, moduleIndex) => ({
      id: tutorial.id,
      kind: "module" as const,
      label: tutorial.title,
      tutorial,
      moduleIndex,
    })),
  ];

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

  const slide = slides[index];
  const isLastSlide = index === slides.length - 1;

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-[#10251f]/25 p-2 sm:p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Full Pipeline walkthrough"
        className="flex h-[calc(100dvh-1rem)] w-full max-w-[1180px] min-w-0 flex-col overflow-hidden border border-[#aebcb7] bg-white sm:h-[calc(100dvh-2rem)]"
      >
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-[#d2dad7] px-5 py-3 sm:px-7">
          <div className="min-w-0">
            <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f7c68]">Learning Center</div>
            <h2 className="truncate text-[20px] font-black text-[#1d2421] sm:text-[24px]">Full walkthrough</h2>
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

        <div className="grid min-h-0 flex-1 md:grid-cols-[230px_minmax(0,1fr)]">
          <nav aria-label="Walkthrough modules" className="hidden overflow-y-auto border-r border-[#d2dad7] px-4 py-5 md:block">
            <ol className="space-y-1">
              {slides.map((item, slideIndex) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setIndex(slideIndex)}
                    aria-current={slideIndex === index ? "step" : undefined}
                    className={`flex min-h-12 w-full items-center gap-3 border-l-2 px-3 text-left ${slideIndex === index ? "border-[#0f8b73] text-[#123f35]" : "border-transparent text-[#68726e] hover:border-[#a8c7bd] hover:text-[#26302c]"}`}
                  >
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center border text-[9px] font-black ${slideIndex < index ? "border-[#0f8b73] bg-[#0f8b73] text-white" : slideIndex === index ? "border-[#0f8b73] text-[#0f7c68]" : "border-[#cbd5d1]"}`}>
                      {slideIndex < index ? <Check size={12} aria-hidden="true" /> : slideIndex === 0 ? "i" : slideIndex}
                    </span>
                    <span className="text-[12px] font-bold leading-4">{item.label}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="border-b border-[#d9dfdc] px-5 py-4 md:hidden">
              <div className="flex items-center justify-between gap-4 text-[9px] font-black uppercase tracking-[0.09em] text-[#6e7874]">
                <span className="truncate">{slide.label}</span>
                <span className="shrink-0">{index + 1} of {slides.length}</span>
              </div>
              <div className="mt-3 flex gap-1" aria-hidden="true">
                {slides.map((item, slideIndex) => <span key={item.id} className={`h-1 flex-1 ${slideIndex <= index ? "bg-[#0f8b73]" : "bg-[#d5ddda]"}`} />)}
              </div>
            </div>

            {slide.kind === "overview" ? (
              <OverviewSlide tutorials={tutorials} />
            ) : (
              <ModuleSlide slide={slide} moduleCount={tutorials.length} />
            )}

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
                onClick={() => isLastSlide ? onClose() : setIndex((current) => Math.min(slides.length - 1, current + 1))}
                className="flex h-11 items-center gap-2 bg-[#0f8b73] px-5 text-[11px] font-black text-white hover:bg-[#0b715e]"
              >
                {isLastSlide ? "Done" : index === 0 ? "Start" : "Next"}
                {!isLastSlide ? <ArrowRight size={14} aria-hidden="true" /> : null}
              </button>
            </footer>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function OverviewSlide({ tutorials }: { tutorials: readonly OperatorGuidedTutorial[] }) {
  const actionCount = tutorials.reduce((total, tutorial) => total + tutorial.steps.length, 0);

  return (
    <article className="flex min-h-0 flex-1 flex-col justify-start overflow-y-auto px-5 py-7 sm:justify-center sm:px-10 sm:py-10 lg:px-14">
      <div className="text-[10px] font-black uppercase tracking-[0.11em] text-[#0f7c68]">Before you begin</div>
      <h3 className="mt-3 max-w-[720px] text-[30px] font-black leading-[34px] text-[#1b211e] sm:text-[40px] sm:leading-[44px]">How Pipeline work moves</h3>
      <p className="mt-5 max-w-[700px] text-[16px] font-medium leading-7 text-[#56625d]">
        One referral workspace carries the packet, assignment, assessment, chart, files, and activity. Work can pause and resume without creating a second record.
      </p>
      <p className="mt-3 max-w-[700px] text-[14px] leading-6 text-[#65706b]">
        This presentation combines every task guide below. Use it for orientation, then open an individual task when you want Pipeline to guide you through the real controls.
      </p>
      <dl className="mt-8 grid max-w-[700px] border-y border-[#d9dfdc] sm:grid-cols-2">
        <div className="py-4 sm:border-r sm:border-[#d9dfdc] sm:pr-6">
          <dt className="text-[9px] font-black uppercase tracking-[0.1em] text-[#7a8480]">Task guides</dt>
          <dd className="mt-1 text-[24px] font-black tabular-nums text-[#27302c]">{tutorials.length}</dd>
        </div>
        <div className="border-t border-[#d9dfdc] py-4 sm:border-t-0 sm:pl-6">
          <dt className="text-[9px] font-black uppercase tracking-[0.1em] text-[#7a8480]">Actions covered</dt>
          <dd className="mt-1 text-[24px] font-black tabular-nums text-[#27302c]">{actionCount}</dd>
        </div>
      </dl>
    </article>
  );
}

function ModuleSlide({ slide, moduleCount }: { slide: Extract<WalkthroughSlide, { kind: "module" }>; moduleCount: number }) {
  const { tutorial } = slide;

  return (
    <article className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-10 lg:px-14">
      <div className="text-[10px] font-black uppercase tracking-[0.11em] text-[#0f7c68]">
        {tutorial.workflow} · Task {slide.moduleIndex + 1} of {moduleCount}
      </div>
      <h3 className="mt-2 max-w-[720px] text-[30px] font-black leading-[34px] text-[#1b211e] sm:text-[36px] sm:leading-10">{tutorial.title}</h3>
      <p className="mt-3 max-w-[720px] text-[15px] font-medium leading-6 text-[#5d6863]">{tutorial.summary}</p>

      <div className="mt-4 flex max-w-[780px] flex-wrap items-center gap-x-2 gap-y-2 text-[11px] font-bold text-[#46514c]" aria-label={`Path: ${tutorial.clickpath.join(", then ")}`}>
        {tutorial.clickpath.map((location, locationIndex) => (
          <span key={`${location}-${locationIndex}`} className="flex items-center gap-2">
            <span>{location}</span>
            {locationIndex < tutorial.clickpath.length - 1 ? <ChevronRight size={13} className="text-[#91a09a]" aria-hidden="true" /> : null}
          </span>
        ))}
      </div>

      <section className="mt-5 max-w-[820px] border-t border-[#d9dfdc] pt-4" aria-labelledby={`walkthrough-actions-${tutorial.id}`}>
        <div className="flex items-center justify-between gap-4">
          <h4 id={`walkthrough-actions-${tutorial.id}`} className="text-[11px] font-black uppercase tracking-[0.08em] text-[#707a76]">What you’ll do</h4>
          <span className="text-[11px] font-bold tabular-nums text-[#7d8783]">{tutorial.steps.length} actions</span>
        </div>
        <ol className="mt-2 grid gap-x-8 md:grid-cols-2">
          {tutorial.steps.map((step, stepIndex) => (
            <li key={step.id} className="grid min-h-10 grid-cols-[26px_minmax(0,1fr)] items-start gap-3 border-t border-[#e3e8e6] py-2.5 first:border-t-0 md:first:border-t">
              <span className="pt-0.5 text-[10px] font-black tabular-nums text-[#0f7c68]">{String(stepIndex + 1).padStart(2, "0")}</span>
              <span className="text-[15px] font-bold leading-5 text-[#2b322f]">{operatorGuideStepTitle(step)}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-4 max-w-[820px] border-l-2 border-[#0f8b73] bg-[#f0f7f4] px-4 py-3">
        <div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#0f7c68]">Finish with</div>
        <p className="mt-1 text-[13px] font-bold leading-5 text-[#34413c]">{tutorial.outcome}</p>
      </div>
    </article>
  );
}
