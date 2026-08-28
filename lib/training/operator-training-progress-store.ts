import "server-only";

import {
  emptyOperatorProgress,
  normalizeOperatorProgress,
  type OperatorProgressRecord,
  type OperatorTrainingProgress,
} from "@/lib/training/operator-training-progress-contract";
import type { OperatorRole } from "@/lib/training/operator-training-types";
import {
  getUserWorkspaceState,
  getUserWorkspaceStateReadiness,
  putUserWorkspaceState,
} from "@/lib/pipeline/user-workspace-state-store";

const STATE_KEY = "operator-curriculum";
const TTL_DAYS = 3650;

export async function getOperatorProgressRecord(principalId: string, assignedRoles: readonly string[], role: OperatorRole): Promise<OperatorProgressRecord> {
  const readiness = getUserWorkspaceStateReadiness();
  if (!readiness.ready) return browserRecord(role);
  const state = await getUserWorkspaceState<OperatorTrainingProgress>(principalId, "operator_training_progress", STATE_KEY);
  if (!state) return { revision: 0, progress: emptyOperatorProgress(role), updatedAt: null, persistence: persistence(readiness.mode) };
  return {
    revision: state.version,
    progress: normalizeOperatorProgress(state.payload, assignedRoles),
    updatedAt: state.updated_at,
    persistence: persistence(readiness.mode),
  };
}

export async function putOperatorProgressRecord(input: {
  principalId: string;
  assignedRoles: readonly string[];
  expectedRevision: number;
  progress: OperatorTrainingProgress;
}) {
  const readiness = getUserWorkspaceStateReadiness();
  if (!readiness.ready) return { ok: false as const, unavailable: true as const, message: "Durable learning progress is not configured." };
  const durable = persistence(readiness.mode);
  const result = await putUserWorkspaceState({
    principalId: input.principalId,
    kind: "operator_training_progress",
    key: STATE_KEY,
    payload: normalizeOperatorProgress(input.progress, input.assignedRoles),
    expectedVersion: input.expectedRevision,
    ttlDays: TTL_DAYS,
  });
  if (!result.ok) {
    return {
      ok: false as const,
      unavailable: false as const,
      current: result.current
        ? { revision: result.current.version, progress: normalizeOperatorProgress(result.current.payload, input.assignedRoles), updatedAt: result.current.updated_at, persistence: durable }
        : { revision: 0, progress: emptyOperatorProgress(input.progress.role), updatedAt: null, persistence: durable },
    };
  }
  return {
    ok: true as const,
    record: { revision: result.state.version, progress: normalizeOperatorProgress(result.state.payload, input.assignedRoles), updatedAt: result.state.updated_at, persistence: durable } satisfies OperatorProgressRecord,
  };
}

function browserRecord(role: OperatorRole): OperatorProgressRecord {
  return { revision: 0, progress: emptyOperatorProgress(role), updatedAt: null, persistence: "browser" };
}

function persistence(mode: "disabled" | "postgres" | "local_file") {
  if (mode === "disabled") throw new Error("Operator progress persistence is not ready.");
  return mode;
}
