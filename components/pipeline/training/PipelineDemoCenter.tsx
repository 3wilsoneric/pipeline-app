"use client";

import {
  ArrowLeft,
  ArrowRight,
  ClipboardCheck,
  ExternalLink,
  ListChecks,
  Maximize2,
  RefreshCcw,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { clearPipelineClientSessionCache, fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import type { PipelineDemoEnvironment } from "@/lib/demo/demo-environment";
import {
  buildPipelineDemoReferral,
  getPipelineDemoScenario,
  pipelineDemoScenarios,
  pipelineDemoTag,
  type PipelineDemoScenario,
  type PipelineDemoScenarioId,
} from "@/lib/demo/demo-scenarios";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import PipelineProcessTester, { type ProcessTesterStage } from "@/components/pipeline/training/PipelineProcessTester";

const SubmissionAcceptanceDemo = dynamic(() => import("@/components/pipeline/training/SubmissionAcceptanceDemo"), {
  loading: () => <div className="flex min-h-[260px] items-center justify-center text-[11px] font-bold text-[#68736f]">Loading workflow rehearsal...</div>,
});

type DemoActor = {
  id: string;
  name: string;
  email: string;
  roles: readonly string[];
  demoPersona?: "assessor" | "supervisor";
};

type DemoReferralSummary = Pick<Referral, "id" | "name" | "community" | "tags" | "createdAt">;
type DemoAssessor = { principal_id: string; display_name: string };
type DemoView = "presentation" | "lab" | "handoff" | "tester";
type DemoWorkspaceStage = "intake" | "assessment";

type PresentationSlide = {
  id: string;
  number: number;
  navLabel: string;
  location: string;
  title: string;
  summary: string;
  screenshots: readonly PresentationScreenshot[];
  nextLabel: string;
};

type PresentationScreenshot = {
  src: string;
  alt: string;
  label: string;
  caption: string;
};

const presentationSlides: readonly PresentationSlide[] = [
  {
    id: "referral-map",
    number: 1,
    navLabel: "Map",
    location: "Pipeline referral workflow",
    title: "Find your referral",
    summary: "Open an assigned referral from Home and keep its work in one workspace.",
    screenshots: [{
      src: "/training/presentation/assessor-home.png",
      alt: "Pipeline Home with Taylor Rivera in New assignments and the current work queue.",
      label: "Home · New assignments",
      caption: "Select the name under New assignments to open that referral. The + in the top navigation is for a new referral, not an assigned one.",
    }],
    nextLabel: "See the main screens",
  },
  {
    id: "find-work",
    number: 2,
    navLabel: "Screens",
    location: "Home · Workspaces · Calendar · Clients",
    title: "Where the work lives",
    summary: "Home shows next work; Workspaces, Calendar, and Clients give you other views.",
    screenshots: [
      { src: "/training/presentation/assessor-workspaces.png", alt: "Pipeline Workspaces with recent referrals and the workspace search and owner filters.", label: "Workspaces", caption: "Workspaces → select the name to open the existing record. Search and owner filters are above the list." },
      { src: "/training/presentation/assessor-home.png", alt: "Pipeline Home with current work and new assignments.", label: "Home", caption: "Select a work item or new assignment. Continue working appears here when there is saved work to resume." },
      { src: "/training/presentation/assessor-calendar.png", alt: "Pipeline Calendar with scheduled assessments and links back to their referrals.", label: "Calendar", caption: "Select an appointment to see its details and open the linked referral." },
      { src: "/training/presentation/current-clients.png", alt: "Pipeline Clients showing current residents as client folders, with Cards and List controls.", label: "Clients", caption: "Current residents from the Alamo platform. Open a folder to see the client chart, or switch to List." },
    ],
    nextLabel: "Open the workspace",
  },
  {
    id: "open-workspace",
    number: 3,
    navLabel: "Workspace",
    location: "Workspaces → referral",
    title: "Inside the workspace",
    summary: "The referral packet, intake, assessment, chart, and files stay together.",
    screenshots: [{
      src: "/training/presentation/intake-workspace-current.png",
      alt: "Synthetic Pipeline Intake workspace with the initial referral document area.",
      label: "Intake and packet",
      caption: "New-referral intake example. Add the referral packet here; existing transferred records use the chart instead.",
    }],
    nextLabel: "Review the intake",
  },
  {
    id: "review-intake",
    number: 4,
    navLabel: "Intake",
    location: "Workspace → Intake",
    title: "Review intake",
    summary: "Check identity and contact details against the referral packet before scheduling.",
    screenshots: [{
      src: "/training/presentation/intake-review.png",
      alt: "Synthetic Pipeline chart-style intake showing identity, referral details, and contact information for Taylor Rivera.",
      label: "Reviewed intake",
      caption: "The packet and entered facts belong to this intake. Confirm the saved status before leaving; add later files to the same workspace.",
    }],
    nextLabel: "Schedule the assessment",
  },
  {
    id: "schedule-assessment",
    number: 5,
    navLabel: "Schedule",
    location: "Workspace → Assessment → Schedule",
    title: "Schedule the assessment",
    summary: "Set the time, method, and meeting details in the same workspace.",
    screenshots: [
      {
        src: "/training/presentation/assessment-schedule-current.png",
        alt: "Synthetic Pipeline full-screen Schedule assessment form with date, duration, method, and meeting details.",
        label: "Schedule assessment",
        caption: "Set date and time in Pacific Time, choose the method, enter its meeting details, then select Schedule assessment.",
      },
      {
        src: "/training/presentation/assessor-calendar.png",
        alt: "Synthetic Pipeline Calendar showing an assessor schedule and a ready-to-schedule queue.",
        label: "Calendar",
        caption: "Calendar shows the saved appointment and the ready-to-schedule queue for the selected assessor.",
      },
    ],
    nextLabel: "Open the assessment",
  },
  {
    id: "open-assessment",
    number: 6,
    navLabel: "Assessment",
    location: "Workspace → Assessment → Open assessment",
    title: "Resume the interview",
    summary: "Use the guided questions or review the same answers in the full assessment.",
    screenshots: [{
      src: "/training/presentation/assessment-interview-current.png",
      alt: "Pipeline guided assessment interview for Taylor Rivera with real answer controls and Next at the bottom right.",
      label: "Guided interview",
      caption: "Answer in the middle; use Back and Next at the bottom. Full switches to the section view, while X returns to the assessment workspace.",
    }],
    nextLabel: "Document the interview",
  },
  {
    id: "document-interview",
    number: 7,
    navLabel: "Document",
    location: "Assessment → History → Prior placements → Language Lab",
    title: "Write beside the answer",
    summary: "Language Lab is available beneath the Prior placements question.",
    screenshots: [{
      src: "/training/presentation/assessment-language-lab.png",
      alt: "Pipeline assessment History screen with Language Lab expanded beneath the Prior placements answer.",
      label: "Language Lab in the assessment",
      caption: "Select Language Lab beneath Prior placements. Its writing order, checklist, and example stay beside the answer you are working on.",
    }],
    nextLabel: "Review and sign",
  },
  {
    id: "review-and-sign",
    number: 8,
    navLabel: "Sign",
    location: "Assessment → Review → Sign assessment",
    title: "Review, then sign",
    summary: "Resolve missing required answers before signing the assessment.",
    screenshots: [{
      src: "/training/presentation/assessment-review.png",
      alt: "Synthetic Pipeline Review section showing completion counts, narrative fields, overall progress, and the Sign assessment action.",
      label: "Final review",
      caption: "Review is selected in the left rail; saved status and Sign assessment remain visible in the top bar.",
    }],
    nextLabel: "Submit for review",
  },
  {
    id: "submittal-acceptance",
    number: 9,
    navLabel: "Decision",
    location: "Workspace → Workflow",
    title: "Submit for a decision",
    summary: "The assessor submits; a supervisor reviews and records the decision.",
    screenshots: [
      { src: "/training/presentation/assessment-submittal.png", alt: "Pipeline Workflow showing the assessor recommendation and Submit for supervisor review control.", label: "Assessor submittal", caption: "Open Workflow beside the workspace tabs. Record the recommendation and rationale, then select Submit for supervisor review." },
      { src: "/training/presentation/supervisor-decision.png", alt: "Pipeline Workflow showing a submitted assessment and the supervisor admission decision controls.", label: "Supervisor decision", caption: "The authorized supervisor reviews the submittal and records a decision. This view has permissions that an assessor account may not have." },
    ],
    nextLabel: "Open your referrals",
  },
] as const;

export function PipelineWorkshopPresentation({ initialPresentationSlide }: { initialPresentationSlide?: string }) {
  return (
    <PresentationDeck
      initialSlideId={initialPresentationSlide}
      finishLabel="Open your referrals"
      finishBusy={false}
      finishError=""
      onExit={() => window.location.assign(toPipelinePath("/training"))}
      onFinish={() => window.location.assign(toPipelinePath("/"))}
      onSlideChange={() => undefined}
    />
  );
}

export default function PipelineDemoCenter({
  actor,
  environment,
  initialPresentationSlide,
  initialView,
  journey = false,
}: {
  actor: DemoActor;
  environment: PipelineDemoEnvironment;
  initialPresentationSlide?: string;
  initialView?: DemoView;
  journey?: boolean;
}) {
  const scrollContainerRef = useRef<HTMLElement>(null);
  const journeyPreparationRef = useRef<Promise<unknown> | null>(null);
  const canUseProcessTester = actor.roles.includes("admin");
  const [view, setView] = useState<DemoView>(() => initialView === "tester" && canUseProcessTester ? "tester" : "presentation");
  const [referrals, setReferrals] = useState<DemoReferralSummary[]>([]);
  const [loadingCases, setLoadingCases] = useState(true);
  const [launchingId, setLaunchingId] = useState<PipelineDemoScenarioId | null>(null);
  const [error, setError] = useState("");
  const [enteringDemo, setEnteringDemo] = useState(false);
  const casesLoadedRef = useRef(false);
  const canWrite = environment.writable && actor.roles.some((role) => ["admin", "assessment_coordinator", "reviewer"].includes(role));
  const canReset = Boolean(actor.demoPersona) && environment.writable;
  const resetDemo = canReset ? () => window.location.assign(toPipelinePath("/training/demo?journey=1")) : undefined;

  const selectView = (nextView: DemoView) => {
    setView(nextView);
    window.requestAnimationFrame(() => scrollContainerRef.current?.scrollTo({ top: 0, behavior: "auto" }));
  };

  useEffect(() => {
    if (view !== "lab" || casesLoadedRef.current) return;
    casesLoadedRef.current = true;
    setLoadingCases(true);
    void (async () => {
      await journeyPreparationRef.current;
      return loadDemoReferrals();
    })().then((items) => {
      startTransition(() => {
        setReferrals(items);
        setLoadingCases(false);
      });
    }).catch(() => {
      setLoadingCases(false);
      setError("Existing demo cases could not be loaded. You can still create a fresh synthetic case.");
    });
  }, [view]);

  useEffect(() => {
    if (!canReset || journeyPreparationRef.current) return;
    const preparation = fetchPipelineJson("/api/demo/journey?reset=1", { method: "POST" });
    journeyPreparationRef.current = preparation;
    void preparation.catch(() => undefined);
  }, [canReset]);

  const launchScenario = async (
    scenario: PipelineDemoScenario,
    workspaceStage: DemoWorkspaceStage = "assessment",
  ) => {
    setError("");
    if (navigateWithoutDemoRecord(scenario)) return;
    if (!canWrite) {
      setError(environment.writable ? "Your demo account needs assessor, coordinator, or admin access to create practice records." : environment.reason);
      return;
    }

    setLaunchingId(scenario.id);
    try {
      await journeyPreparationRef.current;
      const memberResult = await fetchPipelineJson<{ members: DemoAssessor[] }>("/api/members?scope=assessors");
      const assessor = memberResult.members.find((member) => member.principal_id === actor.id) ?? memberResult.members[0];
      if (!assessor) throw new Error("No active assessor is available for this practice case.");
      const referralResult = await createDemoScenarioReferral(scenario, assessor, referrals);
      const assessmentResult = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
        `/api/referrals/${referralResult.referral.id}/assessments`,
        {
          method: "POST",
          body: JSON.stringify({
            data: scenario.assessmentData ?? {},
            client_mutation_id: demoMutationId(`assessment-${scenario.id}`),
          }),
        },
      );
      let assessment = assessmentResult.assessment;
      if (scenario.assessmentState === "in_progress") {
        const scheduled = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
          `/api/assessments/${encodeURIComponent(assessment.assessment_id)}/schedule`,
          {
            method: "POST",
            body: JSON.stringify({
              if_match: assessment.version,
              client_mutation_id: demoMutationId(`schedule-${scenario.id}`),
              schedule: {
                start_at: nextDemoStartTime(referralResult.referral.id),
                duration_minutes: 60,
                method: "zoom",
                location: "Synthetic Zoom room - no live meeting link",
                status: "scheduled",
              },
            }),
          },
        );
        assessment = scheduled.assessment;
        const started = await fetchPipelineJson<{ assessment: PipelineAssessmentRecord }>(
          `/api/assessments/${encodeURIComponent(assessment.assessment_id)}/start`,
          {
            method: "POST",
            body: JSON.stringify({
              if_match: assessment.version,
              client_mutation_id: demoMutationId(`start-${scenario.id}`),
            }),
          },
        );
        assessment = started.assessment;
      }
      void assessment;
      window.location.assign(demoReferralRoute(referralResult.referral.id, workspaceStage));
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : "The synthetic demo case could not be created.");
      setLaunchingId(null);
    }
  };

  const openExisting = (referral: DemoReferralSummary) => {
    const scenario = pipelineDemoScenarios.find((item) => referral.tags?.includes(item.id));
    const workspaceStage = scenario?.launch === "new_referral" ? "intake" : "assessment";
    window.location.assign(demoReferralRoute(referral.id, workspaceStage));
  };

  const enterDemoHome = async () => {
    if (enteringDemo) return;
    setError("");
    setEnteringDemo(true);
    try {
      try {
        await (journeyPreparationRef.current ?? fetchPipelineJson("/api/demo/journey?reset=1", { method: "POST" }));
      } catch {
        journeyPreparationRef.current = fetchPipelineJson("/api/demo/journey?reset=1", { method: "POST" });
        await journeyPreparationRef.current;
      }
      if (actor.demoPersona === "supervisor") {
        await fetchPipelineJson("/api/demo/persona", { method: "POST", body: JSON.stringify({ persona: "assessor" }) });
        clearPipelineClientSessionCache();
      }
      window.location.replace(toPipelinePath("/"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Practice Home could not be prepared.");
      setEnteringDemo(false);
    }
  };

  const openProcessTesterStage = (stage: ProcessTesterStage) => {
    if (stage === "decision") {
      selectView("handoff");
      return;
    }
    if (stage === "intake") {
      window.location.assign(toPipelinePath(`/?view=referrals&screen=packet&draftId=${crypto.randomUUID()}&trainingIntake=1&demo=1`));
      return;
    }
    const section = stage === "review" ? "provenance_qc" : "identity";
    const mode = stage === "schedule" ? "schedule" : stage === "assessment" ? "guided" : "interview";
    const assessmentSection = mode !== "schedule" ? `&assessmentSection=${section}` : "";
    window.location.assign(toPipelinePath(`/?view=referrals&screen=packet&draftId=${crypto.randomUUID()}&workspaceStage=assessment&trainingAssessment=${mode}${assessmentSection}&demo=1`));
  };

  return (
    <main ref={scrollContainerRef} data-demo-center="true" className="h-full min-h-0 overflow-hidden bg-white text-[#171a18]">
      <div className="flex h-full min-h-0 w-full flex-col">
        <header className="relative z-10 shrink-0 border-b border-[#d8dfdc] bg-[#edf2f0]">
          <div className="flex min-w-0 items-end gap-1 overflow-x-auto px-2 pt-1.5 sm:px-3" role="tablist" aria-label="Demo Center sections">
            <DemoTab active={view === "presentation"} label="Presentation" onClick={() => selectView("presentation")} />
            <DemoTab active={view === "lab"} label="Practice cases" onClick={() => selectView("lab")} />
            <DemoTab active={view === "handoff"} label="Submittal & acceptance" onClick={() => selectView("handoff")} />
            {canUseProcessTester ? <DemoTab active={view === "tester"} label="Process tester" onClick={() => selectView("tester")} /> : null}
            <ResetDemoButton onReset={resetDemo} compact view={view} />
          </div>
        </header>

        {error ? <div role="alert" className="shrink-0 border-l-4 border-[#b95649] bg-[#fff2ef] px-4 py-3 text-[11px] font-bold text-[#8c3d33]">{error}</div> : null}
        {!environment.writable && view === "lab" ? <div className="shrink-0 border-b border-[#dfca97] bg-[#fff9e9] px-4 py-3 text-[11px] leading-5 text-[#765817]"><strong>Practice records are read only.</strong> {environment.reason}</div> : null}

        <div className={`min-h-0 flex-1 ${view === "presentation" ? "overflow-hidden" : "overflow-y-auto"}`}>
          {view === "presentation" ? (
            <PresentationDeck
              initialSlideId={initialPresentationSlide}
              finishLabel={canWrite ? "Enter demo" : "Finish"}
              finishBusy={enteringDemo}
              finishError={journey ? error : ""}
              onExit={() => journey ? window.location.assign(toPipelinePath("/training")) : selectView("lab")}
              onFinish={() => {
                if (journey) {
                  void enterDemoHome();
                  return;
                }
                if (!canWrite) {
                  window.location.assign(toPipelinePath("/training"));
                  return;
                }
                const scenario = getPipelineDemoScenario("new-intake");
                if (scenario) void launchScenario(scenario, "intake");
              }}
              onSlideChange={() => scrollContainerRef.current?.scrollTo({ top: 0 })}
              onReset={resetDemo}
            />
          ) : view === "lab" ? (
            <ScenarioLab
              referrals={referrals}
              loading={loadingCases}
              launchingId={launchingId}
              canWrite={canWrite}
              onLaunch={(scenario) => void launchScenario(scenario)}
              onOpen={openExisting}
            />
          ) : view === "tester" ? (
            <PipelineProcessTester onOpenStage={openProcessTesterStage} />
          ) : (
            <SubmissionAcceptanceDemo preparedBy={actor.name} />
          )}
        </div>
      </div>
    </main>
  );
}

function createDemoReferral(command: Record<string, unknown>) {
  return fetchPipelineJson<{ referral: Referral }>("/api/referrals", {
    method: "POST",
    body: JSON.stringify(command),
  });
}

async function createDemoScenarioReferral(
  scenario: PipelineDemoScenario,
  assessor: DemoAssessor,
  referrals: DemoReferralSummary[],
) {
  const knownDuplicateReferralIds = referrals
    .filter((referral) => referral.tags?.includes(scenario.id))
    .map((referral) => referral.id)
    .slice(0, 20);
  const referralCommand = {
    referral: buildPipelineDemoReferral(scenario, assessor.display_name),
    assignee_id: assessor.principal_id,
    client_mutation_id: demoMutationId(`referral-${scenario.id}`),
    ...(knownDuplicateReferralIds.length > 0
      ? { duplicate_confirmation: { referral_ids: knownDuplicateReferralIds } }
      : {}),
  };
  try {
    return await createDemoReferral(referralCommand);
  } catch (error) {
    const confirmationIds = duplicateConfirmationIds(error);
    if (!confirmationIds) throw error;
    return createDemoReferral({
      ...referralCommand,
      duplicate_confirmation: { referral_ids: confirmationIds },
    });
  }
}

function duplicateConfirmationIds(error: unknown) {
  if (!(error instanceof PipelineApiError) || error.status !== 409) return null;
  const payload = error.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const duplicate = payload as { suspected_duplicate?: unknown; can_confirm_distinct_person?: unknown; confirmation_referral_ids?: unknown };
  if (duplicate.suspected_duplicate !== true || duplicate.can_confirm_distinct_person !== true) return null;
  if (!Array.isArray(duplicate.confirmation_referral_ids) || duplicate.confirmation_referral_ids.some((id) => !Number.isSafeInteger(id) || Number(id) <= 0)) return null;
  return duplicate.confirmation_referral_ids as number[];
}

function PresentationDeck({
  initialSlideId,
  finishLabel,
  finishBusy,
  finishError,
  onExit,
  onFinish,
  onSlideChange,
  onReset,
}: {
  initialSlideId?: string;
  finishLabel: string;
  finishBusy: boolean;
  finishError: string;
  onExit: () => void;
  onFinish: () => void;
  onSlideChange: () => void;
  onReset?: () => void;
}) {
  const [slideIndex, setSlideIndex] = useState(() => initialPresentationSlideIndex(initialSlideId));
  const slide = presentationSlides[slideIndex] ?? presentationSlides[0];

  const selectSlide = useCallback((index: number) => {
    setSlideIndex(Math.max(0, Math.min(presentationSlides.length - 1, index)));
    onSlideChange();
  }, [onSlideChange]);

  usePresentationKeyboard(slideIndex, selectSlide);

  return (
    <section data-demo-surface="presentation" className="fixed inset-0 z-[150] flex h-dvh min-h-0 min-w-0 flex-col overflow-hidden bg-white">
      <PresentationHeader slideIndex={slideIndex} onSelect={selectSlide} onClose={onExit} onReset={onReset} />
      <PresentationSlideBody slide={slide} />
      <p className="sr-only" aria-live="polite">Slide {slide.number} of {presentationSlides.length}: {slide.title}</p>
      {finishError ? <p role="alert" className="shrink-0 border-l-2 border-[#ad493c] bg-[#fff3f0] px-5 py-2 text-[12px] font-semibold text-[#8a362c]">{finishError}</p> : null}
      <PresentationFooter slide={slide} slideIndex={slideIndex} onSelect={selectSlide} onFinish={onFinish} finishLabel={finishLabel} finishBusy={finishBusy} />
    </section>
  );
}

function initialPresentationSlideIndex(initialSlideId?: string) {
  const requestedIndex = presentationSlides.findIndex((slide) => slide.id === initialSlideId);
  return requestedIndex >= 0 ? requestedIndex : 0;
}

function usePresentationKeyboard(slideIndex: number, selectSlide: (index: number) => void) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const nextIndex = presentationSlideIndexForKey(event, slideIndex);
      if (nextIndex === null) return;
      event.preventDefault();
      selectSlide(nextIndex);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectSlide, slideIndex]);
}

function presentationSlideIndexForKey(event: KeyboardEvent, slideIndex: number) {
  const target = event.target as HTMLElement | null;
  if (target?.closest("dialog[open]")) return null;
  if (target?.matches("input, textarea, select, [contenteditable='true']")) return null;
  if (event.key === "ArrowRight") return slideIndex + 1;
  if (event.key === "ArrowLeft") return slideIndex - 1;
  if (event.key === "Home") return 0;
  if (event.key === "End") return presentationSlides.length - 1;
  return null;
}

function PresentationHeader({ slideIndex, onSelect, onClose, onReset }: { slideIndex: number; onSelect: (index: number) => void; onClose: () => void; onReset?: () => void }) {
  return (
    <header className="flex min-h-16 shrink-0 items-center gap-4 border-b border-[#d8dfdc] bg-white px-4 py-2 sm:px-6 lg:px-8">
      <div className="hidden min-w-0 flex-1 sm:block">
        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#0f7c68]">AHS · Pipeline</div>
        <div className="mt-0.5 truncate text-[13px] font-black text-[#24302b]">Assessor&apos;s Workshop</div>
      </div>
      <nav aria-label="Presentation slides" className="ml-auto flex min-w-0 items-center gap-2">
        <label htmlFor="presentation-slide" className="sr-only">Jump to slide</label>
        <select id="presentation-slide" value={slideIndex} onChange={(event) => onSelect(Number(event.target.value))} className="h-10 w-[200px] max-w-[calc(100vw-100px)] min-w-0 border border-[#cbd5d1] bg-white px-3 text-[12px] font-bold text-[#34403b] outline-none focus:border-[#0f8b73] sm:w-[230px]">
          {presentationSlides.map((item, index) => <option key={item.id} value={index}>{item.number}. {item.navLabel}</option>)}
        </select>
        <ResetDemoButton onReset={onReset} />
        <button type="button" aria-label="Close presentation" title="Close presentation" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#cbd5d1] text-[#59645f] hover:border-[#0f8b73] hover:text-[#0f705f] focus-visible:ring-2 focus-visible:ring-[#0f8b73]">
          <X size={18} aria-hidden="true" />
        </button>
      </nav>
    </header>
  );
}

function ResetDemoButton({ onReset, compact = false, view }: { onReset?: () => void; compact?: boolean; view?: DemoView }) {
  if (!onReset || view === "presentation") return null;
  return (
    <button
      type="button"
      className={`${compact ? "ml-auto mb-1 size-8" : "size-10"} flex shrink-0 items-center justify-center border border-[#c8d6d0] bg-white text-[#176b59] hover:bg-[#f1faf6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176b59]`}
      aria-label="Reset demo"
      title="Reset demo to the original practice cases"
      onClick={onReset}
    >
      <RefreshCcw size={16} aria-hidden="true" />
    </button>
  );
}

function PresentationSlideBody({ slide }: { slide: PresentationSlide }) {
  return (
    <article key={slide.id} aria-label={`Presentation slide ${slide.number}`} className="relative min-h-0 flex-1 overflow-hidden bg-[#edf1ee]">
      <PresentationVisual slide={slide} />
      <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-10 sm:right-auto sm:bottom-6 sm:left-6 sm:max-w-[600px] lg:left-8">
        <div className="bg-white/95 px-4 py-3 text-[#17221e] sm:px-5 sm:py-4">
          <div className="text-[10px] font-bold uppercase text-[#0c705f]">{slide.location}</div>
          <h2 className="mt-1 text-[24px] font-semibold leading-tight sm:text-[28px]">{slide.title}</h2>
          <p className="mt-1 text-[13px] font-medium leading-5 text-[#52605a] sm:text-[14px]">{slide.summary}</p>
        </div>
      </div>
    </article>
  );
}

function PresentationFooter({ slide, slideIndex, onSelect, onFinish, finishLabel, finishBusy }: { slide: PresentationSlide; slideIndex: number; onSelect: (index: number) => void; onFinish: () => void; finishLabel: string; finishBusy: boolean }) {
  const isLast = slideIndex === presentationSlides.length - 1;
  return <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[#d8dfdc] bg-white px-4 py-3 sm:px-8 lg:px-10"><button type="button" disabled={slideIndex === 0} onClick={() => onSelect(slideIndex - 1)} className="inline-flex h-10 items-center gap-2 px-2 text-[11px] font-bold text-[#5d6863] outline-none hover:text-[#17221e] focus-visible:ring-2 focus-visible:ring-[#0f8b73] disabled:invisible"><ArrowLeft size={14} aria-hidden="true" />Previous</button><div className="hidden items-center gap-1.5 sm:flex" aria-hidden="true">{presentationSlides.map((item, index) => <span key={item.id} className={`h-1.5 transition-[width,background-color] ${index === slideIndex ? "w-8 bg-[#0f8b73]" : "w-1.5 bg-[#cbd4d0]"}`} />)}</div>{isLast ? <button type="button" disabled={finishBusy} onClick={onFinish} className="inline-flex h-10 items-center gap-2 bg-[#0f8b73] px-5 text-[11px] font-black text-white outline-none hover:bg-[#0b6d5b] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 disabled:opacity-60">{finishBusy ? "Opening..." : finishLabel}<ArrowRight size={14} aria-hidden="true" /></button> : <button type="button" aria-label={`Next slide: ${slide.nextLabel}`} onClick={() => onSelect(slideIndex + 1)} className="inline-flex h-10 items-center gap-2 bg-[#111111] px-5 text-[11px] font-black text-white outline-none hover:bg-[#26302c] focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2">Next<ArrowRight size={14} aria-hidden="true" /></button>}</footer>;
}

function PresentationVisual({ slide }: { slide: PresentationSlide }) {
  return <PresentationScreenshots screenshots={slide.screenshots} />;
}

function PresentationScreenshots({ screenshots }: { screenshots: readonly PresentationScreenshot[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selected = screenshots[selectedIndex] ?? screenshots[0];

  useEffect(() => {
    if (expanded) dialogRef.current?.showModal();
  }, [expanded]);

  return (
    <figure className="flex h-full min-h-0 min-w-0 flex-col bg-white">
      <div className="flex h-10 shrink-0 items-stretch justify-between border-b border-[#d5ddda] bg-[#f2f6f4]">
        <div role={screenshots.length > 1 ? "tablist" : undefined} aria-label={screenshots.length > 1 ? "Slide screenshots" : undefined} className="flex min-w-0 overflow-x-auto">
          {screenshots.map((screenshot, index) => screenshots.length > 1 ? (
            <button key={screenshot.src} type="button" role="tab" aria-selected={index === selectedIndex} onClick={() => setSelectedIndex(index)} className={`shrink-0 border-b-2 px-4 text-[11px] font-black ${index === selectedIndex ? "border-[#0f8b73] bg-white text-[#183a31]" : "border-transparent text-[#65706b] hover:text-[#25322d]"}`}>{screenshot.label}</button>
          ) : <span key={screenshot.src} className="flex items-center px-4 text-[10px] font-black uppercase tracking-[0.09em] text-[#0c705f]">{screenshot.label}</span>)}
        </div>
        <button type="button" aria-label="View full-size screenshot" title="View full-size screenshot" onClick={() => setExpanded(true)} className="flex size-10 shrink-0 items-center justify-center text-[#5e6a65] hover:bg-white hover:text-[#0c705f] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0f8b73]"><Maximize2 size={16} aria-hidden="true" /></button>
      </div>
      <button type="button" aria-label={`Enlarge ${selected.label} screenshot`} onClick={() => setExpanded(true)} className="relative block min-h-0 w-full flex-1 cursor-zoom-in overflow-hidden bg-[#e8edeb] outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#0f8b73]">
        <Image key={selected.src} src={toPipelinePath(selected.src)} alt={selected.alt} fill unoptimized loading="eager" sizes="100vw" className="object-contain" />
      </button>
      <figcaption className="sr-only">{selected.caption}</figcaption>
      {expanded ? <dialog ref={dialogRef} onClose={() => setExpanded(false)} className="fixed inset-0 m-0 flex h-dvh max-h-none w-screen max-w-none flex-col border-0 bg-[#0d1713] p-0 text-white" aria-label={`${selected.label} full-size screen`}>
        <header className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-white/20 px-5 sm:px-8"><div className="text-[14px] font-semibold">{selected.label}</div><button type="button" aria-label="Close full-size screenshot" title="Close full-size screenshot" onClick={() => dialogRef.current?.close()} className="flex size-10 items-center justify-center border border-white/30 hover:border-[#8be0c5] hover:text-[#8be0c5] focus-visible:ring-2 focus-visible:ring-[#8be0c5]"><X size={18} aria-hidden="true" /></button></header>
        <div className="relative min-h-0 flex-1"><Image src={toPipelinePath(selected.src)} alt={selected.alt} fill unoptimized sizes="100vw" className="object-contain" /></div>
        <p className="sr-only">{selected.caption}</p>
      </dialog> : null}
    </figure>
  );
}


function ScenarioLab({ referrals, loading, launchingId, canWrite, onLaunch, onOpen }: { referrals: DemoReferralSummary[]; loading: boolean; launchingId: PipelineDemoScenarioId | null; canWrite: boolean; onLaunch: (scenario: PipelineDemoScenario) => void; onOpen: (referral: DemoReferralSummary) => void }) {
  return (
    <section data-demo-surface="practice" className="min-h-full bg-white">
      <div className="flex flex-col justify-between gap-4 border-b border-[#d8dfdc] bg-[#f7faf8] px-5 py-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center bg-[#e4f2ed] text-[#0c705f]"><ListChecks size={18} aria-hidden="true" /></span>
          <div>
            <h2 className="text-[15px] font-black text-[#202623]">Focused assessment</h2>
            <p className="mt-1 text-[11px] font-semibold text-[#68736f]">One question at a time with the current Pipeline assessment content.</p>
          </div>
        </div>
        <button type="button" onClick={() => window.location.assign(toPipelinePath("/training/assessment-preview"))} className="flex h-11 items-center justify-between gap-5 bg-[#111111] px-4 text-[10px] font-black text-white hover:bg-[#0f8b73]">
          Open mockup
          <ArrowRight size={13} aria-hidden="true" />
        </button>
      </div>
      <div className="grid gap-px bg-[#d8dfdc] md:grid-cols-2 xl:grid-cols-4">
        {pipelineDemoScenarios.map((scenario) => {
          const existing = latestScenarioReferral(referrals, scenario.id);
          const creating = launchingId === scenario.id;
          return <article key={scenario.id} className="flex min-h-[250px] flex-col bg-white p-5"><div className="flex items-start justify-between gap-3"><span className="flex h-9 w-9 items-center justify-center border border-[#b8d2c9] bg-[#eef7f4] text-[#0c705f]"><ClipboardCheck size={16} /></span><span className="text-[8px] font-black uppercase tracking-[0.09em] text-[#7c8782]">{scenario.duration}</span></div><div className="mt-4 text-[8px] font-black uppercase tracking-[0.1em] text-[#0c705f]">{scenario.phase}</div><h3 className="mt-1 text-[15px] font-black leading-5 text-[#232a27]">{scenario.title}</h3><p className="mt-2 text-[10px] leading-5 text-[#65706c]">{scenario.summary}</p><div className="mt-auto grid gap-2 pt-5">{existing ? <button type="button" onClick={() => onOpen(existing)} className="flex h-10 items-center justify-between border border-[#9fbbb2] bg-[#f5faf8] px-3 text-[9px] font-black text-[#315e50]">Open latest <ExternalLink size={12} /></button> : null}<button type="button" disabled={(scenario.launch === "assessment" && !canWrite) || creating || loading} onClick={() => onLaunch(scenario)} className="flex h-10 items-center justify-between bg-[#111111] px-3 text-[9px] font-black text-white hover:bg-[#0f8b73] disabled:bg-[#aeb7b4]"><span className="flex items-center gap-2"><RefreshCcw size={12} />{creating ? "Preparing..." : existing ? "New attempt" : "Start"}</span><ArrowRight size={12} /></button></div></article>;
        })}
      </div>
    </section>
  );
}

function DemoTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`relative -mb-px flex h-11 min-w-0 flex-1 items-center justify-center border border-b-0 px-2 text-[11px] font-black sm:min-w-[160px] sm:flex-none sm:px-4 ${active ? "z-10 border-[#cbd5d1] bg-white text-[#202623]" : "border-transparent text-[#68736f] hover:bg-[#e7ecea]"}`}>{label}</button>;
}

async function loadDemoReferrals() {
  const payload = await fetchPipelineJson<{ referrals: DemoReferralSummary[] }>(`/api/referrals?limit=100&tag=${encodeURIComponent(pipelineDemoTag)}&projection=summary`, { cache: "no-store" });
  return payload.referrals;
}

function latestScenarioReferral(referrals: DemoReferralSummary[], scenarioId: PipelineDemoScenarioId) {
  return referrals
    .filter((referral) => referral.tags?.includes(scenarioId))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

function demoReferralRoute(referralId: number, workspaceStage: DemoWorkspaceStage = "assessment") {
  return toPipelinePath(`/?view=referrals&screen=packet&referralId=${referralId}&workspaceStage=${workspaceStage}&demo=1`);
}

function navigateWithoutDemoRecord(scenario: PipelineDemoScenario) {
  if (scenario.launch === "new_referral") {
    window.location.assign(toPipelinePath(`/?view=referrals&screen=packet&draftId=${crypto.randomUUID()}&trainingIntake=1&demoScenario=${scenario.id}&demo=1`));
    return true;
  }
  return false;
}

function demoMutationId(prefix: string) {
  return `demo-${prefix}-${crypto.randomUUID()}`;
}

function nextDemoStartTime(referralId: number) {
  const date = new Date();
  const slot = Math.abs(referralId) % 720;
  date.setMinutes(date.getMinutes() + 15 + slot * 120, 0, 0);
  return date.toISOString();
}
