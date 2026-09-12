"use client";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { parsePipelineWorkContinuityState, type PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
import type {
  PipelineLastWorkspace,
  PipelineWorkContinuityPatch,
  PipelineWorkContinuityState,
} from "@/lib/pipeline/work-continuity";

let updateQueue = Promise.resolve<unknown>(undefined);

export function recordLastPipelineWorkspace(lastWorkspace: PipelineLastWorkspace) {
  void queuePatch({ lastWorkspace }).catch(() => undefined);
}

export async function loadPipelineWorkspaceResumeLocation(referralId: number): Promise<PipelineWorkspaceLocation | undefined> {
  await updateQueue.catch(() => undefined);
  const payload = await fetchPipelineJson<{ state: PipelineWorkContinuityState }>("/api/me/work-continuity", { cache: "no-store" });
  const state = parsePipelineWorkContinuityState(payload.state);
  const recent = [state?.lastWorkspace, ...(state?.recentWorkspaces ?? [])]
    .filter((workspace) => workspace?.referralId === referralId)
    .sort((left, right) => Date.parse(right!.visitedAt) - Date.parse(left!.visitedAt));
  return recent[0]?.location;
}

export function initializePipelineAssignmentTracking(timestamp: string) {
  return queuePatch({ initializeAssignmentTrackingAt: timestamp });
}

export function acknowledgePipelineAssignments(ids: string[], through?: string) {
  if (ids.length === 0 && !through) return Promise.resolve();
  return queuePatch({
    ...(ids.length ? { acknowledgeAssignmentIds: ids } : {}),
    ...(through ? { acknowledgeAssignmentsThrough: through } : {}),
  }).then(() => undefined);
}

function queuePatch(patch: PipelineWorkContinuityPatch) {
  const update = updateQueue.catch(() => undefined).then(() => (
    fetchPipelineJson<{ state: PipelineWorkContinuityState }>("/api/me/work-continuity", {
      method: "PATCH",
      body: JSON.stringify(patch),
    })
  ));
  updateQueue = update;
  return update;
}
