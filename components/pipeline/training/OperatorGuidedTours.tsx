"use client";

import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarPlus,
  Check,
  ClipboardCheck,
  FileSearch,
  FolderSearch2,
  LayoutDashboard,
  MonitorPlay,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import FullWorkflowWalkthroughPreview from "@/components/pipeline/training/FullWorkflowWalkthroughPreview";
import { guidedTutorialsForRoles, type OperatorGuidedTutorial } from "@/lib/training/operator-guided-tutorials";
import { dispatchOperatorGuide } from "@/lib/training/operator-guided-tour-state";
import type { OperatorTrainingProgress } from "@/lib/training/operator-training-progress-contract";

const taskPriority = [
  "complete-assessment",
  "assessor-shift",
  "create-referral",
  "find-workspace",
  "supervisor-shift",
  "review-chart",
  "run-report",
] as const;

const taskPresentation: Readonly<Record<string, { label: string; description: string; icon: ReactNode }>> = {
  "complete-assessment": { label: "Complete an assessment", description: "Work through the form and sign it when it is ready.", icon: <ClipboardCheck size={24} aria-hidden="true" /> },
  "assessor-shift": { label: "Find my assigned work", description: "See what is assigned to you and what needs attention.", icon: <LayoutDashboard size={24} aria-hidden="true" /> },
  "create-referral": { label: "Create and schedule a referral", description: "Add the packet, fill in intake, assign it, and schedule the assessment.", icon: <CalendarPlus size={24} aria-hidden="true" /> },
  "find-workspace": { label: "Find and reopen a referral", description: "Find an existing referral and pick up where it left off.", icon: <FolderSearch2 size={24} aria-hidden="true" /> },
  "supervisor-shift": { label: "Review team workload", description: "Check assignments, schedules, and anything that is stuck.", icon: <BarChart3 size={24} aria-hidden="true" /> },
  "review-chart": { label: "Review a completed Chart", description: "Check the signed assessment and handoff information.", icon: <FileSearch size={24} aria-hidden="true" /> },
  "run-report": { label: "Run or export a report", description: "Choose a report, check the rows, and export it if needed.", icon: <BarChart3 size={24} aria-hidden="true" /> },
};

export default function OperatorGuidedTours({ assignedRoles, progress }: { assignedRoles: readonly string[]; progress: OperatorTrainingProgress }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const tutorials = guidedTutorialsForRoles(assignedRoles).slice().sort((left, right) => priorityOf(left.id) - priorityOf(right.id));
  const selected = tutorials.find((tutorial) => tutorial.id === selectedId) ?? null;

  function selectTask(id: string | null) {
    setSelectedId(id);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-operator-academy="true"]')?.scrollTo({ top: 0, behavior: "smooth" }));
  }

  if (selected) return <ExpandedTask tutorial={selected} progress={progress} onBack={() => selectTask(null)} />;

  return (
    <section className="mt-5 min-h-[calc(100dvh-180px)]" aria-label="Pipeline tasks">
      <button type="button" aria-label="Open full Pipeline walkthrough" onClick={() => setPreviewOpen(true)} className="group grid min-h-[230px] w-full gap-8 border border-[#a9c2b9] bg-[#e8f3ef] p-6 text-left hover:border-[#5f9585] sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)] lg:items-end lg:p-10">
        <div>
          <span className="flex h-14 w-14 items-center justify-center border border-[#9bbab0] bg-white text-[#0f7c68]"><MonitorPlay size={27} aria-hidden="true" /></span>
          <div className="mt-8 text-[10px] font-black uppercase tracking-[0.1em] text-[#0f7c68]">Full walkthrough</div>
          <h2 className="mt-2 text-[28px] font-black leading-8 tracking-[-0.035em] text-[#18372f] sm:text-[34px] sm:leading-9">See how the whole process works</h2>
          <p className="mt-3 text-[13px] leading-5 text-[#4e6860]">From a new referral to the assessment, Chart, and handoff.</p>
        </div>
        <div className="flex items-end justify-between gap-6 border-t border-[#bcd0c9] pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <div className="text-[12px] font-bold leading-7 text-[#315a4f]">Referral → Intake → Assessment → Chart → Handoff</div>
          <ArrowRight size={22} className="shrink-0 text-[#0f7c68] transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </div>
      </button>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tutorials.map((tutorial, index) => (
          <TaskTile key={tutorial.id} rank={index + 1} tutorial={tutorial} completed={progress.tutorialResults[tutorial.id]?.status === "completed"} onOpen={() => selectTask(tutorial.id)} />
        ))}
      </div>

      {previewOpen ? <FullWorkflowWalkthroughPreview onClose={() => setPreviewOpen(false)} /> : null}
    </section>
  );
}

function TaskTile({ rank, tutorial, completed, onOpen }: { rank: number; tutorial: OperatorGuidedTutorial; completed: boolean; onOpen: () => void }) {
  const presentation = taskPresentation[tutorial.id] ?? { label: tutorial.title, description: tutorial.summary, icon: <ClipboardCheck size={24} aria-hidden="true" /> };
  return (
    <button type="button" aria-label={`Open ${presentation.label}`} onClick={onOpen} className="group flex min-h-[178px] flex-col justify-between border border-[#ccd6d2] bg-white p-5 text-left hover:border-[#7da99b] hover:bg-[#fbfdfc] sm:p-6">
      <div className="flex items-start justify-between gap-5">
        <span className={`flex h-12 w-12 items-center justify-center border ${completed ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#bfd1ca] bg-[#edf6f3] text-[#0f7c68]"}`}>
          {completed ? <Check size={20} aria-hidden="true" /> : presentation.icon}
        </span>
        <span className="text-[10px] font-black tabular-nums text-[#8a948f]">{String(rank).padStart(2, "0")}</span>
      </div>
      <div className="mt-8 flex items-end justify-between gap-5">
        <div>
          <h2 className="text-[19px] font-black leading-6 tracking-[-0.025em] text-[#222825]">{presentation.label}</h2>
          <p className="mt-1.5 max-w-[330px] text-[12px] leading-5 text-[#69736f]">{presentation.description}</p>
          <div className="mt-3 text-[10px] font-bold text-[#87918d]">{tutorial.minutes} min{completed ? " · Completed" : ""}</div>
        </div>
        <ArrowRight size={18} className="shrink-0 text-[#0f7c68] transition-transform group-hover:translate-x-1" aria-hidden="true" />
      </div>
    </button>
  );
}

function ExpandedTask({ tutorial, progress, onBack }: { tutorial: OperatorGuidedTutorial; progress: OperatorTrainingProgress; onBack: () => void }) {
  const presentation = taskPresentation[tutorial.id] ?? { label: tutorial.title, description: tutorial.summary, icon: <ClipboardCheck size={24} aria-hidden="true" /> };
  const completed = progress.tutorialResults[tutorial.id]?.status === "completed";

  return (
    <section className="mt-5 flex min-h-[calc(100dvh-180px)] flex-col border border-[#cbd5d1] bg-white">
      <header className="border-b border-[#d5ddda] p-5 sm:p-7 lg:p-9">
        <button type="button" onClick={onBack} className="flex h-9 items-center gap-2 text-[10px] font-black text-[#5d6863] hover:text-[#0f7c68]">
          <ArrowLeft size={14} aria-hidden="true" /> All tasks
        </button>
        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-[780px]">
            <div className="text-[9px] font-black uppercase tracking-[0.11em] text-[#0f7c68]">{tutorial.workflow}</div>
            <h2 className="mt-2 text-[30px] font-black leading-9 tracking-[-0.04em] text-[#19201d] sm:text-[38px] sm:leading-[42px]">{presentation.label}</h2>
            <p className="mt-3 max-w-[680px] text-[14px] leading-6 text-[#606b67]">{presentation.description}</p>
          </div>
          <button type="button" aria-label={`Start guided walkthrough: ${presentation.label}`} onClick={() => dispatchOperatorGuide({ type: "start", tutorialId: tutorial.id })} className="flex h-12 items-center justify-center gap-3 bg-[#0f8b73] px-6 text-[11px] font-black text-white hover:bg-[#0b715e]">
            {completed ? "Run it again" : "Start guide"} <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="grid flex-1 gap-0 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <section className="border-b border-[#d5ddda] p-5 sm:p-7 lg:border-b-0 lg:border-r lg:p-9">
          <h3 className="text-[10px] font-black uppercase tracking-[0.1em] text-[#707a76]">Clickpath</h3>
          <ol className="mt-5 space-y-3" aria-label={`Clickpath: ${tutorial.clickpath.join(", then ")}`}>
            {tutorial.clickpath.map((part, index) => (
              <li key={`${tutorial.id}:${part}`} className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center border border-[#bfd1ca] bg-[#edf6f3] text-[9px] font-black text-[#0f7c68]">{index + 1}</span>
                <span className="text-[13px] font-bold text-[#323a36]">{part}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="p-5 sm:p-7 lg:p-9">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-[10px] font-black uppercase tracking-[0.1em] text-[#707a76]">Steps</h3>
            <span className="text-[10px] font-bold text-[#8a948f]">{tutorial.steps.length}</span>
          </div>
          <ol className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {tutorial.steps.map((step, index) => (
              <li key={step.id} className="grid grid-cols-[26px_minmax(0,1fr)] gap-3 border-t border-[#e0e5e3] pt-3">
                <span className="text-[9px] font-black tabular-nums text-[#0f7c68]">{String(index + 1).padStart(2, "0")}</span>
                <div className="text-[13px] font-bold text-[#2b322f]">{step.title}</div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </section>
  );
}

function priorityOf(id: string) {
  const priority = taskPriority.indexOf(id as (typeof taskPriority)[number]);
  return priority === -1 ? taskPriority.length : priority;
}
