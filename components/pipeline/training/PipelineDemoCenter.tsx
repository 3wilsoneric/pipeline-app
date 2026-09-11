"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  FileText,
  ListChecks,
  LockKeyhole,
  Play,
  RefreshCcw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import type { PipelineDemoEnvironment } from "@/lib/demo/demo-environment";
import {
  buildPipelineDemoReferral,
  getPipelineDemoScenario,
  pipelineDemoScenarios,
  pipelineDemoTag,
  type PipelineDemoScenario,
  type PipelineDemoScenarioId,
} from "@/lib/demo/demo-scenarios";
import { activatePipelineDemoSession } from "@/lib/demo/demo-session";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import { getOperatorGuidedTutorial } from "@/lib/training/operator-guided-tutorials";
import { stageOperatorGuideForNavigation } from "@/lib/training/operator-guided-tour-state";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";

const SubmissionAcceptanceDemo = dynamic(() => import("@/components/pipeline/training/SubmissionAcceptanceDemo"), {
  loading: () => <div className="flex min-h-[260px] items-center justify-center text-[11px] font-bold text-[#68736f]">Loading workflow rehearsal...</div>,
});

type DemoActor = {
  id: string;
  name: string;
  email: string;
  roles: readonly string[];
};

type DemoReferralSummary = Pick<Referral, "id" | "name" | "community" | "tags" | "createdAt">;
type DemoAssessor = { principal_id: string; display_name: string };
type DemoView = "presentation" | "lab" | "handoff";
type DemoWorkspaceStage = "intake" | "assessment";
type DemoGuide = { tutorialId: string; stepId: string };

type PresentationSlide = {
  id: string;
  number: number;
  navLabel: string;
  location: string;
  title: string;
  summary: string;
  points: readonly string[];
  graphic?: "case-spine" | "ownership" | "workday" | "source-stack" | "assessment-map" | "note-comparison" | "decision-path";
  screenshots?: readonly PresentationScreenshot[];
  sections?: readonly string[];
  rule?: string;
  guide?: {
    label: string;
    scenarioId: PipelineDemoScenarioId;
    tutorialId: string;
    stepId: string;
    workspaceStage?: DemoWorkspaceStage;
  };
  nextLabel: string;
  dark?: boolean;
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
    location: "The whole referral",
    title: "One referral stays connected from packet to decision",
    summary: "Pipeline keeps the documents, intake, appointment, assessment, recommendation, submittal, and supervisor decision in one traceable referral record.",
    points: [
      "The workspace is the referral record.",
      "The client profile carries the person's history across referrals.",
      "The live walkthrough will point to each control on the real screen.",
    ],
    graphic: "case-spine",
    nextLabel: "See the main screens",
    dark: true,
  },
  {
    id: "find-work",
    number: 2,
    navLabel: "Screens",
    location: "Home · Workspaces · Calendar · Clients",
    title: "Where everything lives",
    summary: "Each main screen answers a different question. Home shows assigned work, Workspaces opens the referral record, Calendar holds appointments, and Clients holds the durable person profile.",
    points: [
      "Home: assigned referrals, drafts, and upcoming work.",
      "Workspaces: packet, intake, assessment, files, Chart, and activity.",
      "Calendar and Clients: appointment view and person-level history.",
    ],
    graphic: "workday",
    nextLabel: "Open the workspace",
  },
  {
    id: "open-workspace",
    number: 3,
    navLabel: "Workspace",
    location: "Workspaces → referral → Intake",
    title: "The workspace opens in Intake",
    summary: "The stage bar runs across the top. Files and Activity sit beside it. The source packet and document checklist are the first things on the Intake screen.",
    points: [
      "The highlighted area is where the initial referral packet is attached.",
      "Intake, Assessment, and Chart stay attached to this referral.",
      "The tooltip guide remains on screen and points to the next control.",
    ],
    screenshots: [{
      src: "/training/presentation/intake-workspace.png",
      alt: "Synthetic Pipeline Intake screen with the referral packet area highlighted and the Create a referral tooltip walkthrough open.",
      label: "Intake and packet",
      caption: "The stage bar is above the record; Files and Activity are at its right; the packet area is highlighted inside Intake.",
    }],
    guide: { label: "Try the intake walkthrough", scenarioId: "new-intake", tutorialId: "create-referral", stepId: "referral-packet", workspaceStage: "intake" },
    nextLabel: "Review the intake",
  },
  {
    id: "review-intake",
    number: 4,
    navLabel: "Intake",
    location: "Workspace → Intake",
    title: "Review the packet before the interview",
    summary: "Intake is where packet facts are checked, corrected, and attributed before they carry into the assessment.",
    points: [
      "Confirm identity, referral source, county, community, contacts, and medication context against the source.",
      "Keep conflicting sources visible and leave unsupported facts unrecorded.",
      "Add later documents to this workspace rather than opening another referral.",
    ],
    screenshots: [{
      src: "/training/presentation/intake-review.png",
      alt: "Synthetic Pipeline Intake screen showing the attached referral packet and document checklist.",
      label: "Reviewed intake",
      caption: "The attached source packet sits above its document checklist; the Intake save action stays in the stage bar.",
    }],
    nextLabel: "Schedule the assessment",
  },
  {
    id: "schedule-assessment",
    number: 5,
    navLabel: "Schedule",
    location: "Workspace → Assessment → Schedule",
    title: "Schedule from the referral, then see it on Calendar",
    summary: "The appointment is part of the referral record. Date, time, duration, method, and location or meeting link are saved together and reflected on Calendar.",
    points: [
      "Schedule is at the upper-right of the Assessment screen.",
      "The walkthrough highlights each appointment field and the save action.",
      "Rescheduling changes the appointment, not the referral outcome.",
    ],
    screenshots: [
      {
        src: "/training/presentation/assessment-schedule.png",
        alt: "Synthetic Pipeline assessment with the Schedule dialog open and the scheduling tooltip walkthrough beside it.",
        label: "Schedule dialog",
        caption: "The appointment dialog opens over Assessment; the guide moves through date, method, location, and save.",
      },
      {
        src: "/training/presentation/assessor-calendar.png",
        alt: "Synthetic Pipeline Calendar showing an assessor schedule and a ready-to-schedule queue.",
        label: "Calendar",
        caption: "Calendar shows the saved appointment and the ready-to-schedule queue for the selected assessor.",
      },
    ],
    guide: { label: "Try the scheduling walkthrough", scenarioId: "assessment-preparation", tutorialId: "start-assessment", stepId: "assessment-schedule-fields", workspaceStage: "assessment" },
    nextLabel: "Open the assessment",
  },
  {
    id: "open-assessment",
    number: 6,
    navLabel: "Assessment",
    location: "Workspace → Assessment → Open assessment",
    title: "The assessment is organized into 12 sections",
    summary: "The section rail is on the left, the current questions are in the middle, and progress plus key answers stay visible on the right.",
    points: [
      "Select a section in the left rail or move forward one section at a time.",
      "Inherited intake context appears with the interview fields it supports.",
      "The guide spotlights the current control without entering or signing anything for you.",
    ],
    sections: ["Client & referral", "Placement", "History", "Clinical", "Function", "Medication", "Substance use", "Behavior & safety", "Physical health", "Legal", "Support & goals", "Review"],
    screenshots: [{
      src: "/training/presentation/assessment-guided.png",
      alt: "Synthetic Pipeline assessment showing its 12-section rail, interview fields, progress panel, and live tooltip walkthrough.",
      label: "Assessment with guide",
      caption: "Left: section navigation. Center: current interview fields. Right: progress. The tooltip identifies the exact next action.",
    }],
    guide: { label: "Start the assessment walkthrough", scenarioId: "assessment-interview", tutorialId: "complete-assessment", stepId: "assessment-section-identity", workspaceStage: "assessment" },
    nextLabel: "Document the interview",
  },
  {
    id: "document-interview",
    number: 7,
    navLabel: "Document",
    location: "Assessment → section field → Language Lab",
    title: "Document the source, timeframe, and finding",
    summary: "Narrative fields belong in the section where the information was established. Language Lab gives field-specific structure and examples without inventing the answer.",
    points: [
      "Keep client report, collateral information, records, and direct observation distinguishable.",
      "Conditional follow-ups appear only when a preceding answer makes them relevant.",
      "Autosave protects the draft so an unfinished assessment can be resumed.",
    ],
    graphic: "note-comparison",
    nextLabel: "Review and sign",
    guide: { label: "Try Language Lab in the assessment", scenarioId: "assessment-interview", tutorialId: "complete-assessment", stepId: "assessment-answer", workspaceStage: "assessment" },
  },
  {
    id: "review-and-sign",
    number: 8,
    navLabel: "Sign",
    location: "Assessment → Review → Sign assessment",
    title: "Review the saved draft before signing",
    summary: "Review names missing required answers and unresolved information. Signing locks the completed assessment; later information is recorded as an addendum.",
    points: [
      "The Review section is the last item in the left rail.",
      "Saved status and the Sign assessment action are in the top bar.",
      "The clinical recommendation remains separate from the administrator's admission decision.",
    ],
    screenshots: [{
      src: "/training/presentation/assessment-review.png",
      alt: "Synthetic Pipeline Review section showing completion counts, narrative fields, overall progress, and the Sign assessment action.",
      label: "Final review",
      caption: "Review is selected in the left rail; saved status and Sign assessment remain visible in the top bar.",
    }],
    rule: "Assessment: completed and signed by the assessor. Admission decision: recorded by an authorized administrator.",
    nextLabel: "Submit for review",
  },
  {
    id: "submittal-acceptance",
    number: 9,
    navLabel: "Decision",
    location: "Workspace → Workflow",
    title: "Submit the recommendation, then the supervisor decides",
    summary: "The assessor submits the locked assessment revision and clinical recommendation. The supervisor reviews that exact submittal, resolves decision requirements, and records acceptance or decline.",
    points: [
      "Submit for supervisor review freezes the signed assessment revision under review.",
      "The supervisor can accept, decline, or request changes without editing the assessor's work.",
      "Acceptance is an explicit recorded decision; it is not created by changing a stage label.",
    ],
    graphic: "decision-path",
    nextLabel: "Begin walkthrough",
  },
] as const;

export default function PipelineDemoCenter({
  actor,
  environment,
  initialPresentationSlide,
}: {
  actor: DemoActor;
  environment: PipelineDemoEnvironment;
  initialPresentationSlide?: string;
}) {
  const scrollContainerRef = useRef<HTMLElement>(null);
  const [view, setView] = useState<DemoView>("presentation");
  const [referrals, setReferrals] = useState<DemoReferralSummary[]>([]);
  const [loadingCases, setLoadingCases] = useState(true);
  const [launchingId, setLaunchingId] = useState<PipelineDemoScenarioId | null>(null);
  const [error, setError] = useState("");
  const casesLoadedRef = useRef(false);
  const canWrite = environment.writable && actor.roles.some((role) => ["admin", "assessment_coordinator", "reviewer"].includes(role));

  const selectView = (nextView: DemoView) => {
    setView(nextView);
    window.requestAnimationFrame(() => scrollContainerRef.current?.scrollTo({ top: 0, behavior: "auto" }));
  };

  useEffect(() => {
    if (view !== "lab" || casesLoadedRef.current) return;
    casesLoadedRef.current = true;
    setLoadingCases(true);
    activatePipelineDemoSession();
    void loadDemoReferrals().then((items) => {
      startTransition(() => {
        setReferrals(items);
        setLoadingCases(false);
      });
    }).catch(() => {
      setLoadingCases(false);
      setError("Existing demo cases could not be loaded. You can still create a fresh synthetic case.");
    });
  }, [view]);

  const launchScenario = async (
    scenario: PipelineDemoScenario,
    guide?: DemoGuide,
    workspaceStage: DemoWorkspaceStage = "assessment",
  ) => {
    activatePipelineDemoSession();
    setError("");
    if (navigateWithoutDemoRecord(scenario, guide)) return;
    if (!canWrite) {
      setError(environment.writable ? "Your demo account needs assessor, coordinator, or admin access to create practice records." : environment.reason);
      return;
    }

    setLaunchingId(scenario.id);
    try {
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
    activatePipelineDemoSession();
    const scenario = pipelineDemoScenarios.find((item) => referral.tags?.includes(item.id));
    const workspaceStage = scenario?.launch === "new_referral" ? "intake" : "assessment";
    window.location.assign(demoReferralRoute(referral.id, workspaceStage));
  };

  return (
    <main ref={scrollContainerRef} data-demo-center="true" className="h-full min-h-0 overflow-hidden bg-white text-[#171a18]">
      <div className="flex h-full min-h-0 w-full flex-col">
        <header className="shrink-0 border-b border-[#d8dfdc] bg-[#edf2f0]">
          <div className="flex min-w-0 items-end gap-1 overflow-x-auto px-2 pt-1.5 sm:px-3" role="tablist" aria-label="Demo Center sections">
            <DemoTab active={view === "presentation"} label="Presentation" onClick={() => selectView("presentation")} />
            <DemoTab active={view === "lab"} label="Practice cases" onClick={() => selectView("lab")} />
            <DemoTab active={view === "handoff"} label="Submittal & acceptance" onClick={() => selectView("handoff")} />
          </div>
        </header>

        {error ? <div role="alert" className="shrink-0 border-l-4 border-[#b95649] bg-[#fff2ef] px-4 py-3 text-[11px] font-bold text-[#8c3d33]">{error}</div> : null}
        {!environment.writable && view === "lab" ? <div className="shrink-0 border-b border-[#dfca97] bg-[#fff9e9] px-4 py-3 text-[11px] leading-5 text-[#765817]"><strong>Practice records are read only.</strong> {environment.reason}</div> : null}

        <div className={`min-h-0 flex-1 ${view === "presentation" ? "overflow-hidden" : "overflow-y-auto"}`}>
          {view === "presentation" ? (
            <PresentationDeck
              initialSlideId={initialPresentationSlide}
              onExit={() => selectView("lab")}
              onBeginWalkthrough={() => {
                const scenario = getPipelineDemoScenario("new-intake");
                if (scenario) void launchScenario(scenario, { tutorialId: "create-referral", stepId: "referral-packet" }, "intake");
              }}
              onStartGuide={(guide) => {
                const scenario = getPipelineDemoScenario(guide.scenarioId);
                if (scenario) void launchScenario(scenario, { tutorialId: guide.tutorialId, stepId: guide.stepId }, guide.workspaceStage);
              }}
              onSlideChange={() => scrollContainerRef.current?.scrollTo({ top: 0 })}
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
  onExit,
  onBeginWalkthrough,
  onStartGuide,
  onSlideChange,
}: {
  initialSlideId?: string;
  onExit: () => void;
  onBeginWalkthrough: () => void;
  onStartGuide: (guide: NonNullable<PresentationSlide["guide"]>) => void;
  onSlideChange: () => void;
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
      <PresentationHeader slide={slide} slideIndex={slideIndex} onSelect={selectSlide} onClose={onExit} />
      <PresentationSlideBody slide={slide} onStartGuide={onStartGuide} />
      <p className="sr-only" aria-live="polite">Slide {slide.number} of {presentationSlides.length}: {slide.title}</p>
      <PresentationFooter slide={slide} slideIndex={slideIndex} onSelect={selectSlide} onFinish={onBeginWalkthrough} />
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
  if (target?.matches("input, textarea, select, [contenteditable='true']")) return null;
  if (event.key === "ArrowRight") return slideIndex + 1;
  if (event.key === "ArrowLeft") return slideIndex - 1;
  if (event.key === "Home") return 0;
  if (event.key === "End") return presentationSlides.length - 1;
  return null;
}

function PresentationHeader({ slide, slideIndex, onSelect, onClose }: { slide: PresentationSlide; slideIndex: number; onSelect: (index: number) => void; onClose: () => void }) {
  return <header className="flex min-h-16 shrink-0 items-center gap-4 border-b border-[#d8dfdc] bg-white px-4 py-2 sm:px-6 lg:px-8"><div className="min-w-0 flex-1"><div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#0f7c68]">AHS · Pipeline</div><div className="mt-0.5 truncate text-[13px] font-black text-[#24302b]">Assessor orientation</div></div><div className="hidden min-w-0 flex-1 text-center lg:block"><div className="truncate text-[10px] font-black uppercase tracking-[0.1em] text-[#6a756f]">{slide.location}</div></div><nav aria-label="Presentation slides" className="flex shrink-0 items-center gap-2"><label htmlFor="presentation-slide" className="sr-only">Jump to slide</label><select id="presentation-slide" value={slideIndex} onChange={(event) => onSelect(Number(event.target.value))} className="h-10 max-w-[150px] border border-[#cbd5d1] bg-white px-3 text-[11px] font-bold text-[#34403b] outline-none focus:border-[#0f8b73] sm:max-w-[230px]">{presentationSlides.map((item, index) => <option key={item.id} value={index}>{item.number}. {item.navLabel}</option>)}</select><button type="button" onClick={onClose} className="flex h-10 items-center border border-[#cbd5d1] px-3 text-[11px] font-black text-[#59645f] hover:border-[#0f8b73] hover:text-[#0f705f]">Close presentation</button></nav></header>;
}

function PresentationSlideBody({ slide, onStartGuide }: { slide: PresentationSlide; onStartGuide: (guide: NonNullable<PresentationSlide["guide"]>) => void }) {
  const palette = presentationPalette(slide.dark);
  return <article key={slide.id} aria-label={`Presentation slide ${slide.number}`} className={`min-h-0 flex-1 overflow-y-auto ${palette.article}`}><div className="mx-auto grid min-h-full w-full max-w-[1720px] content-center gap-7 px-5 py-6 sm:px-8 sm:py-8 lg:grid-cols-[minmax(320px,370px)_minmax(600px,1fr)] lg:items-center lg:gap-10 lg:px-10 xl:grid-cols-[minmax(350px,400px)_minmax(680px,1fr)] xl:px-12 2xl:grid-cols-[minmax(390px,440px)_minmax(760px,1fr)] 2xl:gap-14 2xl:px-14"><div className="min-w-0"><div className={`text-[11px] font-black uppercase tracking-[0.12em] ${palette.eyebrow}`}>{slide.location}</div><h2 className="mt-3 max-w-[700px] text-[34px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[42px] lg:text-[36px] xl:text-[40px] 2xl:text-[48px]">{slide.title}</h2><p className={`mt-4 max-w-[680px] text-[16px] font-medium leading-7 sm:text-[18px] lg:text-[15px] lg:leading-6 xl:text-[17px] xl:leading-7 2xl:text-[18px] ${palette.summary}`}>{slide.summary}</p><PresentationPoints slide={slide} palette={palette} /><PresentationRule slide={slide} palette={palette} /><PresentationSlideActions slide={slide} onStartGuide={onStartGuide} /></div><PresentationVisual slide={slide} /></div></article>;
}

type PresentationPalette = ReturnType<typeof presentationPalette>;

function presentationPalette(dark?: boolean) {
  return dark ? {
    article: "bg-[#143d34] text-white",
    eyebrow: "text-[#8be0c5]",
    summary: "text-[#d2e5df]",
    list: "border-white/20",
    point: "border-white/15 text-[#e4efeb]",
    number: "text-[#8be0c5]",
    rule: "border-[#8be0c5] bg-white/10 text-[#e1eee9]",
  } : {
    article: "bg-[#fbfcfb] text-[#17221e]",
    eyebrow: "text-[#0c705f]",
    summary: "text-[#52605a]",
    list: "border-[#d5ddda]",
    point: "border-[#e0e5e2] text-[#37433e]",
    number: "text-[#0c705f]",
    rule: "border-[#0f8b73] bg-[#edf6f3] text-[#355047]",
  };
}

function PresentationPoints({ slide, palette }: { slide: PresentationSlide; palette: PresentationPalette }) {
  return <ul className={`mt-5 border-y ${palette.list}`}>{slide.points.map((point, index) => <li key={point} className={`grid grid-cols-[30px_minmax(0,1fr)] gap-2 border-b py-2.5 last:border-b-0 ${palette.point}`}><span className={`text-[10px] font-black tabular-nums ${palette.number}`}>{String(index + 1).padStart(2, "0")}</span><span className="text-[12px] font-bold leading-5 2xl:text-[13px]">{point}</span></li>)}</ul>;
}

function PresentationRule({ slide, palette }: { slide: PresentationSlide; palette: PresentationPalette }) {
  if (!slide.rule) return null;
  return <p className={`mt-4 border-l-[3px] px-4 py-2.5 text-[11px] font-bold leading-5 ${palette.rule}`}>{slide.rule}</p>;
}

function PresentationSlideActions({ slide, onStartGuide }: { slide: PresentationSlide; onStartGuide: (guide: NonNullable<PresentationSlide["guide"]>) => void }) {
  return slide.guide ? <div className="mt-4"><button type="button" onClick={() => onStartGuide(slide.guide!)} className="inline-flex h-10 items-center gap-2 bg-[#0f8b73] px-4 text-[11px] font-black text-white outline-none hover:bg-[#0b6d5b] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2"><Play size={14} aria-hidden="true" />{slide.guide.label}</button></div> : null;
}

function PresentationFooter({ slide, slideIndex, onSelect, onFinish }: { slide: PresentationSlide; slideIndex: number; onSelect: (index: number) => void; onFinish: () => void }) {
  const isLast = slideIndex === presentationSlides.length - 1;
  return <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[#d8dfdc] bg-white px-4 py-3 sm:px-8 lg:px-10"><button type="button" disabled={slideIndex === 0} onClick={() => onSelect(slideIndex - 1)} className="inline-flex h-10 items-center gap-2 px-2 text-[11px] font-bold text-[#5d6863] outline-none hover:text-[#17221e] focus-visible:ring-2 focus-visible:ring-[#0f8b73] disabled:invisible"><ArrowLeft size={14} aria-hidden="true" />Previous</button><div className="hidden items-center gap-1.5 sm:flex" aria-hidden="true">{presentationSlides.map((item, index) => <span key={item.id} className={`h-1.5 transition-[width,background-color] ${index === slideIndex ? "w-8 bg-[#0f8b73]" : "w-1.5 bg-[#cbd4d0]"}`} />)}</div>{isLast ? <button type="button" onClick={onFinish} className="inline-flex h-10 items-center gap-2 bg-[#0f8b73] px-5 text-[11px] font-black text-white outline-none hover:bg-[#0b6d5b] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2">Begin walkthrough<ArrowRight size={14} aria-hidden="true" /></button> : <button type="button" onClick={() => onSelect(slideIndex + 1)} className="inline-flex h-10 items-center gap-2 bg-[#111111] px-5 text-[11px] font-black text-white outline-none hover:bg-[#26302c] focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2">{slide.nextLabel}<ArrowRight size={14} aria-hidden="true" /></button>}</footer>;
}

function PresentationVisual({ slide }: { slide: PresentationSlide }) {
  if (slide.screenshots?.length) return <PresentationScreenshots screenshots={slide.screenshots} />;
  if (slide.graphic === "case-spine") return <CaseSpineVisual />;
  if (slide.graphic === "ownership") return <OwnershipVisual />;
  if (slide.graphic === "workday") return <WorkdayVisual />;
  if (slide.graphic === "source-stack") return <SourceStackVisual />;
  if (slide.graphic === "assessment-map") return <AssessmentMapVisual />;
  if (slide.graphic === "note-comparison") return <NoteComparisonVisual />;
  if (slide.graphic === "decision-path") return <DecisionPathVisual />;
  return null;
}

function PresentationScreenshots({ screenshots }: { screenshots: readonly PresentationScreenshot[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const selected = screenshots[selectedIndex] ?? screenshots[0];

  useEffect(() => {
    if (!expanded) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [expanded]);

  return (
    <figure className="min-w-0 overflow-hidden border border-[#bfcac5] bg-white shadow-[0_24px_70px_rgba(20,48,39,0.14)]">
      <div className="flex min-h-11 items-stretch justify-between border-b border-[#d5ddda] bg-[#f2f6f4]">
        <div role={screenshots.length > 1 ? "tablist" : undefined} aria-label={screenshots.length > 1 ? "Slide screenshots" : undefined} className="flex min-w-0 overflow-x-auto">
          {screenshots.map((screenshot, index) => screenshots.length > 1 ? (
            <button key={screenshot.src} type="button" role="tab" aria-selected={index === selectedIndex} onClick={() => setSelectedIndex(index)} className={`shrink-0 border-b-2 px-4 text-[11px] font-black ${index === selectedIndex ? "border-[#0f8b73] bg-white text-[#183a31]" : "border-transparent text-[#65706b] hover:text-[#25322d]"}`}>{screenshot.label}</button>
          ) : <span key={screenshot.src} className="flex items-center px-4 text-[10px] font-black uppercase tracking-[0.09em] text-[#0c705f]">{screenshot.label}</span>)}
        </div>
        <button type="button" onClick={() => setExpanded(true)} className="shrink-0 px-4 text-[9px] font-black uppercase tracking-[0.09em] text-[#5e6a65] hover:bg-white hover:text-[#0c705f]">View full size</button>
      </div>
      <div className="relative aspect-video w-full overflow-hidden bg-[#e8edeb]">
        <Image key={selected.src} src={toPipelinePath(selected.src)} alt={selected.alt} fill unoptimized loading="eager" sizes="(max-width: 1023px) 100vw, 68vw" className="object-contain object-top" />
      </div>
      <figcaption className="border-t border-[#d5ddda] bg-white px-4 py-3 text-[12px] font-semibold leading-5 text-[#52605a]">{selected.caption}</figcaption>
      {expanded ? <div className="fixed inset-0 z-[170] flex h-dvh flex-col bg-[#0d1713] text-white" role="dialog" aria-modal="true" aria-label={`${selected.label} full-size screen`}>
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-white/20 px-5 sm:px-8"><div><div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#8be0c5]">Synthetic Pipeline screen</div><div className="mt-1 text-[14px] font-black">{selected.label}</div></div><button type="button" onClick={() => setExpanded(false)} className="h-10 border border-white/30 px-4 text-[11px] font-black hover:border-[#8be0c5] hover:text-[#8be0c5]">Close full-size screen</button></header>
        <div className="relative min-h-0 flex-1"><Image src={toPipelinePath(selected.src)} alt={selected.alt} fill unoptimized sizes="100vw" className="object-contain" /></div>
        <p className="shrink-0 border-t border-white/20 px-5 py-3 text-center text-[12px] font-semibold text-[#d5e2dd] sm:px-8">{selected.caption}</p>
      </div> : null}
    </figure>
  );
}

function CaseSpineVisual() {
  const stages = [
    { label: "Referral packet", detail: "What arrived", icon: FileText },
    { label: "Assessment", detail: "What you verified", icon: ClipboardCheck },
    { label: "Recommendation", detail: "What you concluded", icon: FileCheck2 },
    { label: "Supervisor decision", detail: "Accepted or declined", icon: ShieldCheck },
  ] as const;
  return (
    <section aria-label="Taylor Rivera referral journey" className="min-w-0 overflow-hidden border border-white/20 bg-[#0f3029] shadow-[0_28px_80px_rgba(0,0,0,0.22)]">
      <div className="flex items-center justify-between gap-4 border-b border-white/15 px-5 py-4 sm:px-6">
        <div><div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#8be0c5]">Synthetic case</div><div className="mt-1 text-[20px] font-semibold text-white">Taylor Rivera</div></div>
        <div className="text-right text-[11px] font-semibold leading-5 text-[#bdd3cc]">Turlock<br />Assigned assessment</div>
      </div>
      <ol className="grid gap-px bg-white/15 sm:grid-cols-2 xl:grid-cols-4">
        {stages.map(({ label, detail, icon: Icon }, index) => (
          <li key={label} className="relative min-h-[150px] bg-[#143d34] p-5 sm:p-6">
            <div className="flex items-start justify-between"><Icon size={22} className="text-[#8be0c5]" aria-hidden="true" /><span className="text-[10px] font-black text-white/45">0{index + 1}</span></div>
            <div className="mt-8 text-[15px] font-black text-white">{label}</div>
            <div className="mt-1 text-[11px] font-medium leading-5 text-[#bdd3cc]">{detail}</div>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-3 border-t border-white/15 px-5 py-4 text-[12px] font-bold text-white sm:px-6"><Check size={16} className="text-[#8be0c5]" aria-hidden="true" />The packet, assessment, recommendation, and decision remain connected.</div>
    </section>
  );
}

function OwnershipVisual() {
  return (
    <section aria-label="Assessor and administrator responsibilities" className="min-w-0 overflow-hidden border border-[#c8d3ce] bg-white shadow-[0_24px_70px_rgba(28,50,42,0.10)]">
      <div className="grid gap-px bg-[#d8e0dc] sm:grid-cols-2">
        <div className="bg-[#eaf5f1] p-6 sm:p-7">
          <div className="flex items-center gap-3 text-[#0c705f]"><UserRound size={21} aria-hidden="true" /><span className="text-[11px] font-black uppercase tracking-[0.1em]">You · assessor</span></div>
          <ul className="mt-7 space-y-4 text-[15px] font-bold leading-6 text-[#243a32]">
            <OwnershipItem>Verify the source material</OwnershipItem>
            <OwnershipItem>Complete and sign the assessment</OwnershipItem>
            <OwnershipItem>Submit the clinical recommendation</OwnershipItem>
          </ul>
        </div>
        <div className="bg-white p-6 sm:p-7">
          <div className="flex items-center gap-3 text-[#5c6762]"><ShieldCheck size={21} aria-hidden="true" /><span className="text-[11px] font-black uppercase tracking-[0.1em]">Authorized administrator</span></div>
          <ul className="mt-7 space-y-4 text-[15px] font-bold leading-6 text-[#39443f]">
            <OwnershipItem muted>Review assessment and requirements</OwnershipItem>
            <OwnershipItem muted>Discuss operational fit</OwnershipItem>
            <OwnershipItem muted>Record the admission decision</OwnershipItem>
          </ul>
        </div>
      </div>
      <div className="border-t border-[#d8e0dc] bg-[#17221e] px-6 py-4 text-[13px] font-bold text-white"><span className="text-[#8bd5bd]">The boundary:</span> recommend acceptance, decline, or more information. Do not record the final decision.</div>
    </section>
  );
}

function OwnershipItem({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return <li className="flex items-start gap-3"><span className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${muted ? "bg-[#eef1ef] text-[#68736e]" : "bg-white text-[#0f8b73]"}`}><Check size={12} aria-hidden="true" /></span><span>{children}</span></li>;
}

function WorkdayVisual() {
  const surfaces = [
    { label: "Home", title: "Taylor Rivera", detail: "Assessment due today", status: "Needs you", icon: UserRound },
    { label: "Calendar", title: "10:00 AM · Zoom", detail: "60-minute assessment", status: "Scheduled", icon: CalendarDays },
    { label: "Workspace", title: "One connected record", detail: "Intake · Assessment · Chart · Activity", status: "Open", icon: FileCheck2 },
  ] as const;
  return (
    <section aria-label="Home calendar and workspace sequence" className="min-w-0">
      <ol className="grid gap-3 lg:grid-cols-3">
        {surfaces.map(({ label, title, detail, status, icon: Icon }, index) => (
          <li key={label} className="relative border border-[#cbd5d1] bg-white p-5 shadow-[0_16px_40px_rgba(29,52,44,0.08)]">
            <div className="flex items-center justify-between"><div className="flex h-9 w-9 items-center justify-center bg-[#e7f3ef] text-[#0c705f]"><Icon size={18} aria-hidden="true" /></div><span className="text-[9px] font-black uppercase tracking-[0.09em] text-[#77817c]">{label}</span></div>
            <div className="mt-8 text-[16px] font-black text-[#1f2c27]">{title}</div>
            <div className="mt-2 min-h-10 text-[11px] font-medium leading-5 text-[#66716c]">{detail}</div>
            <div className="mt-5 border-t border-[#e0e5e2] pt-3 text-[10px] font-black text-[#0c705f]">{status}</div>
            {index < surfaces.length - 1 ? <span className="absolute -right-[14px] top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-[#cbd5d1] bg-white text-[#0c705f] lg:flex"><ArrowRight size={13} aria-hidden="true" /></span> : null}
          </li>
        ))}
      </ol>
      <div className="mt-4 flex items-center gap-3 border-l-4 border-[#0f8b73] bg-[#edf5f2] px-5 py-4 text-[13px] font-bold leading-6 text-[#315047]">If the referral already exists, open it. Creating it again can split documents and activity across duplicate workspaces.</div>
    </section>
  );
}

function SourceStackVisual() {
  const sources = [
    ["Client report", "Missed two evening doses this week"],
    ["Referral packet", "Medication list dated three months ago"],
    ["Collateral", "Current pharmacy record not received"],
    ["Your observation", "Client identifies purpose of medication"],
  ] as const;
  return (
    <section aria-label="Source attribution example" className="grid min-w-0 gap-4 xl:grid-cols-[0.86fr_1.14fr]">
      <div className="space-y-2">
        {sources.map(([source, fact], index) => <div key={source} className="border border-[#cbd5d1] bg-white px-4 py-3 shadow-[0_8px_20px_rgba(29,52,44,0.05)]"><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.09em] text-[#0c705f]"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#e5f3ee]">{index + 1}</span>{source}</div><p className="mt-2 text-[12px] font-semibold leading-5 text-[#384640]">{fact}</p></div>)}
      </div>
      <div className="border border-[#b6c8c1] bg-[#17372f] p-5 text-white shadow-[0_24px_60px_rgba(24,54,46,0.16)] sm:p-6">
        <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#8bd5bd]">Verified intake</div>
        <div className="mt-4 text-[21px] font-semibold">Medication adherence</div>
        <div className="mt-5 space-y-4 text-[12px] leading-6 text-[#d5e3de]"><p><strong className="text-white">Known:</strong> Taylor reports two missed evening doses this week.</p><p><strong className="text-white">Conflict:</strong> The available medication list may be outdated.</p><p><strong className="text-white">Next action:</strong> Verify the current regimen with the pharmacy or referring team.</p></div>
        <div className="mt-6 border-t border-white/15 pt-4 text-[11px] font-black text-[#8bd5bd]">No current record? Leave the regimen unverified.</div>
      </div>
    </section>
  );
}

function AssessmentMapVisual() {
  const groups = [
    ["Understand the referral", ["Client & referral", "Placement", "History"]],
    ["Understand the person", ["Clinical", "Function", "Medication", "Substance use"]],
    ["Understand safety and care", ["Behavior & safety", "Physical health", "Legal"]],
    ["Plan and finish", ["Support & goals", "Review"]],
  ] as const;
  return (
    <section aria-label="Assessment interview map" className="min-w-0 border border-[#c9d4cf] bg-white shadow-[0_24px_70px_rgba(28,50,42,0.10)]">
      <div className="flex items-end justify-between gap-4 border-b border-[#d9e0dd] px-5 py-3"><div><div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#0c705f]">Taylor Rivera assessment</div><div className="mt-1 text-[15px] font-black text-[#26332e]">Interview map</div></div><div className="text-right"><div className="text-[21px] font-semibold text-[#1f2d28]">7 / 12</div><div className="text-[9px] font-black uppercase text-[#7a8580]">Sections visited</div></div></div>
      <div className="grid gap-px bg-[#dce3e0] sm:grid-cols-2">
        {groups.map(([label, sections], groupIndex) => <div key={label} className="bg-[#fbfcfb] p-4"><div className="flex items-center gap-3"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e5f3ee] text-[9px] font-black text-[#0c705f]">{groupIndex + 1}</span><h3 className="text-[12px] font-black text-[#2b3933]">{label}</h3></div><ul className="mt-3 space-y-1.5">{sections.map((section) => <li key={section} className="flex items-center gap-2 text-[10px] font-semibold text-[#5d6963]"><span className="h-1.5 w-1.5 rounded-full bg-[#68a792]" />{section}</li>)}</ul></div>)}
      </div>
      <div className="flex items-center gap-3 border-t border-[#d9e0dd] bg-[#eef6f3] px-5 py-3 text-[11px] font-bold text-[#315047]"><Check size={15} className="text-[#0f8b73]" aria-hidden="true" />Autosave keeps progress; the section map keeps orientation.</div>
    </section>
  );
}

function NoteComparisonVisual() {
  return (
    <section aria-label="Weak and source-backed note comparison" className="grid min-w-0 gap-3 xl:grid-cols-2">
      <article className="border border-[#dbc9c5] bg-[#fffafa] p-5 sm:p-6"><div className="flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-[0.1em] text-[#91574e]">Too vague</span><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f5e7e4] text-[13px] font-black text-[#9b5146]">×</span></div><blockquote className="mt-8 text-[21px] font-semibold leading-8 tracking-[-0.02em] text-[#4d3834]">“Client is medication noncompliant.”</blockquote><p className="mt-8 border-t border-[#eadbd8] pt-4 text-[11px] font-semibold leading-5 text-[#795f5a]">No source. No time frame. No verified regimen. No next action.</p></article>
      <article className="border border-[#9fc3b7] bg-[#eaf5f1] p-5 shadow-[0_20px_55px_rgba(26,83,65,0.12)] sm:p-6"><div className="flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-[0.1em] text-[#0c705f]">Source-attributed</span><span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-[#0c705f]"><Check size={14} aria-hidden="true" /></span></div><blockquote className="mt-6 text-[16px] font-semibold leading-7 text-[#24443a]">“Taylor reports missing two evening doses this week. The current medication record is unavailable. Verify the regimen with the pharmacy or referring team.”</blockquote><div className="mt-6 flex flex-wrap gap-2"><EvidenceTag>Source</EvidenceTag><EvidenceTag>Status</EvidenceTag><EvidenceTag>Next action</EvidenceTag></div></article>
    </section>
  );
}

function EvidenceTag({ children }: { children: React.ReactNode }) {
  return <span className="border border-[#9fc3b7] bg-white px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.08em] text-[#0c705f]">{children}</span>;
}

function DecisionPathVisual() {
  const steps = [
    ["Draft", "Editable", "Assessor"],
    ["Signed assessment", "Locked", "Assessor"],
    ["Recommendation", "Submitted", "Assessor"],
    ["Admission decision", "Accepted · declined · deferred", "Administrator"],
  ] as const;
  return (
    <section aria-label="Assessment signature and decision sequence" className="min-w-0 overflow-hidden border border-[#c8d3ce] bg-white shadow-[0_24px_70px_rgba(28,50,42,0.10)]">
      <ol className="grid gap-px bg-[#d9e1dd] sm:grid-cols-2 xl:grid-cols-4">{steps.map(([label, detail, owner], index) => <li key={label} className={`relative min-h-[170px] p-5 ${index === 3 ? "bg-[#17221e] text-white" : "bg-white text-[#27342f]"}`}><div className="flex items-center justify-between"><span className={`flex h-8 w-8 items-center justify-center ${index === 3 ? "bg-[#29463c] text-[#8bd5bd]" : "bg-[#e7f3ef] text-[#0c705f]"}`}>{index === 1 ? <LockKeyhole size={15} aria-hidden="true" /> : <span className="text-[10px] font-black">0{index + 1}</span>}</span><span className={`text-[8px] font-black uppercase tracking-[0.08em] ${index === 3 ? "text-[#a9beb7]" : "text-[#84908a]"}`}>{owner}</span></div><div className="mt-8 text-[14px] font-black leading-5">{label}</div><div className={`mt-2 text-[10px] font-semibold leading-5 ${index === 3 ? "text-[#b9cbc5]" : "text-[#69756f]"}`}>{detail}</div>{index < steps.length - 1 ? <ArrowRight size={14} className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 text-[#0f8b73] xl:block" aria-hidden="true" /> : null}</li>)}</ol>
      <div className="grid gap-px border-t border-[#d9e1dd] bg-[#d9e1dd] sm:grid-cols-2"><div className="bg-[#eaf5f1] px-5 py-4 text-[11px] font-black text-[#315047]">Your work ends with a signed assessment and submitted recommendation.</div><div className="bg-[#f8faf9] px-5 py-4 text-[11px] font-black text-[#5b6661]">New facts after signature belong in a source-attributed addendum.</div></div>
    </section>
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

function navigateWithoutDemoRecord(scenario: PipelineDemoScenario, guide?: DemoGuide) {
  if (scenario.launch === "new_referral") {
    if (guide) stageOperatorGuideForNavigation(guide.tutorialId, guide.stepId);
    window.location.assign(toPipelinePath(`/?view=referrals&screen=packet&draftId=${crypto.randomUUID()}&demoScenario=${scenario.id}`));
    return true;
  }
  if (!guide) return false;

  stageOperatorGuideForNavigation(guide.tutorialId, guide.stepId);
  const trainingAssessment = scenario.assessmentState === "unscheduled" ? "schedule" : "interview";
  const tutorialStep = getOperatorGuidedTutorial(guide.tutorialId)?.steps.find((step) => step.id === guide.stepId);
  const guidedSection = tutorialStep ? new URL(tutorialStep.route, window.location.origin).searchParams.get("assessmentSection") : null;
  const assessmentSection = trainingAssessment === "interview" ? `&assessmentSection=${guidedSection ?? "identity"}` : "";
  window.location.assign(toPipelinePath(`/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=${trainingAssessment}${assessmentSection}&demo=1`));
  return true;
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
