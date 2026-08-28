import { getOperatorGuidedTutorial, operatorGuidedTutorialIds } from "@/lib/training/operator-guided-tutorials";

export const OPERATOR_GUIDE_STORAGE_KEY = "pipeline-guided-coach:v2";
export const OPERATOR_GUIDE_EVENT = "pipeline:guided-coach";
export const OPERATOR_GUIDE_STATE_VERSION = 2 as const;

export type OperatorGuideMode = "closed" | "library" | "active";

export type OperatorGuideState = {
  version: typeof OPERATOR_GUIDE_STATE_VERSION;
  mode: OperatorGuideMode;
  activeTutorialId: string | null;
  stepIndex: number;
  completedTutorialIds: string[];
  startedAt: string | null;
  updatedAt: string;
};

export type OperatorGuideEvent =
  | { type: "open-library" }
  | { type: "start"; tutorialId: string }
  | { type: "resume" }
  | { type: "close" }
  | { type: "next" }
  | { type: "previous" }
  | { type: "restart" }
  | { type: "finish" }
  | { type: "end" };

export type OperatorGuideCommand = "next" | "back" | "pause" | "restart" | "why" | "safety" | "repeat" | "unknown";

export function emptyOperatorGuideState(): OperatorGuideState {
  return {
    version: OPERATOR_GUIDE_STATE_VERSION,
    mode: "closed",
    activeTutorialId: null,
    stepIndex: 0,
    completedTutorialIds: [],
    startedAt: null,
    updatedAt: new Date(0).toISOString(),
  };
}

export function normalizeOperatorGuideState(value: unknown): OperatorGuideState {
  if (!isObject(value)) return emptyOperatorGuideState();
  const tutorial = getOperatorGuidedTutorial(stringOrNull(value.activeTutorialId));
  const stepIndex = normalizedStepIndex(value.stepIndex, tutorial?.steps.length ?? 0);
  const mode = normalizedGuideMode(value.mode);
  return {
    version: OPERATOR_GUIDE_STATE_VERSION,
    mode: mode === "active" && !tutorial ? "closed" : mode,
    activeTutorialId: tutorial?.id ?? null,
    stepIndex,
    completedTutorialIds: uniqueStrings(value.completedTutorialIds).filter((id) => operatorGuidedTutorialIds.includes(id)),
    startedAt: validTimestamp(value.startedAt),
    updatedAt: validTimestamp(value.updatedAt) ?? new Date(0).toISOString(),
  };
}

export function reduceOperatorGuideState(current: OperatorGuideState, event: OperatorGuideEvent, now = new Date().toISOString()): OperatorGuideState {
  const state = normalizeOperatorGuideState(current);
  const immediate = reduceImmediateGuideEvent(state, event, now);
  if (immediate) return immediate;
  const tutorial = getOperatorGuidedTutorial(state.activeTutorialId);
  if (!tutorial) return state;
  if (event.type === "previous") return { ...state, stepIndex: Math.max(0, state.stepIndex - 1), updatedAt: now };
  if (event.type === "restart") return { ...state, mode: "active", stepIndex: 0, startedAt: now, updatedAt: now };
  if (event.type === "next") return { ...state, stepIndex: Math.min(tutorial.steps.length - 1, state.stepIndex + 1), updatedAt: now };
  if (event.type === "finish") return {
    ...state,
    mode: "library",
    activeTutorialId: null,
    stepIndex: 0,
    completedTutorialIds: [...new Set([...state.completedTutorialIds, tutorial.id])],
    startedAt: null,
    updatedAt: now,
  };
  return state;
}

function reduceImmediateGuideEvent(state: OperatorGuideState, event: OperatorGuideEvent, now: string): OperatorGuideState | null {
  if (event.type === "open-library") return { ...state, mode: "library", updatedAt: now };
  if (event.type === "start") {
    const tutorial = getOperatorGuidedTutorial(event.tutorialId);
    return tutorial ? { ...state, mode: "active", activeTutorialId: tutorial.id, stepIndex: 0, startedAt: now, updatedAt: now } : state;
  }
  if (event.type === "resume") return { ...state, mode: state.activeTutorialId ? "active" : "library", updatedAt: now };
  if (event.type === "close") return { ...state, mode: "closed", updatedAt: now };
  if (event.type === "end") return { ...state, mode: "library", activeTutorialId: null, stepIndex: 0, startedAt: null, updatedAt: now };
  return null;
}

function normalizedStepIndex(value: unknown, stepCount: number) {
  if (stepCount < 1 || !Number.isSafeInteger(value)) return 0;
  return Math.min(stepCount - 1, Math.max(0, Number(value)));
}

function normalizedGuideMode(value: unknown): OperatorGuideMode {
  return value === "library" || value === "active" || value === "closed" ? value : "closed";
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

export function parseOperatorGuideCommand(value: string): OperatorGuideCommand {
  const command = value.trim().toLowerCase().replace(/[.!?]+$/g, "");
  if (/^(next|continue|go on|done)$/.test(command)) return "next";
  if (/^(back|previous|go back)$/.test(command)) return "back";
  if (/^(pause|close|hide)$/.test(command)) return "pause";
  if (/^(restart|start over)$/.test(command)) return "restart";
  if (/^(why|why this|why does this matter)$/.test(command)) return "why";
  if (/^(safe|safety|what is safe|what should i avoid)$/.test(command)) return "safety";
  if (/^(repeat|help|what do i do|instructions)$/.test(command)) return "repeat";
  return "unknown";
}

export function dispatchOperatorGuide(event: Extract<OperatorGuideEvent, { type: "open-library" | "start" }>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPERATOR_GUIDE_EVENT, { detail: event }));
}

function uniqueStrings(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : [];
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
