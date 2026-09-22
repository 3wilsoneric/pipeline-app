"use client";

import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { parsePipelineWorkContinuityState, pipelineAssessmentResumeLocation, type PipelineWorkspaceLocation } from "@/lib/pipeline/work-continuity";
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
  return (await loadLatestWorkspaceVisit(referralId))?.location;
}

// The signed-in user's last assessment section/question for this workspace,
// even when a later visit went to Files, Activity or Chart.
export async function loadPipelineAssessmentResumeLocation(referralId: number): Promise<PipelineWorkspaceLocation | undefined> {
  return pipelineAssessmentResumeLocation(await loadLatestWorkspaceVisit(referralId));
}

async function loadLatestWorkspaceVisit(referralId: number) {
  await updateQueue.catch(() => undefined);
  const payload = await fetchPipelineJson<{ state: PipelineWorkContinuityState }>("/api/me/work-continuity", { cache: "no-store" });
  const state = parsePipelineWorkContinuityState(payload.state);
  const recent = [...(state?.recentWorkspaces ?? []), state?.lastWorkspace]
    .filter((workspace) => workspace?.referralId === referralId)
    .sort((left, right) => Date.parse(right!.visitedAt) - Date.parse(left!.visitedAt));
  return recent[0];
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
