"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronRight,
  Compass,
  Pause,
  ShieldCheck,
  X,
} from "lucide-react";
import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";

import { fetchCurrentPipelineUser, fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { fromPipelinePath, toPipelinePath } from "@/lib/pipeline/base-path";
import { PIPELINE_NAVIGATION_EVENT, pushPipelineHistory } from "@/lib/pipeline/client-navigation";
import {
  getOperatorGuidedTutorial,
  guidedTutorialsForRoles,
  type OperatorGuideStep,
} from "@/lib/training/operator-guided-tutorials";
import {
  emptyOperatorGuideState,
  normalizeOperatorGuideState,
  OPERATOR_GUIDE_EVENT,
  OPERATOR_GUIDE_STORAGE_KEY,
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

type TargetInteraction = {
  element: HTMLElement | null;
  handler: EventListener | null;
  event: "click" | "input" | "change" | null;
};

const emptyTarget: TargetView = { element: null, rect: null, available: false };
const OPERATOR_GUIDE_NAVIGATION_RESUME_KEY = "pipeline-guided-coach:navigation-resume:v1";

export default function PipelineGuidedCoach() {
  const [state, setState] = useState<OperatorGuideState>(() => emptyOperatorGuideState());
  const [hydrated, setHydrated] = useState(false);
  const [roles, setRoles] = useState<readonly OperatorRole[]>(["viewer"]);
  const [target, setTarget] = useState<TargetView>(emptyTarget);
  const [routeVersion, setRouteVersion] = useState(0);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const tutorial = getOperatorGuidedTutorial(state.activeTutorialId);
  const step = tutorial?.steps[state.stepIndex];

  function commit(event: OperatorGuideEvent) {
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
    if (!selected || !selected.audiences.some((role) => roles.includes(role))) return;
    const now = new Date().toISOString();
    setState((current) => {
      const next = reduceOperatorGuideState(current, { type: "start", tutorialId }, now);
      writeGuideState(next);
      return next;
    });
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
    const nextStep = tutorial.steps[nextIndex];
    commit({ type: "next" });
    queueProgressSync(tutorial.id, {
      status: "started",
      currentStep: nextIndex,
      startedAt: state.startedAt ?? now,
      updatedAt: now,
    });
    window.setTimeout(() => openGuideRoute(nextStep.route), 0);
  }

  function goBack() {
    if (!tutorial || state.stepIndex === 0) return;
    const previousStep = tutorial.steps[state.stepIndex - 1];
    commit({ type: "previous" });
    window.setTimeout(() => openGuideRoute(previousStep.route), 0);
  }

  function resumeTutorial() {
    if (!tutorial || !step) {
      commit({ type: "open-library" });
      return;
    }
    commit({ type: "resume" });
    window.setTimeout(() => openGuideRoute(step.route), 0);
  }

  const handleExternalGuideEvent = useEffectEvent((event: Extract<OperatorGuideEvent, { type: "open-library" | "start" }>) => {
    if (event.type === "open-library") commit(event);
    else startTutorial(event.tutorialId);
  });
  const advanceFromTarget = useEffectEvent(() => advance());

  useEffect(() => {
    startTransition(() => {
      const stored = readGuideState();
      const next = shouldResumeGuideNavigation()
        ? stored
        : { ...stored, mode: "closed" as const };
      writeGuideState(next);
      setState(next);
      setHydrated(true);
    });
    fetchCurrentPipelineUser()
      .then((payload) => setRoles(normalizeRoles(payload.user?.roles ?? [])))
      .catch(() => setRoles(["viewer"]));
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

  if (!hydrated) return null;
  const pathname = fromPipelinePath(window.location.pathname);
  if (pathname === "/training/demo" || pathname === "/note-lab" || pathname.startsWith("/note-lab/")) return null;
  return <GuideCoachSurface state={state} roles={roles} tutorial={tutorial} step={step} target={target} onStart={startTutorial} onCommit={commit} onAdvance={advance} onBack={goBack} onResume={resumeTutorial} />;
}

function GuideCoachSurface({ state, roles, tutorial, step, target, onStart, onCommit, onAdvance, onBack, onResume }: { state: OperatorGuideState; roles: readonly OperatorRole[]; tutorial: ReturnType<typeof getOperatorGuidedTutorial>; step: OperatorGuideStep | undefined; target: TargetView; onStart: (id: string) => void; onCommit: (event: OperatorGuideEvent) => void; onAdvance: () => void; onBack: () => void; onResume: () => void }) {
  if (state.mode === "closed") return null;
  if (state.mode === "library") return <GuideLibrary roles={roles} completed={state.completedTutorialIds} resumableTutorialId={state.activeTutorialId} onStart={onStart} onResume={onResume} onClose={() => onCommit({ type: "close" })} />;
  if (!tutorial || !step) return null;
  const conversation = <GuideConversation tutorialTitle={tutorial.title} step={step} stepIndex={state.stepIndex} stepCount={tutorial.steps.length} targetAvailable={target.available} routeMatches={guideRouteMatches(step.route)} panelSide={guidePanelSide(target.rect)} onBack={onBack} onAdvance={onAdvance} onOpenRoute={() => openGuideRoute(step.route)} onPause={() => onCommit({ type: "close" })} onEnd={() => onCommit({ type: "end" })} />;
  return <>{target.available && target.rect ? <GuideSpotlight rect={target.rect} /> : null}{conversation}</>;
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
  candidate.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
  return true;
}

function targetView(candidate: HTMLElement | null): TargetView {
  const rect = candidate?.getBoundingClientRect() ?? null;
  return { element: candidate, rect, available: Boolean(candidate && rect && rect.width > 0 && rect.height > 0) };
}

function GuideLibrary({ roles, completed, resumableTutorialId, onStart, onResume, onClose }: { roles: readonly OperatorRole[]; completed: readonly string[]; resumableTutorialId: string | null; onStart: (id: string) => void; onResume: () => void; onClose: () => void }) {
  const tutorials = guidedTutorialsForRoles(roles);
  const resumable = getOperatorGuidedTutorial(resumableTutorialId);
  const tutorialOrder = ["assessor-shift", "complete-assessment", "supervisor-shift", "review-chart", "create-referral", "find-workspace", "run-report"];
  const groups = [
    { id: "assessor", label: "Assessor workflow" },
    { id: "supervisor", label: "Supervisor workflow" },
    { id: "shared", label: "Common tasks" },
  ] as const;
  return (
    <section role="dialog" aria-label="Guided tutorial library" className="fixed bottom-4 right-4 z-[90] flex max-h-[min(720px,calc(100dvh-2rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden border border-[#b9c7c2] bg-white shadow-[0_20px_60px_rgba(17,35,30,0.24)]">
      <header className="flex items-center justify-between gap-4 border-b border-[#d8dfdc] bg-[#f3f7f5] px-4 py-3.5">
        <div><div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.11em] text-[#0c705f]"><Compass size={13} aria-hidden="true" /> Pipeline guide</div><h2 className="mt-1 text-[18px] font-black tracking-[-0.025em] text-[#171b19]">Guided walkthroughs</h2></div>
        <button type="button" aria-label="Close guided tutorials" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center text-[#6c7672] hover:bg-white hover:text-[#111111]"><X size={16} /></button>
      </header>
      <div className="overflow-y-auto p-3">
        {resumable ? <button type="button" onClick={onResume} className="mb-3 flex min-h-12 w-full items-center justify-between gap-3 border border-[#83b8a8] bg-[#edf8f4] px-3 text-left"><span><span className="block text-[10px] font-black uppercase tracking-[0.08em] text-[#0c705f]">Continue where you stopped</span><span className="mt-1 block text-[11px] font-bold text-[#25473e]">{resumable.title}</span></span><ArrowRight size={14} className="text-[#0f8b73]" /></button> : null}
        <div className="space-y-4">
          {groups.map((group) => {
            const items = tutorials
              .filter((tutorial) => tutorial.persona === group.id)
              .sort((left, right) => tutorialOrder.indexOf(left.id) - tutorialOrder.indexOf(right.id));
            if (items.length === 0) return null;
            return (
              <section key={group.id}>
                <h3 className="mb-2 text-[9px] font-black uppercase tracking-[0.1em] text-[#65706c]">{group.label}</h3>
                <div className="space-y-2">
                  {items.map((tutorial) => {
                    const done = completed.includes(tutorial.id);
                    return <button key={tutorial.id} type="button" onClick={() => onStart(tutorial.id)} className="group w-full border border-[#d4dcda] bg-white p-3 text-left hover:border-[#86afa3] hover:bg-[#f8fbfa]"><span className="flex items-center gap-3"><span className={`flex h-8 w-8 shrink-0 items-center justify-center border ${done ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#c2d3cd] bg-[#eff6f3] text-[#0c705f]"}`}>{done ? <Check size={15} /> : <BookOpenCheck size={15} />}</span><span className="min-w-0 flex-1"><span className="block text-[12px] font-black text-[#232927]">{tutorial.title}</span><span className="mt-1 block text-[9px] leading-4 text-[#6d7773]">{tutorial.clickpath.join(" → ")}</span><span className="mt-1 block text-[8px] font-black uppercase tracking-[0.08em] text-[#7b8581]">{tutorial.steps.length} steps · {tutorial.minutes} min{done ? " · completed" : ""}</span></span><ChevronRight size={14} className="shrink-0 text-[#84908b] group-hover:text-[#0f8b73]" /></span></button>;
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      <footer className="border-t border-[#d8dfdc] bg-[#fafcfb] px-4 py-3 text-[9px] font-bold leading-4 text-[#707a76]"><ShieldCheck size={13} className="mr-1.5 inline text-[#0f8b73]" />Use test records while learning. The guide never reads field values.</footer>
    </section>
  );
}

function GuideConversation({ tutorialTitle, step, stepIndex, stepCount, targetAvailable, routeMatches, panelSide, onBack, onAdvance, onOpenRoute, onPause, onEnd }: { tutorialTitle: string; step: OperatorGuideStep; stepIndex: number; stepCount: number; targetAvailable: boolean; routeMatches: boolean; panelSide: "left" | "right"; onBack: () => void; onAdvance: () => void; onOpenRoute: () => void; onPause: () => void; onEnd: () => void }) {
  const targetReady = routeMatches && targetAvailable;
  const canConfirm = step.advance === "confirm";
  return (
    <section role="dialog" aria-label={`${tutorialTitle} guided tutorial`} data-testid="guided-coach-panel" className={`fixed bottom-0 right-0 z-[100] flex max-h-[min(560px,calc(100dvh-1rem))] w-full flex-col overflow-hidden border border-[#aebfba] bg-white shadow-[0_22px_70px_rgba(14,31,26,0.28)] sm:bottom-4 sm:w-[380px] ${panelSide === "left" ? "sm:left-4 sm:right-auto" : "sm:right-4"}`}>
      <header className="border-b border-[#d5ddda] bg-[#f2f6f4] px-4 py-3">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-[8px] font-black uppercase tracking-[0.11em] text-[#0c705f]">Step {stepIndex + 1} of {stepCount}</div><h2 className="mt-1 truncate text-[13px] font-black text-[#202623]">{tutorialTitle}</h2></div><div className="flex items-center gap-1"><button type="button" onClick={onPause} aria-label="Pause tutorial" title="Pause" className="flex h-8 w-8 items-center justify-center text-[#68736f] hover:bg-white hover:text-[#111111]"><Pause size={14} /></button><button type="button" onClick={onEnd} aria-label="End tutorial" title="End tutorial" className="flex h-8 w-8 items-center justify-center text-[#68736f] hover:bg-white hover:text-[#a9473d]"><X size={15} /></button></div></div>
        <div className="mt-3 flex gap-1" aria-label={`Step ${stepIndex + 1} of ${stepCount}`}>{Array.from({ length: stepCount }, (_, index) => <span key={index} className={`h-1 flex-1 ${index <= stepIndex ? "bg-[#0f8b73]" : "bg-[#d7dfdc]"}`} />)}</div>
      </header>
      <GuideConversationBody step={step} targetReady={targetReady} routeMatches={routeMatches} onOpenRoute={onOpenRoute} />
      <GuideConversationFooter stepIndex={stepIndex} stepCount={stepCount} canConfirm={canConfirm} onBack={onBack} onAdvance={onAdvance} />
    </section>
  );
}

function GuideConversationBody({ step, targetReady, routeMatches, onOpenRoute }: { step: OperatorGuideStep; targetReady: boolean; routeMatches: boolean; onOpenRoute: () => void }) {
  return <div className="min-h-0 flex-1 overflow-y-auto bg-white px-4 py-4" aria-live="polite"><div className="text-[9px] font-black uppercase tracking-[0.09em] text-[#0c705f]">{step.phase}</div><h3 className="mt-1.5 text-[18px] font-black leading-6 tracking-[-0.02em] text-[#1d2421]">{step.title}</h3><p className="mt-3 border-l-2 border-[#0f8b73] pl-3 text-[12px] font-bold leading-5 text-[#285448]">{step.instruction}</p><p className="mt-3 text-[10px] leading-4 text-[#5f6a66]"><span className="font-black text-[#293d37]">Done when: </span>{step.completion}</p>{step.advance === "confirm" ? <p className="mt-3 border-t border-[#e3e8e6] pt-3 text-[9px] leading-4 text-[#705924]">{step.safety}</p> : null}{!targetReady ? <UnavailableGuideAction step={step} routeMatches={routeMatches} onOpenRoute={onOpenRoute} /> : null}</div>;
}

function UnavailableGuideAction({ step, routeMatches, onOpenRoute }: { step: OperatorGuideStep; routeMatches: boolean; onOpenRoute: () => void }) {
  return <div className="mt-3 border-t border-[#e3e8e6] pt-3 text-[10px] leading-4 text-[#6e561f]">{unavailableGuideMessage(step, routeMatches)}{!routeMatches ? <button type="button" onClick={onOpenRoute} className="mt-2 flex h-8 items-center gap-2 border border-[#9c8145] px-3 text-[9px] font-black uppercase tracking-[0.06em] text-[#6e561f] hover:bg-[#fffaf0]">Open page <ArrowRight size={12} /></button> : null}</div>;
}

function unavailableGuideMessage(step: OperatorGuideStep, routeMatches: boolean) {
  if (!routeMatches) return "This step is on another Pipeline page.";
  if (step.optionalTarget) return "This control is not available for this training record. Skip this step to continue.";
  return "This control is not available yet. Skip this step or open the required page.";
}

function GuideConversationFooter({ stepIndex, stepCount, canConfirm, onBack, onAdvance }: { stepIndex: number; stepCount: number; canConfirm: boolean; onBack: () => void; onAdvance: () => void }) {
  return <footer className="flex items-center justify-between gap-2 border-t border-[#d8dfdc] bg-[#fafcfb] px-3 py-3"><button type="button" disabled={stepIndex === 0} onClick={onBack} className="flex h-9 items-center gap-1.5 px-2 text-[9px] font-black text-[#626d69] disabled:invisible"><ArrowLeft size={13} /> Back</button><div className="flex items-center gap-1.5"><button type="button" onClick={onAdvance} className="h-9 px-2 text-[9px] font-black text-[#66716d] hover:text-[#111111]">{stepIndex === stepCount - 1 ? "Skip and finish" : "Skip step"}</button>{canConfirm ? <button type="button" onClick={onAdvance} className="flex h-9 items-center gap-2 bg-[#0f8b73] px-4 text-[9px] font-black text-white">{guideAdvanceLabel(stepIndex, stepCount)}<ArrowRight size={13} /></button> : <span className="flex h-9 items-center gap-1.5 px-2 text-[9px] font-black text-[#0c705f]">Use control <ChevronRight size={12} /></span>}</div></footer>;
}

function guideAdvanceLabel(stepIndex: number, stepCount: number) {
  if (stepIndex === stepCount - 1) return "Finish";
  return "Continue";
}

function GuideSpotlight({ rect }: { rect: DOMRect }) {
  const pad = 6;
  const left = Math.max(0, rect.left - pad);
  const top = Math.max(0, rect.top - pad);
  const right = Math.min(window.innerWidth, rect.right + pad);
  const bottom = Math.min(window.innerHeight, rect.bottom + pad);
  return (
    <div aria-hidden="true" data-testid="guide-spotlight" className="pointer-events-none fixed inset-0 z-[80]">
      <span className="absolute left-0 top-0 w-full bg-[#10201b]/30" style={{ height: top }} />
      <span className="absolute left-0 bg-[#10201b]/30" style={{ top, width: left, height: Math.max(0, bottom - top) }} />
      <span className="absolute right-0 bg-[#10201b]/30" style={{ top, width: Math.max(0, window.innerWidth - right), height: Math.max(0, bottom - top) }} />
      <span className="absolute bottom-0 left-0 w-full bg-[#10201b]/30" style={{ top: bottom }} />
      <span data-testid="guide-spotlight-outline" className="absolute border-2 border-[#13977d] shadow-[0_0_0_3px_rgba(255,255,255,0.96),0_0_0_6px_rgba(15,139,115,0.26)] transition-[left,top,width,height] duration-150" style={{ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }} />
    </div>
  );
}

function guidePanelSide(rect: DOMRect | null): "left" | "right" {
  if (!rect || window.innerWidth < 640) return "right";
  const panelLeft = window.innerWidth - 396;
  const panelTop = Math.max(16, window.innerHeight - 576);
  return rect.right > panelLeft - 12 && rect.bottom > panelTop - 12 ? "left" : "right";
}

function findVisibleGuideTarget(id: string) {
  const candidates = [...document.querySelectorAll<HTMLElement>(`[data-guide-target~="${id}"]`)];
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
  markGuideNavigationForResume();
  window.location.assign(toPipelinePath(`${destination.pathname}${destination.search}`));
}

function markGuideNavigationForResume() {
  try {
    window.sessionStorage.setItem(OPERATOR_GUIDE_NAVIGATION_RESUME_KEY, "true");
  } catch {
    // A full navigation will pause the guide when browser storage is unavailable.
  }
}

function shouldResumeGuideNavigation() {
  try {
    const shouldResume = window.sessionStorage.getItem(OPERATOR_GUIDE_NAVIGATION_RESUME_KEY) === "true";
    window.sessionStorage.removeItem(OPERATOR_GUIDE_NAVIGATION_RESUME_KEY);
    return shouldResume;
  } catch {
    return false;
  }
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

function normalizeRoles(roles: readonly string[]): readonly OperatorRole[] {
  const allowed: readonly OperatorRole[] = ["admin", "assessment_coordinator", "reviewer", "viewer"];
  const normalized = allowed.filter((role) => roles.includes(role));
  return normalized.length > 0 ? normalized : ["viewer"];
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
