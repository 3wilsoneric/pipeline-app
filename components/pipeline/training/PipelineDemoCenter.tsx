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
  LockKeyhole,
  Play,
  RefreshCcw,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
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
import { stageOperatorGuideForNavigation } from "@/lib/training/operator-guided-tour-state";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";

const MeetClientHandoffDemo = dynamic(() => import("@/components/pipeline/training/MeetClientHandoffDemo"), {
  loading: () => <div className="flex min-h-[260px] items-center justify-center text-[11px] font-bold text-[#68736f]">Loading handoff preview...</div>,
});

type DemoActor = {
  id: string;
  name: string;
  email: string;
  roles: readonly string[];
};

type DemoReferralSummary = Pick<Referral, "id" | "name" | "community" | "tags" | "createdAt">;
type DemoAssessor = { principal_id: string; display_name: string };
type DemoView = "presentation" | "journey" | "lab" | "handoff";

type PresentationSlide = {
  id: string;
  number: number;
  navLabel: string;
  eyebrow: string;
  title: string;
  lead: string;
  graphic: "case-spine" | "ownership" | "workday" | "source-stack" | "assessment-map" | "note-comparison" | "decision-path" | "handoff";
  nextLabel: string;
  dark?: boolean;
  action?: {
    label: string;
    href: string;
  };
};

type DemoChapter = {
  number: number;
  title: string;
  instruction: string;
  actions: readonly string[];
  completeWhen: string;
  scenarioId?: PipelineDemoScenarioId;
  guide?: { tutorialId: string; stepId: string };
  workspaceStage?: "intake" | "assessment";
  destination?: DemoView;
};

const presentationSlides: readonly PresentationSlide[] = [
  {
    id: "decision-ready",
    number: 1,
    navLabel: "Outcome",
    eyebrow: "Supervisor-led assessor orientation",
    title: "How assessors use Pipeline from referral to recommendation",
    lead: "This overview covers where work appears, how to verify and document the assessment, what signing changes, and where assessor responsibility ends.",
    graphic: "case-spine",
    nextLabel: "Review responsibilities",
    dark: true,
  },
  {
    id: "assessor-role",
    number: 2,
    navLabel: "Ownership",
    eyebrow: "Roles and responsibilities",
    title: "Your responsibilities in Pipeline",
    lead: "Assessors verify the source material, complete and sign the assessment, and submit a clinical recommendation. An authorized administrator records the admission decision.",
    graphic: "ownership",
    nextLabel: "See where work appears",
  },
  {
    id: "find-work",
    number: 3,
    navLabel: "Start",
    eyebrow: "Home · Calendar · Workspace",
    title: "Where to start each day",
    lead: "Home lists work requiring attention. Calendar shows scheduled assessments. The workspace contains the referral record and its activity.",
    graphic: "workday",
    nextLabel: "Verify the intake",
  },
  {
    id: "verify-sources",
    number: 4,
    navLabel: "Prepare",
    eyebrow: "Before the interview",
    title: "Verify the intake and its sources",
    lead: "Verify inherited intake against the packet before the interview. Preserve disagreements between sources and leave unsupported facts unknown.",
    graphic: "source-stack",
    nextLabel: "Review the interview",
  },
  {
    id: "structured-interview",
    number: 5,
    navLabel: "Interview",
    eyebrow: "During the assessment",
    title: "Use the section map to stay oriented",
    lead: "The assessment contains twelve sections grouped into four phases. Conditional questions appear only when the client’s answers make them relevant.",
    graphic: "assessment-map",
    nextLabel: "Compare documentation",
  },
  {
    id: "write-evidence",
    number: 6,
    navLabel: "Document",
    eyebrow: "Documenting the interview",
    title: "Write evidence—not polished guesses",
    lead: "A useful note says who reported the fact, what is known now, what conflicts, and what must happen next.",
    graphic: "note-comparison",
    nextLabel: "Review and sign",
    action: {
      label: "Practice this note",
      href: "/note-lab/practice?from=demo",
    },
  },
  {
    id: "review-and-sign",
    number: 7,
    navLabel: "Recommend",
    eyebrow: "Completing assessor work",
    title: "Review, sign, then submit your recommendation",
    lead: "Resolve missing answers and conflicts before signing. The signature locks the assessment; your recommendation then becomes clinical input to the administrator’s decision.",
    graphic: "decision-path",
    nextLabel: "See the handoff",
  },
  {
    id: "accepted-handoff",
    number: 8,
    navLabel: "Impact",
    eyebrow: "After an accepted decision",
    title: "How the assessment supports the receiving team",
    lead: "Verified findings can populate Chart and Meet the Client. Authorized staff review the receiving summary and approved attachments before sending.",
    graphic: "handoff",
    nextLabel: "Start the referral journey",
  },
] as const;

const demoChapters: readonly DemoChapter[] = [
  {
    number: 1,
    title: "Create the referral",
    instruction: "Start with the referral packet and create the intake record.",
    actions: ["Attach the source packet", "Verify client and referral information", "Set the community, owner, and medication context"],
    completeWhen: "The referral has a source packet, verified intake facts, and an owner.",
    scenarioId: "new-intake",
    guide: { tutorialId: "create-referral", stepId: "referral-packet" },
  },
  {
    number: 2,
    title: "Review the intake",
    instruction: "Confirm that the assigned referral is ready for assessment work.",
    actions: ["Verify identity, community, source, and owner", "Review packet status and missing documents", "Separate supplied medication facts from unresolved questions"],
    completeWhen: "Identity, ownership, packet status, and follow-up needs are clear.",
    scenarioId: "assessment-preparation",
    workspaceStage: "intake",
  },
  {
    number: 3,
    title: "Schedule the assessment",
    instruction: "Set the appointment, save it, then open the assessment.",
    actions: ["Set the date, time, duration, and method", "Add the Zoom link or location", "Select Schedule assessment and continue to Client & referral"],
    completeWhen: "The appointment is saved and section 1 of the assessment is open.",
    scenarioId: "assessment-preparation",
    guide: { tutorialId: "start-assessment", stepId: "assessment-schedule-fields" },
  },
  {
    number: 4,
    title: "Complete the interview",
    instruction: "Work through the assessment sections and document what was observed, reported, and reviewed.",
    actions: ["Move through each section in order", "Answer conditional follow-up questions when they appear", "Use Answer format only when you need help structuring a narrative"],
    completeWhen: "Required sections are complete and autosave shows no pending changes.",
    scenarioId: "assessment-interview",
    guide: { tutorialId: "complete-assessment", stepId: "assessment-section-identity" },
  },
  {
    number: 5,
    title: "Sign and recommend",
    instruction: "Finish the assessor-owned work before the referral moves to authorized decision review.",
    actions: ["Confirm saved status and resolve required gaps", "Sign the completed assessment", "Submit a clinical recommendation with a clear rationale"],
    completeWhen: "The assessment is signed and the recommendation is recorded separately from the final decision.",
    scenarioId: "assessment-complex",
  },
  {
    number: 6,
    title: "Understand the downstream handoff",
    instruction: "See how an accepted referral becomes a receiving-community record after the administrator's decision.",
    actions: ["Review the assessment-derived Chart", "Check the Meet the Client summary", "Identify the authorized handoff staff and approved attachments"],
    completeWhen: "You can explain what your assessment supplies downstream and where your assessor responsibility ends.",
    destination: "handoff",
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
  const [chapterIndex, setChapterIndex] = useState(0);
  const [referrals, setReferrals] = useState<DemoReferralSummary[]>([]);
  const [loadingCases, setLoadingCases] = useState(true);
  const [launchingId, setLaunchingId] = useState<PipelineDemoScenarioId | null>(null);
  const [error, setError] = useState("");
  const casesLoadedRef = useRef(false);
  const canWrite = environment.writable && actor.roles.some((role) => ["admin", "assessment_coordinator", "reviewer"].includes(role));
  const chapter = demoChapters[chapterIndex] ?? demoChapters[0];

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
    guide?: DemoChapter["guide"],
    workspaceStage: DemoChapter["workspaceStage"] = "assessment",
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
      const referralResult = await fetchPipelineJson<{ referral: Referral }>("/api/referrals", {
        method: "POST",
        body: JSON.stringify({
          referral: buildPipelineDemoReferral(scenario, assessor.display_name),
          assignee_id: assessor.principal_id,
          client_mutation_id: demoMutationId(`referral-${scenario.id}`),
        }),
      });
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
            <DemoTab active={view === "journey"} label="Referral journey" onClick={() => selectView("journey")} />
            <DemoTab active={view === "lab"} label="Practice cases" onClick={() => selectView("lab")} />
            <DemoTab active={view === "handoff"} label="Meet the Client" onClick={() => selectView("handoff")} />
          </div>
        </header>

        {error ? <div role="alert" className="shrink-0 border-l-4 border-[#b95649] bg-[#fff2ef] px-4 py-3 text-[11px] font-bold text-[#8c3d33]">{error}</div> : null}
        {!environment.writable && (view === "journey" || view === "lab") ? <div className="shrink-0 border-b border-[#dfca97] bg-[#fff9e9] px-4 py-3 text-[11px] leading-5 text-[#765817]"><strong>Practice records are read only.</strong> {environment.reason}</div> : null}

        <div className={`min-h-0 flex-1 ${view === "presentation" || view === "journey" ? "overflow-hidden" : "overflow-y-auto"}`}>
          {view === "presentation" ? (
            <PresentationDeck
              initialSlideId={initialPresentationSlide}
              onStartJourney={() => selectView("journey")}
              onSlideChange={() => scrollContainerRef.current?.scrollTo({ top: 0 })}
            />
          ) : view === "journey" ? (
            <ReferralJourney
              chapter={chapter}
              chapterIndex={chapterIndex}
              launchingId={launchingId}
              canWrite={canWrite}
              onSelect={setChapterIndex}
              onLaunch={(selected) => {
                if (selected.destination) {
                  selectView(selected.destination);
                  return;
                }
                const scenario = selected.scenarioId ? getPipelineDemoScenario(selected.scenarioId) : null;
                if (scenario) void launchScenario(scenario, selected.guide, selected.workspaceStage);
              }}
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
            <MeetClientHandoffDemo preparedBy={actor.name} />
          )}
        </div>
      </div>
    </main>
  );
}

function PresentationDeck({
  initialSlideId,
  onStartJourney,
  onSlideChange,
}: {
  initialSlideId?: string;
  onStartJourney: () => void;
  onSlideChange: () => void;
}) {
  const [slideIndex, setSlideIndex] = useState(() => {
    const requestedIndex = presentationSlides.findIndex((slide) => slide.id === initialSlideId);
    return requestedIndex >= 0 ? requestedIndex : 0;
  });
  const slide = presentationSlides[slideIndex] ?? presentationSlides[0];
  const isLast = slideIndex === presentationSlides.length - 1;

  const selectSlide = useCallback((index: number) => {
    setSlideIndex(Math.max(0, Math.min(presentationSlides.length - 1, index)));
    onSlideChange();
  }, [onSlideChange]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "ArrowRight") selectSlide(slideIndex + 1);
      else if (event.key === "ArrowLeft") selectSlide(slideIndex - 1);
      else if (event.key === "Home") selectSlide(0);
      else if (event.key === "End") selectSlide(presentationSlides.length - 1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectSlide, slideIndex]);

  return (
    <section data-demo-surface="presentation" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white">
      <header className="shrink-0 border-b border-[#d8dfdc] bg-white">
        <div className="flex items-center justify-between gap-4 px-4 pb-2 pt-3 sm:px-6 lg:px-10">
          <div className="text-[10px] font-black uppercase tracking-[0.1em] text-[#52605a]">Supervisor-led assessor orientation <span className="text-[#0f8b73]">· 4 minutes</span></div>
          <div className="hidden text-[10px] font-semibold text-[#7a8580] sm:block">Use ← → to move</div>
        </div>
        <nav aria-label="Presentation slides" className="overflow-x-auto px-2 pb-2 sm:px-4 lg:px-8">
          <div className="flex min-w-max items-center gap-1">
          {presentationSlides.map((item, index) => (
            <button key={item.number} type="button" onClick={() => selectSlide(index)} aria-current={index === slideIndex ? "step" : undefined} className={`group flex h-10 min-w-[104px] items-center gap-2 border-b-2 px-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-1 ${index === slideIndex ? "border-[#0f8b73] bg-[#f1f7f5] text-[#183a31]" : "border-transparent text-[#717c77] hover:bg-[#f6f8f7] hover:text-[#29332f]"}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-black tabular-nums ${index === slideIndex ? "bg-[#0f8b73] text-white" : "border border-[#c7d0cc] bg-white text-[#6a756f] group-hover:border-[#8cab9f]"}`}>{item.number}</span>
              <span className="text-[10px] font-black">{item.navLabel}</span>
            </button>
          ))}
          </div>
        </nav>
      </header>
      <article key={slide.id} aria-label={`Presentation slide ${slide.number}`} className={`pipeline-presentation-enter min-h-0 flex-1 overflow-y-auto ${slide.dark ? "bg-[#143d34] text-white" : "bg-[#fbfcfb] text-[#17221e]"}`}>
        <div className="mx-auto grid min-h-full w-full max-w-[1500px] content-start gap-7 px-5 py-8 sm:px-8 sm:py-10 lg:grid-cols-[minmax(360px,0.85fr)_minmax(480px,1.15fr)] lg:items-center lg:gap-10 lg:px-10 xl:px-12">
          <div className="min-w-0">
            <div className={`text-[11px] font-black uppercase tracking-[0.12em] ${slide.dark ? "text-[#8be0c5]" : "text-[#0c705f]"}`}>{slide.eyebrow}</div>
            <h2 className="mt-4 max-w-[720px] text-[36px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[44px] lg:text-[46px]">{slide.title}</h2>
            <p className={`mt-5 max-w-[660px] text-[16px] font-medium leading-7 sm:text-[18px] sm:leading-8 ${slide.dark ? "text-[#d2e5df]" : "text-[#52605a]"}`}>{slide.lead}</p>
            {slide.action ? <Link href={toPipelinePath(slide.action.href)} className={`mt-6 inline-flex h-11 items-center gap-2 px-5 text-[12px] font-black outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${slide.dark ? "bg-white text-[#143d34] focus-visible:ring-white focus-visible:ring-offset-[#143d34]" : "bg-[#0f8b73] text-white hover:bg-[#0b6d5b] focus-visible:ring-[#0f8b73]"}`}>{slide.action.label}<ArrowRight size={15} aria-hidden="true" /></Link> : null}
          </div>
          <PresentationVisual slide={slide} />
        </div>
      </article>
      <p className="sr-only" aria-live="polite">Slide {slide.number} of {presentationSlides.length}: {slide.title}</p>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[#d8dfdc] bg-white px-4 py-3 sm:px-8 lg:px-10">
        <button type="button" disabled={slideIndex === 0} onClick={() => selectSlide(slideIndex - 1)} className="inline-flex h-10 items-center gap-2 px-2 text-[11px] font-bold text-[#5d6863] outline-none hover:text-[#17221e] focus-visible:ring-2 focus-visible:ring-[#0f8b73] disabled:invisible"><ArrowLeft size={14} aria-hidden="true" />Previous</button>
        <div className="hidden items-center gap-1.5 sm:flex" aria-hidden="true">{presentationSlides.map((item, index) => <span key={item.id} className={`h-1.5 transition-[width,background-color] ${index === slideIndex ? "w-8 bg-[#0f8b73]" : "w-1.5 bg-[#cbd4d0]"}`} />)}</div>
        {isLast ? <button type="button" onClick={onStartJourney} className="inline-flex h-10 items-center gap-2 bg-[#0f8b73] px-5 text-[11px] font-black text-white outline-none hover:bg-[#0b6d5b] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2">Start the referral journey<ArrowRight size={14} aria-hidden="true" /></button> : <button type="button" onClick={() => selectSlide(slideIndex + 1)} className="inline-flex h-10 items-center gap-2 bg-[#111111] px-5 text-[11px] font-black text-white outline-none hover:bg-[#26302c] focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2">{slide.nextLabel}<ArrowRight size={14} aria-hidden="true" /></button>}
      </footer>
    </section>
  );
}

function PresentationVisual({ slide }: { slide: PresentationSlide }) {
  if (slide.graphic === "case-spine") return <CaseSpineVisual />;
  if (slide.graphic === "ownership") return <OwnershipVisual />;
  if (slide.graphic === "workday") return <WorkdayVisual />;
  if (slide.graphic === "source-stack") return <SourceStackVisual />;
  if (slide.graphic === "assessment-map") return <AssessmentMapVisual />;
  if (slide.graphic === "note-comparison") return <NoteComparisonVisual />;
  if (slide.graphic === "decision-path") return <DecisionPathVisual />;
  return <HandoffVisual />;
}

function CaseSpineVisual() {
  const stages = [
    { label: "Referral packet", detail: "What arrived", icon: FileText },
    { label: "Assessment", detail: "What you verified", icon: ClipboardCheck },
    { label: "Recommendation", detail: "What you concluded", icon: FileCheck2 },
    { label: "Care handoff", detail: "What the next team needs", icon: ShieldCheck },
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
      <div className="flex items-center gap-3 border-t border-white/15 px-5 py-4 text-[12px] font-bold text-white sm:px-6"><Check size={16} className="text-[#8be0c5]" aria-hidden="true" />The packet, assessment, recommendation, and handoff remain connected.</div>
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

function HandoffVisual() {
  const facts = [["Medication", "Two missed evening doses · verify regimen"], ["Daily living", "Independent mobility · bathing support"], ["Support", "Quiet setting helps during escalation"]] as const;
  return (
    <section aria-label="Assessment to care handoff lineage" className="grid min-w-0 gap-4 xl:grid-cols-[0.9fr_auto_1.1fr] xl:items-center">
      <div className="border border-[#cbd5d1] bg-white p-5 shadow-[0_18px_50px_rgba(28,50,42,0.08)]"><div className="flex items-center gap-3"><FileCheck2 size={20} className="text-[#0c705f]" aria-hidden="true" /><div><div className="text-[10px] font-black uppercase tracking-[0.09em] text-[#0c705f]">Signed assessment</div><div className="mt-1 text-[15px] font-black text-[#27352f]">Taylor Rivera</div></div></div><ul className="mt-5 space-y-3">{facts.map(([label, fact]) => <li key={label} className="border-t border-[#e0e5e2] pt-3"><div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#7a8580]">{label}</div><div className="mt-1 text-[11px] font-semibold leading-5 text-[#44514b]">{fact}</div></li>)}</ul></div>
      <div className="hidden h-10 w-10 items-center justify-center rounded-full bg-[#0f8b73] text-white xl:flex"><ArrowRight size={17} aria-hidden="true" /></div>
      <div className="overflow-hidden border border-[#9fc3b7] bg-[#153d34] text-white shadow-[0_24px_70px_rgba(21,61,52,0.18)]"><div className="border-b border-white/15 px-5 py-4"><div className="text-[9px] font-black uppercase tracking-[0.1em] text-[#8bd5bd]">Meet the Client</div><div className="mt-1 text-[19px] font-semibold">Receiving-team summary</div></div><div className="grid gap-px bg-white/10 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3"><HandoffCard label="Medication" value="Verification needed" /><HandoffCard label="Care needs" value="Bathing support" /><HandoffCard label="Helpful context" value="Quiet setting" /></div><div className="flex items-center gap-3 border-t border-white/15 px-5 py-4 text-[11px] font-bold text-[#d4e3de]"><ShieldCheck size={15} className="text-[#8bd5bd]" aria-hidden="true" />Receiving staff review before sending.</div></div>
    </section>
  );
}

function HandoffCard({ label, value }: { label: string; value: string }) {
  return <div className="bg-[#153d34] p-4"><div className="text-[8px] font-black uppercase tracking-[0.09em] text-[#8bd5bd]">{label}</div><div className="mt-2 text-[11px] font-bold leading-5 text-white">{value}</div></div>;
}

function ReferralJourney({ chapter, chapterIndex, launchingId, canWrite, onSelect, onLaunch }: { chapter: DemoChapter; chapterIndex: number; launchingId: PipelineDemoScenarioId | null; canWrite: boolean; onSelect: (index: number) => void; onLaunch: (chapter: DemoChapter) => void }) {
  const scenario = chapter.scenarioId ? getPipelineDemoScenario(chapter.scenarioId) : null;
  const disabled = Boolean(scenario && scenario.launch === "assessment" && !chapter.guide && !canWrite) || launchingId !== null;
  return (
    <section data-demo-surface="journey" className="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-white lg:grid-cols-[280px_minmax(0,1fr)] lg:grid-rows-none">
      <aside className="min-h-0 min-w-0 border-b border-[#d8dfdc] bg-[#eef3f1] lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <nav aria-label="Referral journey stages" className="flex w-full min-w-0 gap-1 overflow-x-auto p-2 lg:block">{demoChapters.map((item, index) => <button key={item.number} type="button" onClick={() => onSelect(index)} aria-current={index === chapterIndex ? "step" : undefined} className={`grid min-h-[62px] w-[190px] shrink-0 grid-cols-[30px_minmax(0,1fr)] items-center gap-3 border-l-[3px] px-3 py-2 text-left lg:mb-1 lg:w-full ${index === chapterIndex ? "border-l-[#0f8b73] bg-white" : "border-l-transparent hover:bg-white/70"}`}><span className={`flex h-7 w-7 items-center justify-center border text-[9px] font-black ${index === chapterIndex ? "border-[#0f8b73] bg-[#e4f3ee] text-[#0c705f]" : "border-[#bac8c3] bg-white text-[#58645f]"}`}>{item.number}</span><span className="text-[11px] font-black leading-4 text-[#27302c]">{item.title}</span></button>)}</nav>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-7 sm:px-8 lg:px-10 lg:py-8">
          <div className="text-[9px] font-black uppercase tracking-[0.12em] text-[#0c705f]">Step {chapter.number} of {demoChapters.length}</div>
          <h2 className="mt-2 max-w-[820px] text-[25px] font-semibold tracking-[-0.035em]">{chapter.title}</h2>
          <p className="mt-2 max-w-[820px] text-[12px] leading-6 text-[#56615d]">{chapter.instruction}</p>
          <div className="mt-6 max-w-[900px] border-y border-[#d9dfdc]">
            {chapter.actions.map((item, index) => <div key={item} className="grid grid-cols-[32px_minmax(0,1fr)] items-center border-b border-[#e1e5e3] py-4 last:border-b-0"><span className="text-[10px] font-black text-[#0c705f]">{index + 1}</span><span className="text-[11px] font-bold leading-5 text-[#39423e]">{item}</span></div>)}
          </div>
          <div className="mt-6 max-w-[900px] border-l-[3px] border-[#0f8b73] bg-[#f1f7f5] px-4 py-3"><span className="text-[9px] font-black uppercase tracking-[0.09em] text-[#0c705f]">Complete when</span><p className="mt-1 text-[11px] leading-5 text-[#40544d]">{chapter.completeWhen}</p></div>
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#d8dfdc] bg-[#fafcfb] px-5 py-3 sm:px-8">
          <button type="button" disabled={chapterIndex === 0} onClick={() => onSelect(Math.max(0, chapterIndex - 1))} className="inline-flex h-10 items-center gap-2 border border-[#cbd5d1] px-4 text-[10px] font-black disabled:invisible"><ArrowLeft size={13} /> Previous</button>
          <div className="flex gap-2">
            <button type="button" disabled={disabled} onClick={() => onLaunch(chapter)} className="inline-flex h-10 items-center gap-2 bg-[#0f8b73] px-5 text-[10px] font-black text-white hover:bg-[#0b6d5b] disabled:bg-[#aeb9b5]"><Play size={13} />{launchingId === chapter.scenarioId ? "Preparing..." : chapter.destination === "handoff" ? "Open handoff preview" : chapter.guide ? "Open guided practice" : "Open practice record"}</button>
            {chapterIndex < demoChapters.length - 1 ? <button type="button" onClick={() => onSelect(chapterIndex + 1)} className="inline-flex h-10 items-center gap-2 bg-[#111111] px-4 text-[10px] font-black text-white">Next <ArrowRight size={13} /></button> : null}
          </div>
        </footer>
      </div>
    </section>
  );
}

function ScenarioLab({ referrals, loading, launchingId, canWrite, onLaunch, onOpen }: { referrals: DemoReferralSummary[]; loading: boolean; launchingId: PipelineDemoScenarioId | null; canWrite: boolean; onLaunch: (scenario: PipelineDemoScenario) => void; onOpen: (referral: DemoReferralSummary) => void }) {
  return (
    <section data-demo-surface="practice" className="bg-white">
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

function demoReferralRoute(referralId: number, workspaceStage: DemoChapter["workspaceStage"] = "assessment") {
  return toPipelinePath(`/?view=referrals&screen=packet&referralId=${referralId}&workspaceStage=${workspaceStage}&demo=1`);
}

function navigateWithoutDemoRecord(scenario: PipelineDemoScenario, guide?: DemoChapter["guide"]) {
  if (scenario.launch === "new_referral") {
    if (guide) stageOperatorGuideForNavigation(guide.tutorialId, guide.stepId);
    window.location.assign(toPipelinePath(`/?view=referrals&screen=packet&draftId=${crypto.randomUUID()}&demoScenario=${scenario.id}`));
    return true;
  }
  if (!guide) return false;

  stageOperatorGuideForNavigation(guide.tutorialId, guide.stepId);
  const trainingAssessment = scenario.assessmentState === "unscheduled" ? "schedule" : "interview";
  const assessmentSection = trainingAssessment === "interview" ? "&assessmentSection=identity" : "";
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
