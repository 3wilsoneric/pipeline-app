"use client";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import type {
  PipelineLastWorkspace,
  PipelineWorkContinuityPatch,
  PipelineWorkContinuityState,
} from "@/lib/pipeline/work-continuity";

let updateQueue = Promise.resolve<unknown>(undefined);

export function recordLastPipelineWorkspace(lastWorkspace: PipelineLastWorkspace) {
  void queuePatch({ lastWorkspace }).catch(() => undefined);
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
