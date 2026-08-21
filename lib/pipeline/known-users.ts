import "server-only";

import { getPipelineSql } from "@/lib/database/pipeline-database";
import { getReferralStoreReadiness } from "@/lib/pipeline/referral-store";
import { findActiveWorkspaceMemberByName } from "@/lib/pipeline/workspace-members";

export type KnownPipelineUser = {
  id: string;
  name: string;
};

type KnownUserRow = {
  actor_id: string;
  actor_name: string;
  last_seen_at: Date | string;
};

/**
 * Resolves an entered owner name only when immutable audit history identifies
 * exactly one Entra principal. Ambiguous names deliberately remain unresolved.
 */
export async function resolveKnownPipelineUser(name: string): Promise<KnownPipelineUser | null> {
  const normalized = name.trim();
  if (!normalized) return null;

  const activeMember = await findActiveWorkspaceMemberByName(normalized);
  if (activeMember) return { id: activeMember.principal_id, name: activeMember.display_name };
  if (getReferralStoreReadiness().mode !== "postgres") return null;

  const sql = getPipelineSql();
  const rows = await sql<KnownUserRow[]>`
    with known_actors as (
      select actor_id, actor_name, created_at as last_seen_at
      from pipeline.audit_events
      where lower(trim(actor_name)) = lower(${normalized})
      union all
      select created_by, created_by_name, created_at
      from pipeline.referrals
      where lower(trim(created_by_name)) = lower(${normalized})
      union all
      select updated_by, updated_by_name, updated_at
      from pipeline.referrals
      where lower(trim(updated_by_name)) = lower(${normalized})
      union all
      select owner_id, owner_name, updated_at
      from pipeline.referrals
      where owner_id is not null and lower(trim(owner_name)) = lower(${normalized})
      union all
      select created_by, created_by_name, created_at
      from pipeline.assessments
      where lower(trim(created_by_name)) = lower(${normalized})
      union all
      select updated_by, updated_by_name, updated_at
      from pipeline.assessments
      where lower(trim(updated_by_name)) = lower(${normalized})
    )
    select actor_id, max(actor_name) as actor_name, max(last_seen_at) as last_seen_at
    from known_actors
    where actor_id is not null and trim(actor_id) <> ''
    group by actor_id
    order by max(last_seen_at) desc
    limit 2
  `;

  if (rows.length !== 1) return null;
  return { id: rows[0].actor_id, name: rows[0].actor_name };
}
