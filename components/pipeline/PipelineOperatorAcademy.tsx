"use client";

import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";

import OperatorDemoEntry from "@/components/pipeline/training/OperatorDemoEntry";
import DemoAssessmentLabButton from "@/components/pipeline/DemoAssessmentLabButton";
import OperatorGuidedTours from "@/components/pipeline/training/OperatorGuidedTours";
import {
  emptyOperatorProgress,
  normalizeOperatorProgress,
  type OperatorProgressRecord,
} from "@/lib/training/operator-training-progress-contract";

export default function PipelineOperatorAcademy({
  assignedRoles,
  demoUrl,
  initialProgress,
}: {
  assignedRoles: readonly string[];
  demoUrl: string | null;
  progressStorageKey: string;
  initialProgress: OperatorProgressRecord;
}) {
  const [progress, setProgress] = useState(() => emptyOperatorProgress(normalizeOperatorProgress(initialProgress.progress, assignedRoles).role));
  const [moduleOpen, setModuleOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const next = emptyOperatorProgress(normalizeOperatorProgress(initialProgress.progress, assignedRoles).role);
    queueMicrotask(() => {
      if (cancelled) return;
      setProgress(next);
    });
    return () => {
      cancelled = true;
    };
  }, [assignedRoles, initialProgress]);

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
      data-training-hydrated="true"
      className={`h-full min-h-0 bg-[#f6f8f7] text-[#171a18] ${moduleOpen ? "overflow-hidden" : "overflow-y-auto"}`}
    >
      <div className={moduleOpen ? "h-full min-h-0 w-full" : "w-full px-4 pb-12 pt-6 sm:px-6 lg:px-8 lg:pt-9"}>
        {!moduleOpen ? (
          <>
            <header className="pb-5">
              <h1 className="text-[34px] font-semibold tracking-[-0.045em] text-[#151917] sm:text-[44px]">Learning Center</h1>
              <p className="mt-2 text-[15px] leading-6 text-[#606b67]">{process.env.NEXT_PUBLIC_PIPELINE_PERSONA_DEMO === "true" ? "Explore the assessment, or choose a task below." : "Start with the orientation, or choose a task for help on the screen you use."}</p>
            </header>

            {process.env.NEXT_PUBLIC_PIPELINE_PERSONA_DEMO === "true" ? (
              <DemoAssessmentLabButton className="mb-5 block w-full border border-[#a7c5ba] bg-white px-6 py-6 text-left hover:bg-[#f4f9f6] focus-visible:outline-2 focus-visible:outline-[#0f8b73]">
                <span className="block text-[24px] font-semibold text-[#18372f]">Assessment lab</span>
                <span className="mt-2 block text-[14px] text-[#606b67]">Click through every section and its answer help.</span>
              </DemoAssessmentLabButton>
            ) : <OperatorDemoEntry demoUrl={demoUrl} />}
          </>
        ) : null}
        <OperatorGuidedTours assignedRoles={assignedRoles} progress={progress} onExpandedChange={setModuleOpen} />

        {!moduleOpen ? (
          <footer className="mt-5 flex items-center gap-2 text-[10px] leading-4 text-[#6d7773]">
            <CheckCircle2 size={14} className="shrink-0 text-[#0f8b73]" aria-hidden="true" />
            Assessment practice uses a synthetic case. Other guides use the app’s controls: use test records, not live client data, when practicing.
          </footer>
        ) : null}
      </div>
    </main>
  );
}
