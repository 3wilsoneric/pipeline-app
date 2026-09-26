import "server-only";

import { canAccessPipeline, hasPipelineSessionForUser, type PipelineUser } from "@/lib/auth/pipeline-auth";
import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";

// Called after the sign-in response. Audit availability must never prevent login.
// A valid same-account session refresh is not another sign-in.
export async function recordPipelineSignIn(request: Request, user: PipelineUser) {
  if (user.demoPersona || user.delegation || !canAccessPipeline(user) || !getPipelineDatabaseReadiness().ready) return;
  try {
    if (await hasPipelineSessionForUser(request, user.id)) return;
    const sql = getPipelineSql();
    await sql`
      insert into pipeline.audit_events (entity_type, entity_id, action, actor_id, actor_name)
      values ('auth_session', ${crypto.randomUUID()}, 'signed_in', ${user.id}, ${user.name})
    `;
  } catch {
    // No identity, cookie, token, or database exception enters application logs.
    console.warn("Pipeline sign-in activity could not be recorded; sign-in remains available.");
  }
}
