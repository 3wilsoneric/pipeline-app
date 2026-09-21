import { fromPipelinePath } from "@/lib/pipeline/base-path";
import { applyPipelineWorkspaceLocation, pipelineWorkspaceLocationFromSearchParams } from "@/lib/pipeline/work-continuity";
import type { OperatorGuidedTutorial } from "@/lib/training/operator-guided-tutorials";

const origin = "https://pipeline.invalid";

export function guideWorkspaceAvailable(location: string) {
  const params = new URL(location, origin).searchParams;
  return params.get("screen") === "packet" && Boolean(params.get("referralId") || params.get("trainingAssessment"));
}

export function guideRouteMatches(route: string, location: string) {
  const current = new URL(location, origin);
  const expected = new URL(route, origin);
  if (fromPipelinePath(current.pathname) !== expected.pathname) return false;
  // Home is not every other query-driven screen at the root path.
  if (!expected.search) return !current.search;
  return [...expected.searchParams].every(([key, value]) => current.searchParams.get(key) === value);
}

export function resolveGuideDestination(route: string, location: string, context: OperatorGuidedTutorial["context"], freshDraftId?: string): string | null {
  const current = new URL(location, origin);
  const destination = new URL(route, origin);
  const params = destination.searchParams;
  if (params.has("trainingAssessment") || params.has("trainingIntake")) {
    const samePractice = current.searchParams.has("trainingAssessment") || current.searchParams.has("trainingIntake");
    const draftId = freshDraftId ?? (samePractice ? current.searchParams.get("draftId") : null);
    if (!draftId) return null;
    params.set("draftId", draftId);
  } else if (params.get("screen") === "packet") {
    // Contextual guides must never manufacture an empty intake or switch client.
    if (!guideWorkspaceAvailable(location)) return null;
    const merged = new URLSearchParams(current.search);
    if (params.has("workspaceStage") || params.has("workspaceView")) {
      applyPipelineWorkspaceLocation(merged, pipelineWorkspaceLocationFromSearchParams(params));
    }
    destination.search = merged.toString();
  } else if (context === "workspace") return null;
  return destination.pathname + destination.search;
}
