"use client";

import {
  ArrowLeft,
  ArrowRight,
  LayoutDashboard,
  CircleHelp,
  Check,
  ChevronRight,
  Compass,
  ChevronDown,
  ChevronUp,
  ListOrdered,
  LocateFixed,
  PanelRightClose,
  X,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { fetchCurrentPipelineUser, fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { fromPipelinePath, toPipelinePath } from "@/lib/pipeline/base-path";
import { PIPELINE_NAVIGATION_EVENT, pushPipelineHistory } from "@/lib/pipeline/client-navigation";
import {
  getOperatorGuidedTutorial,
  guidedTutorialsForUser,
  operatorGuideNextActions,
  operatorGuideStepTitle,
  type OperatorGuidedTutorial,
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
import styles from "./PipelineGuidedCoach.module.css";
import { tutorialReferralEntry } from "@/lib/training/tutorial-referral";

type TargetView = {
  stepId?: string;
  element: HTMLElement | null;
  rect: DOMRect | null;
  available: boolean;
};

type ProgressSyncState = "idle" | "server" | "browser" | "guide";

const emptyTarget: TargetView = { element: null, rect: null, available: false };
type PendingGuide = { id: string; stepIndex: number; resume: boolean };
export default function PipelineGuidedCoach() {
  const [state, setState] = useState<OperatorGuideState>(() => emptyOperatorGuideState());
  const [hydrated, setHydrated] = useState(false);
  const [allowedGuides, setAllowedGuides] = useState<readonly OperatorGuidedTutorial[]>([]);
  const [target, setTarget] = useState<TargetView>(emptyTarget);
  const [locationKey, setLocationKey] = useState("");
  const [progressSyncState, setProgressSyncState] = useState<ProgressSyncState>("idle");
  const { beforeNavigationRef } = usePipelineShell();
  const navigating = useRef(false);
  const navigationGeneration = useRef(0);
  const [navigationError, setNavigationError] = useState("");
  const [pendingGuide, setPendingGuide] = useState<PendingGuide | null>(null);
  const pendingTargetNavigation = useRef<string | null>(null);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const tutorial = getOperatorGuidedTutorial(state.activeTutorialId);
  const step = tutorial?.steps[state.stepIndex];

  function commit(event: OperatorGuideEvent) {
    if (event.type === "close" || event.type === "end") { setPendingGuide(null); pendingTargetNavigation.current = null; }
    if (event.type === "close" || event.type === "end" || event.type === "open-library") navigationGeneration.current += 1;
    if (event.type === "close" && document.activeElement?.closest("[data-guide-dock]")) {
      queueMicrotask(() => {
        const controls = document.querySelectorAll<HTMLElement>('[data-guide-target="guided-help"], button[aria-label^="Open page menu"]');
        [...controls].find((control) => control.getClientRects().length > 0)?.focus();
      });
    }
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
    const destination = resolveGuideDestination(route, location, context, freshPractice && (context === "practice" || context === "intake") ? crypto.randomUUID() : undefined);
    if (!destination) {
      setNavigationError(context === "intake" ? "Return to your intake draft to resume these tips. To start a new referral, choose Create a referral in Tutorials." : "Choose the client's card on your Home Board, then return to this help.");
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
    const allowed = guidedTutorialsForUser(identity?.user);
    setAllowedGuides(allowed);
    return allowed.find((item) => item.id === tutorialId);
  }

  async function startTutorial(tutorialId: string, requestedStepIndex = 0) {
    const generation = ++navigationGeneration.current;
    const selected = await allowedTutorial(tutorialId);
    if (generation !== navigationGeneration.current) return;
    if (!selected) return;
    if (tutorialReferralEntry(selected.id) !== undefined) {
      try {
        await beforeNavigationRef.current?.();
        if (generation !== navigationGeneration.current) return;
        const params = new URLSearchParams({ task: selected.id, returnTo: fromPipelinePath(window.location.pathname) === "/" ? `/${window.location.search}` : "/" });
        commit({ type: "close" });
        window.location.assign(toPipelinePath(`/tutorials/referral?${params}`));
      } catch { setNavigationError("Your current work could not be saved. Resolve its save error before opening the sample."); }
      return;
    }
    if (selected.context === "workspace" && !guideWorkspaceAvailable(currentGuideLocationKey())) {
      commit({ type: "open-library" });
      setPendingGuide({ id: tutorialId, stepIndex: requestedStepIndex, resume: false });
      return;
    }
    setPendingGuide(null);
    const stepIndex = Math.min(selected.steps.length - 1, Math.max(0, requestedStepIndex));
    if (!await openGuideRoute(selected.steps[stepIndex].route, selected.context, true)) return;
    const now = new Date().toISOString();
    commit({ type: "start", tutorialId, stepIndex });
    queueProgressSync(tutorialId, { status: "started", currentStep: stepIndex, startedAt: now, updatedAt: now });
  }

  async function startTutorialSequence(requestedIds: readonly string[]) {
    const sampleTutorial = requestedIds.find((id) => tutorialReferralEntry(id) !== undefined);
    if (sampleTutorial) return startTutorial(sampleTutorial);
    const generation = ++navigationGeneration.current;
    const identity = await fetchCurrentPipelineUser().catch(() => null);
    if (generation !== navigationGeneration.current) return;
    const allowed = guidedTutorialsForUser(identity?.user);
    setAllowedGuides(allowed);
    const tutorialIds = [...new Set(requestedIds)].filter((id) => allowed.some((item) => item.id === id && item.context !== "workspace" && item.context !== "intake"));
    const first = getOperatorGuidedTutorial(tutorialIds[0]);
    if (!first || !await openGuideRoute(first.steps[0].route, first.context, true)) return;
    const now = new Date().toISOString();
    commit({ type: "start-sequence", tutorialIds });
    queueProgressSync(first.id, { status: "started", currentStep: 0, startedAt: now, updatedAt: now });
  }

  async function finishTutorial(tutorial: OperatorGuidedTutorial, now: string, skipped: boolean) {
      const nextTutorial = getOperatorGuidedTutorial(state.sequenceTutorialIds[state.sequenceIndex + 1]);
      if (nextTutorial && !await openGuideRoute(nextTutorial.steps[0].route, nextTutorial.context, true)) return;
      const complete = operatorGuideCanComplete(state, skipped);
      commit({ type: "finish", skipped });
      queueProgressSync(tutorial.id, { status: complete ? "completed" : "started", currentStep: state.stepIndex,
        startedAt: state.startedAt ?? now, updatedAt: now, ...(complete ? { completedAt: now } : {}) });
      if (complete) window.dispatchEvent(new CustomEvent("pipeline:guided-tutorial-completed", { detail: { tutorialId: tutorial.id } }));
  }

  function canAdvanceCurrentStep(step: OperatorGuideStep, expectedStepId: string | undefined, skipped: boolean) {
    if (navigating.current) return false;
    if (expectedStepId && step.id !== expectedStepId) return false;
    return skipped || Boolean(expectedStepId) || guideRouteMatches(step.route, currentGuideLocationKey());
  }

  async function advance(expectedStepId?: string, skipped = false) {
    if (!tutorial || !step) return;
    if (!canAdvanceCurrentStep(step, expectedStepId, skipped)) return;
    const lastStep = state.stepIndex === tutorial.steps.length - 1;
    const now = new Date().toISOString();
    if (lastStep) return finishTutorial(tutorial, now, skipped);
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

  async function goToStep(stepIndex: number) {
    const nextStep = tutorial?.steps[stepIndex];
    if (!nextStep || !await openGuideRoute(nextStep.route)) return;
    commit({ type: "go-to-step", stepIndex });
  }

  async function resumeTutorial() {
    if (tutorial && tutorialReferralEntry(tutorial.id) !== undefined) return startTutorial(tutorial.id);
    if (!tutorial || !step || !await allowedTutorial(tutorial.id)) { commit({ type: "open-library" }); return; }
    if (tutorial.context === "workspace" && !guideWorkspaceAvailable(currentGuideLocationKey())) {
      setPendingGuide({ id: tutorial.id, stepIndex: state.stepIndex, resume: true });
      return;
    }
    setPendingGuide(null);
    if (await openGuideRoute(step.route)) commit({ type: "resume" });
  }

  const handleExternalGuideEvent = useEffectEvent((event: Extract<OperatorGuideEvent, { type: "open-library" | "start" | "start-sequence" }>) => {
    if (event.type === "open-library") commit(event);
    else if (event.type === "start") startTutorial(event.tutorialId, event.stepIndex);
    else startTutorialSequence(event.tutorialIds);
  });
  const advanceFromTarget = useEffectEvent((expectedStepId: string) => advance(expectedStepId));
  const observeOpenSchedule = useEffectEvent(() => { if (step?.id === "schedule-open") commit({ type: "next" }); });

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
        : { ...stored, mode: "closed" as const };
      writeGuideState(next);
      setState(next);
      setLocationKey(currentGuideLocationKey());
      setHydrated(true);
      const pending = consumePendingOperatorGuideEvent();
      if (pending) handleExternalGuideEvent(pending);
    });

    fetchCurrentPipelineUser()
      .then((payload) => setAllowedGuides(guidedTutorialsForUser(payload.user)))
      .catch(() => setAllowedGuides([]));

    return () => {
      cancelled = true;
      window.removeEventListener(OPERATOR_GUIDE_EVENT, handleGuideEvent);
    };
  }, []);

  const handleLocationChange = useEffectEvent(() => {
    setLocationKey(currentGuideLocationKey());
    if (pendingTargetNavigation.current && guideWorkspaceAvailable(currentGuideLocationKey())) {
      const id = pendingTargetNavigation.current;
      pendingTargetNavigation.current = null;
      void advance(id);
    }
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
    let observedSchedule = false;

    // Capture against the current target before React replaces a question screen.
    const detectInteraction = (event: Event) => {
      // Opening is observed from the form itself, including when it was already open.
      if (step.id === "schedule-open") return;
      const candidate = event.target instanceof Element ? event.target.closest<HTMLElement>(`[data-guide-target="${step.target}"]`) : null;
      if (guideRouteMatches(step.route, currentGuideLocationKey()) && candidate && event.target instanceof Node && candidate.contains(event.target) && guideAdvanceEvent(step, candidate) === event.type) {
        if (step.target === "home-board-card" || step.target === "workspace-results") pendingTargetNavigation.current = step.id;
        else window.setTimeout(() => advanceFromTarget(step.id), 0);
      }
    };
    const interactionEvents = ["click", "input", "change", "pipeline:guide-complete"] as const;
    for (const event of interactionEvents) document.addEventListener(event, detectInteraction, true);

    const measure = () => {
      revealCollapsedGuideTarget(step.target);
      const candidate = findVisibleGuideTarget(step.target);
      if (step.id === "schedule-open" && findVisibleGuideTarget("assessment-schedule-fields")) {
        if (!observedSchedule) { observedSchedule = true; observeOpenSchedule(); }
        return;
      }
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
  if (pathname === "/training/demo" || pathname === "/tutorials/referral" || pathname === "/note-lab" || pathname.startsWith("/note-lab/")) return null;
  const currentTarget = target.stepId === step?.id && step && guideRouteMatches(step.route, locationKey) ? target : emptyTarget;
  return <><span hidden data-pipeline-ready="guided-coach" /><GuideCoachSurface state={state} allowedGuides={allowedGuides} tutorial={tutorial} step={step} target={currentTarget} locationKey={locationKey} progressSyncState={progressSyncState} navigationError={navigationError} pendingGuide={pendingGuide} onCancelSelection={() => setPendingGuide(null)} onBrowse={(destination = "board") => { void openGuideRoute(destination === "board" ? "/" : "/?view=referrals", "app", true); }} onOpenRoute={() => { if (step) void openGuideRoute(step.route); }} onSkip={() => { void advance(undefined, true); }} onStart={startTutorial} onCommit={commit} onAdvance={() => advance()} onBack={goBack} onResume={resumeTutorial} onGoToStep={goToStep} /></>;
}

function GuideCoachSurface({ state, allowedGuides, tutorial, step, target, locationKey, progressSyncState, navigationError, pendingGuide, onCancelSelection, onBrowse, onOpenRoute, onSkip, onStart, onCommit, onAdvance, onBack, onResume, onGoToStep }: { state: OperatorGuideState; allowedGuides: readonly OperatorGuidedTutorial[]; tutorial: ReturnType<typeof getOperatorGuidedTutorial>; step: OperatorGuideStep | undefined; target: TargetView; locationKey: string; progressSyncState: ProgressSyncState; navigationError: string; pendingGuide: PendingGuide | null; onCancelSelection: () => void; onBrowse: (destination?: "board" | "directory") => void; onOpenRoute: () => void; onSkip: () => void; onStart: (id: string, stepIndex?: number) => void; onCommit: (event: OperatorGuideEvent) => void; onAdvance: () => void; onBack: () => void; onResume: () => void; onGoToStep: (index: number) => void }) {
  if (state.mode === "closed") return null;
  if (state.mode === "library") return <GuideLibrary locationKey={locationKey} navigationError={navigationError} tutorials={allowedGuides} completed={state.completedTutorialIds} resumableTutorialId={state.activeTutorialId} pending={pendingGuide} onCancelSelection={onCancelSelection} onBrowse={onBrowse} onStart={onStart} onResume={onResume} onClose={() => onCommit({ type: "close" })} />;
  if (!tutorial || !step) return null;
  if (!allowedGuides.some((item) => item.id === tutorial.id)) return null;
  if (state.mode === "finished") return <GuideNextActions tutorial={tutorial} allowed={allowedGuides} locationKey={locationKey} navigationError={navigationError} onStart={onStart} onClose={() => onCommit({ type: "close" })} onLibrary={() => onCommit({ type: "open-library" })} onBrowse={onBrowse} />;
  return <GuideConversation key={tutorial.id} tutorial={tutorial} step={step} stepIndex={state.stepIndex} sequenceIndex={state.sequenceIndex} sequenceCount={state.sequenceTutorialIds.length} target={target} routeMatches={guideRouteMatches(step.route, locationKey)} progressSyncState={progressSyncState} onBack={onBack} onAdvance={onAdvance} onOpenRoute={onOpenRoute} onSkip={onSkip} navigationError={navigationError} onPause={() => onCommit({ type: "close" })} onLibrary={() => onCommit({ type: "open-library" })} onGoToStep={onGoToStep} onStart={onStart} onBrowse={onBrowse} reviewedStepIds={state.reviewedStepIds} />;
}

function findPreviousGuideStep(state: OperatorGuideState, tutorial: OperatorGuidedTutorial) {
  if (state.stepIndex > 0) return tutorial.steps[state.stepIndex - 1];
  const previousTutorial = getOperatorGuidedTutorial(state.sequenceTutorialIds[state.sequenceIndex - 1]);
  return previousTutorial?.steps.at(-1);
}

function scrollGuideTargetIntoView(candidate: HTMLElement | null, alreadyScrolled: boolean) {
  if (!candidate || alreadyScrolled) return alreadyScrolled;
  const rect = candidate.getBoundingClientRect();
  const visible = visibleGuideBounds(rect, candidate);
  if (visible.bottom - visible.top < Math.min(80, rect.height) || visible.right <= visible.left) {
    const start = rect.height > window.innerHeight / 2 ? candidate.querySelector<HTMLElement>("h1,h2,h3,h4,legend") ?? candidate : candidate;
    start.scrollIntoView({ behavior: "instant", block: "center", inline: "nearest" });
  }

  return true;
}

function targetView(candidate: HTMLElement | null): TargetView {
  const rect = candidate?.getBoundingClientRect() ?? null;
  return { element: candidate, rect, available: Boolean(candidate && rect && rect.width > 0 && rect.height > 0) };
}

function GuideLibrary({ tutorials, navigationError, onStart, onClose }: { tutorials: readonly OperatorGuidedTutorial[]; completed: readonly string[]; locationKey: string; navigationError: string; resumableTutorialId: string | null; pending: PendingGuide | null; onCancelSelection: () => void; onBrowse: (destination?: "board" | "directory") => void; onStart: (id: string, stepIndex?: number) => void; onResume: () => void; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const tasks = [
    ["create-referral", "Create a referral & add files"],
    ["start-assessment", "Schedule an appointment"],
    ["complete-assessment", "Fill out the assessment"],
    ["review-chart", "Review & sign"],
    ["record-decision", "Record a decision"],
    ["prepare-packet", "Prepare the admission packet"],
    ["run-report", "View reports"],
  ];

  return <section role="dialog" aria-label="Tutorials" data-guide-dock onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }} className={styles.dock + " " + styles.library}>
    <header className={styles.header}>
      <h2 ref={heading} tabIndex={-1} className={styles.libraryHeading}><Compass size={20} aria-hidden="true" /> Tutorials</h2>
      <div className={styles.headerActions}><button type="button" aria-label="Close tutorials" onClick={onClose}><X size={18} /></button></div>
    </header>
    <div className={styles.libraryBody}>
      {navigationError ? <p role="alert" className={styles.error}>{navigationError}</p> : null}
      {tutorials.some((item) => item.id === "assessor-shift") ? <button type="button" className={styles.boardHelp} onClick={() => onStart("assessor-shift")}><LayoutDashboard size={20} /><span>Walk through a referral<small>Sample client, from Home to the packet</small></span><ArrowRight size={17} /></button> : null}
      <p className={styles.menuPrompt}>Or jump to a task</p>
      <div className={styles.topics} aria-label="Tutorial topics">
      {tasks.filter(([id]) => tutorials.some((item) => item.id === id)).map(([id, label]) => <button type="button" className={styles.tutorialItem} key={id} onClick={() => onStart(id)}>{label}<ChevronRight size={16} aria-hidden="true" /></button>)}
      </div>
    </div>
  </section>;
}

function GuideNextActions({ tutorial, allowed, locationKey, navigationError, onStart, onClose, onLibrary, onBrowse }: { tutorial: OperatorGuidedTutorial; allowed: readonly OperatorGuidedTutorial[]; locationKey: string; navigationError: string; onStart: (id: string) => void; onClose: () => void; onLibrary: () => void; onBrowse: (destination?: "board" | "directory") => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const next = operatorGuideNextActions[tutorial.id];
  const message = tutorial.id === "create-referral" && new URL(locationKey, "https://pipeline.invalid").searchParams.has("referralId")
    ? "This referral has been created. Check its save and upload status, then schedule the assessment here or from its Home Board card. You can add more files to this same referral later."
    : next.message;
  return <aside data-guide-dock data-testid="guide-next-actions" aria-label="Next steps" className={styles.dock + " " + styles.nextActions} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header className={styles.header}><button type="button" className={styles.libraryLink} onClick={onLibrary}><Compass size={17} /> Tutorials</button><div className={styles.headerActions}><button type="button" aria-label="Close help" onClick={onClose}><X size={18} /></button></div></header>
    <div className={styles.scroll}>
      <p className={styles.context}>{tutorial.title}</p>
      <div className={styles.task}><h2 ref={heading} tabIndex={-1}>Your next step</h2></div>
      <p className={styles.nextMessage}>{message}</p>
      <p className={styles.menuPrompt}>Need help with the next task?</p>
      {next.tutorials.flatMap((id) => allowed.filter((item) => item.id === id)).map((item) => <button key={item.id} type="button" className={styles.tutorialItem} onClick={() => onStart(item.id)}>Help: {item.title}<ArrowRight size={16} /></button>)}
      <button type="button" className={styles.sampleLink} onClick={() => onBrowse("board")}><LayoutDashboard size={17} /> Go to my Board</button>
      {navigationError ? <p role="alert" className={styles.error}>{navigationError}</p> : null}
    </div>
    <footer className={styles.footer}><button type="button" className={styles.browseReferrals} onClick={onClose}>Close help</button></footer>
  </aside>;
}

const guideContextNames = { practice: "Sample only", workspace: "Help with your referral", intake: "Help with your referral", app: "Help with this page" };

function GuideConversation({ tutorial, step, stepIndex, sequenceIndex, sequenceCount, target, routeMatches, progressSyncState, navigationError, onSkip, onBack, onAdvance, onOpenRoute, onPause, onLibrary, onGoToStep, onStart, onBrowse, reviewedStepIds }: { tutorial: OperatorGuidedTutorial; step: OperatorGuideStep; stepIndex: number; sequenceIndex: number; sequenceCount: number; target: TargetView; routeMatches: boolean; progressSyncState: ProgressSyncState; navigationError: string; onSkip: () => void; onBack: () => void; onAdvance: () => void; onOpenRoute: () => void; onPause: () => void; onLibrary: () => void; onGoToStep: (index: number) => void; onStart: (id: string, stepIndex?: number) => void; onBrowse: (destination?: "board" | "directory") => void; reviewedStepIds: readonly string[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const targetReady = routeMatches && target.available;
  // Reading a tip must not depend on a conditional control still being visible.
  const canConfirm = step.advance === "confirm" && routeMatches;
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const showControl = () => {
    const element = target.element;
    if (!element) return;
    scrollGuideTargetIntoView(element, false);
    const hadTabIndex = element.hasAttribute("tabindex");
    if (!hadTabIndex) {
      element.setAttribute("tabindex", "-1");
      element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
    }
    element.focus({ preventScroll: true });
  };
  const renderSteps = () => <ol id="tutorial-step-list" className={styles.steps} aria-label="Tutorial steps">{tutorial.steps.map((item, index) => <li key={item.id}><button type="button" aria-current={index === stepIndex ? "step" : undefined} onClick={() => { onGoToStep(index); setShowSteps(false); }}><span className={styles.stepNumber}>{reviewedStepIds.includes(item.id) ? <Check size={14} aria-label="Reviewed" /> : index + 1}</span><span>{item.title}</span></button></li>)}</ol>;
  const renderRecovery = () => <>
          <button type="button" className={styles.helpToggle} aria-expanded={helpOpen} onClick={() => setHelpOpen(!helpOpen)}><CircleHelp size={17} /> {helpOpen ? "Hide extra help" : "I'm stuck here"}<ChevronDown size={16} className={helpOpen ? styles.rotated : undefined} /></button>
          {helpOpen || !targetReady ? <GuideRecovery step={step} tutorial={tutorial} onStart={onStart} onGoToStep={onGoToStep} onBrowse={onBrowse} /> : null}
  </>;
  const renderExpandedGuide = () => <>
        <div key={step.id} className={styles.scroll}>
          <div className={styles.task}>
            <p className={styles.context}>{guideContextNames[tutorial.context]}{sequenceCount > 1 ? ` · ${sequenceIndex + 1}/${sequenceCount}` : ""}</p>
            <h2 ref={heading} tabIndex={-1}>{tutorial.title}</h2>
          </div>
          <button type="button" className={styles.stepToggle} aria-expanded={showSteps} aria-controls="tutorial-step-list" onClick={() => setShowSteps(!showSteps)}><ListOrdered size={16} /><span>Choose a step · {stepIndex + 1} of {tutorial.steps.length}</span><ChevronDown size={16} className={showSteps ? styles.rotated : undefined} /></button>
          {showSteps ? renderSteps() : null}
          <div className={styles.instruction} aria-live="polite" aria-atomic="true">
            <h3>{operatorGuideStepTitle(step)}</h3>
            <p>{step.instruction}</p>
          </div>
          {navigationError ? <p role="alert" className={styles.error}>{navigationError}</p> : null}
          {!targetReady ? <UnavailableGuideAction step={step} routeMatches={routeMatches} onOpenRoute={onOpenRoute} /> : <button type="button" className={styles.locate} onClick={showControl}><LocateFixed size={16} /> Show me where</button>}
          {renderRecovery()}
          <GuideProgressSync state={progressSyncState} />
        </div>
        <GuideConversationFooter step={step} stepIndex={stepIndex} stepCount={tutorial.steps.length} canConfirm={canConfirm} hasPreviousModule={sequenceIndex > 0} hasNextModule={sequenceIndex < sequenceCount - 1} onSkip={onSkip} onBack={onBack} onAdvance={onAdvance} />
        {targetReady && target.rect ? <GuideSpotlight rect={target.rect} element={target.element} stepNumber={stepIndex + 1} /> : null}
  </>;
  return (
    <aside aria-label={`${tutorial.title} tutorial`} data-guide-dock data-collapsed={collapsed} data-testid="guided-coach-panel" className={styles.dock} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); if (showSteps) setShowSteps(false); else onPause(); } }}>
      <header className={styles.header}>
        <button type="button" className={styles.libraryLink} onClick={onLibrary} title="All tutorials"><Compass size={17} /> Tutorials</button>
        <div className={styles.headerActions}>
          <button type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "Expand tutorial" : "Collapse tutorial"} aria-expanded={!collapsed} title={collapsed ? "Expand tutorial" : "Collapse tutorial"}>{collapsed ? <ChevronUp size={18} /> : <PanelRightClose size={18} />}</button>
          <button type="button" onClick={onPause} aria-label="Pause tutorial" title="Close and keep your place"><X size={18} /></button>
        </div>
      </header>
      {collapsed ? <button type="button" className={styles.collapsedTitle} onClick={() => setCollapsed(false)}>{stepIndex + 1}/{tutorial.steps.length} · {step.title}<ChevronDown size={16} /></button> : <>
        {renderExpandedGuide()}
      </>}
    </aside>
  );
}

function GuideProgressSync({ state }: { state: ProgressSyncState }) {
  if (state !== "browser" && state !== "guide") return null;
  return <p role="status" className={styles.sync}>Tutorial progress kept in this browser{state === "browser" ? " until sync resumes" : ""}.</p>;
}

function UnavailableGuideAction({ step, routeMatches, onOpenRoute }: { step: OperatorGuideStep; routeMatches: boolean; onOpenRoute: () => void }) {
  return <div className={styles.unavailable}>{unavailableGuideMessage(step, routeMatches)}{!routeMatches ? <button type="button" onClick={onOpenRoute}>Open page <ArrowRight size={14} /></button> : null}</div>;
}

const guideRecoveryMessages = [
  { targets: ["my-queue", "home-board-card"], message: "Check the other Board stages; on a phone, use Referral stage. Clear the assessor filter to see other assignments. Older referrals are in Workspaces." },
  { targets: ["workspace-search", "workspace-results"], message: "Clear the community and owner filters and search with part of the client's name. Check the client's details before opening a result." },
  { targets: ["intake-identity"], message: "Use the face sheet to confirm identity. Enter date of birth once; age calculates from it. Check the source documents and correct these fields when needed." },
  { targets: ["intake-routing"], message: "Choose the assessor who should receive this referral and confirm the community and referral contact. These are intake details, not an admission date." },
  { targets: ["intake-medications"], message: "Enter what is available in the referral summary and medication fields. Additional documents and corrections stay in the same workspace later." },
  { targets: ["assessment-recorded", "assessment-fields", "assessment-section-nav", "assessment-next-section"], message: "Already answered it? Open the answer under Current information to edit it. On a phone, open Client info. Use Assessment section to jump elsewhere; you do not have to work in order." },
  { targets: ["assessment-save-status"], message: "Wait for a saved confirmation. If saving fails, keep the assessment open and use its error message to resolve the problem. Do not refresh or sign just to get past a save error." },
  { targets: ["assessment-sign", "assessment-review"], message: "Review & sign is separate from these tips. Return to Assessment to change answers in the same record. If it is already signed, go to Decision rather than creating another assessment." },
  { targets: ["workspace-decision", "workspace-admit-date", "workspace-finish-send"], message: "Check the saved decision first. Admission date and packet preparation apply to an accepted referral. If it is under review or declined, you do not need to manufacture an admission date." },
  { targets: ["workspace-packet-preview", "chart-email-handoff"], message: "Check the recipients, attached files, and preview in the workspace. Send is a separate confirmation. Check delivery status before retrying so you do not send the same packet twice." },
  { targets: ["workspace-files"], message: "Make sure this is the correct client. Files added later belong here too. An unavailable preview is not proof that the document uploaded successfully; check the file's status." },
  { targets: ["workspace-history"], message: "Expand an Activity group for the person and time of a change. Activity is a record of changes, not a second editable assessment." },
];

const guideRecoveryPrefixes = [
  { pattern: /upload/, message: "Check the file list and any upload error before continuing. If files are still uploading, keep this page open. Add later documents to this same referral, not a second intake." },
  { pattern: /^assessment-schedule-/, message: "Check the appointment date, time, time zone, and method. Supply the phone number, address, or meeting link requested by that method. A save error keeps the form open; reading the next tip does not book it. If the form was closed, reopen scheduling." },
  { pattern: /^packet-/, message: "Check the recipients, attached files, and preview in the workspace. Send is a separate confirmation. Check delivery status before retrying so you do not send the same packet twice." },
  { pattern: /^calendar-/, message: "Check the selected date range and assessor filter. An appointment only appears after it saves successfully. Open the client's referral to confirm or change the appointment." },
  { pattern: /^operations-/, message: "Check the report type, dates, and filters, then apply them. If results fail to load, use the report error or retry; an empty or stale result is not a confirmed zero." },
];

function guideRecoveryMessage(target: string, practice: boolean) {
  if (target === "create-workspace") return practice ? "This sample intentionally does not create a real referral. Use Create a referral below when you are ready for real work." : "The Create referral button is on the workspace header. If it is gone and the referral has an ID, it has already been created. Check the save status and upload errors before scheduling; do not create another copy.";
  return guideRecoveryMessages.find((item) => item.targets.includes(target))?.message
    ?? guideRecoveryPrefixes.find((item) => item.pattern.test(target))?.message
    ?? "Use Show me where to find this item, or choose another step above.";
}

function GuideRecovery({ step, tutorial, onStart, onGoToStep, onBrowse }: { step: OperatorGuideStep; tutorial: OperatorGuidedTutorial; onStart: (id: string) => void; onGoToStep: (index: number) => void; onBrowse: (destination?: "board" | "directory") => void }) {
  const target = step.target;
  const scheduling = target.startsWith("assessment-schedule-");
  const board = target === "my-queue" || target === "home-board-card";
  const message = guideRecoveryMessage(target, tutorial.context === "practice");
  return <div className={styles.recovery}>
    <p>{message}</p>
    {board ? <button type="button" onClick={() => onBrowse("directory")}>Find the referral in Workspaces <ArrowRight size={15} /></button> : null}
    {scheduling && step.id !== "schedule-open" ? <button type="button" onClick={() => onGoToStep(0)}>Help opening scheduling <ArrowRight size={15} /></button> : null}
    {target === "create-workspace" ? <button type="button" onClick={() => onStart(tutorial.context === "practice" ? "create-referral" : "start-assessment")}>{tutorial.context === "practice" ? "Open real intake help" : "Help scheduling this referral"}<ArrowRight size={15} /></button> : null}
    {["assessment-sign", "assessment-review"].includes(target) ? <button type="button" onClick={() => onStart("record-decision")}>Help with the decision <ArrowRight size={15} /></button> : null}
    {["workspace-admit-date", "workspace-finish-send"].includes(target) ? <button type="button" onClick={() => onStart("record-decision")}>Help with the saved decision <ArrowRight size={15} /></button> : null}
  </div>;
}

function unavailableGuideMessage(step: OperatorGuideStep, routeMatches: boolean) {
  if (!routeMatches) return "This step is on another Pipeline page.";
  if (step.target === "workspace-admit-date" || step.target === "workspace-finish-send") return "This is only shown for an accepted referral. Check the saved decision first.";
  if (step.target.startsWith("assessment-schedule-") && step.target !== "assessment-schedule-open") return "Open the scheduling form first. Go back to Open scheduling, or skip this step if you are only reviewing the workflow.";
  if (step.target === "assessment-sign") return "Signing depends on this assessment's state and your permissions. Review the assessment's status before signing or editing an existing signature.";
  if (step.target === "home-board-card") return "No client card is visible in this Board column. Change the stage or find the referral in Workspaces.";
  if (step.target === "create-workspace") return "Check the workspace header and save status. An existing referral does not need to be created again.";
  if (step.optionalTarget) return "This action is not shown for the current stage or your access. Use the help below to find the right next step.";
  return "This item is not visible on the current page. Check the help below, or choose the step you need above.";
}

function GuideConversationFooter({ stepIndex, stepCount, canConfirm, hasPreviousModule, hasNextModule, onSkip, onBack, onAdvance }: { step: OperatorGuideStep; stepIndex: number; stepCount: number; canConfirm: boolean; hasPreviousModule: boolean; hasNextModule: boolean; onSkip: () => void; onBack: () => void; onAdvance: () => void }) {
  return <footer className={styles.footer}><div className={styles.footerActions}><button type="button" aria-label="Previous tutorial step" title="Previous step" disabled={stepIndex === 0 && !hasPreviousModule} onClick={onBack}><ArrowLeft size={17} />Back</button><button type="button" onClick={canConfirm ? onAdvance : onSkip} className={styles.continue}>{stepIndex === stepCount - 1 && !hasNextModule ? "Done" : "Next"}<ArrowRight size={16} /></button></div></footer>;
}

function visibleGuideBounds(rect: DOMRect, element: HTMLElement | null) {
  let left = Math.max(2, rect.left - 2);
  let top = Math.max(2, rect.top - 2);
  let right = Math.min(window.innerWidth - 2, rect.right + 2);
  let bottom = Math.min(window.innerHeight - 2, rect.bottom + 2);
  // Highlight only the visible portion inside nested workspace scrollers.
  for (let parent = element?.parentElement; parent; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent);
    const bounds = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
  }
  const workspace = element?.closest('[data-testid="packet-workspace"]');
  const header = workspace?.querySelector<HTMLElement>('[data-testid="workspace-folder-header"]');
  const footer = workspace?.querySelector<HTMLElement>('footer[aria-label="Assessment actions"]');
  if (!element?.closest('[role="dialog"], dialog')) {
    if (header && !header.contains(element)) top = Math.max(top, header.getBoundingClientRect().bottom);
    if (footer && !footer.contains(element)) bottom = Math.min(bottom, footer.getBoundingClientRect().top);
  }
  return { left, top, right, bottom };
}

function GuideSpotlight({ rect, element, stepNumber }: { rect: DOMRect; element: HTMLElement | null; stepNumber: number }) {
  const { left, top, right, bottom } = visibleGuideBounds(rect, element);
  if (right <= left || bottom <= top) return null;
  return <div aria-hidden="true" data-testid="guide-spotlight" className={styles.spotlight} style={{ left, top, width: right - left, height: bottom - top }}><span data-testid="guide-spotlight-outline" className={styles.outline} /><span className={styles.targetNumber}>{stepNumber}</span></div>;
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
