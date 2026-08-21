import "server-only";

import { getPipelineSql } from "@/lib/database/pipeline-database";
import { getReferralStoreReadiness, type ReferralActor } from "@/lib/pipeline/referral-store";
import type { ReferralSection } from "@/lib/pipeline/referral-types";
import {
  assessmentToolSections,
  type AssessmentToolSection,
} from "@/lib/assessment/assessment-tool-schema";
import { recordPipelineMetric } from "@/lib/observability/pipeline-metrics";

export const presenceHeartbeatMs = 15_000;
export const presenceLeaseMs = 45_000;

export type EditingPresenceSection = ReferralSection | `assessment:${AssessmentToolSection}`;

export type EditingPresence = {
  lease_id: string;
  referral_id: number;
  actor_id: string;
  actor_name: string;
  section: EditingPresenceSection;
  heartbeat_at: string;
  expires_at: string;
};

type PresenceRow = {
  lease_id: string;
  referral_id: number | string;
  actor_id: string;
  actor_name: string;
  section: EditingPresenceSection;
  heartbeat_at: Date | string;
  expires_at: Date | string;
};

const globalPresence = globalThis as typeof globalThis & {
  __pipelineEditingPresence?: Map<string, EditingPresence>;
};
const localPresence = globalPresence.__pipelineEditingPresence
  ?? (globalPresence.__pipelineEditingPresence = new Map<string, EditingPresence>());

export async function heartbeatEditingPresence(input: {
  leaseId: string;
  referralId: number;
  section: EditingPresenceSection;
  actor: ReferralActor;
}) {
  if (getReferralStoreReadiness().mode !== "postgres") {
    recordStaleLeases(pruneLocalPresence(), "local");
    const existing = localPresence.get(input.leaseId);
    if (existing && (existing.actor_id !== input.actor.id || existing.referral_id !== input.referralId)) return null;
    const heartbeatAt = new Date();
    const presence: EditingPresence = {
      lease_id: input.leaseId,
      referral_id: input.referralId,
      actor_id: input.actor.id,
      actor_name: input.actor.name,
      section: input.section,
      heartbeat_at: heartbeatAt.toISOString(),
      expires_at: new Date(heartbeatAt.getTime() + presenceLeaseMs).toISOString(),
    };
    localPresence.set(input.leaseId, presence);
    return presence;
  }

  const sql = getPipelineSql();
  const rows = await sql<PresenceRow[]>`
    insert into pipeline.editing_presence (
      lease_id, referral_id, actor_id, actor_name, section, heartbeat_at, expires_at
    ) values (
      ${input.leaseId}::uuid, ${input.referralId}, ${input.actor.id}, ${input.actor.name},
      ${input.section}, now(), now() + interval '45 seconds'
    )
    on conflict (lease_id) do update set
      actor_name = excluded.actor_name,
      section = excluded.section,
      heartbeat_at = now(),
      expires_at = now() + interval '45 seconds'
    where pipeline.editing_presence.actor_id = excluded.actor_id
      and pipeline.editing_presence.referral_id = excluded.referral_id
    returning lease_id, referral_id, actor_id, actor_name, section, heartbeat_at, expires_at
  `;
  return rows[0] ? mapPresence(rows[0]) : null;
}

export function isEditingPresenceSection(value: unknown): value is EditingPresenceSection {
  if (value === "identity" || value === "intake" || value === "documents" || value === "assessment" || value === "workflow" || value === "decision") {
    return true;
  }
  if (typeof value !== "string" || !value.startsWith("assessment:")) return false;
  return (assessmentToolSections as readonly string[]).includes(value.slice("assessment:".length));
}

export async function listEditingPresence(referralId: number) {
  if (getReferralStoreReadiness().mode !== "postgres") {
    recordStaleLeases(pruneLocalPresence(), "local");
    return [...localPresence.values()]
      .filter((presence) => presence.referral_id === referralId)
      .sort(comparePresence);
  }

  const sql = getPipelineSql();
  const expired = await sql<{ lease_id: string }[]>`
    delete from pipeline.editing_presence where expires_at <= now() returning lease_id
  `;
  recordStaleLeases(expired.length, "postgres");
  const rows = await sql<PresenceRow[]>`
    select lease_id, referral_id, actor_id, actor_name, section, heartbeat_at, expires_at
    from pipeline.editing_presence
    where referral_id = ${referralId} and expires_at > now()
    order by actor_name, section, lease_id
  `;
  return rows.map(mapPresence);
}

export async function releaseEditingPresence(leaseId: string, referralId: number, actorId: string) {
  if (getReferralStoreReadiness().mode !== "postgres") {
    const existing = localPresence.get(leaseId);
    if (!existing || existing.referral_id !== referralId || existing.actor_id !== actorId) return false;
    return localPresence.delete(leaseId);
  }

  const sql = getPipelineSql();
  const rows = await sql<{ lease_id: string }[]>`
    delete from pipeline.editing_presence
    where lease_id = ${leaseId}::uuid and referral_id = ${referralId} and actor_id = ${actorId}
    returning lease_id
  `;
  return Boolean(rows[0]);
}

function pruneLocalPresence() {
  const now = Date.now();
  let pruned = 0;
  for (const [leaseId, presence] of localPresence) {
    if (Date.parse(presence.expires_at) <= now && localPresence.delete(leaseId)) pruned += 1;
  }
  return pruned;
}

function recordStaleLeases(count: number, backend: "local" | "postgres") {
  if (count <= 0) return;
  recordPipelineMetric("pipeline.presence.stale_leases", count, "count", {
    operation: "prune",
    result: "expired",
    backend,
  });
}

function mapPresence(row: PresenceRow): EditingPresence {
  return {
    lease_id: row.lease_id,
    referral_id: Number(row.referral_id),
    actor_id: row.actor_id,
    actor_name: row.actor_name,
    section: row.section,
    heartbeat_at: toIso(row.heartbeat_at),
    expires_at: toIso(row.expires_at),
  };
}

function comparePresence(left: EditingPresence, right: EditingPresence) {
  return left.actor_name.localeCompare(right.actor_name)
    || left.section.localeCompare(right.section)
    || left.lease_id.localeCompare(right.lease_id);
}

function toIso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
