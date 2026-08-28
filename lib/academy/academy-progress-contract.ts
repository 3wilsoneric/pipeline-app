import {
  ACADEMY_CURRICULUM_VERSION,
  academyActivityIds,
  academyActivityKey,
  academyModules,
  academyModuleIds,
  getAcademyModule,
} from "@/lib/academy/academy-curriculum";

export const ACADEMY_PROGRESS_SCHEMA_VERSION = 2 as const;
export const ACADEMY_EVIDENCE_MAX_LENGTH = 6_000;

export type AcademyEvidence = {
  text: string;
  updatedAt: string;
};

export type AcademyProgress = {
  version: typeof ACADEMY_PROGRESS_SCHEMA_VERSION;
  curriculumVersion: string;
  completedActivityIds: string[];
  activeModuleId: string;
  activeActivityId: string;
  evidence: Record<string, AcademyEvidence>;
  confidence: Record<string, number>;
};

export type AcademyProgressRecord = {
  revision: number;
  progress: AcademyProgress;
  updatedAt: string | null;
  persistence: "postgres" | "local_file" | "browser";
};

export type AcademyProgressUpdate = {
  expectedRevision: number;
  progress: AcademyProgress;
};

const activityIdSet = new Set(academyActivityIds);
const moduleIdSet = new Set(academyModuleIds);

export function emptyAcademyProgress(): AcademyProgress {
  return {
    version: ACADEMY_PROGRESS_SCHEMA_VERSION,
    curriculumVersion: ACADEMY_CURRICULUM_VERSION,
    completedActivityIds: [],
    activeModuleId: academyModules[0].id,
    activeActivityId: academyModules[0].activities[0].id,
    evidence: {},
    confidence: {},
  };
}

export function normalizeAcademyProgress(value: unknown): AcademyProgress {
  if (!isObject(value)) return emptyAcademyProgress();

  const completedActivityIds = uniqueStrings(value.completedActivityIds)
    .filter((activityId) => activityIdSet.has(activityId));
  const activeModule = typeof value.activeModuleId === "string"
    ? getAcademyModule(value.activeModuleId)
    : undefined;
  const academyModule = activeModule ?? firstIncompleteModule(new Set(completedActivityIds));
  const requestedActivity = typeof value.activeActivityId === "string"
    ? academyModule.activities.find((activity) => activity.id === value.activeActivityId)
    : undefined;
  const activeActivity = requestedActivity
    ?? academyModule.activities.find((activity) => !completedActivityIds.includes(academyActivityKey(academyModule.id, activity.id)))
    ?? academyModule.activities[0];

  return {
    version: ACADEMY_PROGRESS_SCHEMA_VERSION,
    curriculumVersion: ACADEMY_CURRICULUM_VERSION,
    completedActivityIds,
    activeModuleId: academyModule.id,
    activeActivityId: activeActivity.id,
    evidence: normalizeEvidence(value.evidence),
    confidence: normalizeConfidence(value.confidence),
  };
}

export function validateAcademyProgressUpdate(value: unknown):
  | { ok: true; value: AcademyProgressUpdate }
  | { ok: false; error: string } {
  if (!isObject(value)) return { ok: false, error: "Progress update must be an object." };
  if (!Number.isInteger(value.expectedRevision) || Number(value.expectedRevision) < 0) {
    return { ok: false, error: "expectedRevision must be a non-negative integer." };
  }
  if (!isObject(value.progress)) return { ok: false, error: "progress must be an object." };

  const progress = normalizeAcademyProgress(value.progress);
  if (Object.keys(progress.evidence).length > academyActivityIds.length) {
    return { ok: false, error: "Progress evidence exceeds the curriculum activity limit." };
  }
  if (JSON.stringify(progress).length > 300_000) {
    return { ok: false, error: "Progress payload exceeds the storage limit." };
  }

  return {
    ok: true,
    value: {
      expectedRevision: Number(value.expectedRevision),
      progress,
    },
  };
}

export function mergeAcademyProgress(left: AcademyProgress, right: AcademyProgress) {
  const completedActivityIds = [...new Set([
    ...left.completedActivityIds,
    ...right.completedActivityIds,
  ])].filter((activityId) => activityIdSet.has(activityId));
  const evidence = { ...left.evidence };
  for (const [activityId, candidate] of Object.entries(right.evidence)) {
    const current = evidence[activityId];
    if (!current || candidate.updatedAt >= current.updatedAt) evidence[activityId] = candidate;
  }

  return normalizeAcademyProgress({
    ...right,
    completedActivityIds,
    evidence,
    confidence: { ...left.confidence, ...right.confidence },
  });
}

export function activityRequiresEvidence(moduleId: string, activityId: string) {
  const activity = getAcademyModule(moduleId)?.activities.find((candidate) => candidate.id === activityId);
  return Boolean(activity?.evidencePrompt);
}

function normalizeEvidence(value: unknown) {
  if (!isObject(value)) return {};
  const result: Record<string, AcademyEvidence> = {};
  for (const [activityId, rawEvidence] of Object.entries(value)) {
    if (!activityIdSet.has(activityId) || !isObject(rawEvidence)) continue;
    const text = typeof rawEvidence.text === "string"
      ? rawEvidence.text.trim().slice(0, ACADEMY_EVIDENCE_MAX_LENGTH)
      : "";
    if (!text) continue;
    const updatedAt = typeof rawEvidence.updatedAt === "string" && !Number.isNaN(Date.parse(rawEvidence.updatedAt))
      ? rawEvidence.updatedAt
      : new Date(0).toISOString();
    result[activityId] = { text, updatedAt };
  }
  return result;
}

function normalizeConfidence(value: unknown) {
  if (!isObject(value)) return {};
  const result: Record<string, number> = {};
  for (const [moduleId, confidence] of Object.entries(value)) {
    if (!moduleIdSet.has(moduleId) || !Number.isInteger(confidence)) continue;
    result[moduleId] = Math.min(5, Math.max(1, Number(confidence)));
  }
  return result;
}

function firstIncompleteModule(completed: Set<string>) {
  return academyModules.find((module) => (
    module.prerequisites.every((prerequisite) => {
      const prerequisiteModule = getAcademyModule(prerequisite);
      return prerequisiteModule?.activities.every((activity) => (
        completed.has(academyActivityKey(prerequisiteModule.id, activity.id))
      ));
    }) && module.activities.some((activity) => !completed.has(academyActivityKey(module.id, activity.id)))
  )) ?? academyModules[academyModules.length - 1];
}

function uniqueStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string"))];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
