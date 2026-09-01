"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronRight,
  Compass,
  MessageCircleQuestion,
  Pause,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { startTransition, useEffect, useEffectEvent, useRef, useState, type CSSProperties, type FormEvent } from "react";

import { fetchCurrentPipelineUser, fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { fromPipelinePath, toPipelinePath } from "@/lib/pipeline/base-path";
import { PIPELINE_NAVIGATION_EVENT, pushPipelineHistory } from "@/lib/pipeline/client-navigation";
import {
  getOperatorGuidedTutorial,
  guidedTutorialsForRole,
  type OperatorGuideStep,
} from "@/lib/training/operator-guided-tutorials";
import {
  emptyOperatorGuideState,
  normalizeOperatorGuideState,
  OPERATOR_GUIDE_EVENT,
  OPERATOR_GUIDE_STORAGE_KEY,
  parseOperatorGuideCommand,
  reduceOperatorGuideState,
  type OperatorGuideEvent,
  type OperatorGuideState,
} from "@/lib/training/operator-guided-tour-state";
import type {
  OperatorProgressRecord,
  OperatorTrainingProgress,
  OperatorTutorialResult,
} from "@/lib/training/operator-training-progress-contract";
import type { OperatorRole } from "@/lib/training/operator-training-types";

type TargetView = {
  element: HTMLElement | null;
  rect: DOMRect | null;
  available: boolean;
};

type GuideExchange = {
  user: string;
  helper: string;
};

type TargetInteraction = {
  element: HTMLElement | null;
  handler: EventListener | null;
  event: "click" | "input" | "change" | null;
};

const emptyTarget: TargetView = { element: null, rect: null, available: false };

export default function PipelineGuidedCoach() {
  const [state, setState] = useState<OperatorGuideState>(() => emptyOperatorGuideState());
  const [hydrated, setHydrated] = useState(false);
  const [role, setRole] = useState<OperatorRole>("viewer");
  const [target, setTarget] = useState<TargetView>(emptyTarget);
  const [exchange, setExchange] = useState<GuideExchange | null>(null);
  const [command, setCommand] = useState("");
  const [routeVersion, setRouteVersion] = useState(0);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const tutorial = getOperatorGuidedTutorial(state.activeTutorialId);
  const step = tutorial?.steps[state.stepIndex];

  function commit(event: OperatorGuideEvent) {
    setExchange(null);
    setCommand("");
    setState((current) => {
      const next = reduceOperatorGuideState(current, event);
      writeGuideState(next);
      return next;
    });
  }

  function queueProgressSync(tutorialId: string, result: OperatorTutorialResult) {
    syncQueueRef.current = syncQueueRef.current
      .catch(() => undefined)
      .then(() => syncTutorialProgress(tutorialId, result));
  }

  function startTutorial(tutorialId: string) {
    const selected = getOperatorGuidedTutorial(tutorialId);
    if (!selected || !selected.audiences.includes(role)) return;
    const now = new Date().toISOString();
    setState((current) => {
      const next = reduceOperatorGuideState(current, { type: "start", tutorialId }, now);
      writeGuideState(next);
      return next;
    });
    setExchange(null);
    queueProgressSync(tutorialId, { status: "started", currentStep: 0, startedAt: now, updatedAt: now });
    openGuideRoute(selected.steps[0].route);
  }

  function advance() {
    if (!tutorial || !step) return;
    const lastStep = state.stepIndex === tutorial.steps.length - 1;
    const now = new Date().toISOString();
    if (lastStep) {
      const completed: OperatorTutorialResult = {
        status: "completed",
        currentStep: state.stepIndex,
        startedAt: state.startedAt ?? now,
        updatedAt: now,
        completedAt: now,
      };
      commit({ type: "finish" });
      queueProgressSync(tutorial.id, completed);
      window.dispatchEvent(new CustomEvent("pipeline:guided-tutorial-completed", { detail: { tutorialId: tutorial.id } }));
      return;
    }
    const nextIndex = state.stepIndex + 1;
    commit({ type: "next" });
    queueProgressSync(tutorial.id, {
      status: "started",
      currentStep: nextIndex,
      startedAt: state.startedAt ?? now,
      updatedAt: now,
    });
  }

  const handleExternalGuideEvent = useEffectEvent((event: Extract<OperatorGuideEvent, { type: "open-library" | "start" }>) => {
    if (event.type === "open-library") commit(event);
    else startTutorial(event.tutorialId);
  });
  const advanceFromTarget = useEffectEvent(() => advance());

  useEffect(() => {
    startTransition(() => {
      setState(readGuideState());
      setHydrated(true);
    });
    fetchCurrentPipelineUser()
      .then((payload) => setRole(primaryRole(payload.user?.roles ?? [])))
      .catch(() => setRole("viewer"));
  }, []);

  useEffect(() => {
    const handleGuideEvent = (event: Event) => {
      const detail = (event as CustomEvent<OperatorGuideEvent>).detail;
      if (!detail || (detail.type !== "open-library" && detail.type !== "start")) return;
      handleExternalGuideEvent(detail);
    };
    window.addEventListener(OPERATOR_GUIDE_EVENT, handleGuideEvent);
    return () => window.removeEventListener(OPERATOR_GUIDE_EVENT, handleGuideEvent);
  }, []);

  useEffect(() => {
    const changed = () => setRouteVersion((value) => value + 1);
    window.addEventListener(PIPELINE_NAVIGATION_EVENT, changed);
    window.addEventListener("popstate", changed);
    return () => {
      window.removeEventListener(PIPELINE_NAVIGATION_EVENT, changed);
      window.removeEventListener("popstate", changed);
    };
  }, []);

  useEffect(() => {
    if (state.mode !== "active" || !step) {
      return;
    }

    let interaction: TargetInteraction = { element: null, handler: null, event: null };
    let frame = 0;
    let didScroll = false;

    const measure = () => {
      const candidate = findVisibleGuideTarget(step.target);
      interaction = rebindGuideInteraction(interaction, candidate, step, advanceFromTarget);
      didScroll = scrollGuideTargetIntoView(candidate, didScroll);
      setTarget(targetView(candidate));
    };
    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    const observer = new MutationObserver(scheduleMeasure);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden"] });
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    measure();
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
      detachGuideInteraction(interaction);
    };
  }, [routeVersion, state.mode, state.stepIndex, step]);

  const submitCommand = (event: FormEvent) => {
    event.preventDefault();
    if (!step || !command.trim()) return;
    const raw = command.trim().slice(0, 80);
    const parsed = parseOperatorGuideCommand(raw);
    setCommand("");
    executeGuideCommand({ parsed, raw, step, target, advance, commit, setExchange });
  };

  if (!hydrated) return null;
  const pathname = fromPipelinePath(window.location.pathname);
  if (pathname === "/training/demo" || pathname === "/note-lab" || pathname.startsWith("/note-lab/")) return null;
  return <GuideCoachSurface hideLauncher={false} state={state} role={role} tutorial={tutorial} step={step} target={target} exchange={exchange} command={command} onStart={startTutorial} onCommit={commit} onAdvance={advance} onCommandChange={setCommand} onSubmit={submitCommand} onExchange={setExchange} />;
}

function GuideCoachSurface({ hideLauncher, state, role, tutorial, step, target, exchange, command, onStart, onCommit, onAdvance, onCommandChange, onSubmit, onExchange }: { hideLauncher: boolean; state: OperatorGuideState; role: OperatorRole; tutorial: ReturnType<typeof getOperatorGuidedTutorial>; step: OperatorGuideStep | undefined; target: TargetView; exchange: GuideExchange | null; command: string; onStart: (id: string) => void; onCommit: (event: OperatorGuideEvent) => void; onAdvance: () => void; onCommandChange: (value: string) => void; onSubmit: (event: FormEvent) => void; onExchange: (exchange: GuideExchange) => void }) {
  if (state.mode === "closed") return hideLauncher ? null : <GuideLauncher resumable={Boolean(state.activeTutorialId)} onOpen={() => onCommit(state.activeTutorialId ? { type: "resume" } : { type: "open-library" })} />;
  if (state.mode === "library") return <GuideLibrary role={role} completed={state.completedTutorialIds} resumableTutorialId={state.activeTutorialId} onStart={onStart} onResume={() => onCommit({ type: "resume" })} onClose={() => onCommit({ type: "close" })} />;
  if (!tutorial || !step) return <GuideLauncher resumable={false} onOpen={() => onCommit({ type: "open-library" })} />;
  const conversation = <GuideConversation tutorialTitle={tutorial.title} workflow={tutorial.workflow} step={step} stepIndex={state.stepIndex} stepCount={tutorial.steps.length} targetAvailable={target.available} routeMatches={guideRouteMatches(step.route)} exchange={exchange} command={command} onCommandChange={onCommandChange} onSubmit={onSubmit} onWhy={() => onExchange({ user: "Why does this matter?", helper: step.why })} onSafety={() => onExchange({ user: "What should I avoid?", helper: step.safety })} onBack={() => onCommit({ type: "previous" })} onAdvance={onAdvance} onOpenRoute={() => openGuideRoute(step.route)} onPause={() => onCommit({ type: "close" })} onEnd={() => onCommit({ type: "end" })} />;
  return <>{target.available && target.rect ? <GuideSpotlight rect={target.rect} step={step} /> : null}{conversation}</>;
}

function GuideLauncher({ resumable, onOpen }: { resumable: boolean; onOpen: () => void }) {
  return <button type="button" aria-label={resumable ? "Resume guided tutorial" : "Open guide launcher"} onClick={onOpen} className="fixed bottom-4 right-4 z-[75] flex h-11 items-center gap-2 border border-[#b7c9c3] bg-white px-3 text-[10px] font-black text-[#164e43] shadow-[0_8px_24px_rgba(18,48,40,0.16)] outline-none hover:border-[#0f8b73] focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2"><MessageCircleQuestion size={16} aria-hidden="true" /><span>{resumable ? "Resume guide" : "Guide"}</span></button>;
}

function executeGuideCommand({ parsed, raw, step, target, advance, commit, setExchange }: { parsed: ReturnType<typeof parseOperatorGuideCommand>; raw: string; step: OperatorGuideStep; target: TargetView; advance: () => void; commit: (event: OperatorGuideEvent) => void; setExchange: (exchange: GuideExchange) => void }) {
  if (parsed === "next") {
    if (guideTargetActionRequired(step, target)) setExchange({ user: raw, helper: `Use the highlighted ${targetLabel(step.target)} control so Pipeline can verify this step. I will advance automatically.` });
    else advance();
    return;
  }
  if (parsed === "back") return commit({ type: "previous" });
  if (parsed === "pause") return commit({ type: "close" });
  if (parsed === "restart") return commit({ type: "restart" });
  setExchange({ user: raw, helper: guideCommandReply(parsed, step) });
}

function guideTargetActionRequired(step: OperatorGuideStep, target: TargetView) {
  const optionalUnavailable = step.optionalTarget && (!target.available || !guideRouteMatches(step.route));
  return step.advance !== "confirm" && !optionalUnavailable;
}

function guideCommandReply(parsed: ReturnType<typeof parseOperatorGuideCommand>, step: OperatorGuideStep) {
  if (parsed === "why") return step.why;
  if (parsed === "safety") return step.safety;
  if (parsed === "repeat") return step.instruction;
  return "I use authored commands only. Try: why, safety, repeat, next, back, restart, or pause. Do not enter names, packet text, or other PHI.";
}

function rebindGuideInteraction(current: TargetInteraction, candidate: HTMLElement | null, step: OperatorGuideStep, onAdvance: () => void): TargetInteraction {
  if (candidate === current.element) return current;
  detachGuideInteraction(current);
  const event = candidate ? guideAdvanceEvent(step.advance, candidate) : null;
  if (!candidate || !event) return { element: candidate, handler: null, event };
  const handler = () => window.setTimeout(onAdvance, 0);
  candidate.addEventListener(event, handler);
  return { element: candidate, handler, event };
}

function detachGuideInteraction(interaction: TargetInteraction) {
  if (interaction.element && interaction.handler && interaction.event) {
    interaction.element.removeEventListener(interaction.event, interaction.handler);
  }
}

function scrollGuideTargetIntoView(candidate: HTMLElement | null, alreadyScrolled: boolean) {
  if (!candidate || alreadyScrolled) return alreadyScrolled;
  if (isMostlyVisible(candidate.getBoundingClientRect())) return false;
  candidate.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center", inline: "center" });
  return true;
}

function targetView(candidate: HTMLElement | null): TargetView {
  const rect = candidate?.getBoundingClientRect() ?? null;
  return { element: candidate, rect, available: Boolean(candidate && rect && rect.width > 0 && rect.height > 0) };
}

function GuideLibrary({ role, completed, resumableTutorialId, onStart, onResume, onClose }: { role: OperatorRole; completed: readonly string[]; resumableTutorialId: string | null; onStart: (id: string) => void; onResume: () => void; onClose: () => void }) {
  const tutorials = guidedTutorialsForRole(role);
  const resumable = getOperatorGuidedTutorial(resumableTutorialId);
  return (
    <section role="dialog" aria-label="Guided tutorial library" className="fixed bottom-4 right-4 z-[90] flex max-h-[min(720px,calc(100dvh-2rem))] w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden border border-[#b9c7c2] bg-white shadow-[0_20px_60px_rgba(17,35,30,0.24)]">
      <header className="flex items-start justify-between gap-4 border-b border-[#d8dfdc] bg-[#f3f7f5] px-4 py-4">
        <div><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.11em] text-[#0c705f]"><Compass size={13} aria-hidden="true" /> Pipeline workflow guide</div><h2 className="mt-1.5 text-[18px] font-black tracking-[-0.025em] text-[#171b19]">Practice the work by doing it</h2><p className="mt-1 text-[10px] leading-4 text-[#66716d]">Authored actions only. The guide verifies interactions but never reads values or makes a workflow decision.</p></div>
        <button type="button" aria-label="Close guided tutorials" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center text-[#6c7672] hover:bg-white hover:text-[#111111]"><X size={16} /></button>
      </header>
      <div className="overflow-y-auto p-3">
        {resumable ? <button type="button" onClick={onResume} className="mb-3 flex min-h-12 w-full items-center justify-between gap-3 border border-[#83b8a8] bg-[#edf8f4] px-3 text-left"><span><span className="block text-[10px] font-black uppercase tracking-[0.08em] text-[#0c705f]">Continue where you stopped</span><span className="mt-1 block text-[11px] font-bold text-[#25473e]">{resumable.title}</span></span><ArrowRight size={14} className="text-[#0f8b73]" /></button> : null}
        <div className="space-y-2">
          {tutorials.map((tutorial) => {
            const done = completed.includes(tutorial.id);
            return <button key={tutorial.id} type="button" onClick={() => onStart(tutorial.id)} className="group w-full border border-[#d4dcda] bg-white p-3 text-left hover:border-[#86afa3] hover:bg-[#f8fbfa]"><div className="flex items-start justify-between gap-3"><span className={`flex h-8 w-8 shrink-0 items-center justify-center border ${done ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#c2d3cd] bg-[#eff6f3] text-[#0c705f]"}`}>{done ? <Check size={15} /> : <BookOpenCheck size={15} />}</span><span className="min-w-0 flex-1"><span className="block text-[8px] font-black uppercase tracking-[0.08em] text-[#0c705f]">{tutorial.workflow}</span><span className="mt-1 block text-[12px] font-black text-[#232927]">{tutorial.title}</span><span className="mt-1 block text-[10px] leading-4 text-[#69736f]">{tutorial.summary}</span><span className="mt-2 block text-[8px] font-black uppercase tracking-[0.09em] text-[#87908c]">{tutorial.steps.length} actions · {tutorial.minutes} min{done ? " · completed" : ""}</span></span><ChevronRight size={14} className="mt-2 shrink-0 text-[#84908b] group-hover:text-[#0f8b73]" /></div></button>;
          })}
        </div>
      </div>
      <footer className="border-t border-[#d8dfdc] bg-[#fafcfb] px-4 py-3 text-[9px] font-bold leading-4 text-[#707a76]"><ShieldCheck size={13} className="mr-1.5 inline text-[#0f8b73]" />Never enter PHI in the guide. It stores progress and command categories, not chat text.</footer>
    </section>
  );
}

function GuideConversation({ tutorialTitle, workflow, step, stepIndex, stepCount, targetAvailable, routeMatches, exchange, command, onCommandChange, onSubmit, onWhy, onSafety, onBack, onAdvance, onOpenRoute, onPause, onEnd }: { tutorialTitle: string; workflow: string; step: OperatorGuideStep; stepIndex: number; stepCount: number; targetAvailable: boolean; routeMatches: boolean; exchange: GuideExchange | null; command: string; onCommandChange: (value: string) => void; onSubmit: (event: FormEvent) => void; onWhy: () => void; onSafety: () => void; onBack: () => void; onAdvance: () => void; onOpenRoute: () => void; onPause: () => void; onEnd: () => void }) {
  const targetReady = routeMatches && targetAvailable;
  const canConfirm = !guideActionRequiresTarget(step, targetReady);
  return (
    <section role="dialog" aria-label={`${tutorialTitle} guided tutorial`} className="fixed bottom-0 right-0 z-[100] flex max-h-[min(680px,calc(100dvh-1rem))] w-full flex-col overflow-hidden border border-[#aebfba] bg-white shadow-[0_22px_70px_rgba(14,31,26,0.28)] sm:bottom-4 sm:right-4 sm:w-[390px]">
      <header className="border-b border-[#d5ddda] bg-[#f2f6f4] px-4 py-3">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2 text-[8px] font-black uppercase tracking-[0.11em] text-[#0c705f]"><MessageCircleQuestion size={12} /> Deterministic workflow guide</div><h2 className="mt-1 truncate text-[13px] font-black text-[#202623]">{tutorialTitle}</h2><div className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-[#75807c]">{workflow} · {step.phase}</div></div><div className="flex items-center gap-1"><button type="button" onClick={onPause} aria-label="Pause tutorial" title="Pause" className="flex h-8 w-8 items-center justify-center text-[#68736f] hover:bg-white hover:text-[#111111]"><Pause size={14} /></button><button type="button" onClick={onEnd} aria-label="End tutorial" title="End tutorial" className="flex h-8 w-8 items-center justify-center text-[#68736f] hover:bg-white hover:text-[#a9473d]"><X size={15} /></button></div></div>
        <div className="mt-3 flex gap-1" aria-label={`Action ${stepIndex + 1} of ${stepCount}`}>{Array.from({ length: stepCount }, (_, index) => <span key={index} className={`h-1 flex-1 ${index <= stepIndex ? "bg-[#0f8b73]" : "bg-[#d7dfdc]"}`} />)}</div>
      </header>
      <GuideConversationBody step={step} stepIndex={stepIndex} targetReady={targetReady} routeMatches={routeMatches} exchange={exchange} onOpenRoute={onOpenRoute} onWhy={onWhy} onSafety={onSafety} />
      <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-[#d8dfdc] bg-white px-3 py-2"><label htmlFor="pipeline-guide-command" className="sr-only">Guide command</label><input id="pipeline-guide-command" value={command} maxLength={80} onChange={(event) => onCommandChange(event.target.value)} autoComplete="off" placeholder="Ask: why, safety, next, back..." className="h-9 min-w-0 flex-1 border border-[#ced8d4] px-3 text-[10px] outline-none focus:border-[#0f8b73]" /><button type="submit" aria-label="Send guide command" disabled={!command.trim()} className="flex h-9 w-9 items-center justify-center bg-[#176b78] text-white disabled:bg-[#b8c1be]"><Send size={13} /></button></form>
      <GuideConversationFooter step={step} stepIndex={stepIndex} stepCount={stepCount} targetReady={targetReady} canConfirm={canConfirm} onBack={onBack} onAdvance={onAdvance} />
    </section>
  );
}

function GuideConversationBody({ step, stepIndex, targetReady, routeMatches, exchange, onOpenRoute, onWhy, onSafety }: { step: OperatorGuideStep; stepIndex: number; targetReady: boolean; routeMatches: boolean; exchange: GuideExchange | null; onOpenRoute: () => void; onWhy: () => void; onSafety: () => void }) {
  return <div className="min-h-0 flex-1 overflow-y-auto bg-[#f8faf9] px-4 py-4" aria-live="polite"><div className="flex items-start gap-2.5"><span className="flex h-7 w-7 shrink-0 items-center justify-center border border-[#9fc8bb] bg-[#e9f5f1] text-[#0c705f]"><Compass size={14} /></span><div className="max-w-[300px] border border-[#d3ddda] bg-white px-3 py-3"><div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#0c705f]">Action {stepIndex + 1} · {step.phase}</div><h3 className="mt-1 text-[14px] font-black leading-5 text-[#1d2421]">{step.title}</h3><p className="mt-2 text-[11px] leading-5 text-[#57625e]">{step.message}</p><div className="mt-3 border-l-2 border-[#0f8b73] bg-[#f0f7f4] px-3 py-2 text-[10px] font-bold leading-4 text-[#285448]"><span className="mb-1 block text-[8px] font-black uppercase tracking-[0.08em] text-[#0c705f]">Do this</span>{step.instruction}</div><div className="mt-2 border-l-2 border-[#83a99d] bg-[#f7faf9] px-3 py-2 text-[9px] leading-4 text-[#52605b]"><span className="font-black text-[#293d37]">Done when: </span>{step.completion}</div></div></div>{!targetReady ? <UnavailableGuideAction step={step} routeMatches={routeMatches} onOpenRoute={onOpenRoute} /> : null}{exchange ? <><div className="ml-auto mt-3 max-w-[270px] bg-[#176b78] px-3 py-2 text-[10px] font-bold leading-4 text-white">{exchange.user}</div><div className="mt-2 flex items-start gap-2.5"><span className="flex h-7 w-7 shrink-0 items-center justify-center border border-[#9fc8bb] bg-[#e9f5f1] text-[#0c705f]"><Compass size={14} /></span><div className="max-w-[300px] border border-[#d3ddda] bg-white px-3 py-2.5 text-[10px] leading-5 text-[#57625e]">{exchange.helper}</div></div></> : null}<div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={onWhy} className="h-8 border border-[#cbd5d1] bg-white px-3 text-[9px] font-black text-[#4f5a56] hover:border-[#0f8b73]">Why this matters</button><button type="button" onClick={onSafety} className="h-8 border border-[#cbd5d1] bg-white px-3 text-[9px] font-black text-[#4f5a56] hover:border-[#a16a16]">Safety boundary</button></div></div>;
}

function UnavailableGuideAction({ step, routeMatches, onOpenRoute }: { step: OperatorGuideStep; routeMatches: boolean; onOpenRoute: () => void }) {
  return <div className="mt-3 border border-[#dbc48d] bg-[#fff9e9] px-3 py-2.5 text-[10px] leading-4 text-[#6e561f]">{unavailableGuideMessage(step, routeMatches)}{!routeMatches ? <button type="button" onClick={onOpenRoute} className="mt-2 flex h-8 items-center gap-2 bg-[#6e561f] px-3 text-[9px] font-black uppercase tracking-[0.06em] text-white">Open this action <ArrowRight size={12} /></button> : null}</div>;
}

function unavailableGuideMessage(step: OperatorGuideStep, routeMatches: boolean) {
  if (!routeMatches) return "This action is on another Pipeline page.";
  if (step.optionalTarget) return "No matching work or permitted control is available. Acknowledge the stop condition instead of inventing a workaround.";
  return "I am waiting for the highlighted action to become available.";
}

function GuideConversationFooter({ step, stepIndex, stepCount, targetReady, canConfirm, onBack, onAdvance }: { step: OperatorGuideStep; stepIndex: number; stepCount: number; targetReady: boolean; canConfirm: boolean; onBack: () => void; onAdvance: () => void }) {
  return <footer className="flex items-center justify-between gap-2 border-t border-[#d8dfdc] bg-[#fafcfb] px-3 py-3"><button type="button" disabled={stepIndex === 0} onClick={onBack} className="flex h-9 items-center gap-1.5 px-2 text-[9px] font-black text-[#626d69] disabled:invisible"><ArrowLeft size={13} /> Back</button><span className="text-[8px] font-black uppercase tracking-[0.08em] text-[#838c89]">No PHI in guide</span>{canConfirm ? <button type="button" onClick={onAdvance} className="flex h-9 items-center gap-2 bg-[#0f8b73] px-4 text-[9px] font-black text-white">{guideAdvanceLabel(step, stepIndex, stepCount, targetReady)}<ArrowRight size={13} /></button> : <span className="flex h-9 items-center gap-2 border border-[#9fc8bb] bg-[#edf7f3] px-3 text-[9px] font-black text-[#0c705f]">Complete highlighted action <ChevronRight size={12} /></span>}</footer>;
}

function guideActionRequiresTarget(step: OperatorGuideStep, targetReady: boolean) {
  return step.advance !== "confirm" && !(step.optionalTarget && !targetReady);
}

function guideAdvanceLabel(step: OperatorGuideStep, stepIndex: number, stepCount: number, targetReady: boolean) {
  if (stepIndex === stepCount - 1) return "Complete workflow";
  if (step.optionalTarget && !targetReady) return "Acknowledge stop";
  return "Mark action complete";
}

function GuideSpotlight({ rect, step }: { rect: DOMRect; step: OperatorGuideStep }) {
  const pad = 6;
  const left = Math.max(0, rect.left - pad);
  const top = Math.max(0, rect.top - pad);
  const right = Math.min(window.innerWidth, rect.right + pad);
  const bottom = Math.min(window.innerHeight, rect.bottom + pad);
  const tooltip = tooltipPosition(rect, step.placement ?? "auto");
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[80]">
      <span className="absolute left-0 top-0 w-full bg-[#10201b]/45" style={{ height: top }} />
      <span className="absolute left-0 bg-[#10201b]/45" style={{ top, width: left, height: Math.max(0, bottom - top) }} />
      <span className="absolute right-0 bg-[#10201b]/45" style={{ top, width: Math.max(0, window.innerWidth - right), height: Math.max(0, bottom - top) }} />
      <span className="absolute bottom-0 left-0 w-full bg-[#10201b]/45" style={{ top: bottom }} />
      <span className="absolute border-2 border-[#1ba889] shadow-[0_0_0_4px_rgba(255,255,255,0.92),0_0_0_7px_rgba(15,139,115,0.35)]" style={{ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }} />
      <span className="absolute max-w-[250px] border border-[#0f8b73] bg-[#103f35] px-3 py-2 text-[10px] font-black leading-4 text-white shadow-[0_8px_24px_rgba(10,35,29,0.25)]" style={tooltip}>{step.title}</span>
    </div>
  );
}

function tooltipPosition(rect: DOMRect, placement: OperatorGuideStep["placement"]): CSSProperties {
  const width = 250;
  const gap = 14;
  const resolved = placement === "auto" ? (rect.bottom + 80 < window.innerHeight ? "bottom" : "top") : placement;
  if (resolved === "left") return { left: Math.max(8, rect.left - width - gap), top: clamp(rect.top, 8, window.innerHeight - 90), width };
  if (resolved === "right") return { left: Math.min(window.innerWidth - width - 8, rect.right + gap), top: clamp(rect.top, 8, window.innerHeight - 90), width };
  const left = clamp(rect.left + rect.width / 2 - width / 2, 8, window.innerWidth - width - 8);
  if (resolved === "top") return { left, top: Math.max(8, rect.top - 66), width };
  return { left, top: Math.min(window.innerHeight - 70, rect.bottom + gap), width };
}

function findVisibleGuideTarget(id: string) {
  const candidates = [...document.querySelectorAll<HTMLElement>(`[data-guide-target="${id}"]`)];
  return candidates.find((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }) ?? null;
}

function guideRouteMatches(route: string) {
  if (typeof window === "undefined") return false;
  const currentPath = fromPipelinePath(window.location.pathname);
  const expected = new URL(route, window.location.origin);
  if (currentPath !== expected.pathname) return false;
  const currentParams = new URLSearchParams(window.location.search);
  return [...expected.searchParams.entries()].every(([key, value]) => currentParams.get(key) === value);
}

function openGuideRoute(route: string) {
  if (guideRouteMatches(route)) return;
  const destination = new URL(route, window.location.origin);
  const currentPath = fromPipelinePath(window.location.pathname);
  if (currentPath === "/" && destination.pathname === "/") {
    pushPipelineHistory(`${destination.pathname}${destination.search}`);
    return;
  }
  window.location.assign(toPipelinePath(`${destination.pathname}${destination.search}`));
}

function readGuideState() {
  try {
    return normalizeOperatorGuideState(JSON.parse(window.localStorage.getItem(OPERATOR_GUIDE_STORAGE_KEY) ?? "null"));
  } catch {
    return emptyOperatorGuideState();
  }
}

function writeGuideState(state: OperatorGuideState) {
  try {
    window.localStorage.setItem(OPERATOR_GUIDE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The active in-memory guide remains usable when browser storage is unavailable.
  }
}

async function syncTutorialProgress(tutorialId: string, result: OperatorTutorialResult) {
  const identity = await fetchCurrentPipelineUser().catch(() => null);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const record = await fetchPipelineJson<OperatorProgressRecord>("/api/training/progress", { cache: "no-store" }, { maxResponseBytes: 360_000 });
      const progress: OperatorTrainingProgress = {
        ...record.progress,
        tutorialResults: { ...record.progress.tutorialResults, [tutorialId]: mergeTutorialResult(record.progress.tutorialResults[tutorialId], result) },
      };
      await fetchPipelineJson<OperatorProgressRecord>("/api/training/progress", {
        method: "PUT",
        body: JSON.stringify({ expectedRevision: record.revision, progress }),
      }, { maxResponseBytes: 360_000 });
      return;
    } catch (error) {
      if (error instanceof PipelineApiError && error.status === 409) continue;
      if (error instanceof PipelineApiError && error.status === 503 && identity?.user?.id) {
        await saveBrowserTrainingProgress(identity.user.id, identity.user.roles, tutorialId, result);
      }
      return;
    }
  }
}

async function saveBrowserTrainingProgress(principalId: string, roles: readonly string[], tutorialId: string, result: OperatorTutorialResult) {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(principalId));
  const identity = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 16);
  const key = `pipeline-operator-training:${identity}`;
  try {
    const stored = JSON.parse(window.localStorage.getItem(key) ?? "null") as Partial<OperatorTrainingProgress> | null;
    const current = stored?.tutorialResults?.[tutorialId];
    const next = {
      ...(stored ?? {}),
      role: primaryRole(roles),
      tutorialResults: { ...(stored?.tutorialResults ?? {}), [tutorialId]: mergeTutorialResult(current, result) },
    };
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // The guide's own completion record remains available in browser storage.
  }
}

function mergeTutorialResult(current: OperatorTutorialResult | undefined, candidate: OperatorTutorialResult) {
  if (!current) return candidate;
  if (current.status === "completed" && candidate.status !== "completed") return current;
  if (candidate.status === "completed" && current.status !== "completed") return candidate;
  return candidate.updatedAt >= current.updatedAt ? candidate : current;
}

function primaryRole(roles: readonly string[]): OperatorRole {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("assessment_coordinator")) return "assessment_coordinator";
  if (roles.includes("reviewer")) return "reviewer";
  return "viewer";
}

function targetLabel(id: string) {
  return id.replace(/^primary-/, "").replaceAll("-", " ");
}

function guideAdvanceEvent(advance: OperatorGuideStep["advance"], target: HTMLElement) {
  if (advance === "target-input") return "input" as const;
  if (advance === "target-change") return "change" as const;
  if (advance === "target-click") return target instanceof HTMLSelectElement ? "change" as const : "click" as const;
  return null;
}

function isMostlyVisible(rect: DOMRect) {
  return rect.top >= 82 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
