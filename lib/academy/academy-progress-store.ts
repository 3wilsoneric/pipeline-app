import "server-only";

import {
  emptyAcademyProgress,
  normalizeAcademyProgress,
  type AcademyProgress,
  type AcademyProgressRecord,
} from "@/lib/academy/academy-progress-contract";
import {
  getUserWorkspaceState,
  getUserWorkspaceStateReadiness,
  putUserWorkspaceState,
} from "@/lib/pipeline/user-workspace-state-store";

const ACADEMY_STATE_KEY = "enterprise-curriculum";
const ACADEMY_PROGRESS_TTL_DAYS = 3650;

export async function getAcademyProgressRecord(principalId: string): Promise<AcademyProgressRecord> {
  const readiness = getUserWorkspaceStateReadiness();
  if (!readiness.ready) return browserProgressRecord();
  const persistence = durablePersistence(readiness.mode);

  const record = await getUserWorkspaceState<AcademyProgress>(
    principalId,
    "academy_progress",
    ACADEMY_STATE_KEY,
  );
  if (!record) {
    return {
      revision: 0,
      progress: emptyAcademyProgress(),
      updatedAt: null,
      persistence,
    };
  }

  return {
    revision: record.version,
    progress: normalizeAcademyProgress(record.payload),
    updatedAt: record.updated_at,
    persistence,
  };
}

export async function putAcademyProgressRecord(input: {
  principalId: string;
  expectedRevision: number;
  progress: AcademyProgress;
}) {
  const readiness = getUserWorkspaceStateReadiness();
  if (!readiness.ready) {
    return {
      ok: false as const,
      unavailable: true as const,
      message: "Durable Academy progress requires the configured per-user state store.",
    };
  }
  const persistence = durablePersistence(readiness.mode);

  const result = await putUserWorkspaceState({
    principalId: input.principalId,
    kind: "academy_progress",
    key: ACADEMY_STATE_KEY,
    payload: normalizeAcademyProgress(input.progress),
    expectedVersion: input.expectedRevision,
    ttlDays: ACADEMY_PROGRESS_TTL_DAYS,
  });
  if (!result.ok) {
    return {
      ok: false as const,
      unavailable: false as const,
      current: result.current
        ? {
            revision: result.current.version,
            progress: normalizeAcademyProgress(result.current.payload),
            updatedAt: result.current.updated_at,
            persistence,
          } satisfies AcademyProgressRecord
        : {
            revision: 0,
            progress: emptyAcademyProgress(),
            updatedAt: null,
            persistence,
          } satisfies AcademyProgressRecord,
    };
  }

  return {
    ok: true as const,
    record: {
      revision: result.state.version,
      progress: normalizeAcademyProgress(result.state.payload),
      updatedAt: result.state.updated_at,
      persistence,
    } satisfies AcademyProgressRecord,
  };
}

function browserProgressRecord(): AcademyProgressRecord {
  return {
    revision: 0,
    progress: emptyAcademyProgress(),
    updatedAt: null,
    persistence: "browser",
  };
}

function durablePersistence(mode: "disabled" | "postgres" | "local_file") {
  if (mode === "disabled") {
    throw new Error("Academy progress persistence is not ready.");
  }
  return mode;
}
