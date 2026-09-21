import { fromPipelinePath } from "@/lib/pipeline/base-path";
import { applyPipelineWorkspaceLocation, pipelineWorkspaceLocationFromSearchParams } from "@/lib/pipeline/work-continuity";
import type { OperatorGuidedTutorial } from "@/lib/training/operator-guided-tutorials";

const origin = "https://pipeline.invalid";

export function guideWorkspaceAvailable(location: string) {
  const params = new URL(location, origin).searchParams;
  return params.get("screen") === "packet" && Boolean(params.get("referralId") || params.get("trainingAssessment"));
}

export function guideIntakeAvailable(location: string) {
  const params = new URL(location, origin).searchParams;
  return params.get("screen") === "packet" && Boolean(params.get("draftId")) && !params.has("referralId") && !params.has("trainingAssessment") && !params.has("trainingIntake");
}

export function guideRouteMatches(route: string, location: string) {
  const current = new URL(location, origin);
  const expected = new URL(route, origin);
  if (fromPipelinePath(current.pathname) !== expected.pathname) return false;
  // Home is not every other query-driven screen at the root path.
  if (!expected.search) return !current.search;
  return [...expected.searchParams].every(([key, value]) => current.searchParams.get(key) === value);
}

function guideIsPractice(params: URLSearchParams) {
  return ["trainingAssessment", "trainingIntake"].some((key) => params.has(key));
}

function resolveIntakeDestination(current: URL, destination: URL, freshDraftId?: string) {
  const location = current.pathname + current.search;
  if (guideIntakeAvailable(location)) return location;
  if (freshDraftId) destination.searchParams.set("draftId", freshDraftId);
  else if (guideWorkspaceAvailable(location)) destination.search = current.search;
  else return null;
  return destination.pathname + destination.search;
}

export function resolveGuideDestination(route: string, location: string, context: OperatorGuidedTutorial["context"], freshDraftId?: string): string | null {
  const current = new URL(location, origin);
  const destination = new URL(route, origin);
  const params = destination.searchParams;
  if (context === "intake") {
    return resolveIntakeDestination(current, destination, freshDraftId);
  } else if (guideIsPractice(params)) {
    const samePractice = guideIsPractice(current.searchParams);
    const draftId = freshDraftId ?? (samePractice ? current.searchParams.get("draftId") : null);
    if (!draftId) return null;
    params.set("draftId", draftId);
  } else if (params.get("screen") === "packet") {
    // Contextual guides must never manufacture an empty intake or switch client.
    if (!guideWorkspaceAvailable(location)) return null;
    const merged = new URLSearchParams(current.search);
    if (["workspaceStage", "workspaceView"].some((key) => params.has(key))) {
      applyPipelineWorkspaceLocation(merged, pipelineWorkspaceLocationFromSearchParams(params));
    }
    destination.search = merged.toString();
  } else if (context === "workspace") return null;
  return destination.pathname + destination.search;
}
