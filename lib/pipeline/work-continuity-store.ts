import "server-only";

import {
  emptyPipelineWorkContinuityState,
  mergePipelineWorkContinuityState,
  parsePipelineWorkContinuityState,
  type PipelineWorkContinuityPatch,
  type PipelineWorkContinuityState,
} from "@/lib/pipeline/work-continuity";
import {
  getUserWorkspaceState,
  putUserWorkspaceState,
} from "@/lib/pipeline/user-workspace-state-store";

const stateKey = "default";

export async function getPipelineWorkContinuityState(principalId: string) {
  const record = await getUserWorkspaceState<PipelineWorkContinuityState>(
    principalId,
    "workflow_continuity",
    stateKey,
  );
  return {
    state: parsePipelineWorkContinuityState(record?.payload) ?? emptyPipelineWorkContinuityState(),
    version: record?.version ?? 0,
  };
}

export async function patchPipelineWorkContinuityState(
  principalId: string,
  patch: PipelineWorkContinuityPatch,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await getPipelineWorkContinuityState(principalId);
    const next = mergePipelineWorkContinuityState(current.state, patch);
    const result = await putUserWorkspaceState({
      principalId,
      kind: "workflow_continuity",
      key: stateKey,
      payload: next,
      expectedVersion: current.version,
      ttlDays: 3_650,
    });
    if (result.ok) return result.state.payload;
  }
  return null;
}
