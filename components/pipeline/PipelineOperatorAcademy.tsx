"use client";

import { CheckCircle2 } from "lucide-react";
import { startTransition, useEffect, useState } from "react";

import OperatorGuidedTours from "@/components/pipeline/training/OperatorGuidedTours";
import {
  emptyOperatorProgress,
  mergeOperatorProgress,
  normalizeOperatorProgress,
  type OperatorProgressRecord,
  type OperatorTrainingProgress,
} from "@/lib/training/operator-training-progress-contract";

export default function PipelineOperatorAcademy({
  assignedRoles,
  progressStorageKey,
  initialProgress,
}: {
  assignedRoles: readonly string[];
  progressStorageKey: string;
  initialProgress: OperatorProgressRecord;
}) {
  const [progress, setProgress] = useState(() => normalizeOperatorProgress(initialProgress.progress, assignedRoles));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const serverProgress = normalizeOperatorProgress(initialProgress.progress, assignedRoles);
    const storedProgress = readLocalProgress(progressStorageKey, assignedRoles);
    const next = initialProgress.persistence === "browser" || initialProgress.revision === 0
      ? mergeOperatorProgress(serverProgress, storedProgress, assignedRoles)
      : serverProgress;
    startTransition(() => {
      setProgress(next);
      setHydrated(true);
    });
  }, [assignedRoles, initialProgress, progressStorageKey]);

  useEffect(() => {
    const recordCompletion = (event: Event) => {
      const tutorialId = (event as CustomEvent<{ tutorialId?: string }>).detail?.tutorialId;
      if (!tutorialId) return;
      const now = new Date().toISOString();
      setProgress((current) => ({
        ...current,
        tutorialResults: {
          ...current.tutorialResults,
          [tutorialId]: {
            status: "completed",
            currentStep: current.tutorialResults[tutorialId]?.currentStep ?? 0,
            startedAt: current.tutorialResults[tutorialId]?.startedAt ?? now,
            updatedAt: now,
            completedAt: now,
          },
        },
      }));
    };
    window.addEventListener("pipeline:guided-tutorial-completed", recordCompletion);
    return () => window.removeEventListener("pipeline:guided-tutorial-completed", recordCompletion);
  }, []);

  return (
    <main
      data-operator-academy="true"
      data-training-hydrated={hydrated ? "true" : "false"}
      aria-busy={!hydrated}
      className={`h-full min-h-0 overflow-y-auto bg-[#f6f8f7] text-[#171a18] ${hydrated ? "" : "pointer-events-none"}`}
    >
      <div className="mx-auto w-full max-w-[1360px] px-4 pb-12 pt-6 sm:px-6 lg:px-8 lg:pt-9">
        <header className="border-b border-[#cbd5d1] pb-5">
          <h1 className="text-[30px] font-semibold tracking-[-0.04em] text-[#151917] sm:text-[36px]">Learning Center</h1>
          <p className="mt-1.5 max-w-[680px] text-[13px] leading-5 text-[#626c68]">
            Choose a walkthrough. Pipeline will open the right screen and highlight each action.
          </p>
        </header>

        <OperatorGuidedTours progress={progress} />

        <footer className="mt-5 flex items-center gap-2 text-[10px] leading-4 text-[#6d7773]">
          <CheckCircle2 size={14} className="shrink-0 text-[#0f8b73]" aria-hidden="true" />
          Use test records while learning. The guide does not read what you type or submit actions for you.
        </footer>
      </div>
    </main>
  );
}

function readLocalProgress(key: string, roles: readonly string[]): OperatorTrainingProgress {
  const empty = emptyOperatorProgress(normalizeOperatorProgress({}, roles).role);
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? normalizeOperatorProgress(JSON.parse(raw), roles) : empty;
  } catch {
    return empty;
  }
}
