export const pipelineHomeModuleIds = [
  "search",
  "recent-work",
  "current-work",
  "new-assignments",
  "upcoming-assessments",
  "scheduling-queue",
] as const;

export type PipelineHomeModuleId = (typeof pipelineHomeModuleIds)[number];

export type PipelineHomeDashboardLayout = {
  schema: 3;
  module_ids: PipelineHomeModuleId[];
  locked: boolean;
};

const pipelineHomeModuleIdSet = new Set<string>(pipelineHomeModuleIds);
const defaultModuleIds: PipelineHomeModuleId[] = [
  "current-work",
  "new-assignments",
  "upcoming-assessments",
];
const legacyDefaultModuleIds: PipelineHomeModuleId[] = [
  "search",
  "recent-work",
  ...defaultModuleIds,
];

export function defaultPipelineHomeDashboardLayout(): PipelineHomeDashboardLayout {
  return { schema: 3, module_ids: [...defaultModuleIds], locked: true };
}

export function parsePipelineHomeDashboardLayout(value: unknown): PipelineHomeDashboardLayout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (![1, 2, 3].includes(candidate.schema as number) || typeof candidate.locked !== "boolean" || !Array.isArray(candidate.module_ids)) return null;
  if (candidate.module_ids.length > pipelineHomeModuleIds.length) return null;
  const moduleIds = [...new Set(candidate.module_ids.filter(isPipelineHomeModuleId))];
  if (moduleIds.length !== candidate.module_ids.length) return null;
  const migratedIds = migrateModuleIds(candidate.schema as 1 | 2 | 3, moduleIds);
  return { schema: 3, module_ids: migratedIds, locked: candidate.locked };
}

export function isPipelineHomeModuleId(value: unknown): value is PipelineHomeModuleId {
  return typeof value === "string" && pipelineHomeModuleIdSet.has(value);
}

function migrateModuleIds(schema: 1 | 2 | 3, moduleIds: PipelineHomeModuleId[]) {
  if (schema === 1) return moduleIds.filter((id) => id !== "search" && id !== "recent-work");
  if (schema === 2 && sameModuleOrder(moduleIds, legacyDefaultModuleIds)) return [...defaultModuleIds];
  return moduleIds;
}

function sameModuleOrder(left: PipelineHomeModuleId[], right: PipelineHomeModuleId[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
