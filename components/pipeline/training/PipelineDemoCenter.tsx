"use client";

import {
  ArrowLeft,
  ArrowRight,
  ClipboardCheck,
  ExternalLink,
  Play,
  RefreshCcw,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { startTransition, useEffect, useRef, useState } from "react";

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
import MeetClientHandoffDemo from "@/components/pipeline/training/MeetClientHandoffDemo";

type DemoActor = {
  id: string;
  name: string;
  email: string;
  roles: readonly string[];
};

type DemoReferralSummary = Pick<Referral, "id" | "name" | "community" | "tags" | "createdAt">;
type DemoView = "presentation" | "journey" | "lab" | "handoff";

type PresentationSlide = {
  id: string;
  number: number;
  title: string;
  points: readonly string[];
  sections?: readonly string[];
  rule?: string;
  graphic?: "assignments";
  screenshots?: readonly PresentationScreenshot[];
  action?: {
    label: string;
    href: string;
  };
};

type PresentationScreenshot = {
  src: string;
  alt: string;
  label: string;
  caption: string;
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
    id: "assigned-work",
    number: 1,
    title: "Review your assigned work",
    points: [
      "Start on Home. It shows the referrals, drafts, and appointments assigned to you.",
      "Open an existing draft instead of creating the referral again.",
      "Check today's work and upcoming appointments before opening a workspace.",
    ],
    graphic: "assignments",
  },
  {
    id: "open-workspace",
    number: 2,
    title: "Open the workspace",
    points: [
      "Confirm the client, assigned assessor, community, and current stage.",
      "Use Files for source documents and Activity for the change history.",
      "Add later documents to this same workspace so the record stays together.",
    ],
    screenshots: [{
      src: "/training/presentation/intake-workspace.png",
      alt: "Synthetic Pipeline intake workspace with the referral packet and workspace navigation visible.",
      label: "Referral workspace",
      caption: "One workspace holds the source packet, intake facts, assessment, files, and activity.",
    }],
  },
  {
    id: "review-intake",
    number: 3,
    title: "Verify the intake",
    points: [
      "Check identity, referral source, contacts, prior setting, community, and medications against the packet.",
      "Correct inherited information in Intake before starting the assessment.",
      "Mark missing or conflicting information. Do not guess.",
    ],
    screenshots: [{
      src: "/training/presentation/intake-review.png",
      alt: "Synthetic Pipeline intake workspace populated with reviewed referral and medication information.",
      label: "Intake review",
      caption: "Verified intake facts carry forward while missing and conflicting source information stays visible.",
    }],
  },
  {
    id: "schedule-assessment",
    number: 4,
    title: "Schedule the assessment",
    points: [
      "Set the date, time, duration, and method.",
      "Add the Zoom link, location, or appointment detail, then save.",
      "Confirm it appears on your calendar. Reschedule or record a no-show without changing the referral outcome.",
    ],
    screenshots: [
      {
        src: "/training/presentation/assessment-schedule.png",
        alt: "Synthetic Pipeline assessment scheduling dialog with date, duration, method, and location fields.",
        label: "Schedule",
        caption: "The appointment remains attached to the referral and assigned assessor.",
      },
      {
        src: "/training/presentation/assessor-calendar.png",
        alt: "Synthetic Pipeline team calendar showing a scheduled assessment and ready-to-schedule queue.",
        label: "Calendar",
        caption: "The saved appointment appears in the assessor-scoped calendar.",
      },
    ],
  },
  {
    id: "open-assessment",
    number: 5,
    title: "Open the assessment",
    points: [
      "Review the inherited client, referral, placement, and medication information.",
      "Complete all 12 sections. You can return directly to any unfinished section.",
      "Keep client report, collateral information, records, and assessor observations distinguishable.",
    ],
    sections: [
      "Client & referral",
      "Placement",
      "History",
      "Clinical",
      "Function",
      "Legal",
      "Medication",
      "Substance use",
      "Behavior & safety",
      "Physical health",
      "Support & goals",
      "Review",
    ],
    screenshots: [{
      src: "/training/presentation/assessment-guided.png",
      alt: "Synthetic Pipeline assessment with section navigation, interview fields, progress, and guided tutorial visible.",
      label: "Full assessment",
      caption: "The section rail, inherited context, conditional questions, and saved progress remain together.",
    }],
  },
  {
    id: "document-interview",
    number: 6,
    title: "Complete each section",
    points: [
      "Answer conditional follow-up questions only when they appear.",
      "Write each finding in the section where it belongs.",
      "Use Answer Help when a narrative field needs structure or an example.",
    ],
  },
  {
    id: "practice-language",
    number: 7,
    title: "Practice in Notes Lab",
    points: [
      "Practice the same assessment fields with a synthetic client.",
      "Use Answer Help only when you need it.",
      "Return to this presentation when you finish.",
    ],
    action: {
      label: "Open Assessment Notes Lab",
      href: "/note-lab/practice?from=demo",
    },
  },
  {
    id: "review-and-sign",
    number: 8,
    title: "Review and sign",
    points: [
      "Confirm autosave has finished.",
      "Review missing required answers, conflicts, sources, and the recommendation.",
      "Sign only when the assessment is complete. Add later information as an addendum.",
    ],
    screenshots: [{
      src: "/training/presentation/assessment-review.png",
      alt: "Synthetic Pipeline assessment review section showing saved status, required-field progress, and final narrative fields.",
      label: "Final review",
      caption: "Saved status and unresolved required fields remain visible before signature.",
    }],
  },
  {
    id: "submit-assessment",
    number: 9,
    title: "Submit for supervisor review",
    points: [
      "The supervisor reviews the signed assessment and returns anything that needs correction.",
      "After an accepted decision, verified data feeds the Chart and Meet the Client handoff.",
      "Files remain in the workspace and Activity records who changed the record and when.",
    ],
    rule: "The assessor documents and signs the assessment. The supervisor makes the admission decision.",
    screenshots: [{
      src: "/training/presentation/meet-client-handoff.png",
      alt: "Synthetic Meet the Client handoff preview created from verified intake and signed assessment information.",
      label: "Downstream record",
      caption: "Accepted referrals use the verified record for the Chart, receiving summary, and approved packet files.",
    }],
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
    title: "Review for decision",
    instruction: "A supervisor reviews the completed assessment before the admission decision.",
    actions: ["Review evidence, conflicts, and missing information", "Return unclear or incomplete work for correction", "Confirm the recommendation and open requirements"],
    completeWhen: "The assessment is ready for an authorized admission decision.",
    scenarioId: "assessment-complex",
  },
  {
    number: 6,
    title: "Prepare the handoff",
    instruction: "For an accepted referral, review the receiving-community information and approved files.",
    actions: ["Review the complete Chart", "Check the Meet the Client summary", "Confirm the admission packet attachments before sending"],
    completeWhen: "The receiving team has the approved summary and admission files.",
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
  const canWrite = environment.writable && actor.roles.some((role) => ["admin", "assessment_coordinator", "reviewer"].includes(role));
  const chapter = demoChapters[chapterIndex] ?? demoChapters[0];
  const showingHandoff = view === "handoff";

  const selectView = (nextView: DemoView) => {
    setView(nextView);
    window.requestAnimationFrame(() => scrollContainerRef.current?.scrollTo({ top: 0, behavior: "auto" }));
  };

  useEffect(() => {
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
  }, []);

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
      const referralResult = await fetchPipelineJson<{ referral: Referral }>("/api/referrals", {
        method: "POST",
        body: JSON.stringify({
          referral: buildPipelineDemoReferral(scenario, actor.name),
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
    <main ref={scrollContainerRef} data-demo-center="true" className={`h-full min-h-0 overflow-y-auto text-[#171a18] ${showingHandoff ? "bg-white" : "bg-[#f4f7f5]"}`}>
      <div className={`mx-auto w-full pb-14 ${showingHandoff ? "max-w-[1320px] px-4 pt-3 sm:px-6 lg:px-8" : "max-w-[1540px] px-4 pt-5 sm:px-6 lg:px-8 lg:pt-7"}`}>
        <header className="border-b border-[#d8dfdc] bg-white">
          <div className={`flex min-w-0 items-end overflow-x-auto ${showingHandoff ? "gap-1 px-0" : "bg-[#edf2f0] px-3 pt-2"}`} role="tablist" aria-label="Demo Center sections">
            <DemoTab active={view === "presentation"} label="Presentation" onClick={() => selectView("presentation")} />
            <DemoTab active={view === "journey"} label="Referral journey" onClick={() => selectView("journey")} />
            <DemoTab active={view === "lab"} label="Practice cases" onClick={() => selectView("lab")} />
            <DemoTab active={view === "handoff"} label="Meet the Client" onClick={() => selectView("handoff")} />
          </div>
        </header>

        {error ? <div role="alert" className="mt-4 border-l-4 border-[#b95649] bg-[#fff2ef] px-4 py-3 text-[11px] font-bold text-[#8c3d33]">{error}</div> : null}
        {!environment.writable && (view === "journey" || view === "lab") ? <div className="mt-4 border border-[#dfca97] bg-[#fff9e9] px-4 py-3 text-[11px] leading-5 text-[#765817]"><strong>Practice records are read only.</strong> {environment.reason}</div> : null}

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
  const hasSupportingVisual = Boolean(slide.graphic || slide.screenshots?.length);

  useEffect(() => {
    for (const presentationSlide of presentationSlides) {
      for (const screenshot of presentationSlide.screenshots ?? []) {
        const preload = new window.Image();
        preload.src = toPipelinePath(screenshot.src);
      }
    }
  }, []);

  const selectSlide = (index: number) => {
    setSlideIndex(Math.max(0, Math.min(presentationSlides.length - 1, index)));
    onSlideChange();
  };

  return (
    <section className="mt-3 grid min-h-[620px] min-w-0 overflow-hidden border border-[#cbd5d1] bg-white lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="border-b border-[#d8dfdc] bg-[#eef3f1] p-3 lg:max-h-[760px] lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-4">
        <nav aria-label="Presentation slides" className="flex gap-1 overflow-x-auto lg:block">
          {presentationSlides.map((item, index) => (
            <button key={item.number} type="button" onClick={() => selectSlide(index)} aria-current={index === slideIndex ? "step" : undefined} className={`grid min-h-[50px] w-[176px] shrink-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-2 border-l-2 px-3 text-left lg:mb-1 lg:w-full ${index === slideIndex ? "border-[#0f8b73] bg-white text-[#20302b]" : "border-transparent text-[#63706b] hover:bg-white/70"}`}>
              <span className="text-[10px] font-bold tabular-nums">{String(item.number).padStart(2, "0")}</span>
              <span className="text-[11px] font-bold leading-4">{item.title}</span>
            </button>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col">
        <article aria-label={`Presentation slide ${slide.number}`} className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:px-10 lg:py-9 xl:px-12">
          <div className="text-[10px] font-bold uppercase tracking-[0.09em] text-[#0c705f]">Step {slide.number} of {presentationSlides.length}</div>
          <h2 className="mt-2 max-w-[900px] text-[28px] font-semibold leading-9 tracking-[-0.035em] text-[#1c2421] sm:text-[32px] sm:leading-[38px]">{slide.title}</h2>
          <div className={hasSupportingVisual ? "mt-6 grid min-w-0 items-start gap-7 lg:grid-cols-[minmax(250px,0.72fr)_minmax(440px,1.28fr)]" : "mt-6 max-w-[920px]"}>
            <div className="min-w-0">
              <ul className="border-y border-[#d9dfdc]">
                {slide.points.map((point, index) => <li key={point} className="grid grid-cols-[28px_minmax(0,1fr)] items-start border-b border-[#e1e5e3] py-3 last:border-b-0"><span className="pt-0.5 text-[10px] font-bold tabular-nums text-[#0c705f]">{index + 1}</span><span className="text-[12px] font-semibold leading-5 text-[#39423e]">{point}</span></li>)}
              </ul>
              {slide.sections ? <ol className="mt-5 grid grid-cols-2 border-t border-[#d5ddda]">{slide.sections.map((section, index) => <li key={section} className="flex min-h-9 items-center gap-2 border-b border-[#e0e5e2] py-1.5 pr-2"><span className="text-[8px] font-black tabular-nums text-[#0c705f]">{String(index + 1).padStart(2, "0")}</span><span className="text-[10px] font-bold leading-4 text-[#34413c]">{section}</span></li>)}</ol> : null}
              {slide.rule ? <p className="mt-5 border-l-[3px] border-[#0f8b73] bg-[#f0f6f4] px-4 py-3 text-[11px] font-bold leading-5 text-[#355047]">{slide.rule}</p> : null}
              {slide.action ? <Link href={toPipelinePath(slide.action.href)} className="mt-5 inline-flex h-11 items-center bg-[#0f8b73] px-5 text-[11px] font-bold text-white hover:bg-[#0b6d5b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2">{slide.action.label}</Link> : null}
            </div>
            {hasSupportingVisual ? <PresentationVisual key={slide.number} slide={slide} /> : null}
          </div>
        </article>
        <footer className="flex items-center justify-between gap-3 border-t border-[#d8dfdc] bg-[#fafcfb] px-5 py-4 sm:px-8">
          <button type="button" disabled={slideIndex === 0} onClick={() => selectSlide(slideIndex - 1)} className="inline-flex h-10 items-center px-2 text-[10px] font-bold text-[#5d6863] disabled:invisible">Previous</button>
          {isLast ? <button type="button" onClick={onStartJourney} className="inline-flex h-10 items-center bg-[#0f8b73] px-5 text-[10px] font-bold text-white hover:bg-[#0b6d5b]">Start the referral journey</button> : <button type="button" onClick={() => selectSlide(slideIndex + 1)} className="inline-flex h-10 items-center bg-[#111111] px-5 text-[10px] font-bold text-white">Next</button>}
        </footer>
      </div>
    </section>
  );
}

function PresentationVisual({ slide }: { slide: PresentationSlide }) {
  if (slide.screenshots?.length) return <PresentationScreenshots screenshots={slide.screenshots} />;
  if (slide.graphic) return <AssignedWorkExample />;
  return null;
}

function PresentationScreenshots({ screenshots }: { screenshots: readonly PresentationScreenshot[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = screenshots[selectedIndex] ?? screenshots[0];

  return (
    <figure className="min-w-0 border border-[#cbd5d1] bg-white">
      {screenshots.length > 1 ? (
        <div role="tablist" aria-label="Slide screenshots" className="flex min-h-10 border-b border-[#d7dfdb] bg-[#f4f7f5]">
          {screenshots.map((screenshot, index) => (
            <button key={screenshot.src} type="button" role="tab" aria-selected={index === selectedIndex} onClick={() => setSelectedIndex(index)} className={`border-b-2 px-4 text-[10px] font-bold ${index === selectedIndex ? "border-[#0f8b73] bg-white text-[#1f342d]" : "border-transparent text-[#6a746f] hover:text-[#26332e]"}`}>{screenshot.label}</button>
          ))}
        </div>
      ) : null}
      <div className="relative aspect-video overflow-hidden bg-[#e6ece9]">
        <Image
          key={selected.src}
          src={toPipelinePath(selected.src)}
          alt={selected.alt}
          fill
          unoptimized
          loading="eager"
          sizes="(max-width: 1023px) 100vw, 60vw"
          className="object-cover object-top"
        />
      </div>
      <figcaption className="border-t border-[#d7dfdb] px-3 py-2.5 text-[10px] font-medium leading-4 text-[#56615c]">{selected.caption}</figcaption>
    </figure>
  );
}

function AssignedWorkExample() {
  return (
    <section aria-label="Assessor assigned work" className="border border-[#cbd5d1] bg-white">
      <div className="border-b border-[#d7dfdb] px-4 py-3 text-[11px] font-bold text-[#27322d]">Assigned work</div>
      <div className="divide-y divide-[#dfe5e2] px-4">
        <AssignmentRow name="Jordan Practice" detail="Intake review due today" status="Needs review" />
        <AssignmentRow name="Taylor Example" detail="Assessment tomorrow at 10:00 AM" status="Scheduled" />
        <AssignmentRow name="Morgan Training" detail="Assessment draft saved" status="In progress" />
      </div>
    </section>
  );
}

function AssignmentRow({ name, detail, status }: { name: string; detail: string; status: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 bg-white py-3">
      <div className="min-w-0"><div className="truncate text-[11px] font-bold text-[#27322d]">{name}</div><div className="mt-1 truncate text-[9px] font-medium text-[#68736e]">{detail}</div></div>
      <span className="text-[9px] font-bold text-[#0c705f]">{status}</span>
    </div>
  );
}

function ReferralJourney({ chapter, chapterIndex, launchingId, canWrite, onSelect, onLaunch }: { chapter: DemoChapter; chapterIndex: number; launchingId: PipelineDemoScenarioId | null; canWrite: boolean; onSelect: (index: number) => void; onLaunch: (chapter: DemoChapter) => void }) {
  const scenario = chapter.scenarioId ? getPipelineDemoScenario(chapter.scenarioId) : null;
  const disabled = Boolean(scenario && scenario.launch === "assessment" && !chapter.guide && !canWrite) || launchingId !== null;
  return (
    <section className="mt-5 grid min-h-[520px] min-w-0 overflow-hidden border border-[#cbd5d1] bg-white lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="min-w-0 border-b border-[#d8dfdc] bg-[#eef3f1] lg:border-b-0 lg:border-r">
        <nav aria-label="Referral journey stages" className="flex w-full min-w-0 gap-1 overflow-x-auto p-2 lg:block">{demoChapters.map((item, index) => <button key={item.number} type="button" onClick={() => onSelect(index)} aria-current={index === chapterIndex ? "step" : undefined} className={`grid min-h-[62px] w-[190px] shrink-0 grid-cols-[30px_minmax(0,1fr)] items-center gap-3 border-l-[3px] px-3 py-2 text-left lg:mb-1 lg:w-full ${index === chapterIndex ? "border-l-[#0f8b73] bg-white" : "border-l-transparent hover:bg-white/70"}`}><span className={`flex h-7 w-7 items-center justify-center border text-[9px] font-black ${index === chapterIndex ? "border-[#0f8b73] bg-[#e4f3ee] text-[#0c705f]" : "border-[#bac8c3] bg-white text-[#58645f]"}`}>{item.number}</span><span className="text-[11px] font-black leading-4 text-[#27302c]">{item.title}</span></button>)}</nav>
      </aside>
      <div className="flex min-w-0 flex-col">
        <div className="flex-1 px-5 py-7 sm:px-8 lg:px-10 lg:py-8">
          <div className="text-[9px] font-black uppercase tracking-[0.12em] text-[#0c705f]">Step {chapter.number} of {demoChapters.length}</div>
          <h2 className="mt-2 max-w-[820px] text-[25px] font-semibold tracking-[-0.035em]">{chapter.title}</h2>
          <p className="mt-2 max-w-[820px] text-[12px] leading-6 text-[#56615d]">{chapter.instruction}</p>
          <div className="mt-6 max-w-[900px] border-y border-[#d9dfdc]">
            {chapter.actions.map((item, index) => <div key={item} className="grid grid-cols-[32px_minmax(0,1fr)] items-center border-b border-[#e1e5e3] py-4 last:border-b-0"><span className="text-[10px] font-black text-[#0c705f]">{index + 1}</span><span className="text-[11px] font-bold leading-5 text-[#39423e]">{item}</span></div>)}
          </div>
          <div className="mt-6 max-w-[900px] border-l-[3px] border-[#0f8b73] bg-[#f1f7f5] px-4 py-3"><span className="text-[9px] font-black uppercase tracking-[0.09em] text-[#0c705f]">Complete when</span><p className="mt-1 text-[11px] leading-5 text-[#40544d]">{chapter.completeWhen}</p></div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d8dfdc] bg-[#fafcfb] px-5 py-4 sm:px-8">
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
    <section className="mt-5 border border-[#cbd5d1] bg-white">
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
