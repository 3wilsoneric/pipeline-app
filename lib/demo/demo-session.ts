export const PIPELINE_DEMO_SESSION_KEY = "pipeline-demo-session";
export const PIPELINE_DEMO_SESSION_EVENT = "pipeline:demo-session-changed";

export function activatePipelineDemoSession() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(PIPELINE_DEMO_SESSION_KEY, "active");
  window.dispatchEvent(new CustomEvent(PIPELINE_DEMO_SESSION_EVENT, { detail: { active: true } }));
}

export function clearPipelineDemoSession() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PIPELINE_DEMO_SESSION_KEY);
  window.dispatchEvent(new CustomEvent(PIPELINE_DEMO_SESSION_EVENT, { detail: { active: false } }));
}

export function hasActivePipelineDemoSession() {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(PIPELINE_DEMO_SESSION_KEY) === "active";
}
