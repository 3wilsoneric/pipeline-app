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

const taskPresentation: Readonly<Record<string, { label: string; icon: ReactNode }>> = {
  "complete-assessment": { label: "Complete an assessment", icon: <ClipboardCheck size={24} aria-hidden="true" /> },
  "assessor-shift": { label: "Find my assigned work", icon: <LayoutDashboard size={24} aria-hidden="true" /> },
  "create-referral": { label: "Create and schedule a referral", icon: <CalendarPlus size={24} aria-hidden="true" /> },
  "find-workspace": { label: "Find and reopen a referral", icon: <FolderSearch2 size={24} aria-hidden="true" /> },
  "supervisor-shift": { label: "Review team workload", icon: <BarChart3 size={24} aria-hidden="true" /> },
  "review-chart": { label: "Review a completed Chart", icon: <FileSearch size={24} aria-hidden="true" /> },
  "run-report": { label: "Run or export a report", icon: <BarChart3 size={24} aria-hidden="true" /> },
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
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tutorials.map((tutorial, index) => (
          <TaskTile key={tutorial.id} rank={index + 1} tutorial={tutorial} completed={progress.tutorialResults[tutorial.id]?.status === "completed"} onOpen={() => selectTask(tutorial.id)} />
        ))}

        <button type="button" aria-label="Open full Pipeline workflow overview" onClick={() => setPreviewOpen(true)} className="group flex min-h-[184px] flex-col justify-between border border-[#9eb4ac] bg-[#153f36] p-5 text-left text-white shadow-[0_8px_24px_rgba(21,63,54,0.12)] hover:bg-[#0f4b3e] sm:p-6">
          <div className="flex items-start justify-between gap-5">
            <span className="flex h-12 w-12 items-center justify-center border border-white/25 bg-white/10"><MonitorPlay size={24} aria-hidden="true" /></span>
            <span className="text-[9px] font-black uppercase tracking-[0.1em] text-[#bfe5d8]">Workflow overview</span>
          </div>
          <div className="mt-8 flex items-end justify-between gap-5">
            <div>
              <div className="text-[19px] font-black leading-6 tracking-[-0.025em]">See the full workflow</div>
              <div className="mt-1.5 max-w-[330px] text-[11px] leading-4 text-[#cae0d9]">Referral intake through assessment, Chart, and handoff.</div>
            </div>
            <ArrowRight size={18} className="shrink-0 transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </div>
        </button>
      </div>

      {previewOpen ? <FullWorkflowWalkthroughPreview onClose={() => setPreviewOpen(false)} /> : null}
    </section>
  );
}

function TaskTile({ rank, tutorial, completed, onOpen }: { rank: number; tutorial: OperatorGuidedTutorial; completed: boolean; onOpen: () => void }) {
  const presentation = taskPresentation[tutorial.id] ?? { label: tutorial.title, icon: <ClipboardCheck size={24} aria-hidden="true" /> };
  return (
    <button type="button" aria-label={`Open ${presentation.label}`} onClick={onOpen} className="group flex min-h-[184px] flex-col justify-between border border-[#ccd6d2] bg-white p-5 text-left shadow-[0_5px_18px_rgba(24,43,37,0.04)] hover:border-[#7da99b] hover:bg-[#fbfdfc] sm:p-6">
      <div className="flex items-start justify-between gap-5">
        <span className={`flex h-12 w-12 items-center justify-center border ${completed ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#bfd1ca] bg-[#edf6f3] text-[#0f7c68]"}`}>
          {completed ? <Check size={20} aria-hidden="true" /> : presentation.icon}
        </span>
        <span className="text-[10px] font-black tabular-nums text-[#8a948f]">{String(rank).padStart(2, "0")}</span>
      </div>
      <div className="mt-8 flex items-end justify-between gap-5">
        <div>
          <h2 className="text-[19px] font-black leading-6 tracking-[-0.025em] text-[#222825]">{presentation.label}</h2>
          <p className="mt-1.5 max-w-[330px] text-[11px] leading-4 text-[#69736f]">{tutorial.summary}</p>
          <div className="mt-3 text-[9px] font-black uppercase tracking-[0.08em] text-[#87918d]">About {tutorial.minutes} min{completed ? " · completed" : ""}</div>
        </div>
        <ArrowRight size={18} className="shrink-0 text-[#0f7c68] transition-transform group-hover:translate-x-1" aria-hidden="true" />
      </div>
    </button>
  );
}

function ExpandedTask({ tutorial, progress, onBack }: { tutorial: OperatorGuidedTutorial; progress: OperatorTrainingProgress; onBack: () => void }) {
  const presentation = taskPresentation[tutorial.id] ?? { label: tutorial.title, icon: <ClipboardCheck size={24} aria-hidden="true" /> };
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
            <p className="mt-3 max-w-[680px] text-[13px] leading-5 text-[#606b67]">{tutorial.outcome}</p>
          </div>
          <button type="button" aria-label={`Start guided walkthrough: ${presentation.label}`} onClick={() => dispatchOperatorGuide({ type: "start", tutorialId: tutorial.id })} className="flex h-12 items-center justify-center gap-3 bg-[#0f8b73] px-6 text-[11px] font-black text-white hover:bg-[#0b715e]">
            {completed ? "Repeat walkthrough" : "Start guided walkthrough"} <ArrowRight size={15} aria-hidden="true" />
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
            <h3 className="text-[10px] font-black uppercase tracking-[0.1em] text-[#707a76]">What you will do</h3>
            <span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#8a948f]">{tutorial.steps.length} actions</span>
          </div>
          <ol className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {tutorial.steps.map((step, index) => (
              <li key={step.id} className="grid grid-cols-[26px_minmax(0,1fr)] gap-3 border-t border-[#e0e5e3] pt-3">
                <span className="text-[9px] font-black tabular-nums text-[#0f7c68]">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <div className="text-[12px] font-black text-[#2b322f]">{step.title}</div>
                  <div className="mt-1 text-[10px] leading-4 text-[#707a76]">{step.instruction}</div>
                </div>
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
