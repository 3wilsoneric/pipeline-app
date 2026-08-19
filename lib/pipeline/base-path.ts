import {
  normalizePipelineBasePath,
  withPipelineBasePath,
  withoutPipelineBasePath,
} from "@/shared/pipeline-base-path.mjs";

export const pipelineBasePath = normalizePipelineBasePath(
  process.env.NEXT_PUBLIC_PIPELINE_BASE_PATH,
);

export function toPipelinePath(path: string) {
  return withPipelineBasePath(path, pipelineBasePath);
}

export function fromPipelinePath(path: string) {
  return withoutPipelineBasePath(path, pipelineBasePath);
}
