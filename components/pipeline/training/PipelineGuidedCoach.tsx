"use client";

import {
  ArrowLeft,
  ArrowRight,
  Search,
  Check,
  ChevronRight,
  Compass,
  Pause,
  X,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties } from "react";

import { fetchCurrentPipelineUser, fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { fromPipelinePath, toPipelinePath } from "@/lib/pipeline/base-path";
import { PIPELINE_NAVIGATION_EVENT, pushPipelineHistory } from "@/lib/pipeline/client-navigation";
import {
  getOperatorGuidedTutorial,
  guidedTutorialsForRoles,
  operatorGuideStepTitle,
  type OperatorGuidedTutorial,
  type OperatorGuidePlacement,
  type OperatorGuideStep,
} from "@/lib/training/operator-guided-tutorials";
import {
  emptyOperatorGuideState,
  consumePendingOperatorGuideEvent,
  normalizeOperatorGuideState,
  OPERATOR_GUIDE_EVENT,
  OPERATOR_GUIDE_NAVIGATION_RESUME_KEY,
  OPERATOR_GUIDE_STORAGE_KEY,
  reduceOperatorGuideState,
  type OperatorGuideEvent,
  type OperatorGuideState,
} from "@/lib/training/operator-guided-tour-state";
import {
  mergeOperatorProgress,
  normalizeOperatorProgress,
  type OperatorProgressRecord,
  type OperatorTrainingProgress,
  type OperatorTutorialResult,
} from "@/lib/training/operator-training-progress-contract";
import { usePipelineShell } from "@/components/pipeline/pipeline-shell-context";
import { guideRouteMatches, guideWorkspaceAvailable, resolveGuideDestination } from "@/lib/training/operator-guide-navigation";
import { operatorGuideCanComplete } from "@/lib/training/operator-guided-tour-state";
import type { OperatorRole } from "@/lib/training/operator-training-types";

type TargetView = {
  stepId?: string;
  element: HTMLElement | null;
  rect: DOMRect | null;
  available: boolean;
};

type ProgressSyncState = "idle" | "server" | "browser" | "guide";

const emptyTarget: TargetView = { element: null, rect: null, available: false };
export default function PipelineGuidedCoach() {
  const [state, setState] = useState<OperatorGuideState>(() => emptyOperatorGuideState());
  const [hydrated, setHydrated] = useState(false);
  const [roles, setRoles] = useState<readonly OperatorRole[]>(["viewer"]);
  const [target, setTarget] = useState<TargetView>(emptyTarget);
  const [locationKey, setLocationKey] = useState("");
  const [progressSyncState, setProgressSyncState] = useState<ProgressSyncState>("idle");
  const { beforeNavigationRef } = usePipelineShell();
  const navigating = useRef(false);
  const navigationGeneration = useRef(0);
  const [navigationError, setNavigationError] = useState("");
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const tutorial = getOperatorGuidedTutorial(state.activeTutorialId);
  const step = tutorial?.steps[state.stepIndex];

  function commit(event: OperatorGuideEvent) {
    if (event.type === "close" || event.type === "end" || event.type === "open-library") navigationGeneration.current += 1;
    setState((current) => {
      const next = reduceOperatorGuideState(current, event);
      writeGuideState(next);
      return next;
    });
  }

  function queueProgressSync(tutorialId: string, result: OperatorTutorialResult) {
    syncQueueRef.current = syncQueueRef.current
      .catch(() => undefined)
      .then(() => syncTutorialProgress(tutorialId, result))
      .then((syncState) => setProgressSyncState(syncState));
  }


  async function openGuideRoute(route: string, context = tutorial?.context ?? "app", freshPractice = false) {
    if (navigating.current) return false;
    const location = currentGuideLocationKey();
    const destination = resolveGuideDestination(route, location, context, freshPractice && context === "practice" ? crypto.randomUUID() : undefined);
    if (!destination) {
      setNavigationError("Open the referral workspace first, then start this tutorial.");
      return false;
    }
    if (!freshPractice && guideRouteMatches(route, location)) return true;
    navigating.current = true;
    const generation = navigationGeneration.current;
    try {
      await beforeNavigationRef.current?.();
      if (generation !== navigationGeneration.current) return false;
      setNavigationError("");
      if (fromPipelinePath(window.location.pathname) === "/") pushPipelineHistory(destination);
      else {
        markGuideNavigationForResume();
        window.location.assign(toPipelinePath(destination));
      }
      return true;
    } catch {
      setNavigationError("The current work could not be saved. Resolve its save error, then try again.");
      return false;
    } finally {
      navigating.current = false;
    }
  }

  async function allowedTutorial(tutorialId: string) {
    const identity = await fetchCurrentPipelineUser().catch(() => null);
    const effectiveRoles = normalizeRoles(identity?.user?.roles ?? []);
    setRoles(effectiveRoles);
    return guidedTutorialsForRoles(effectiveRoles).find((item) => item.id === tutorialId);
  }

  async function startTutorial(tutorialId: string, requestedStepIndex = 0) {
    const generation = ++navigationGeneration.current;
    const selected = await allowedTutorial(tutorialId);
    if (generation !== navigationGeneration.current) return;
    if (!selected || (selected.context === "workspace" && !guideWorkspaceAvailable(currentGuideLocationKey()))) return;
    const stepIndex = Math.min(selected.steps.length - 1, Math.max(0, requestedStepIndex));
    if (!await openGuideRoute(selected.steps[stepIndex].route, selected.context, true)) return;
    const now = new Date().toISOString();
    commit({ type: "start", tutorialId, stepIndex });
    queueProgressSync(tutorialId, { status: "started", currentStep: stepIndex, startedAt: now, updatedAt: now });
  }

  async function startTutorialSequence(requestedIds: readonly string[]) {
    const generation = ++navigationGeneration.current;
    const identity = await fetchCurrentPipelineUser().catch(() => null);
    if (generation !== navigationGeneration.current) return;
    const allowed = guidedTutorialsForRoles(normalizeRoles(identity?.user?.roles ?? []));
    const tutorialIds = [...new Set(requestedIds)].filter((id) => allowed.some((item) => item.id === id && item.context !== "workspace"));
    const first = getOperatorGuidedTutorial(tutorialIds[0]);
    if (!first || !await openGuideRoute(first.steps[0].route, first.context, true)) return;
    const now = new Date().toISOString();
    commit({ type: "start-sequence", tutorialIds });
    queueProgressSync(first.id, { status: "started", currentStep: 0, startedAt: now, updatedAt: now });
  }

  async function advance(expectedStepId?: string, skipped = false) {
    if (!tutorial || !step || navigating.current) return;
    if (expectedStepId && step.id !== expectedStepId) return;
    if (!skipped && !guideRouteMatches(step.route, currentGuideLocationKey())) return;
    const lastStep = state.stepIndex === tutorial.steps.length - 1;
    const now = new Date().toISOString();
    if (lastStep) {
      const nextTutorial = getOperatorGuidedTutorial(state.sequenceTutorialIds[state.sequenceIndex + 1]);
      if (nextTutorial && !await openGuideRoute(nextTutorial.steps[0].route, nextTutorial.context, true)) return;
      const complete = operatorGuideCanComplete(state, skipped);
      commit({ type: "finish", skipped });
      queueProgressSync(tutorial.id, { status: complete ? "completed" : "started", currentStep: state.stepIndex,
        startedAt: state.startedAt ?? now, updatedAt: now, ...(complete ? { completedAt: now } : {}) });
      if (complete) window.dispatchEvent(new CustomEvent("pipeline:guided-tutorial-completed", { detail: { tutorialId: tutorial.id } }));
      return;
    }
    const nextIndex = state.stepIndex + 1;
    if (!await openGuideRoute(tutorial.steps[nextIndex].route)) return;
    commit({ type: "next", skipped });
    queueProgressSync(tutorial.id, { status: "started", currentStep: nextIndex, startedAt: state.startedAt ?? now, updatedAt: now });
  }

  async function goBack() {
    if (!tutorial) return;
    const previousStep = findPreviousGuideStep(state, tutorial);
    if (previousStep && await openGuideRoute(previousStep.route)) commit({ type: "previous" });
  }

  async function resumeTutorial() {
    if (!tutorial || !step || !await allowedTutorial(tutorial.id)) { commit({ type: "open-library" }); return; }
    if (await openGuideRoute(step.route)) commit({ type: "resume" });
  }

  const handleExternalGuideEvent = useEffectEvent((event: Extract<OperatorGuideEvent, { type: "open-library" | "start" | "start-sequence" }>) => {
    if (event.type === "open-library") commit(event);
    else if (event.type === "start") startTutorial(event.tutorialId, event.stepIndex);
    else startTutorialSequence(event.tutorialIds);
  });
  const advanceFromTarget = useEffectEvent((expectedStepId: string) => advance(expectedStepId));

  useEffect(() => {
    let cancelled = false;
    const handleGuideEvent = (event: Event) => {
      const detail = (event as CustomEvent<OperatorGuideEvent>).detail;
      if (!detail || (detail.type !== "open-library" && detail.type !== "start" && detail.type !== "start-sequence")) return;
      handleExternalGuideEvent(consumePendingOperatorGuideEvent() ?? detail);
    };
    window.addEventListener(OPERATOR_GUIDE_EVENT, handleGuideEvent);

    queueMicrotask(() => {
      if (cancelled) return;
      const stored = readGuideState();
      const next = shouldResumeGuideNavigation()
        ? stored
        : emptyOperatorGuideState();
      writeGuideState(next);
      setState(next);
      setLocationKey(currentGuideLocationKey());
      setHydrated(true);
      const pending = consumePendingOperatorGuideEvent();
      if (pending) handleExternalGuideEvent(pending);
    });

    fetchCurrentPipelineUser()
      .then((payload) => setRoles(normalizeRoles(payload.user?.roles ?? [])))
      .catch(() => setRoles(["viewer"]));

    return () => {
      cancelled = true;
      window.removeEventListener(OPERATOR_GUIDE_EVENT, handleGuideEvent);
    };
  }, []);

  const handleLocationChange = useEffectEvent(() => {
    setLocationKey(currentGuideLocationKey());
    setState((current) => {
      if (current.mode === "active") return current;
      const next = emptyOperatorGuideState();
      writeGuideState(next);
      return next;
    });
  });

  useEffect(() => {
    const changed = () => handleLocationChange();
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

    let frame = 0;
    let didScroll = false;

    // Capture against the current target before React replaces a question screen.
    const detectInteraction = (event: Event) => {
      const candidate = findVisibleGuideTarget(step.target);
      if (guideRouteMatches(step.route, currentGuideLocationKey()) && candidate && event.target instanceof Node && candidate.contains(event.target) && guideAdvanceEvent(step, candidate) === event.type) {
        window.setTimeout(() => advanceFromTarget(step.id), 0);
      }
    };
    const interactionEvents = ["click", "input", "change", "pipeline:guide-complete"] as const;
    for (const event of interactionEvents) document.addEventListener(event, detectInteraction, true);

    const measure = () => {
      revealCollapsedGuideTarget(step.target);
      const candidate = findVisibleGuideTarget(step.target);
      didScroll = scrollGuideTargetIntoView(candidate, didScroll);
      setTarget({ ...targetView(candidate), stepId: step.id });
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
      for (const event of interactionEvents) document.removeEventListener(event, detectInteraction, true);
    };
  }, [locationKey, state.mode, state.stepIndex, step]);

  if (!hydrated) return null;
  const pathname = fromPipelinePath(window.location.pathname);
  if (pathname === "/training/demo" || pathname === "/note-lab" || pathname.startsWith("/note-lab/")) return null;
  const currentTarget = target.stepId === step?.id && step && guideRouteMatches(step.route, locationKey) ? target : emptyTarget;
  return <><span hidden data-pipeline-ready="guided-coach" /><GuideCoachSurface state={state} roles={roles} tutorial={tutorial} step={step} target={currentTarget} locationKey={locationKey} progressSyncState={progressSyncState} navigationError={navigationError} onOpenRoute={() => { if (step) void openGuideRoute(step.route); }} onSkip={() => { void advance(undefined, true); }} onStart={startTutorial} onCommit={commit} onAdvance={() => advance()} onBack={goBack} onResume={resumeTutorial} /></>;
}

function GuideCoachSurface({ state, roles, tutorial, step, target, locationKey, progressSyncState, navigationError, onOpenRoute, onSkip, onStart, onCommit, onAdvance, onBack, onResume }: { state: OperatorGuideState; roles: readonly OperatorRole[]; tutorial: ReturnType<typeof getOperatorGuidedTutorial>; step: OperatorGuideStep | undefined; target: TargetView; locationKey: string; progressSyncState: ProgressSyncState; navigationError: string; onOpenRoute: () => void; onSkip: () => void; onStart: (id: string) => void; onCommit: (event: OperatorGuideEvent) => void; onAdvance: () => void; onBack: () => void; onResume: () => void }) {
  if (state.mode === "closed") return null;
  if (state.mode === "library") return <GuideLibrary locationKey={locationKey} navigationError={navigationError} roles={roles} completed={state.completedTutorialIds} resumableTutorialId={state.activeTutorialId} onStart={onStart} onResume={onResume} onClose={() => onCommit({ type: "close" })} />;
  if (!tutorial || !step) return null;
  const conversation = <GuideConversation tutorial={tutorial} step={step} stepIndex={state.stepIndex} sequenceIndex={state.sequenceIndex} sequenceCount={state.sequenceTutorialIds.length} targetAvailable={target.available} targetRect={target.rect} routeMatches={guideRouteMatches(step.route, locationKey)} progressSyncState={progressSyncState} onBack={onBack} onAdvance={onAdvance} onOpenRoute={onOpenRoute} onSkip={onSkip} navigationError={navigationError} onPause={() => onCommit({ type: "close" })} onEnd={() => onCommit({ type: "end" })} />;
  return <>{target.available && target.rect ? <GuideSpotlight rect={target.rect} /> : null}{conversation}</>;
}

function findPreviousGuideStep(state: OperatorGuideState, tutorial: OperatorGuidedTutorial) {
  if (state.stepIndex > 0) return tutorial.steps[state.stepIndex - 1];
  const previousTutorial = getOperatorGuidedTutorial(state.sequenceTutorialIds[state.sequenceIndex - 1]);
  return previousTutorial?.steps.at(-1);
}

function scrollGuideTargetIntoView(candidate: HTMLElement | null, alreadyScrolled: boolean) {
  if (!candidate || alreadyScrolled) return alreadyScrolled;
  const rect = candidate.getBoundingClientRect();
  if (!isMostlyVisible(rect)) {
    candidate.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
    return true;
  }

  const sideRoom = Math.max(rect.left, window.innerWidth - rect.right);
  const verticalRoom = Math.max(rect.top - 82, window.innerHeight - rect.bottom);
  if (sideRoom < 446 && verticalRoom < 240) {
    candidate.scrollIntoView({
      behavior: "auto",
      block: rect.top < window.innerHeight / 2 ? "start" : "end",
      inline: "nearest",
    });
  }
  return true;
}

function targetView(candidate: HTMLElement | null): TargetView {
  const rect = candidate?.getBoundingClientRect() ?? null;
  return { element: candidate, rect, available: Boolean(candidate && rect && rect.width > 0 && rect.height > 0) };
}

function GuideLibrary({ roles, completed, locationKey, navigationError, resumableTutorialId, onStart, onResume, onClose }: { roles: readonly OperatorRole[]; completed: readonly string[]; locationKey: string; navigationError: string; resumableTutorialId: string | null; onStart: (id: string) => void; onResume: () => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { search.current?.focus(); }, []);
  const tutorials = guidedTutorialsForRoles(roles).filter((item) => (item.title + " " + item.summary).toLowerCase().includes(query.toLowerCase().trim()));
  const workspace = guideWorkspaceAvailable(locationKey);
  const resumable = tutorials.find((item) => item.id === resumableTutorialId);
  const groups = [
    { id: "workspace", label: "In this workspace" },
    { id: "app", label: "Around Pipeline" },
    { id: "practice", label: "Practice separately" },
  ] as const;
  return <section role="dialog" aria-label="Tutorials" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }} className="fixed bottom-4 right-4 z-[120] flex max-h-[calc(100dvh-2rem)] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-[#b9c7c2] bg-white shadow-[0_16px_48px_rgba(17,35,30,0.2)]">
    <header className="flex items-center justify-between border-b border-[#d8dfdc] px-4 py-3">
      <h2 className="flex items-center gap-2 text-lg font-bold text-[#1d3028]"><Compass size={18} /> Tutorials</h2>
      <button type="button" aria-label="Close tutorials" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded hover:bg-[#edf4f0]"><X size={18} /></button>
    </header>
    <label className="mx-4 my-3 flex items-center gap-2 rounded border border-[#cbd7d1] px-3 focus-within:ring-2 focus-within:ring-[#0f8b73]"><Search size={16} aria-hidden="true" /><input ref={search} aria-label="Search tutorials" placeholder="Find a task" value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
    {navigationError ? <p role="alert" className="px-4 pb-3 text-sm text-[#a13b30]">{navigationError}</p> : null}
    <div className="min-h-0 overflow-y-auto px-4 pb-3">
      {resumable ? <button type="button" onClick={onResume} className="mb-3 flex w-full items-center justify-between border-b border-[#cbd7d1] py-3 text-left text-sm font-semibold text-[#0c705f]">Resume {resumable.title}<ArrowRight size={16} /></button> : null}
      {groups.map((group) => {
        const items = tutorials.filter((item) => item.context === group.id);
        if (!items.length) return null;
        return <section key={group.id} className="mb-4">
          <h3 className="mb-1 text-xs font-bold text-[#4b6155]">{group.label}</h3>
          {group.id === "workspace" && !workspace ? <p className="mb-2 text-xs text-[#67756d]">Open a referral to use these tutorials.</p> : null}
          <div className="divide-y divide-[#e5ebe7]">{items.map((item) => <button key={item.id} type="button" onClick={() => onStart(item.id)} disabled={item.context === "workspace" && !workspace} aria-label={"Start tutorial: " + item.title} className="flex w-full items-center gap-3 py-3 text-left hover:text-[#0c705f] disabled:opacity-45">
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.title}</span><span className="mt-1 block text-xs leading-4 text-[#67756d]">{item.summary}</span><span className="mt-1 block text-[11px] text-[#67756d]">{item.steps.length} steps · {item.minutes} min</span></span>
            {completed.includes(item.id) ? <Check size={16} aria-label="Walkthrough completed" /> : <ChevronRight size={16} className="shrink-0" />}
          </button>)}</div>
        </section>;
      })}
      {!tutorials.length ? <p role="status" className="py-4 text-sm text-[#67756d]">No matching tutorials.</p> : null}
    </div>
  </section>;
}

function GuideConversation({ tutorial, step, stepIndex, sequenceIndex, sequenceCount, targetAvailable, targetRect, routeMatches, progressSyncState, navigationError, onSkip, onBack, onAdvance, onOpenRoute, onPause, onEnd }: { tutorial: OperatorGuidedTutorial; step: OperatorGuideStep; stepIndex: number; sequenceIndex: number; sequenceCount: number; targetAvailable: boolean; targetRect: DOMRect | null; routeMatches: boolean; progressSyncState: ProgressSyncState; navigationError: string; onSkip: () => void; onBack: () => void; onAdvance: () => void; onOpenRoute: () => void; onPause: () => void; onEnd: () => void }) {
  const targetReady = routeMatches && targetAvailable;
  const canConfirm = step.advance === "confirm" && targetReady;
  const isFullWorkflow = sequenceCount > 1;
  const panelStyle = guidePanelLayout(targetRect, step.placement ?? "auto");
  return (
    <section role="dialog" aria-label={`${isFullWorkflow ? "Full Pipeline walkthrough" : tutorial.title} guided tutorial`} data-testid="guided-coach-panel" style={panelStyle} className="fixed z-[120] flex flex-col overflow-hidden border border-[#aebfba] bg-white shadow-[0_22px_70px_rgba(14,31,26,0.28)]">
      <header className="border-b border-[#d5ddda] bg-[#f2f6f4] px-3 py-2">
        <div className="flex items-center justify-between gap-3"><div className="min-w-0 truncate text-[10px] font-black text-[#52605a]">{isFullWorkflow ? `Module ${sequenceIndex + 1}/${sequenceCount} · ` : ""}{step.phase} · {stepIndex + 1}/{tutorial.steps.length}</div><div className="flex items-center gap-0.5"><button type="button" onClick={onPause} aria-label="Pause tutorial" title="Pause" className="flex h-8 w-8 items-center justify-center text-[#68736f] hover:bg-white hover:text-[#111111]"><Pause size={14} /></button><button type="button" onClick={onEnd} aria-label="End tutorial" title="End tutorial" className="flex h-8 w-8 items-center justify-center text-[#68736f] hover:bg-white hover:text-[#a9473d]"><X size={15} /></button></div></div>
        <div className="mt-1.5 h-1 bg-[#d7dfdc]" aria-label={`Action ${stepIndex + 1} of ${tutorial.steps.length}`}><div className="h-full bg-[#0f8b73]" style={{ width: `${((stepIndex + 1) / tutorial.steps.length) * 100}%` }} /></div>
        {progressSyncState === "browser" ? <p role="status" className="mt-1.5 text-[9px] font-bold text-[#7a5e1e]">Saving in this browser until sync resumes.</p> : null}
        {progressSyncState === "guide" ? <p role="status" className="mt-1.5 text-[9px] font-bold text-[#7a5e1e]">Saving this guide in this browser.</p> : null}
      </header>
      {navigationError ? <p role="alert" className="px-4 pt-3 text-xs text-[#a13b30]">{navigationError}</p> : null}
      <GuideConversationBody step={step} targetReady={targetReady} routeMatches={routeMatches} onOpenRoute={onOpenRoute} />
      <GuideConversationFooter step={step} stepIndex={stepIndex} stepCount={tutorial.steps.length} canConfirm={canConfirm} hasPreviousModule={sequenceIndex > 0} hasNextModule={sequenceIndex < sequenceCount - 1} onSkip={onSkip} onBack={onBack} onAdvance={onAdvance} />
    </section>
  );
}

function GuideConversationBody({ step, targetReady, routeMatches, onOpenRoute }: { step: OperatorGuideStep; targetReady: boolean; routeMatches: boolean; onOpenRoute: () => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-white px-4 py-3.5" aria-live="polite">
      <h3 className="text-[16px] font-black leading-5 text-[#1d2421]">{operatorGuideStepTitle(step)}</h3>
      <p className="mt-2 border-l-[3px] border-[#0f8b73] pl-3 text-[13px] font-bold leading-5 text-[#244b40]">{step.instruction}</p>
      {!targetReady ? <UnavailableGuideAction step={step} routeMatches={routeMatches} onOpenRoute={onOpenRoute} /> : null}
    </div>
  );
}

function UnavailableGuideAction({ step, routeMatches, onOpenRoute }: { step: OperatorGuideStep; routeMatches: boolean; onOpenRoute: () => void }) {
  return <div className="mt-4 border-t border-[#e3e8e6] pt-4 text-[13px] font-medium leading-5 text-[#6e561f]">{unavailableGuideMessage(step, routeMatches)}{!routeMatches ? <button type="button" onClick={onOpenRoute} className="mt-3 flex h-10 items-center gap-2 border border-[#9c8145] px-4 text-[11px] font-black uppercase tracking-[0.05em] text-[#6e561f] hover:bg-[#fffaf0]">Open page <ArrowRight size={14} /></button> : null}</div>;
}

function unavailableGuideMessage(step: OperatorGuideStep, routeMatches: boolean) {
  if (!routeMatches) return "This step is on another Pipeline page.";
  if (step.optionalTarget) return "This control is not available at the current stage or permission level. Skipped steps do not count as completed.";
  return "This control is not available yet. Open the required page or skip this step; skipped steps do not count as completed.";
}

function GuideConversationFooter({ step, stepIndex, stepCount, canConfirm, hasPreviousModule, hasNextModule, onSkip, onBack, onAdvance }: { step: OperatorGuideStep; stepIndex: number; stepCount: number; canConfirm: boolean; hasPreviousModule: boolean; hasNextModule: boolean; onSkip: () => void; onBack: () => void; onAdvance: () => void }) {
  return <footer className="flex items-center justify-between gap-1 border-t border-[#d8dfdc] bg-[#fafcfb] px-3 py-2"><button type="button" disabled={stepIndex === 0 && !hasPreviousModule} onClick={onBack} className="flex h-8 items-center gap-1 px-1.5 text-[10px] font-black text-[#626d69] disabled:invisible"><ArrowLeft size={13} /> Back</button><div className="flex items-center gap-1"><button type="button" onClick={onSkip} className="h-8 px-1.5 text-[10px] font-black text-[#66716d] hover:text-[#111111]">{guideSkipLabel(stepIndex, stepCount, hasNextModule)}</button>{canConfirm ? <button type="button" onClick={onAdvance} className="flex h-8 items-center gap-1.5 bg-[#0f8b73] px-3 text-[10px] font-black text-white">{guideAdvanceLabel(stepIndex, stepCount, hasNextModule)}<ArrowRight size={13} /></button> : <span className="flex h-8 items-center gap-1 px-1.5 text-[10px] font-black text-[#0c705f]">{guideInteractionLabel(step)} <ChevronRight size={12} /></span>}</div></footer>;
}

function guideInteractionLabel(step: OperatorGuideStep) {
  if (step.target === "assessment-schedule-save") return "Save the appointment";
  if (step.advance === "target-input") return "Use highlighted field";
  if (step.advance === "target-change") return "Use highlighted field";
  return "Select highlighted item";
}

function guideAdvanceLabel(stepIndex: number, stepCount: number, hasNextModule: boolean) {
  if (stepIndex === stepCount - 1) return hasNextModule ? "Next module" : "Finish";
  return "Continue";
}

function guideSkipLabel(stepIndex: number, stepCount: number, hasNextModule: boolean) {
  if (stepIndex !== stepCount - 1) return "Skip step";
  return hasNextModule ? "Skip to next" : "Skip and finish";
}

function GuideSpotlight({ rect }: { rect: DOMRect }) {
  const pad = 6;
  const left = Math.max(0, rect.left - pad);
  const top = Math.max(0, rect.top - pad);
  const right = Math.min(window.innerWidth, rect.right + pad);
  const bottom = Math.min(window.innerHeight, rect.bottom + pad);
  return (
    <div aria-hidden="true" data-testid="guide-spotlight" className="pointer-events-none fixed inset-0 z-[110]">
      <span className="absolute left-0 top-0 w-full bg-[#10201b]/30" style={{ height: top }} />
      <span className="absolute left-0 bg-[#10201b]/30" style={{ top, width: left, height: Math.max(0, bottom - top) }} />
      <span className="absolute right-0 bg-[#10201b]/30" style={{ top, width: Math.max(0, window.innerWidth - right), height: Math.max(0, bottom - top) }} />
      <span className="absolute bottom-0 left-0 w-full bg-[#10201b]/30" style={{ top: bottom }} />
      <span data-testid="guide-spotlight-outline" className="absolute border-2 border-[#13977d] shadow-[0_0_0_3px_rgba(255,255,255,0.96),0_0_0_6px_rgba(15,139,115,0.26)] transition-[left,top,width,height] duration-150" style={{ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }} />
    </div>
  );
}

function guidePanelLayout(rect: DOMRect | null, preferred: OperatorGuidePlacement): CSSProperties {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const margin = viewportWidth < 640 ? 8 : 16;
  const gap = viewportWidth < 640 ? 10 : 16;
  const width = Math.min(340, viewportWidth - margin * 2);
  const fullHeight = Math.max(1, viewportHeight - margin * 2);
  const estimatedHeight = Math.min(300, fullHeight);

  if (!rect) {
    return {
      left: viewportWidth - width - margin,
      bottom: margin,
      width,
      maxHeight: fullHeight,
    };
  }

  const space = {
    top: rect.top - gap - margin,
    right: viewportWidth - rect.right - gap - margin,
    bottom: viewportHeight - rect.bottom - gap - margin,
    left: rect.left - gap - margin,
  };
  const centeredX = clamp(rect.left + rect.width / 2 - width / 2, margin, viewportWidth - width - margin);
  const sideTop = clamp(rect.top, margin, viewportHeight - estimatedHeight - margin);
  const sideMaxHeight = Math.max(1, viewportHeight - sideTop - margin);
  const minimumVerticalSpace = Math.min(180, Math.max(120, viewportHeight * 0.24));
  const candidates: Record<Exclude<OperatorGuidePlacement, "auto">, CSSProperties | null> = {
    right: space.right >= width ? { left: rect.right + gap, top: sideTop, width, maxHeight: sideMaxHeight } : null,
    left: space.left >= width ? { left: rect.left - gap - width, top: sideTop, width, maxHeight: sideMaxHeight } : null,
    bottom: space.bottom >= minimumVerticalSpace ? { left: centeredX, top: rect.bottom + gap, width, maxHeight: space.bottom } : null,
    top: space.top >= minimumVerticalSpace ? { left: centeredX, bottom: viewportHeight - rect.top + gap, width, maxHeight: space.top } : null,
  };
  const automaticOrder: readonly Exclude<OperatorGuidePlacement, "auto">[] = viewportWidth < 640
    ? (space.bottom >= space.top ? ["bottom", "top", "right", "left"] : ["top", "bottom", "right", "left"])
    : ["right", "left", "bottom", "top"];
  const requestedOrder = preferred === "auto"
    ? automaticOrder
    : [preferred, ...automaticOrder.filter((placement) => placement !== preferred)];
  for (const placement of requestedOrder) {
    const candidate = candidates[placement];
    if (candidate) return candidate;
  }

  return { right: margin, bottom: margin, width, maxHeight: Math.min(360, fullHeight) };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function findVisibleGuideTarget(id: string) {
  const candidates = [...document.querySelectorAll<HTMLElement>(`[data-guide-target~="${id}"]`)];
  return candidates.find((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
  }) ?? null;
}

function revealCollapsedGuideTarget(id: string) {
  const candidate = document.querySelector<HTMLElement>(`[data-guide-target~="${id}"]`);
  const details = candidate?.closest<HTMLDetailsElement>("details:not([open])");
  const summary = details?.querySelector<HTMLElement>(":scope > summary");
  if (summary) summary.click();
}

function currentGuideLocationKey() {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}`;
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
    return normalizeOperatorGuideState(JSON.parse(window.sessionStorage.getItem(OPERATOR_GUIDE_STORAGE_KEY) ?? "null"));
  } catch {
    return emptyOperatorGuideState();
  }
}

function writeGuideState(state: OperatorGuideState) {
  try {
    window.sessionStorage.setItem(OPERATOR_GUIDE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The active in-memory guide remains usable when browser storage is unavailable.
  }
}

async function syncTutorialProgress(tutorialId: string, result: OperatorTutorialResult) {
  const identity = await fetchCurrentPipelineUser().catch(() => null);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const record = await fetchPipelineJson<OperatorProgressRecord>("/api/training/progress", { cache: "no-store" }, { maxResponseBytes: 360_000 });
      const currentProgress = await mergeServerAndBrowserProgress(record, identity);
      const progress: OperatorTrainingProgress = {
        ...currentProgress,
        tutorialResults: { ...currentProgress.tutorialResults, [tutorialId]: mergeTutorialResult(currentProgress.tutorialResults[tutorialId], result) },
      };
      await fetchPipelineJson<OperatorProgressRecord>("/api/training/progress", {
        method: "PUT",
        body: JSON.stringify({ expectedRevision: record.revision, progress }),
      }, { maxResponseBytes: 360_000 });
      return "server" as const;
    } catch (error) {
      if (error instanceof PipelineApiError && error.status === 409) continue;
      return saveTutorialProgressFallback(identity, tutorialId, result);
    }
  }
  return saveTutorialProgressFallback(identity, tutorialId, result);
}

async function mergeServerAndBrowserProgress(record: OperatorProgressRecord, identity: Awaited<ReturnType<typeof fetchCurrentPipelineUser>> | null) {
  const browserProgress = identity?.user?.id
    ? await readBrowserTrainingProgress(identity.user.id, identity.user.roles)
    : null;
  return browserProgress
    ? mergeOperatorProgress(record.progress, browserProgress, identity?.user?.roles ?? [record.progress.role])
    : record.progress;
}

async function saveTutorialProgressFallback(identity: Awaited<ReturnType<typeof fetchCurrentPipelineUser>> | null, tutorialId: string, result: OperatorTutorialResult) {
  if (identity?.user?.id && await saveBrowserTrainingProgress(identity.user.id, identity.user.roles, tutorialId, result)) return "browser" as const;
  return "guide" as const;
}

async function saveBrowserTrainingProgress(principalId: string, roles: readonly string[], tutorialId: string, result: OperatorTutorialResult) {
  try {
    const key = await browserTrainingProgressKey(principalId);
    const stored = JSON.parse(window.localStorage.getItem(key) ?? "null") as Partial<OperatorTrainingProgress> | null;
    const current = stored?.tutorialResults?.[tutorialId];
    const next = normalizeOperatorProgress({
      ...(stored ?? {}),
      role: primaryRole(roles),
      tutorialResults: { ...(stored?.tutorialResults ?? {}), [tutorialId]: mergeTutorialResult(current, result) },
    }, roles);
    window.localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent("pipeline:training-progress-local", { detail: { tutorialId } }));
    return true;
  } catch {
    // The guide's own completion record remains available in browser storage.
    return false;
  }
}

async function readBrowserTrainingProgress(principalId: string, roles: readonly string[]) {
  try {
    const key = await browserTrainingProgressKey(principalId);
    const stored = window.localStorage.getItem(key);
    return stored ? normalizeOperatorProgress(JSON.parse(stored), roles) : null;
  } catch {
    return null;
  }
}

async function browserTrainingProgressKey(principalId: string) {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(principalId));
  const identity = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("").slice(0, 16);
  return `pipeline-operator-training:${identity}`;
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

function guideAdvanceEvent(step: OperatorGuideStep, target: HTMLElement) {
  if (usesVerifiedCompletionEvent(step)) return "pipeline:guide-complete" as const;
  if (step.advance === "target-input") return "input" as const;
  if (step.advance === "target-change") return "change" as const;
  if (step.advance === "target-click") return target instanceof HTMLSelectElement ? "change" as const : "click" as const;
  return null;
}

function usesVerifiedCompletionEvent(step: OperatorGuideStep) {
  return step.advance !== "confirm" && (step.target === "initial-packet-upload" || step.target === "assessment-schedule-save");
}

function isMostlyVisible(rect: DOMRect) {
  return rect.top >= 82 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
}
