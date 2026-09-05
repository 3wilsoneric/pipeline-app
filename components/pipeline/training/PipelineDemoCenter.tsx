"use client";

import {
  ArrowLeft,
  ArrowRight,
  ClipboardCheck,
  ExternalLink,
  FlaskConical,
  Play,
  RefreshCcw,
} from "lucide-react";
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
    title: "One referral, one record",
    summary: "Pipeline keeps the packet, intake, assessment, decision, Chart, and handoff connected.",
    points: ["The referral workspace is the source record", "Each role sees the work it needs", "Files and activity stay attached to the referral"],
    flow: ["Email + packet", "Intake", "Assessment", "Decision", "Chart + handoff"],
  },
  {
    number: 2,
    title: "Intake",
    summary: "Create the referral from the source packet before assessment work begins.",
    points: ["Attach the packet first", "Verify identity, source, community, and owner", "Carry supplied medication information forward for assessment verification"],
  },
  {
    number: 3,
    title: "Assessment",
    summary: "Schedule the interview, begin it under the assigned assessor, and complete all 12 sections.",
    points: ["Inherited intake facts remain visible", "Conditional questions appear only when relevant", "Autosave protects the draft; signature remains a deliberate action"],
  },
  {
    number: 4,
    title: "Supervisor review",
    summary: "Review the evidence, unresolved conflicts, completeness, and recommendation before the decision.",
    points: ["Prioritize exceptions and overdue work", "Return unclear documentation for correction", "Record the admission decision in the referral workspace"],
  },
  {
    number: 5,
    title: "Accepted referral",
    summary: "Use the signed assessment to prepare the Chart and the receiving-community handoff.",
    points: ["Review the complete Chart", "Send Meet the Client with the approved admission files", "Prepare the accepted record for EHR entry"],
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
    instruction: "Set the assessor, date, time, duration, and interview method.",
    actions: ["Open Assessment and select Schedule", "Choose Zoom or the correct interview method", "Save and confirm the scheduled time on the referral"],
    completeWhen: "The assessment has an assessor, time, and interview method.",
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
          <PresentationDeck onStartJourney={() => selectView("journey")} />
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

function PresentationDeck({ onStartJourney }: { onStartJourney: () => void }) {
  const [slideIndex, setSlideIndex] = useState(0);
  const slide = presentationSlides[slideIndex] ?? presentationSlides[0];
  const isLast = slideIndex === presentationSlides.length - 1;

  return (
    <section className="mt-5 grid min-h-[540px] min-w-0 overflow-hidden border border-[#cbd5d1] bg-white lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="border-b border-[#d8dfdc] bg-[#eef3f1] p-3 lg:border-b-0 lg:border-r lg:p-4">
        <nav aria-label="Presentation slides" className="flex gap-1 overflow-x-auto lg:block">
          {presentationSlides.map((item, index) => (
            <button key={item.number} type="button" onClick={() => setSlideIndex(index)} aria-current={index === slideIndex ? "step" : undefined} className={`grid min-h-[56px] w-[176px] shrink-0 grid-cols-[24px_minmax(0,1fr)] items-center gap-2 border-l-2 px-3 text-left lg:mb-1 lg:w-full ${index === slideIndex ? "border-[#0f8b73] bg-white text-[#20302b]" : "border-transparent text-[#63706b] hover:bg-white/70"}`}>
              <span className="text-[9px] font-black tabular-nums">{String(item.number).padStart(2, "0")}</span>
              <span className="text-[11px] font-black leading-4">{item.title}</span>
            </button>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-col">
        <article aria-label={`Presentation slide ${slide.number}`} className="flex flex-1 flex-col px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
          <div className="text-[9px] font-black uppercase tracking-[0.12em] text-[#0c705f]">{slide.number} / {presentationSlides.length}</div>
          <h2 className="mt-3 max-w-[900px] text-[30px] font-semibold leading-9 tracking-[-0.035em] text-[#1c2421] sm:text-[38px] sm:leading-[44px]">{slide.title}</h2>
          <p className="mt-4 max-w-[820px] text-[16px] font-medium leading-7 text-[#58645f]">{slide.summary}</p>
          {slide.flow ? <div className="mt-8 grid gap-px overflow-hidden border border-[#cbd5d1] bg-[#cbd5d1] sm:grid-cols-5">{slide.flow.map((item, index) => <div key={item} className="flex min-h-[82px] items-center gap-3 bg-[#f7faf9] px-4"><span className="flex h-7 w-7 shrink-0 items-center justify-center bg-[#dceee8] text-[9px] font-black text-[#0c705f]">{index + 1}</span><span className="text-[11px] font-black leading-4 text-[#34413c]">{item}</span></div>)}</div> : null}
          <div className="mt-8 max-w-[920px] border-y border-[#d9dfdc]">
            {slide.points.map((point, index) => <div key={point} className="grid grid-cols-[30px_minmax(0,1fr)] items-center border-b border-[#e1e5e3] py-4 last:border-b-0"><span className="text-[10px] font-black text-[#0c705f]">{index + 1}</span><span className="text-[13px] font-bold leading-5 text-[#39423e]">{point}</span></div>)}
          </div>
        </article>
        <footer className="flex items-center justify-between gap-3 border-t border-[#d8dfdc] bg-[#fafcfb] px-5 py-4 sm:px-8">
          <button type="button" disabled={slideIndex === 0} onClick={() => setSlideIndex((current) => Math.max(0, current - 1))} className="inline-flex h-10 items-center gap-2 px-2 text-[10px] font-black text-[#5d6863] disabled:invisible"><ArrowLeft size={13} /> Previous</button>
          {isLast ? <button type="button" onClick={onStartJourney} className="inline-flex h-10 items-center gap-2 bg-[#0f8b73] px-5 text-[10px] font-black text-white hover:bg-[#0b6d5b]">Open referral journey <ArrowRight size={13} /></button> : <button type="button" onClick={() => setSlideIndex((current) => Math.min(presentationSlides.length - 1, current + 1))} className="inline-flex h-10 items-center gap-2 bg-[#111111] px-5 text-[10px] font-black text-white">Next <ArrowRight size={13} /></button>}
        </footer>
      </div>
    </section>
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
