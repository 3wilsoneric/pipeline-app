import "server-only";

export function isPipelineDesktopStateEnabled() {
  return process.env.PIPELINE_DESKTOP_STATE_ENABLED === "true";
}
