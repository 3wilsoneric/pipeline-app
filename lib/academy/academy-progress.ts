import {
  academyActivityKey,
  academyModules,
  academyTracks,
  getAcademyModule,
} from "@/lib/academy/academy-curriculum";
import type { AcademyProgress } from "@/lib/academy/academy-progress-contract";
import type { AcademyActivity, AcademyModule } from "@/lib/academy/academy-types";

export function completedActivitySet(progress: AcademyProgress) {
  return new Set(progress.completedActivityIds);
}

export function isAcademyActivityComplete(progress: AcademyProgress, moduleId: string, activityId: string) {
  return progress.completedActivityIds.includes(academyActivityKey(moduleId, activityId));
}

export function isAcademyModuleComplete(progress: AcademyProgress, module: AcademyModule) {
  return module.activities.every((activity) => isAcademyActivityComplete(progress, module.id, activity.id));
}

export function isAcademyModuleUnlocked(progress: AcademyProgress, module: AcademyModule) {
  return module.prerequisites.every((moduleId) => {
    const prerequisite = getAcademyModule(moduleId);
    return prerequisite ? isAcademyModuleComplete(progress, prerequisite) : false;
  });
}

export function countAcademyModuleActivities(progress: AcademyProgress, module: AcademyModule) {
  return module.activities.filter((activity) => isAcademyActivityComplete(progress, module.id, activity.id)).length;
}

export function academyTrackProgress(progress: AcademyProgress, trackId: string) {
  const modules = academyModules.filter((module) => module.trackId === trackId);
  const activities = modules.flatMap((module) => module.activities.map((activity) => academyActivityKey(module.id, activity.id)));
  const completed = activities.filter((activityId) => progress.completedActivityIds.includes(activityId)).length;
  return {
    modules: modules.length,
    completedModules: modules.filter((module) => isAcademyModuleComplete(progress, module)).length,
    activities: activities.length,
    completed,
    percent: activities.length ? Math.round((completed / activities.length) * 100) : 0,
  };
}

export function academyOverallProgress(progress: AcademyProgress) {
  const total = academyModules.reduce((count, module) => count + module.activities.length, 0);
  const completed = progress.completedActivityIds.length;
  return {
    total,
    completed,
    percent: total ? Math.round((completed / total) * 100) : 0,
    completedModules: academyModules.filter((module) => isAcademyModuleComplete(progress, module)).length,
    tracksComplete: academyTracks.filter((track) => academyTrackProgress(progress, track.id).percent === 100).length,
  };
}

export function academyEvidenceFor(progress: AcademyProgress, moduleId: string, activityId: string) {
  return progress.evidence[academyActivityKey(moduleId, activityId)]?.text ?? "";
}

export function evidenceMeetsMinimum(text: string) {
  return text.trim().length >= 80;
}

export function nextAcademyActivity(module: AcademyModule, activity: AcademyActivity) {
  const activityIndex = module.activities.findIndex((candidate) => candidate.id === activity.id);
  const nextInModule = module.activities[activityIndex + 1];
  if (nextInModule) return { module, activity: nextInModule };
  const moduleIndex = academyModules.findIndex((candidate) => candidate.id === module.id);
  const nextModule = academyModules[moduleIndex + 1];
  return nextModule ? { module: nextModule, activity: nextModule.activities[0] } : null;
}
