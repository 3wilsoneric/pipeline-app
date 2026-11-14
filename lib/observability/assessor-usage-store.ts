import "server-only";
import { getPipelineSql } from "@/lib/database/pipeline-database";
import type { UsageBatch } from "./assessor-usage-contract";

export async function saveAssessorUsage(principalId: string, batch: UsageBatch) {
  const sql = getPipelineSql();
  // Cumulative per-tab minute totals: lost acknowledgments, retries and reordered
  // requests cannot double count or move a total backward. Identity is server-owned.
  await sql`
    insert into pipeline.assessor_usage_minutes ${sql(batch.samples.map((sample) => ({
      principal_id: principalId, session_id: batch.sessionId, minute: sample.minute, interactions: sample.interactions,
    })))}
    on conflict (principal_id, session_id, minute) do update
      set interactions = greatest(pipeline.assessor_usage_minutes.interactions, excluded.interactions)
  `;
}
