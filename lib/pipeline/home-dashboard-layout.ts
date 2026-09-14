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
  schema: 2;
  module_ids: PipelineHomeModuleId[];
  locked: boolean;
};

const pipelineHomeModuleIdSet = new Set<string>(pipelineHomeModuleIds);
const defaultModuleIds: PipelineHomeModuleId[] = [
  "search",
  "recent-work",
  "current-work",
  "new-assignments",
  "upcoming-assessments",
];

export function defaultPipelineHomeDashboardLayout(): PipelineHomeDashboardLayout {
  return { schema: 2, module_ids: [...defaultModuleIds], locked: true };
}

export function parsePipelineHomeDashboardLayout(value: unknown): PipelineHomeDashboardLayout | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if ((candidate.schema !== 1 && candidate.schema !== 2) || typeof candidate.locked !== "boolean" || !Array.isArray(candidate.module_ids)) return null;
  if (candidate.module_ids.length > pipelineHomeModuleIds.length) return null;
  const moduleIds = [...new Set(candidate.module_ids.filter(isPipelineHomeModuleId))];
  if (moduleIds.length !== candidate.module_ids.length) return null;
  // Search and recent work were fixed above every v1 layout. Migrate once so
  // removing either in v2 stays removed on the next visit.
  const migratedIds: PipelineHomeModuleId[] = candidate.schema === 1
    ? [...new Set<PipelineHomeModuleId>(["search", "recent-work", ...moduleIds])]
    : moduleIds;
  return { schema: 2, module_ids: migratedIds, locked: candidate.locked };
}

export function isPipelineHomeModuleId(value: unknown): value is PipelineHomeModuleId {
  return typeof value === "string" && pipelineHomeModuleIdSet.has(value);
}
