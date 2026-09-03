"use client";

import { ArrowRight, Check, ListChecks, MapPinned } from "lucide-react";

import { guidedTutorialsForRole, type OperatorGuidedTutorial } from "@/lib/training/operator-guided-tutorials";
import { dispatchOperatorGuide } from "@/lib/training/operator-guided-tour-state";
import type { OperatorTrainingProgress } from "@/lib/training/operator-training-progress-contract";

export default function OperatorGuidedTours({ progress }: { progress: OperatorTrainingProgress }) {
  const tutorials = guidedTutorialsForRole(progress.role);
  const fullTour = tutorials.find((tutorial) => tutorial.id === "full-pipeline");
  const commonTasks = tutorials.filter((tutorial) => tutorial.id !== "full-pipeline");

  return (
    <section className="mt-6" aria-label="Pipeline walkthroughs">
      {fullTour ? <FullWalkthrough tutorial={fullTour} progress={progress} /> : null}

      <div className="mt-8 flex items-end justify-between gap-4 border-b border-[#d4dcd8] pb-3">
        <div>
          <h2 className="text-[18px] font-black tracking-[-0.02em] text-[#202623]">Common tasks</h2>
          <p className="mt-1 text-[11px] text-[#707a76]">Start at the task you need to complete.</p>
        </div>
        <span className="text-[10px] font-bold text-[#77817d]">
          {completedCount(commonTasks, progress)} of {commonTasks.length} completed
        </span>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {commonTasks.map((tutorial) => (
          <TaskWalkthrough key={tutorial.id} tutorial={tutorial} progress={progress} />
        ))}
      </div>
    </section>
  );
}

function FullWalkthrough({ tutorial, progress }: { tutorial: OperatorGuidedTutorial; progress: OperatorTrainingProgress }) {
  const result = progress.tutorialResults[tutorial.id];
  const done = result?.status === "completed";
  return (
    <article className="grid overflow-hidden border border-[#9fc5ba] bg-white lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 gap-4 p-5 sm:p-6">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center border ${done ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#9fc5ba] bg-[#eaf5f1] text-[#0f7c68]"}`}>
          {done ? <Check size={19} aria-hidden="true" /> : <MapPinned size={19} aria-hidden="true" />}
        </span>
        <div className="min-w-0">
          <div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#0f7c68]">Full walkthrough</div>
          <h2 className="mt-1 text-[21px] font-black tracking-[-0.025em] text-[#1d2320]">{tutorial.title}</h2>
          <p className="mt-2 max-w-[760px] text-[12px] leading-5 text-[#5f6965]">{tutorial.summary}</p>
          <div className="mt-3 text-[9px] font-black uppercase tracking-[0.08em] text-[#7a8580]">
            {tutorial.steps.length} steps · about {tutorial.minutes} minutes{done ? " · completed" : ""}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={() => startGuide(tutorial.id)}
        className="group flex min-h-14 items-center justify-between gap-4 border-t border-[#9fc5ba] bg-[#0f8b73] px-5 text-[11px] font-black text-white hover:bg-[#0b7561] lg:min-h-full lg:min-w-[210px] lg:border-l lg:border-t-0"
      >
        {done ? "Take again" : "Start walkthrough"}
        <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </button>
    </article>
  );
}

function TaskWalkthrough({ tutorial, progress }: { tutorial: OperatorGuidedTutorial; progress: OperatorTrainingProgress }) {
  const result = progress.tutorialResults[tutorial.id];
  const done = result?.status === "completed";
  return (
    <article className="flex min-h-[132px] items-stretch border border-[#d2dad7] bg-white">
      <div className="flex min-w-0 flex-1 gap-3 p-4 sm:p-5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center border ${done ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#c2d3cd] bg-[#f0f6f4] text-[#0f7c68]"}`}>
          {done ? <Check size={16} aria-hidden="true" /> : <ListChecks size={16} aria-hidden="true" />}
        </span>
        <div className="min-w-0">
          <h3 className="text-[14px] font-black leading-5 text-[#232927]">{tutorial.title}</h3>
          <p className="mt-1.5 text-[10px] leading-4 text-[#68726e]">{tutorial.summary}</p>
          <div className="mt-2 text-[8px] font-black uppercase tracking-[0.08em] text-[#89928e]">
            {tutorial.steps.length} steps · {tutorial.minutes} min{done ? " · completed" : ""}
          </div>
        </div>
      </div>
      <button
        type="button"
        aria-label={`${done ? "Repeat" : "Start"} ${tutorial.title}`}
        onClick={() => startGuide(tutorial.id)}
        className="flex w-12 shrink-0 items-center justify-center border-l border-[#d2dad7] text-[#0f7c68] hover:bg-[#edf7f3] sm:w-14"
      >
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </article>
  );
}

function startGuide(tutorialId: string) {
  dispatchOperatorGuide({ type: "start", tutorialId });
}

function completedCount(tutorials: readonly OperatorGuidedTutorial[], progress: OperatorTrainingProgress) {
  return tutorials.filter((tutorial) => progress.tutorialResults[tutorial.id]?.status === "completed").length;
}
