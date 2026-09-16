"use client";

import {
  ArrowLeft,
  ArrowRight,
  ClipboardCheck,
  ExternalLink,
  ListChecks,
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
  points: readonly string[];
  screenshots: readonly PresentationScreenshot[];
  rule?: string;
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
    location: "From Allo to Pipeline",
    title: "Find your referral. Keep the work together.",
    summary: "Home is the starting point. Select your assignment to open its existing workspace.",
    points: [
      "The packet, intake, appointment, and assessment stay with that referral.",
      "Use + only when taking a new referral—not to reopen an assignment.",
    ],
    screenshots: [{
      src: "/training/presentation/assessor-home.png",
      alt: "Pipeline Home with Taylor Rivera in New assignments and the current work queue.",
      label: "Home · New assignments",
      caption: "Select the name under New assignments to open that referral. The + in the top navigation is for a new referral, not an assigned one.",
    }],
    nextLabel: "See the main screens",
    dark: true,
  },
  {
    id: "find-work",
    number: 2,
    navLabel: "Screens",
    location: "Home · Workspaces · Calendar · Clients",
    title: "Where everything lives",
    summary: "Home shows work needing attention. Workspaces holds referrals; Clients lists current residents from the Alamo platform.",
    points: [
      "Home → Continue working reopens saved work when there is something to resume.",
      "Workspaces shows recent updates first. Use search and owner filters; supervisors can switch Mine / All.",
    ],
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
    summary: "New referrals use Intake, Assessment, and Chart. Transferred Allo records open as charts; they do not need a new intake or assessment just because they were imported.",
    points: [
      "Intake holds the packet and client information. Assessment is where the interview is completed.",
      "Files and Activity are beside the stage navigation at the top.",
    ],
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
    title: "Review intake before scheduling",
    summary: "Open the packet and check the information recorded in Intake, including the contact details needed to arrange the interview.",
    points: [
      "Check identity, county, community, and medications against the source. Saving a contact does not call or message anyone.",
      "Keep conflicting sources visible and leave unsupported facts unrecorded.",
    ],
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
    title: "Arrange the assessment",
    summary: "After reviewing intake and arranging the interview, open Assessment → Schedule. Enter the date and time in Pacific Time, duration, and method.",
    points: [
      "Add the address, phone number, or Zoom link. Record review needs no meeting details; scheduling does not send an invitation.",
      "The saved appointment appears on Calendar. Open its linked referral on the day, or reschedule it if plans change.",
    ],
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
    title: "Pick up where you left off",
    summary: "The guided interview works through one group of questions at a time. The full assessment organizes the same answers into 12 sections.",
    points: [
      "Use Next within the interview. Close the guided view to review the full assessment.",
      "Pausing? Wait for saved status. Return through Home → Continue working or the same workspace. A draft is not a submittal.",
    ],
    screenshots: [{
      src: "/training/presentation/assessment-interview-current.png",
      alt: "Pipeline guided assessment interview for Taylor Rivera with real answer controls and Next at the bottom right.",
      label: "Guided interview",
      caption: "Answer in the middle; use Back and Next at the bottom. Exit guided interview returns to the section view of these same answers.",
    }],
    nextLabel: "Document the interview",
  },
  {
    id: "document-interview",
    number: 7,
    navLabel: "Document",
    location: "Assessment → History → Prior placements → Language Lab",
    title: "Language Lab stays beside the answer",
    summary: "In History, select Language Lab beneath Prior placements. The writing order, checklist, and example open where you are working.",
    points: [
      "Use the example for structure—not as facts about your client.",
      "Language Lab stays beneath the same answer in the guided interview and full assessment.",
    ],
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
    summary: "Review names missing required answers and unresolved information. Signing locks the completed assessment; later information is recorded as an addendum.",
    points: [
      "Select Review at the bottom of the left rail. Saved status and Sign assessment are in the top bar.",
      "A signed assessment still needs Submit for supervisor review in Workflow.",
    ],
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
    title: "Submit for supervisor review",
    summary: "The assessor submits the signed assessment and recommendation. The authorized supervisor records acceptance, decline, or a request for changes.",
    points: [
      "Submit for supervisor review freezes the signed assessment revision under review.",
      "Acceptance is not admission. The admission and handoff requirements still need to be completed.",
    ],
    screenshots: [
      { src: "/training/presentation/assessment-submittal.png", alt: "Pipeline Workflow showing the assessor recommendation and Submit for supervisor review control.", label: "Assessor submittal", caption: "Open Workflow beside the workspace tabs. Record the recommendation and rationale, then select Submit for supervisor review." },
      { src: "/training/presentation/supervisor-decision.png", alt: "Pipeline Workflow showing a submitted assessment and the supervisor admission decision controls.", label: "Supervisor decision", caption: "The authorized supervisor reviews the submittal and records a decision. This view has permissions that an assessor account may not have." },
    ],
    nextLabel: "Review the writing guide",
  },
  {
    id: "language-lab-overview",
    number: 10,
    navLabel: "Language Lab",
    location: "Assessment → History → Prior placements",
    title: "Write the answer, not the example",
    summary: "Prior placements asks for the setting, time there, why it ended, and the source. Language Lab puts that writing order beside the actual answer.",
    points: [
      "Name a packet or collateral source when it differs from what the client says.",
      "Leave unsupported details unanswered; record why when the field asks for it.",
    ],
    screenshots: [{
      src: "/training/presentation/assessment-language-lab.png",
      alt: "Assessment History with Language Lab expanded below the Prior placements field.",
      label: "Prior placements · Language Lab",
      caption: "Use the field's writing order, checklist, and example as structure. Enter only what this interview or its named sources support.",
    }],
    rule: "Prior placements: setting · time there · exit reason · named source · next verification.",
    nextLabel: "Enter practice Home",
  },
] as const;

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
      <PresentationHeader slide={slide} slideIndex={slideIndex} onSelect={selectSlide} onClose={onExit} onReset={onReset} />
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

function PresentationHeader({ slide, slideIndex, onSelect, onClose, onReset }: { slide: PresentationSlide; slideIndex: number; onSelect: (index: number) => void; onClose: () => void; onReset?: () => void }) {
  return (
    <header className="flex min-h-16 shrink-0 items-center gap-4 border-b border-[#d8dfdc] bg-white px-4 py-2 sm:px-6 lg:px-8">
      <div className="hidden min-w-0 flex-1 sm:block">
        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#0f7c68]">AHS · Pipeline</div>
        <div className="mt-0.5 truncate text-[13px] font-black text-[#24302b]">Assessor's Workshop</div>
      </div>
      <div className="hidden min-w-0 flex-1 text-center lg:block">
        <div className="truncate text-[10px] font-black uppercase tracking-[0.1em] text-[#6a756f]">{slide.location}</div>
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
  const palette = presentationPalette(slide.dark);
  return <article key={slide.id} aria-label={`Presentation slide ${slide.number}`} className={`min-h-0 flex-1 overflow-y-auto ${palette.article}`}><div className="mx-auto grid min-h-full w-full max-w-[1840px] content-center gap-7 px-5 py-6 sm:px-8 sm:py-8 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-center lg:gap-10 lg:px-10 lg:py-6 xl:grid-cols-[320px_minmax(0,1fr)] xl:px-12 2xl:grid-cols-[360px_minmax(0,1fr)] 2xl:gap-10 2xl:px-14"><div className="min-w-0"><div className={`text-[11px] font-black uppercase tracking-[0.12em] ${palette.eyebrow}`}>{slide.location}</div><h2 className="mt-3 max-w-[700px] text-[34px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[42px] lg:text-[36px] xl:text-[36px] 2xl:text-[44px]">{slide.title}</h2><p className={`mt-4 max-w-[680px] text-[16px] font-medium leading-7 sm:text-[18px] lg:text-[16px] lg:leading-6 xl:text-[17px] xl:leading-7 2xl:text-[18px] ${palette.summary}`}>{slide.summary}</p><PresentationPoints slide={slide} palette={palette} /><PresentationRule slide={slide} palette={palette} /></div><PresentationVisual slide={slide} /></div></article>;
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
  return <ul className={`mt-5 border-y ${palette.list}`}>{slide.points.map((point, index) => <li key={point} className={`grid grid-cols-[30px_minmax(0,1fr)] gap-2 border-b py-2.5 last:border-b-0 ${palette.point}`}><span className={`text-[10px] font-black tabular-nums ${palette.number}`}>{String(index + 1).padStart(2, "0")}</span><span className="text-[14px] font-medium leading-6 2xl:text-[16px]">{point}</span></li>)}</ul>;
}

function PresentationRule({ slide, palette }: { slide: PresentationSlide; palette: PresentationPalette }) {
  if (!slide.rule) return null;
  return <p className={`mt-4 border-l-[3px] px-4 py-2.5 text-[11px] font-bold leading-5 ${palette.rule}`}>{slide.rule}</p>;
}

function PresentationFooter({ slide, slideIndex, onSelect, onFinish, finishLabel, finishBusy }: { slide: PresentationSlide; slideIndex: number; onSelect: (index: number) => void; onFinish: () => void; finishLabel: string; finishBusy: boolean }) {
  const isLast = slideIndex === presentationSlides.length - 1;
  return <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[#d8dfdc] bg-white px-4 py-3 sm:px-8 lg:px-10"><button type="button" disabled={slideIndex === 0} onClick={() => onSelect(slideIndex - 1)} className="inline-flex h-10 items-center gap-2 px-2 text-[11px] font-bold text-[#5d6863] outline-none hover:text-[#17221e] focus-visible:ring-2 focus-visible:ring-[#0f8b73] disabled:invisible"><ArrowLeft size={14} aria-hidden="true" />Previous</button><div className="hidden items-center gap-1.5 sm:flex" aria-hidden="true">{presentationSlides.map((item, index) => <span key={item.id} className={`h-1.5 transition-[width,background-color] ${index === slideIndex ? "w-8 bg-[#0f8b73]" : "w-1.5 bg-[#cbd4d0]"}`} />)}</div>{isLast ? <button type="button" disabled={finishBusy} onClick={onFinish} className="inline-flex h-10 items-center gap-2 bg-[#0f8b73] px-5 text-[11px] font-black text-white outline-none hover:bg-[#0b6d5b] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 disabled:opacity-60">{finishBusy ? "Preparing demo..." : finishLabel}<ArrowRight size={14} aria-hidden="true" /></button> : <button type="button" onClick={() => onSelect(slideIndex + 1)} className="inline-flex h-10 items-center gap-2 bg-[#111111] px-5 text-[11px] font-black text-white outline-none hover:bg-[#26302c] focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2">{slide.nextLabel}<ArrowRight size={14} aria-hidden="true" /></button>}</footer>;
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
    <figure className="min-w-0 overflow-hidden border border-[#bfcac5] bg-white shadow-[0_24px_70px_rgba(20,48,39,0.14)]">
      <div className="flex min-h-11 items-stretch justify-between border-b border-[#d5ddda] bg-[#f2f6f4]">
        <div role={screenshots.length > 1 ? "tablist" : undefined} aria-label={screenshots.length > 1 ? "Slide screenshots" : undefined} className="flex min-w-0 overflow-x-auto">
          {screenshots.map((screenshot, index) => screenshots.length > 1 ? (
            <button key={screenshot.src} type="button" role="tab" aria-selected={index === selectedIndex} onClick={() => setSelectedIndex(index)} className={`shrink-0 border-b-2 px-4 text-[11px] font-black ${index === selectedIndex ? "border-[#0f8b73] bg-white text-[#183a31]" : "border-transparent text-[#65706b] hover:text-[#25322d]"}`}>{screenshot.label}</button>
          ) : <span key={screenshot.src} className="flex items-center px-4 text-[10px] font-black uppercase tracking-[0.09em] text-[#0c705f]">{screenshot.label}</span>)}
        </div>
        <button type="button" onClick={() => setExpanded(true)} className="shrink-0 px-4 text-[9px] font-black uppercase tracking-[0.09em] text-[#5e6a65] hover:bg-white hover:text-[#0c705f]">View full size</button>
      </div>
      <button type="button" aria-label={`Enlarge ${selected.label} screenshot`} onClick={() => setExpanded(true)} className="relative block aspect-video w-full lg:max-h-[calc(100dvh-330px)] cursor-zoom-in overflow-hidden bg-[#e8edeb] outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#0f8b73]">
        <Image key={selected.src} src={toPipelinePath(selected.src)} alt={selected.alt} fill unoptimized loading="eager" sizes="(max-width: 1023px) 100vw, 68vw" className="object-contain object-top" />
      </button>
      <figcaption className="border-t border-[#d5ddda] bg-white px-4 py-3 text-[14px] font-medium leading-6 text-[#52605a]">{selected.caption}</figcaption>
      {expanded ? <dialog ref={dialogRef} onClose={() => setExpanded(false)} className="fixed inset-0 m-0 flex h-dvh max-h-none w-screen max-w-none flex-col border-0 bg-[#0d1713] p-0 text-white" aria-label={`${selected.label} full-size screen`}>
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-white/20 px-5 sm:px-8"><div><div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#8be0c5]">Synthetic Pipeline screen</div><div className="mt-1 text-[14px] font-black">{selected.label}</div></div><button type="button" onClick={() => dialogRef.current?.close()} className="h-10 border border-white/30 px-4 text-[11px] font-black hover:border-[#8be0c5] hover:text-[#8be0c5]">Close full-size screen</button></header>
        <div className="relative min-h-0 flex-1"><Image src={toPipelinePath(selected.src)} alt={selected.alt} fill unoptimized sizes="100vw" className="object-contain" /></div>
        <p className="shrink-0 border-t border-white/20 px-5 py-3 text-center text-[12px] font-semibold text-[#d5e2dd] sm:px-8">{selected.caption}</p>
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
