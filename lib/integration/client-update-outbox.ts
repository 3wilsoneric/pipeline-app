import "server-only";

import type { JSONValue } from "postgres";

import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import {
  assertPreparedClientUpdate,
  CLIENT_DATABASE_BASELINE_DATE,
  type PreparedClientUpdate,
} from "./client-update-contracts";

export {
  CLIENT_DATABASE_BASELINE_DATE,
  prepareAssessmentUpdate,
  prepareNewClientUpdate,
} from "./client-update-contracts";
export type { PreparedClientUpdate } from "./client-update-contracts";

export function getClientUpdateReadiness() {
  const enabled = process.env.PIPELINE_CLIENT_INCREMENTAL_UPDATES_ENABLED === "true";
  const approved = process.env.PIPELINE_CLIENT_INCREMENTAL_UPDATES_APPROVAL === "APPROVED";
  const database = getPipelineDatabaseReadiness();
  return {
    enabled,
    approved,
    ready: enabled && approved && database.ready,
    database_ready: database.ready,
    baseline_date: CLIENT_DATABASE_BASELINE_DATE,
    warning: enabled && approved
      ? database.ready
        ? null
        : "The incremental client-update outbox requires PostgreSQL."
      : "Incremental client creation and Databricks publication are prepared but not approved.",
  };
}

export async function enqueuePreparedClientUpdate(
  update: PreparedClientUpdate,
  actorId: string,
) {
  const readiness = getClientUpdateReadiness();
  if (!readiness.ready) {
    throw new Error("Incremental client updates are not approved in this environment.");
  }
  assertPreparedClientUpdate(update);
  const sql = getPipelineSql();
  const rows = await sql<{ client_update_id: string; status: string }[]>`
    insert into pipeline.client_update_outbox (
      update_type, canonical_client_id, assessment_id, source_baseline_date,
      payload, status, idempotency_key, created_by
    ) values (
      ${update.update_type}, ${update.canonical_client_id}, ${update.assessment_id},
      ${CLIENT_DATABASE_BASELINE_DATE}::date, ${sql.json(asJsonValue(update.payload))},
      'pending_approval', ${update.idempotency_key}, ${actorId}
    )
    on conflict (idempotency_key) do update
      set idempotency_key = excluded.idempotency_key
    returning client_update_id, status
  `;
  return rows[0];
}

function asJsonValue(value: Record<string, unknown>): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}
