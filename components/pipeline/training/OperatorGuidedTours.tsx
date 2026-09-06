"use client";

import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarPlus,
  Check,
  CirclePlay,
  ClipboardCheck,
  ChevronRight,
  FileSearch,
  FolderSearch2,
  LayoutDashboard,
} from "lucide-react";
import { useRef, useState, type KeyboardEvent, type ReactNode, type TouchEvent } from "react";

import {
  guidedTutorialsForRoles,
  operatorGuideChapters,
  operatorGuideStepTitle,
  type OperatorGuidedTutorial,
  type OperatorGuideStep,
} from "@/lib/training/operator-guided-tutorials";
import { dispatchOperatorGuide } from "@/lib/training/operator-guided-tour-state";
import type { OperatorTrainingProgress } from "@/lib/training/operator-training-progress-contract";

const taskPriority = [
  "create-referral",
  "assessor-shift",
  "start-assessment",
  "complete-assessment",
  "review-chart",
  "supervisor-shift",
  "find-workspace",
  "run-report",
] as const;

const taskPresentation: Readonly<Record<string, { description: string; icon: ReactNode }>> = {
  "complete-assessment": { description: "Answer, review, and sign.", icon: <ClipboardCheck size={26} aria-hidden="true" /> },
  "start-assessment": { description: "Schedule it, then open the assessment.", icon: <CalendarPlus size={26} aria-hidden="true" /> },
  "assessor-shift": { description: "Open what needs attention.", icon: <LayoutDashboard size={26} aria-hidden="true" /> },
  "create-referral": { description: "Upload, assign, and schedule.", icon: <CalendarPlus size={26} aria-hidden="true" /> },
  "find-workspace": { description: "Search and reopen it.", icon: <FolderSearch2 size={26} aria-hidden="true" /> },
  "supervisor-shift": { description: "Find unassigned or stuck work.", icon: <BarChart3 size={26} aria-hidden="true" /> },
  "review-chart": { description: "Check the signed record.", icon: <FileSearch size={26} aria-hidden="true" /> },
  "run-report": { description: "Choose, review, and export.", icon: <BarChart3 size={26} aria-hidden="true" /> },
};

export default function OperatorGuidedTours({ assignedRoles, progress }: { assignedRoles: readonly string[]; progress: OperatorTrainingProgress }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tutorials = guidedTutorialsForRoles(assignedRoles).slice().sort((left, right) => priorityOf(left.id) - priorityOf(right.id));
  const selected = tutorials.find((tutorial) => tutorial.id === selectedId) ?? null;
  const selectedIndex = selected ? tutorials.findIndex((tutorial) => tutorial.id === selected.id) : -1;

  function selectTask(id: string | null) {
    setSelectedId(id);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-operator-academy="true"]')?.scrollTo({ top: 0, behavior: "smooth" }));
  }

  if (selected) {
    return (
      <ExpandedTask
        key={selected.id}
        tutorial={selected}
        tutorials={tutorials}
        activeModuleIndex={selectedIndex}
        progress={progress}
        onBack={() => selectTask(null)}
        onSelectModule={(index) => selectTask(tutorials[index]?.id ?? selected.id)}
      />
    );
  }

  return (
    <section className="mt-7 min-h-[calc(100dvh-470px)]" aria-label="Quick help">
      <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-[#252b28]">Quick help</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {tutorials.map((tutorial, index) => (
          <TaskTile key={tutorial.id} rank={index + 1} tutorial={tutorial} completed={progress.tutorialResults[tutorial.id]?.status === "completed"} onOpen={() => selectTask(tutorial.id)} />
        ))}
      </div>
    </section>
  );
}

function TaskTile({ rank, tutorial, completed, onOpen }: { rank: number; tutorial: OperatorGuidedTutorial; completed: boolean; onOpen: () => void }) {
  const presentation = taskPresentation[tutorial.id] ?? { description: tutorial.summary, icon: <ClipboardCheck size={24} aria-hidden="true" /> };
  return (
    <button type="button" aria-label={`Open ${tutorial.title}`} onClick={onOpen} className="group flex min-h-[190px] flex-col justify-between border border-[#ccd6d2] bg-white p-5 text-left hover:border-[#7da99b] hover:bg-[#fbfdfc] sm:p-6">
      <div className="flex items-start justify-between gap-5">
        <span className={`flex h-14 w-14 items-center justify-center border ${completed ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#bfd1ca] bg-[#edf6f3] text-[#0f7c68]"}`}>
          {completed ? <Check size={20} aria-hidden="true" /> : presentation.icon}
        </span>
        <span className="text-[10px] font-black tabular-nums text-[#8a948f]">{String(rank).padStart(2, "0")}</span>
      </div>
      <div className="mt-8 flex items-end justify-between gap-5">
        <div>
          <h2 className="text-[23px] font-black leading-7 tracking-normal text-[#222825]">{tutorial.title}</h2>
          <p className="mt-2 max-w-[330px] text-[15px] font-medium leading-5 text-[#69736f]">{presentation.description}</p>
          <div className="mt-4 text-[11px] font-bold text-[#7d8783]">{tutorial.steps.length} steps · {tutorial.minutes} min{completed ? " · Done" : ""}</div>
        </div>
        <ArrowRight size={18} className="shrink-0 text-[#0f7c68] transition-transform group-hover:translate-x-1" aria-hidden="true" />
      </div>
    </button>
  );
}

function ExpandedTask({
  tutorial,
  tutorials,
  activeModuleIndex,
  progress,
  onBack,
  onSelectModule,
}: {
  tutorial: OperatorGuidedTutorial;
  tutorials: readonly OperatorGuidedTutorial[];
  activeModuleIndex: number;
  progress: OperatorTrainingProgress;
  onBack: () => void;
  onSelectModule: (index: number) => void;
}) {
  const completed = progress.tutorialResults[tutorial.id]?.status === "completed";
  const chapters = operatorGuideChapters(tutorial);
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const activeChapter = chapters[activeChapterIndex] ?? chapters[0];
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  function selectRelativeModule(offset: -1 | 1) {
    const nextIndex = activeModuleIndex + offset;
    if (nextIndex >= 0 && nextIndex < tutorials.length) onSelectModule(nextIndex);
  }

  function handleTouchStart(event: TouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    touchStart.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  function handleTouchEnd(event: TouchEvent<HTMLElement>) {
    const start = touchStart.current;
    const touch = event.changedTouches[0];
    touchStart.current = null;
    if (!start || !touch) return;
    const horizontalDistance = touch.clientX - start.x;
    const verticalDistance = touch.clientY - start.y;
    if (Math.abs(horizontalDistance) < 56 || Math.abs(horizontalDistance) <= Math.abs(verticalDistance)) return;
    selectRelativeModule(horizontalDistance < 0 ? 1 : -1);
  }

  function handleModuleKeys(event: KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowLeft") selectRelativeModule(-1);
    if (event.key === "ArrowRight") selectRelativeModule(1);
  }

  if (!activeChapter) return null;

  return (
    <section
      className="mt-5 flex min-h-[calc(100dvh-180px)] flex-col border border-[#cbd5d1] bg-white outline-none"
      aria-label={`${tutorial.title} module`}
      tabIndex={0}
      onKeyDown={handleModuleKeys}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <header className="border-b border-[#d5ddda] p-5 sm:p-7 lg:px-9 lg:py-8">
        <ModulePager
          tutorials={tutorials}
          activeIndex={activeModuleIndex}
          onBack={onBack}
          onSelect={onSelectModule}
          onPrevious={() => selectRelativeModule(-1)}
          onNext={() => selectRelativeModule(1)}
        />
        <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-[780px]">
            <h2 className="text-[30px] font-black leading-9 tracking-normal text-[#19201d] sm:text-[38px] sm:leading-[42px]">{tutorial.title}</h2>
            <p className="mt-3 max-w-[680px] text-[17px] font-medium leading-6 text-[#606b67]">{tutorial.summary}</p>
          </div>
          <button type="button" aria-label={`Start guided walkthrough: ${tutorial.title}`} onClick={() => dispatchOperatorGuide({ type: "start", tutorialId: tutorial.id })} className="flex h-12 items-center justify-center gap-3 bg-[#0f8b73] px-6 text-[11px] font-black text-white hover:bg-[#0b715e]">
            {completed ? "Run it again" : "Start guide"} <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="grid flex-1 lg:grid-cols-[270px_minmax(0,1fr)]">
        <nav aria-label={`${tutorial.title} chapters`} className="border-b border-[#d5ddda] p-4 sm:p-5 lg:border-b-0 lg:border-r lg:p-6">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.09em] text-[#6c7772]"><BookOpen size={14} aria-hidden="true" /> Chapters</div>
          <ol className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
            {chapters.map((chapter, index) => (
              <li key={chapter.id}>
                <button
                  type="button"
                  aria-current={index === activeChapterIndex ? "step" : undefined}
                  onClick={() => setActiveChapterIndex(index)}
                  className={`grid min-h-14 w-full grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-3 border-l-2 px-3 text-left ${index === activeChapterIndex ? "border-[#0f8b73] bg-[#edf6f3] text-[#173d34]" : "border-transparent text-[#5f6965] hover:border-[#a6c5bb] hover:bg-[#fafcfb]"}`}
                >
                  <span className="text-[10px] font-black tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                  <span className="text-[14px] font-black leading-5">{chapter.title}</span>
                  <span className="text-[10px] font-bold tabular-nums text-[#87918d]">{chapter.steps.length}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <section className="min-w-0 p-5 sm:p-7 lg:px-10 lg:py-8" aria-labelledby={`chapter-${activeChapter.id}`}>
          <div className="flex flex-col gap-5 border-b border-[#d9dfdc] pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-[700px]">
              <div className="text-[10px] font-black uppercase tracking-[0.09em] text-[#0f7c68]">{activeChapterIndex + 1} of {chapters.length}</div>
              <h3 id={`chapter-${activeChapter.id}`} className="mt-2 text-[30px] font-black leading-9 text-[#1d2421]">{activeChapter.title}</h3>
            </div>
            <button
              type="button"
              onClick={() => dispatchOperatorGuide({ type: "start", tutorialId: tutorial.id, stepIndex: activeChapter.startStepIndex })}
              className="flex h-11 shrink-0 items-center justify-center gap-2 border border-[#0f8b73] px-4 text-[11px] font-black text-[#0f7c68] hover:bg-[#edf6f3]"
            >
              <CirclePlay size={16} aria-hidden="true" /> Practice chapter
            </button>
          </div>

          <ol className="mt-2">
            {activeChapter.steps.map((step, index) => (
              <ChapterLesson
                key={step.id}
                step={step}
                number={activeChapter.startStepIndex + index + 1}
                onGuide={() => dispatchOperatorGuide({ type: "start", tutorialId: tutorial.id, stepIndex: activeChapter.startStepIndex + index })}
              />
            ))}
          </ol>
        </section>
      </div>
    </section>
  );
}

function ModulePager({
  tutorials,
  activeIndex,
  onBack,
  onSelect,
  onPrevious,
  onNext,
}: {
  tutorials: readonly OperatorGuidedTutorial[];
  activeIndex: number;
  onBack: () => void;
  onSelect: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const previous = tutorials[activeIndex - 1];
  const next = tutorials[activeIndex + 1];

  return (
    <div className="flex min-h-11 items-center justify-between gap-3" aria-label="Change module">
      <button type="button" onClick={onBack} className="flex h-10 shrink-0 items-center gap-2 px-1 text-[11px] font-black text-[#5d6863] hover:text-[#0f7c68]">
        <ArrowLeft size={15} aria-hidden="true" /> Modules
      </button>

      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <button
          type="button"
          aria-label={previous ? `Previous module: ${previous.title}` : "No previous module"}
          disabled={!previous}
          onClick={onPrevious}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#cbd5d1] text-[#36574e] hover:border-[#7da99b] hover:bg-[#f2f8f5] disabled:cursor-default disabled:opacity-25"
        >
          <ArrowLeft size={17} aria-hidden="true" />
        </button>

        <div className="min-w-0 text-center" aria-live="polite">
          <div className="text-[10px] font-black uppercase tracking-[0.08em] text-[#68736e]">
            Module {activeIndex + 1} of {tutorials.length}
          </div>
          <div className="mt-2 flex items-center justify-center gap-1.5" role="tablist" aria-label="Modules">
            {tutorials.map((candidate, index) => (
              <button
                key={candidate.id}
                type="button"
                role="tab"
                aria-label={`Open module ${index + 1}: ${candidate.title}`}
                aria-selected={index === activeIndex}
                title={candidate.title}
                onClick={() => onSelect(index)}
                className={`h-2.5 rounded-full transition-[width,background-color] duration-200 ${index === activeIndex ? "w-7 bg-[#0f8b73]" : "w-2.5 bg-[#c8d2ce] hover:bg-[#7da99b]"}`}
              />
            ))}
          </div>
        </div>

        <button
          type="button"
          aria-label={next ? `Next module: ${next.title}` : "No next module"}
          disabled={!next}
          onClick={onNext}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#cbd5d1] text-[#36574e] hover:border-[#7da99b] hover:bg-[#f2f8f5] disabled:cursor-default disabled:opacity-25"
        >
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ChapterLesson({ step, number, onGuide }: { step: OperatorGuideStep; number: number; onGuide: () => void }) {
  return (
    <li className="border-b border-[#e0e6e3] py-5">
      <div className="grid gap-4 sm:grid-cols-[34px_minmax(0,1fr)_auto] sm:items-start">
        <span className="flex h-7 w-7 items-center justify-center border border-[#bfd1ca] bg-[#edf6f3] text-[10px] font-black tabular-nums text-[#0f7c68]">{number}</span>
        <div className="min-w-0">
          <h4 className="text-[18px] font-black leading-6 text-[#28302c]">{operatorGuideStepTitle(step)}</h4>
          <p className="mt-2 text-[14px] font-semibold leading-5 text-[#4f5c56]">{step.instruction}</p>
          <p className="mt-2 text-[12px] font-medium leading-5 text-[#78827e]"><span className="font-black text-[#5d6863]">Check:</span> {step.completion}</p>
          <details className="mt-3 text-[12px] leading-5 text-[#68736e]">
            <summary className="cursor-pointer font-black text-[#52605a] hover:text-[#0f7c68]">Notes</summary>
            <p className="mt-2">{step.message}</p>
            <p className="mt-2 font-semibold text-[#765f29]">{step.safety}</p>
          </details>
        </div>
        <button
          type="button"
          aria-label={`Open guided tooltip for ${operatorGuideStepTitle(step)}`}
          onClick={onGuide}
          className="flex h-10 items-center justify-center gap-2 px-1 text-[11px] font-black text-[#0f7c68] hover:text-[#0a6555]"
        >
          Show me <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

function priorityOf(id: string) {
  const priority = taskPriority.indexOf(id as (typeof taskPriority)[number]);
  return priority === -1 ? taskPriority.length : priority;
}
