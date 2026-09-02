"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCheck,
  ExternalLink,
  FlaskConical,
  Play,
  RefreshCcw,
} from "lucide-react";
import { startTransition, useEffect, useState } from "react";

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
type DemoView = "run" | "lab" | "handoff";

type DemoChapter = {
  number: number;
  title: string;
  instruction: string;
  actions: readonly string[];
  completeWhen: string;
  scenarioId: PipelineDemoScenarioId;
};

const demoChapters: readonly DemoChapter[] = [
  {
    number: 1,
    title: "Review the referral",
    instruction: "Confirm that the assigned referral is ready for assessment work.",
    actions: ["Open Intake and verify name, date of birth, community, source, and owner", "Review the packet status and missing documents", "Record missing or conflicting information instead of guessing"],
    completeWhen: "Identity, source, ownership, and packet status are clear.",
    scenarioId: "assessment-preparation",
  },
  {
    number: 2,
    title: "Check medication information",
    instruction: "Review the medication information carried from intake before the interview.",
    actions: ["Compare the medication list with the source packet", "Verify name, dose, route, schedule, and source when available", "Leave unverified details clearly marked for follow-up"],
    completeWhen: "Medication facts and unresolved questions are distinguishable.",
    scenarioId: "assessment-preparation",
  },
  {
    number: 3,
    title: "Schedule the assessment",
    instruction: "Set the assessor, date, time, duration, and interview method.",
    actions: ["Open Assessment and select Schedule", "Choose Zoom or the correct interview method", "Save and confirm the scheduled time on the referral"],
    completeWhen: "The assessment has an assessor, time, and interview method.",
    scenarioId: "assessment-preparation",
  },
  {
    number: 4,
    title: "Complete the interview",
    instruction: "Work through the assessment sections and document what was observed, reported, and reviewed.",
    actions: ["Move through each section in order", "Answer conditional follow-up questions when they appear", "Use Answer format only when you need help structuring a narrative"],
    completeWhen: "Required sections are complete and autosave shows no pending changes.",
    scenarioId: "assessment-interview",
  },
  {
    number: 5,
    title: "Prepare for supervisor review",
    instruction: "Resolve what you can and make every remaining uncertainty visible.",
    actions: ["Attribute conflicting statements to the client, collateral source, or record", "State what is unknown and what follow-up is needed", "Review the assessment for missing required fields before handoff"],
    completeWhen: "A supervisor can understand the evidence, conflicts, and next action without asking what the note means.",
    scenarioId: "assessment-complex",
  },
] as const;

export default function PipelineDemoCenter({ actor, environment }: { actor: DemoActor; environment: PipelineDemoEnvironment }) {
  const [view, setView] = useState<DemoView>("run");
  const [chapterIndex, setChapterIndex] = useState(0);
  const [referrals, setReferrals] = useState<DemoReferralSummary[]>([]);
  const [loadingCases, setLoadingCases] = useState(true);
  const [launchingId, setLaunchingId] = useState<PipelineDemoScenarioId | null>(null);
  const [error, setError] = useState("");
  const canWrite = environment.writable && actor.roles.some((role) => ["admin", "assessment_coordinator", "reviewer"].includes(role));
  const chapter = demoChapters[chapterIndex] ?? demoChapters[0];
  const showingHandoff = view === "handoff";

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

  const launchScenario = async (scenario: PipelineDemoScenario) => {
    activatePipelineDemoSession();
    setError("");
    if (scenario.launch === "new_referral") {
      window.location.assign(toPipelinePath(`/?view=referrals&screen=packet&draftId=${crypto.randomUUID()}&demoScenario=${scenario.id}`));
      return;
    }
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
                start_at: nextDemoStartTime(),
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
      window.location.assign(demoReferralRoute(referralResult.referral.id));
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : "The synthetic demo case could not be created.");
      setLaunchingId(null);
    }
  };

  const openExisting = (referral: DemoReferralSummary) => {
    activatePipelineDemoSession();
    window.location.assign(demoReferralRoute(referral.id));
  };

  return (
    <main data-demo-center="true" className={`h-full min-h-0 overflow-y-auto text-[#171a18] ${showingHandoff ? "bg-white" : "bg-[#f4f7f5]"}`}>
      <div className={`mx-auto w-full pb-14 ${showingHandoff ? "max-w-[1320px] px-4 pt-3 sm:px-6 lg:px-8" : "max-w-[1540px] px-4 pt-5 sm:px-6 lg:px-8 lg:pt-7"}`}>
        <header className={showingHandoff ? "border-b border-[#dfe4e1] bg-white" : "border border-[#c8d3cf] bg-white"}>
          {!showingHandoff ? <div className="px-5 py-4 sm:px-7">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 border border-[#9fc6b9] bg-[#eaf5f1] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.11em] text-[#0b6d5b]"><FlaskConical size={12} /> Synthetic data</span>
                <span className={`border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.09em] ${environment.writable ? "border-[#bdd4cc] bg-[#f3f8f6] text-[#42665b]" : "border-[#dfca97] bg-[#fff8e8] text-[#825a10]"}`}>{environment.label}</span>
              </div>
              <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.035em]">Assessor walkthrough</h1>
              <p className="mt-1 text-[11px] leading-5 text-[#5b6662]">Practice referral review, scheduling, interviewing, and supervisor handoff.</p>
            </div>
          </div> : null}
          <div className={`flex items-end ${showingHandoff ? "gap-1 bg-white px-0" : "border-t border-[#d8dfdc] bg-[#edf2f0] px-3 pt-2"}`} role="tablist" aria-label="Demo Center sections">
            <DemoTab active={view === "run"} label="Walkthrough" onClick={() => setView("run")} />
            <DemoTab active={view === "lab"} label="Practice cases" onClick={() => setView("lab")} />
            <DemoTab active={view === "handoff"} label="Meet the Client" onClick={() => setView("handoff")} />
          </div>
        </header>

        {error ? <div role="alert" className="mt-4 border-l-4 border-[#b95649] bg-[#fff2ef] px-4 py-3 text-[11px] font-bold text-[#8c3d33]">{error}</div> : null}
        {!environment.writable ? <div className="mt-4 border border-[#dfca97] bg-[#fff9e9] px-4 py-3 text-[11px] leading-5 text-[#765817]"><strong>Synthetic writes are locked.</strong> {environment.reason}</div> : null}

        {view === "run" ? (
          <PresenterRun
            chapter={chapter}
            chapterIndex={chapterIndex}
            launchingId={launchingId}
            canWrite={canWrite}
            onSelect={setChapterIndex}
            onLaunch={(selected) => void launchScenario(getPipelineDemoScenario(selected.scenarioId)!)}
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

function PresenterRun({ chapter, chapterIndex, launchingId, canWrite, onSelect, onLaunch }: { chapter: DemoChapter; chapterIndex: number; launchingId: PipelineDemoScenarioId | null; canWrite: boolean; onSelect: (index: number) => void; onLaunch: (chapter: DemoChapter) => void }) {
  const scenario = chapter.scenarioId ? getPipelineDemoScenario(chapter.scenarioId) : null;
  const disabled = Boolean(scenario && scenario.launch === "assessment" && !canWrite) || launchingId !== null;
  return (
    <section className="mt-5 grid min-h-[520px] overflow-hidden border border-[#cbd5d1] bg-white lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="border-b border-[#d8dfdc] bg-[#eef3f1] lg:border-b-0 lg:border-r">
        <div className="border-b border-[#d8dfdc] px-4 py-4 text-[10px] font-black uppercase tracking-[0.1em] text-[#0c705f]">Assessment steps</div>
        <nav aria-label="Demo chapters" className="flex gap-1 overflow-x-auto p-2 lg:block">{demoChapters.map((item, index) => <button key={item.number} type="button" onClick={() => onSelect(index)} className={`grid min-h-[62px] w-full min-w-[190px] grid-cols-[30px_minmax(0,1fr)] items-center gap-3 border-l-[3px] px-3 py-2 text-left lg:mb-1 lg:min-w-0 ${index === chapterIndex ? "border-l-[#0f8b73] bg-white" : "border-l-transparent hover:bg-white/70"}`}><span className={`flex h-7 w-7 items-center justify-center border text-[9px] font-black ${index < chapterIndex ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#bac8c3] bg-white text-[#58645f]"}`}>{index < chapterIndex ? <Check size={13} /> : item.number}</span><span className="text-[11px] font-black leading-4 text-[#27302c]">{item.title}</span></button>)}</nav>
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
            <button type="button" disabled={disabled} onClick={() => onLaunch(chapter)} className="inline-flex h-10 items-center gap-2 bg-[#0f8b73] px-5 text-[10px] font-black text-white hover:bg-[#0b6d5b] disabled:bg-[#aeb9b5]"><Play size={13} />{launchingId === chapter.scenarioId ? "Preparing..." : "Open practice record"}</button>
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
      <header className="border-b border-[#d8dfdc] px-5 py-4 sm:px-7"><h2 className="text-[20px] font-semibold tracking-[-0.025em]">Practice cases</h2><p className="mt-1 text-[10px] leading-5 text-[#65706c]">Each attempt creates a new synthetic record.</p></header>
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
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`relative -mb-px flex h-11 min-w-[160px] items-center justify-center border border-b-0 px-4 text-[11px] font-black ${active ? "z-10 border-[#cbd5d1] bg-white text-[#202623]" : "border-transparent text-[#68736f] hover:bg-[#e7ecea]"}`}>{label}</button>;
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

function demoReferralRoute(referralId: number) {
  return toPipelinePath(`/?view=referrals&screen=packet&referralId=${referralId}&workspaceStage=assessment&demo=1`);
}

function demoMutationId(prefix: string) {
  return `demo-${prefix}-${crypto.randomUUID()}`;
}

function nextDemoStartTime() {
  const date = new Date();
  date.setMinutes(date.getMinutes() + 15, 0, 0);
  return date.toISOString();
}
