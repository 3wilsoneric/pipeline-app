export const pipelineHomeModuleIds = [
  "current-work",
  "new-assignments",
  "upcoming-assessments",
  "scheduling-queue",
] as const;

export type PipelineHomeModuleId = (typeof pipelineHomeModuleIds)[number];

export type PipelineHomeDashboardLayout = {
  schema: 1;
  module_ids: PipelineHomeModuleId[];
  locked: boolean;
};

const pipelineHomeModuleIdSet = new Set<string>(pipelineHomeModuleIds);
const defaultModuleIds: PipelineHomeModuleId[] = [
  "current-work",
  "new-assignments",
  "upcoming-assessments",
];

export function defaultPipelineHomeDashboardLayout(): PipelineHomeDashboardLayout {
  return { schema: 1, module_ids: [...defaultModuleIds], locked: true };
}

export function parsePipelineHomeDashboardLayout(value: unknown): PipelineHomeDashboardLayout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PipelineHomeDashboardLayout>;
  if (candidate.schema !== 1 || typeof candidate.locked !== "boolean" || !Array.isArray(candidate.module_ids)) return null;
  if (candidate.module_ids.length > pipelineHomeModuleIds.length) return null;
  const moduleIds = [...new Set(candidate.module_ids.filter(isPipelineHomeModuleId))];
  if (moduleIds.length !== candidate.module_ids.length) return null;
  return { schema: 1, module_ids: moduleIds, locked: candidate.locked };
}

export function isPipelineHomeModuleId(value: unknown): value is PipelineHomeModuleId {
  return typeof value === "string" && pipelineHomeModuleIdSet.has(value);
}
