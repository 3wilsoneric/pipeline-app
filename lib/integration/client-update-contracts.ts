export const CLIENT_DATABASE_BASELINE_DATE = "2026-08-18" as const;

export type ClientUpdateType = "new_client" | "assessment";

export type PreparedClientUpdate = {
  update_type: ClientUpdateType;
  canonical_client_id: string | null;
  assessment_id: string | null;
  source_baseline_date: typeof CLIENT_DATABASE_BASELINE_DATE;
  payload: Record<string, unknown>;
  idempotency_key: string;
};

export function prepareNewClientUpdate(
  payload: Record<string, unknown>,
  idempotencyKey: string,
): PreparedClientUpdate {
  const update: PreparedClientUpdate = {
    update_type: "new_client",
    canonical_client_id: null,
    assessment_id: null,
    source_baseline_date: CLIENT_DATABASE_BASELINE_DATE,
    payload,
    idempotency_key: idempotencyKey,
  };
  assertPreparedClientUpdate(update);
  return update;
}

export function prepareAssessmentUpdate(
  canonicalClientId: string,
  assessmentId: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): PreparedClientUpdate {
  const update: PreparedClientUpdate = {
    update_type: "assessment",
    canonical_client_id: canonicalClientId.trim() || null,
    assessment_id: assessmentId.trim() || null,
    source_baseline_date: CLIENT_DATABASE_BASELINE_DATE,
    payload,
    idempotency_key: idempotencyKey,
  };
  assertPreparedClientUpdate(update);
  return update;
}

export function assertPreparedClientUpdate(update: PreparedClientUpdate) {
  if (update.source_baseline_date !== CLIENT_DATABASE_BASELINE_DATE) {
    throw new Error("Client updates must preserve the August 18 baseline reference.");
  }
  if (!["new_client", "assessment"].includes(update.update_type)) {
    throw new Error("Client update type is invalid.");
  }
  if (update.update_type === "assessment" && (!update.assessment_id || !update.canonical_client_id)) {
    throw new Error("Assessment updates require canonical client and assessment identifiers.");
  }
  if (!update.idempotency_key || update.idempotency_key.length > 160) {
    throw new Error("Client update idempotency key is invalid.");
  }
  if (!update.payload || typeof update.payload !== "object" || Array.isArray(update.payload)) {
    throw new Error("Client update payload must be an object.");
  }
}
