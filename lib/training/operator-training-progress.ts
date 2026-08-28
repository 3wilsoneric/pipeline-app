import {
  operatorActivityKey,
  operatorModulesForRole,
} from "@/lib/training/operator-training-curriculum";
import { scenariosForRole } from "@/lib/training/operator-training-resources";
import type { OperatorTrainingProgress } from "@/lib/training/operator-training-progress-contract";
import type { OperatorActivity, OperatorModule } from "@/lib/training/operator-training-types";

export const OPERATOR_EVIDENCE_MIN_LENGTH = 80;

export function isOperatorActivityComplete(progress: OperatorTrainingProgress, moduleId: string, activityId: string) {
  return progress.completedActivityIds.includes(operatorActivityKey(moduleId, activityId));
}

export function operatorEvidence(progress: OperatorTrainingProgress, moduleId: string, activityId: string) {
  return progress.evidence[operatorActivityKey(moduleId, activityId)]?.text ?? "";
}

export function isOperatorModuleComplete(progress: OperatorTrainingProgress, module: OperatorModule) {
  return module.activities.every((activity) => isOperatorActivityComplete(progress, module.id, activity.id));
}

export function isOperatorModuleUnlocked(progress: OperatorTrainingProgress, module: OperatorModule) {
  return module.prerequisites.every((id) => {
    const prerequisite = operatorModulesForRole(progress.role).find((candidate) => candidate.id === id);
    return !prerequisite || isOperatorModuleComplete(progress, prerequisite);
  });
}

export function operatorModuleActivityCount(progress: OperatorTrainingProgress, module: OperatorModule) {
  return module.activities.filter((activity) => isOperatorActivityComplete(progress, module.id, activity.id)).length;
}

export function operatorOverallProgress(progress: OperatorTrainingProgress) {
  const modules = operatorModulesForRole(progress.role);
  const activities = modules.flatMap((module) => module.activities);
  const completedActivities = activities.filter((activity) => (
    progress.completedActivityIds.includes(operatorActivityKey(activity.moduleId, activity.id))
  )).length;
  const completedModules = modules.filter((module) => isOperatorModuleComplete(progress, module)).length;
  const roleScenarios = scenariosForRole(progress.role);
  const passedScenarios = roleScenarios.filter((scenario) => progress.scenarioResults[scenario.id]?.passed).length;
  return {
    modules: modules.length,
    completedModules,
    activities: activities.length,
    completedActivities,
    percent: activities.length ? Math.round((completedActivities / activities.length) * 100) : 0,
    scenarios: roleScenarios.length,
    passedScenarios,
  };
}

export function nextOperatorActivity(progress: OperatorTrainingProgress, module: OperatorModule, activity: OperatorActivity) {
  const modules = operatorModulesForRole(progress.role);
  const activityIndex = module.activities.findIndex((candidate) => candidate.id === activity.id);
  if (activityIndex < module.activities.length - 1) return { module, activity: module.activities[activityIndex + 1] };
  const moduleIndex = modules.findIndex((candidate) => candidate.id === module.id);
  const nextModule = modules[moduleIndex + 1];
  return nextModule ? { module: nextModule, activity: nextModule.activities[0] } : null;
}

export function operatorEvidenceReady(value: string) {
  return value.trim().length >= OPERATOR_EVIDENCE_MIN_LENGTH;
}
