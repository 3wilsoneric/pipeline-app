"use client";

import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  FileText,
  ExternalLink,
  FlaskConical,
  FolderOpen,
  Home,
  Play,
  RefreshCcw,
  ShieldCheck,
  type LucideIcon,
  UserRound,
} from "lucide-react";
import Image from "next/image";
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
  number: number;
  title: string;
  summary: string;
  points: readonly string[];
  flow?: readonly string[];
  sections?: readonly string[];
  rule?: string;
  graphic?: "navigation" | "readiness" | "decision" | "evidence";
  screenshots?: readonly PresentationScreenshot[];
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
    number: 1,
    title: "Follow one referral",
    summary: "The workspace holds one referral episode. The client profile is the durable record for the person.",
    points: [
      "Create one workspace for each referral episode.",
      "Keep the packet, intake, assessment, decision, Chart, files, and activity connected to that workspace.",
      "Use the client profile when you need information that continues across referral episodes.",
    ],
    flow: ["Email received", "Referral created", "Packet review", "Assessment", "Post-assessment", "Accepted or declined"],
    rule: "The referral can close. The client record remains.",
  },
  {
    number: 2,
    title: "Know where to work",
    summary: "Each main screen answers a different question.",
    points: [
      "Home shows your assignments, drafts, upcoming assessments, and work that needs action.",
      "Workspaces holds every referral episode and lets you filter by month, community, owner, or stage.",
      "Calendar holds appointments and follow-up dates. Clients holds the durable profile for each person.",
      "Search gets you to a known workspace or client quickly; verify identity before changing anything.",
    ],
    graphic: "navigation",
  },
  {
    number: 3,
    title: "Create the referral once",
    summary: "Start with the source packet, then establish the identity and ownership of the work.",
    points: [
      "Upload the initial packet and supporting files at the top of Intake.",
      "Verify the name, date of birth, referral source, received date, county, and contacts.",
      "Set the community and owner, then enter the supplied medication information.",
      "If you stop, resume the saved draft from Home instead of starting another referral.",
    ],
    rule: "A late document belongs in the existing workspace. It does not create another referral.",
    screenshots: [{
      src: "/training/presentation/intake-workspace.png",
      alt: "Synthetic Pipeline intake workspace with the referral packet drop zone highlighted by the guided tutorial.",
      label: "Start in Intake",
      caption: "The packet drop and document checklist are at the top of the workspace.",
    }],
  },
  {
    number: 4,
    title: "Review the packet",
    summary: "Extraction proposes values. A person confirms what the record can actually support.",
    points: [
      "Compare each extracted value with its source before confirming it.",
      "Correct inaccurate values, preserve conflicting sources, and leave unsupported facts missing.",
      "Check required documents and create a requirement for anything still needed.",
      "Finish packet review only when identity, routing, medication context, and follow-up needs are clear.",
    ],
    rule: "Extraction can fill a blank. It cannot silently replace a human-confirmed value.",
    screenshots: [{
      src: "/training/presentation/intake-review.png",
      alt: "Synthetic Pipeline intake workspace populated with reviewed identity, routing, referral, and medication information.",
      label: "Confirm the chart",
      caption: "Reviewed source information remains visible beside document status and assignment.",
    }],
  },
  {
    number: 5,
    title: "Move it when it is ready",
    summary: "The lifecycle stage says where the referral is. Work queues say why it needs attention.",
    points: [
      "A workspace has one stage, but it may appear in several queues such as Assessment due, Missing documents, and Blocked.",
      "An owner is required before the referral workflow starts; an initial packet is required before packet review.",
      "Packet review must be complete before Assessment, and the assessment must be complete before Post-assessment.",
      "Requirements carry their own owner, due date, next action, evidence, and blocker state.",
    ],
    graphic: "readiness",
  },
  {
    number: 6,
    title: "Schedule the assessment",
    summary: "Schedule from the workspace or the Calendar queue, then confirm the event appears for the assigned assessor.",
    points: [
      "Set the date, time, duration, and method: Zoom, in person, phone, or record review.",
      "Add the Zoom link, location, or other appointment detail and check for conflicts.",
      "Use Calendar to reschedule or record a cancellation or no-show.",
      "Changing an appointment changes the schedule, not the referral outcome.",
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
    number: 7,
    title: "Complete the assessment",
    summary: "Verify inherited facts, then document the interview in the section where each finding belongs.",
    points: [
      "Use section navigation to move in order or return directly to a section that needs work.",
      "Conditional follow-up fields appear only when the preceding answer makes them relevant.",
      "Keep client report, collateral information, supplied records, and direct observation distinguishable.",
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
      label: "Work section by section",
      caption: "The left rail shows completion by section while the main area holds the current questions.",
    }],
  },
  {
    number: 8,
    title: "Save, review, and sign",
    summary: "Autosave protects the draft. Signature is the point at which the assessor closes the clinical record.",
    points: [
      "Use Answer Help only when a narrative field needs structure; it does not supply the clinical answer.",
      "Confirm section saves have completed before leaving, especially after reconnecting or resolving a version warning.",
      "Review missing and conflicting information before signing. Required omissions block signature.",
      "After signature, record later information as an addendum rather than rewriting the signed assessment.",
    ],
    screenshots: [{
      src: "/training/presentation/assessment-review.png",
      alt: "Synthetic Pipeline assessment review section showing saved status, required-field progress, and final narrative fields.",
      label: "Review before signature",
      caption: "Saved status and unresolved required fields stay visible before the assessor signs.",
    }],
  },
  {
    number: 9,
    title: "Supervisor review and decision",
    summary: "The assessor's recommendation informs the decision; it is not the decision itself.",
    points: [
      "The supervisor reviews the assessment, source evidence, conflicts, completeness, and community fit.",
      "Unclear or unsupported work returns for correction before disposition.",
      "A declined referral requires a recorded reason.",
      "An accepted referral must have an accepted decision and its blocking move-in requirements resolved.",
    ],
    graphic: "decision",
  },
  {
    number: 10,
    title: "Complete an accepted handoff",
    summary: "The signed assessment feeds the Chart, receiving-community summary, and EHR preparation.",
    points: [
      "Review the complete Chart against the verified intake and signed assessment.",
      "Prepare Meet the Client and select only the approved admission packet files.",
      "Verify the receiving community and authorized recipient before sending.",
      "Monitor EHR handoff separately: accepted, queued, sent, and failed are different states.",
    ],
    rule: "Do not treat a request to send as proof that delivery or EHR creation finished.",
    screenshots: [{
      src: "/training/presentation/meet-client-handoff.png",
      alt: "Synthetic Meet the Client handoff preview with client summary, care information, and four admission packet attachments.",
      label: "Verify the handoff",
      caption: "The receiving summary and selected admission files are reviewed together before delivery.",
    }],
  },
  {
    number: 11,
    title: "Keep the record trustworthy",
    summary: "Most recovery work belongs in the existing record, with the original evidence and activity preserved.",
    points: [
      "Verify identity before linking a client or editing a workspace; a similar name is not enough.",
      "Resolve newer-version warnings instead of overwriting another person's work.",
      "Keep missing, unreviewed, stale, conflicting, failed, and unassigned states visible.",
      "Use Files for evidence and Activity to see who changed the record and when.",
    ],
    rule: "When the presentation ends, use Referral journey to practice the same sequence in the application.",
    graphic: "evidence",
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

export default function PipelineDemoCenter({ actor, environment }: { actor: DemoActor; environment: PipelineDemoEnvironment }) {
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
        <header className={showingHandoff ? "border-b border-[#dfe4e1] bg-white" : "border border-[#c8d3cf] bg-white"}>
          {!showingHandoff ? <div className="px-5 py-4 sm:px-7">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 border border-[#9fc6b9] bg-[#eaf5f1] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.11em] text-[#0b6d5b]"><FlaskConical size={12} /> Synthetic data</span>
                <span className={`border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.09em] ${environment.writable ? "border-[#bdd4cc] bg-[#f3f8f6] text-[#42665b]" : "border-[#dfca97] bg-[#fff8e8] text-[#825a10]"}`}>{environment.label}</span>
              </div>
              <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.035em]">Pipeline training</h1>
            </div>
          </div> : null}
          <div className={`flex min-w-0 items-end overflow-x-auto ${showingHandoff ? "gap-1 bg-white px-0" : "border-t border-[#d8dfdc] bg-[#edf2f0] px-3 pt-2"}`} role="tablist" aria-label="Demo Center sections">
            <DemoTab active={view === "presentation"} label="Presentation" onClick={() => selectView("presentation")} />
            <DemoTab active={view === "journey"} label="Referral journey" onClick={() => selectView("journey")} />
            <DemoTab active={view === "lab"} label="Practice cases" onClick={() => selectView("lab")} />
            <DemoTab active={view === "handoff"} label="Meet the Client" onClick={() => selectView("handoff")} />
          </div>
        </header>

        {error ? <div role="alert" className="mt-4 border-l-4 border-[#b95649] bg-[#fff2ef] px-4 py-3 text-[11px] font-bold text-[#8c3d33]">{error}</div> : null}
        {!environment.writable ? <div className="mt-4 border border-[#dfca97] bg-[#fff9e9] px-4 py-3 text-[11px] leading-5 text-[#765817]"><strong>Synthetic writes are locked.</strong> {environment.reason}</div> : null}

        {view === "presentation" ? (
          <PresentationDeck
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
  onStartJourney,
  onSlideChange,
}: {
  onStartJourney: () => void;
  onSlideChange: () => void;
}) {
  const [slideIndex, setSlideIndex] = useState(0);
  const slide = presentationSlides[slideIndex] ?? presentationSlides[0];
  const isLast = slideIndex === presentationSlides.length - 1;
  const hasSupportingVisual = Boolean(slide.graphic || slide.screenshots?.length);
  const selectSlide = (index: number) => {
    setSlideIndex(Math.max(0, Math.min(presentationSlides.length - 1, index)));
    onSlideChange();
  };

  return (
    <section className="mt-5 grid min-h-[620px] min-w-0 overflow-hidden border border-[#cbd5d1] bg-white lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="border-b border-[#d8dfdc] bg-[#eef3f1] p-3 lg:max-h-[720px] lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-4">
        <nav aria-label="Presentation slides" className="flex gap-1 overflow-x-auto lg:block">
          {presentationSlides.map((item, index) => (
            <button key={item.number} type="button" onClick={() => selectSlide(index)} aria-current={index === slideIndex ? "step" : undefined} className={`grid min-h-[50px] w-[176px] shrink-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-2 border-l-2 px-3 text-left lg:mb-1 lg:w-full ${index === slideIndex ? "border-[#0f8b73] bg-white text-[#20302b]" : "border-transparent text-[#63706b] hover:bg-white/70"}`}>
              <span className="text-[9px] font-black tabular-nums">{String(item.number).padStart(2, "0")}</span>
              <span className="text-[11px] font-black leading-4">{item.title}</span>
            </button>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col">
        <article aria-label={`Presentation slide ${slide.number}`} className="flex flex-1 flex-col px-5 py-7 sm:px-8 lg:px-10 lg:py-9 xl:px-12">
          <div className="text-[9px] font-black uppercase tracking-[0.12em] text-[#0c705f]">{slide.number} / {presentationSlides.length}</div>
          <h2 className="mt-2 max-w-[900px] text-[30px] font-semibold leading-9 tracking-[-0.035em] text-[#1c2421] sm:text-[36px] sm:leading-[42px]">{slide.title}</h2>
          <p className="mt-3 max-w-[840px] text-[15px] font-medium leading-6 text-[#58645f]">{slide.summary}</p>
          {slide.flow ? <PresentationFlow steps={slide.flow} /> : null}
          <div className={hasSupportingVisual ? "mt-6 grid min-w-0 items-start gap-7 lg:grid-cols-[minmax(250px,0.72fr)_minmax(440px,1.28fr)]" : "mt-6 max-w-[920px]"}>
            <div className="min-w-0">
              <ul className="border-y border-[#d9dfdc]">
                {slide.points.map((point) => <li key={point} className="grid grid-cols-[20px_minmax(0,1fr)] items-start border-b border-[#e1e5e3] py-3 last:border-b-0"><span className="mt-[7px] h-1.5 w-1.5 bg-[#0f8b73]" aria-hidden="true" /><span className="text-[12px] font-semibold leading-5 text-[#39423e]">{point}</span></li>)}
              </ul>
              {slide.sections ? <ol className="mt-5 grid grid-cols-2 border-t border-[#d5ddda]">{slide.sections.map((section, index) => <li key={section} className="flex min-h-9 items-center gap-2 border-b border-[#e0e5e2] py-1.5 pr-2"><span className="text-[8px] font-black tabular-nums text-[#0c705f]">{String(index + 1).padStart(2, "0")}</span><span className="text-[10px] font-bold leading-4 text-[#34413c]">{section}</span></li>)}</ol> : null}
              {slide.rule ? <p className="mt-5 border-l-[3px] border-[#0f8b73] bg-[#f0f6f4] px-4 py-3 text-[11px] font-bold leading-5 text-[#355047]">{slide.rule}</p> : null}
            </div>
            {hasSupportingVisual ? <PresentationVisual key={slide.number} slide={slide} /> : null}
          </div>
        </article>
        <footer className="flex items-center justify-between gap-3 border-t border-[#d8dfdc] bg-[#fafcfb] px-5 py-4 sm:px-8">
          <button type="button" disabled={slideIndex === 0} onClick={() => selectSlide(slideIndex - 1)} className="inline-flex h-10 items-center gap-2 px-2 text-[10px] font-black text-[#5d6863] disabled:invisible"><ArrowLeft size={13} /> Previous</button>
          {isLast ? <button type="button" onClick={onStartJourney} className="inline-flex h-10 items-center gap-2 bg-[#0f8b73] px-5 text-[10px] font-black text-white hover:bg-[#0b6d5b]">Open referral journey <ArrowRight size={13} /></button> : <button type="button" onClick={() => selectSlide(slideIndex + 1)} className="inline-flex h-10 items-center gap-2 bg-[#111111] px-5 text-[10px] font-black text-white">Next <ArrowRight size={13} /></button>}
        </footer>
      </div>
    </section>
  );
}

function PresentationFlow({ steps }: { steps: readonly string[] }) {
  return (
    <div aria-label="Referral lifecycle" className="mt-6 overflow-x-auto border-y border-[#d9dfdc] py-5">
      <div className="flex min-w-[720px] items-center">
        {steps.map((step, index) => (
          <div key={step} className="contents">
            <div className="flex min-w-0 flex-1 flex-col items-center text-center">
              <span className="flex h-8 w-8 items-center justify-center border-2 border-[#0f8b73] bg-white text-[9px] font-black text-[#0c705f]">{index + 1}</span>
              <span className="mt-2 max-w-[110px] text-[10px] font-black leading-4 text-[#34413c]">{step}</span>
            </div>
            {index < steps.length - 1 ? <ArrowRight size={16} className="shrink-0 text-[#8aa59c]" aria-hidden="true" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function PresentationVisual({ slide }: { slide: PresentationSlide }) {
  if (slide.screenshots?.length) return <PresentationScreenshots screenshots={slide.screenshots} />;
  if (slide.graphic) return <PresentationGraphic graphic={slide.graphic} />;
  return null;
}

function PresentationScreenshots({ screenshots }: { screenshots: readonly PresentationScreenshot[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = screenshots[selectedIndex] ?? screenshots[0];

  return (
    <figure className="min-w-0 border border-[#cbd5d1] bg-[#f4f7f5]">
      <div className="flex min-h-10 items-center justify-between border-b border-[#d7dfdb] px-3">
        {screenshots.length > 1 ? (
          <div role="tablist" aria-label="Slide screenshots" className="flex self-stretch">
            {screenshots.map((screenshot, index) => (
              <button key={screenshot.src} type="button" role="tab" aria-selected={index === selectedIndex} onClick={() => setSelectedIndex(index)} className={`border-b-2 px-3 text-[10px] font-black ${index === selectedIndex ? "border-[#0f8b73] bg-white text-[#1f342d]" : "border-transparent text-[#6a746f] hover:text-[#26332e]"}`}>{screenshot.label}</button>
            ))}
          </div>
        ) : <span className="text-[9px] font-black uppercase tracking-[0.08em] text-[#0c705f]">{selected.label}</span>}
        <span className="text-[8px] font-black uppercase tracking-[0.08em] text-[#75807b]">Synthetic demo</span>
      </div>
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
      <figcaption className="border-t border-[#d7dfdb] bg-white px-3 py-2.5 text-[10px] font-semibold leading-4 text-[#56615c]">{selected.caption}</figcaption>
    </figure>
  );
}

function PresentationGraphic({ graphic }: { graphic: NonNullable<PresentationSlide["graphic"]> }) {
  if (graphic === "navigation") {
    return (
      <section aria-label="Pipeline screen map" className="border border-[#cbd5d1] bg-[#f7f9f8] p-5">
        <div className="grid grid-cols-2 gap-px border border-[#d2dbd7] bg-[#d2dbd7]">
          <GraphicCell icon={Home} title="Home" detail="What needs my attention?" />
          <GraphicCell icon={FolderOpen} title="Workspaces" detail="Where is this referral?" />
          <GraphicCell icon={CalendarDays} title="Calendar" detail="When is the assessment?" />
          <GraphicCell icon={UserRound} title="Clients" detail="What follows this person?" />
        </div>
      </section>
    );
  }

  if (graphic === "readiness") {
    return (
      <section aria-label="Lifecycle and attention model" className="border border-[#cbd5d1] bg-[#f7f9f8] p-5">
        <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#68736e]">One lifecycle</div>
        <div className="mt-3 flex items-center gap-2">
          <GraphicPill label="Intake" active />
          <ArrowRight size={15} className="shrink-0 text-[#81938c]" aria-hidden="true" />
          <GraphicPill label="Assessment" />
          <ArrowRight size={15} className="shrink-0 text-[#81938c]" aria-hidden="true" />
          <GraphicPill label="Decision" />
        </div>
        <div className="mt-6 border-t border-[#d4dcd8] pt-5">
          <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#68736e]">Attention can overlap</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {["Missing document", "Assessment due", "Blocked", "Needs review"].map((label) => <span key={label} className="border border-[#c8d3ce] bg-white px-2.5 py-1.5 text-[9px] font-black text-[#44514b]">{label}</span>)}
          </div>
        </div>
      </section>
    );
  }

  if (graphic === "decision") {
    return (
      <section aria-label="Admission decision path" className="border border-[#cbd5d1] bg-[#f7f9f8] p-5">
        <div className="flex items-center gap-3">
          <GraphicStep icon={ClipboardCheck} label="Assessor recommendation" />
          <ArrowRight size={16} className="shrink-0 text-[#81938c]" aria-hidden="true" />
          <GraphicStep icon={ShieldCheck} label="Supervisor review" emphasis />
        </div>
        <div className="ml-auto mt-5 grid w-[72%] grid-cols-2 gap-2 border-t border-[#cbd5d1] pt-5">
          <div className="flex items-center gap-2 border-l-[3px] border-[#0f8b73] bg-white px-3 py-3 text-[10px] font-black text-[#245447]"><CheckCircle2 size={15} aria-hidden="true" />Accepted</div>
          <div className="flex items-center gap-2 border-l-[3px] border-[#a65b51] bg-white px-3 py-3 text-[10px] font-black text-[#744039]"><FileText size={15} aria-hidden="true" />Declined + reason</div>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Trusted record evidence" className="border border-[#cbd5d1] bg-[#f7f9f8] p-5">
      <div className="flex items-center gap-2">
        <GraphicStep icon={FileCheck2} label="Source files" />
        <ArrowRight size={15} className="shrink-0 text-[#81938c]" aria-hidden="true" />
        <GraphicStep icon={ClipboardCheck} label="Confirmed data" />
        <ArrowRight size={15} className="shrink-0 text-[#81938c]" aria-hidden="true" />
        <GraphicStep icon={ShieldCheck} label="Signed assessment" emphasis />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-px border border-[#d2dbd7] bg-[#d2dbd7]">
        <GraphicCell icon={FileText} title="Chart" detail="Clinical record" compact />
        <GraphicCell icon={FolderOpen} title="Files" detail="Source evidence" compact />
        <GraphicCell icon={Activity} title="Activity" detail="Change history" compact />
      </div>
    </section>
  );
}

function GraphicCell({ icon: Icon, title, detail, compact = false }: { icon: LucideIcon; title: string; detail: string; compact?: boolean }) {
  return (
    <div className={`bg-white ${compact ? "px-3 py-3" : "px-4 py-5"}`}>
      <Icon size={compact ? 15 : 18} className="text-[#0f8b73]" aria-hidden="true" />
      <div className="mt-2 text-[11px] font-black text-[#27322d]">{title}</div>
      <div className="mt-1 text-[9px] font-semibold leading-4 text-[#68736e]">{detail}</div>
    </div>
  );
}

function GraphicPill({ label, active = false }: { label: string; active?: boolean }) {
  return <span className={`flex min-h-10 flex-1 items-center justify-center border px-2 text-center text-[9px] font-black ${active ? "border-[#0f8b73] bg-[#e5f3ee] text-[#0c705f]" : "border-[#c8d3ce] bg-white text-[#44514b]"}`}>{label}</span>;
}

function GraphicStep({ icon: Icon, label, emphasis = false }: { icon: LucideIcon; label: string; emphasis?: boolean }) {
  return <div className={`flex min-h-[76px] flex-1 flex-col items-center justify-center border px-3 text-center ${emphasis ? "border-[#0f8b73] bg-[#e5f3ee] text-[#0c705f]" : "border-[#c8d3ce] bg-white text-[#44514b]"}`}><Icon size={18} aria-hidden="true" /><span className="mt-2 text-[9px] font-black leading-4">{label}</span></div>;
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
