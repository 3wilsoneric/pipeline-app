import { toPipelinePath } from "@/lib/pipeline/base-path";

export const PIPELINE_SERVICE_WORKER_PATH = toPipelinePath("/sw.js");
export const PIPELINE_DESKTOP_CACHE_PREFIX = "pipeline-static-";

export function isPipelineDesktopEnabled() {
  return process.env.NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED === "true";
}
