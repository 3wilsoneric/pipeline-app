import {
  OPERATOR_TRAINING_VERSION,
  getOperatorModule,
  operatorActivityIds,
  operatorActivityKey,
  operatorModules,
  operatorModulesForRole,
  primaryOperatorRole,
} from "@/lib/training/operator-training-curriculum";
import { operatorScenarios } from "@/lib/training/operator-training-resources";
import { operatorGuidedTutorials } from "@/lib/training/operator-guided-tutorials";
import type { OperatorRole } from "@/lib/training/operator-training-types";

export const OPERATOR_PROGRESS_SCHEMA_VERSION = 2 as const;
export const OPERATOR_EVIDENCE_MAX_LENGTH = 4_000;

export type OperatorEvidence = {
  text: string;
  updatedAt: string;
};

export type OperatorScenarioResult = {
  attempts: number;
  passed: boolean;
  updatedAt: string;
};

export type OperatorTutorialResult = {
  status: "started" | "completed";
  currentStep: number;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type OperatorTrainingProgress = {
  version: typeof OPERATOR_PROGRESS_SCHEMA_VERSION;
  curriculumVersion: string;
  role: OperatorRole;
  completedActivityIds: string[];
  activeModuleId: string;
  activeActivityId: string;
  evidence: Record<string, OperatorEvidence>;
  confidence: Record<string, number>;
  scenarioResults: Record<string, OperatorScenarioResult>;
  tutorialResults: Record<string, OperatorTutorialResult>;
};

export type OperatorProgressRecord = {
  revision: number;
  progress: OperatorTrainingProgress;
  updatedAt: string | null;
  persistence: "postgres" | "local_file" | "browser";
};

export type OperatorProgressUpdate = {
  expectedRevision: number;
  progress: OperatorTrainingProgress;
};

const activityIds = new Set(operatorActivityIds);
const moduleIds = new Set(operatorModules.map((module) => module.id));
const scenarioIds = new Set(operatorScenarios.map((scenario) => scenario.id));
const tutorialsById = new Map(operatorGuidedTutorials.map((tutorial) => [tutorial.id, tutorial]));

export function emptyOperatorProgress(role: OperatorRole): OperatorTrainingProgress {
  const firstModule = operatorModulesForRole(role)[0] ?? operatorModules[0];
  return {
    version: OPERATOR_PROGRESS_SCHEMA_VERSION,
    curriculumVersion: OPERATOR_TRAINING_VERSION,
    role,
    completedActivityIds: [],
    activeModuleId: firstModule.id,
    activeActivityId: firstModule.activities[0].id,
    evidence: {},
    confidence: {},
    scenarioResults: {},
    tutorialResults: {},
  };
}

export function normalizeOperatorProgress(value: unknown, assignedRoles: readonly string[]): OperatorTrainingProgress {
  const fallbackRole = primaryOperatorRole(assignedRoles);
  if (!isObject(value)) return emptyOperatorProgress(fallbackRole);
  const role = isOperatorRole(value.role) && assignedRoles.includes(value.role) ? value.role : fallbackRole;
  const roleModules = operatorModulesForRole(role);
  const roleModuleIds = new Set(roleModules.map((module) => module.id));
  const completedActivityIds = uniqueStrings(value.completedActivityIds).filter((id) => activityIds.has(id));
  const requestedModule = typeof value.activeModuleId === "string" && roleModuleIds.has(value.activeModuleId)
    ? getOperatorModule(value.activeModuleId)
    : undefined;
  const activeModule = requestedModule ?? firstIncompleteRoleModule(role, new Set(completedActivityIds));
  const requestedActivity = typeof value.activeActivityId === "string"
    ? activeModule.activities.find((activity) => activity.id === value.activeActivityId)
    : undefined;
  const activeActivity = requestedActivity
    ?? activeModule.activities.find((activity) => !completedActivityIds.includes(operatorActivityKey(activeModule.id, activity.id)))
    ?? activeModule.activities[0];

  return {
    version: OPERATOR_PROGRESS_SCHEMA_VERSION,
    curriculumVersion: OPERATOR_TRAINING_VERSION,
    role,
    completedActivityIds,
    activeModuleId: activeModule.id,
    activeActivityId: activeActivity.id,
    evidence: normalizeEvidence(value.evidence),
    confidence: normalizeConfidence(value.confidence),
    scenarioResults: normalizeScenarioResults(value.scenarioResults),
    tutorialResults: normalizeTutorialResults(value.tutorialResults),
  };
}

export function validateOperatorProgressUpdate(value: unknown, assignedRoles: readonly string[]):
  | { ok: true; value: OperatorProgressUpdate }
  | { ok: false; error: string } {
  if (!isObject(value)) return { ok: false, error: "Progress update must be an object." };
  if (!Number.isInteger(value.expectedRevision) || Number(value.expectedRevision) < 0) {
    return { ok: false, error: "expectedRevision must be a non-negative integer." };
  }
  if (!isObject(value.progress)) return { ok: false, error: "progress must be an object." };
  const progress = normalizeOperatorProgress(value.progress, assignedRoles);
  if (JSON.stringify(progress).length > 260_000) {
    return { ok: false, error: "Progress payload exceeds the storage limit." };
  }
  return { ok: true, value: { expectedRevision: Number(value.expectedRevision), progress } };
}

export function mergeOperatorProgress(left: OperatorTrainingProgress, right: OperatorTrainingProgress, assignedRoles: readonly string[]) {
  const evidence = mergeNewestRecords(left.evidence, right.evidence);
  const scenarioResults = mergeNewestRecords(left.scenarioResults, right.scenarioResults);
  const tutorialResults = mergeTutorialResults(left.tutorialResults, right.tutorialResults);
  return normalizeOperatorProgress({
    ...right,
    completedActivityIds: [...new Set([...left.completedActivityIds, ...right.completedActivityIds])],
    evidence,
    confidence: { ...left.confidence, ...right.confidence },
    scenarioResults,
    tutorialResults,
  }, assignedRoles);
}

function mergeNewestRecords<T extends { updatedAt: string }>(left: Record<string, T>, right: Record<string, T>) {
  const merged = { ...left };
  for (const [id, candidate] of Object.entries(right)) {
    const current = merged[id];
    if (!current || candidate.updatedAt >= current.updatedAt) merged[id] = candidate;
  }
  return merged;
}

function mergeTutorialResults(left: Record<string, OperatorTutorialResult>, right: Record<string, OperatorTutorialResult>) {
  const merged = { ...left };
  for (const [id, candidate] of Object.entries(right)) {
    const current = merged[id];
    merged[id] = preferredTutorialResult(current, candidate);
  }
  return merged;
}

function preferredTutorialResult(current: OperatorTutorialResult | undefined, candidate: OperatorTutorialResult) {
  if (!current) return candidate;
  if (current.status !== candidate.status) return current.status === "completed" ? current : candidate;
  return candidate.updatedAt >= current.updatedAt ? candidate : current;
}

function firstIncompleteRoleModule(role: OperatorRole, completed: Set<string>) {
  const roleModules = operatorModulesForRole(role);
  return roleModules.find((module) => module.activities.some((activity) => !completed.has(operatorActivityKey(module.id, activity.id))))
    ?? roleModules[roleModules.length - 1]
    ?? operatorModules[0];
}

function normalizeEvidence(value: unknown) {
  if (!isObject(value)) return {};
  const evidence: Record<string, OperatorEvidence> = {};
  for (const [id, candidate] of Object.entries(value)) {
    if (!activityIds.has(id) || !isObject(candidate)) continue;
    const text = typeof candidate.text === "string" ? candidate.text.trim().slice(0, OPERATOR_EVIDENCE_MAX_LENGTH) : "";
    if (!text) continue;
    evidence[id] = { text, updatedAt: validTimestamp(candidate.updatedAt) };
  }
  return evidence;
}

function normalizeConfidence(value: unknown) {
  if (!isObject(value)) return {};
  const confidence: Record<string, number> = {};
  for (const [id, score] of Object.entries(value)) {
    if (!moduleIds.has(id) || !Number.isInteger(score)) continue;
    confidence[id] = Math.min(5, Math.max(1, Number(score)));
  }
  return confidence;
}

function normalizeScenarioResults(value: unknown) {
  if (!isObject(value)) return {};
  const results: Record<string, OperatorScenarioResult> = {};
  for (const [id, candidate] of Object.entries(value)) {
    if (!scenarioIds.has(id) || !isObject(candidate)) continue;
    const attempts = Number(candidate.attempts);
    if (!Number.isSafeInteger(attempts) || attempts < 1 || typeof candidate.passed !== "boolean") continue;
    results[id] = {
      attempts: Math.min(10_000, attempts),
      passed: candidate.passed,
      updatedAt: validTimestamp(candidate.updatedAt),
    };
  }
  return results;
}

function normalizeTutorialResults(value: unknown) {
  if (!isObject(value)) return {};
  const results: Record<string, OperatorTutorialResult> = {};
  for (const [id, candidate] of Object.entries(value)) {
    const tutorial = tutorialsById.get(id);
    const result = normalizeTutorialResult(candidate, tutorial?.steps.length ?? 0);
    if (result) results[id] = result;
  }
  return results;
}

function normalizeTutorialResult(value: unknown, stepCount: number): OperatorTutorialResult | null {
  if (!isObject(value) || stepCount < 1) return null;
  const status = tutorialStatus(value.status);
  const currentStep = Number(value.currentStep);
  if (!status || !Number.isSafeInteger(currentStep) || currentStep < 0) return null;
  const timestamps = { startedAt: validTimestamp(value.startedAt), updatedAt: validTimestamp(value.updatedAt) };
  if (status === "started") return { status, currentStep: Math.min(stepCount - 1, currentStep), ...timestamps };
  return {
    status,
    currentStep: Math.min(stepCount - 1, currentStep),
    ...timestamps,
    completedAt: validTimestamp(value.completedAt ?? value.updatedAt),
  };
}

function tutorialStatus(value: unknown): OperatorTutorialResult["status"] | null {
  if (value === "completed" || value === "started") return value;
  return null;
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : new Date(0).toISOString();
}

function uniqueStrings(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string"))] : [];
}

function isOperatorRole(value: unknown): value is OperatorRole {
  return value === "admin" || value === "assessment_coordinator" || value === "reviewer" || value === "viewer";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
