import "server-only";
import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { getPipelineSql } from "@/lib/database/pipeline-database";
import { getAssessorScorecardWork } from "./operations-snapshot";
import { buildAssessorScorecard, scorecardRange, type ScorecardEvent, type ScorecardMember } from "./assessor-scorecard-model";
import type { ScorecardPeriod } from "./assessor-scorecard-types";

export async function getAssessorScorecard(user: PipelineUser, period: ScorecardPeriod) {
  const sql = getPipelineSql();
  const through = new Date();
  const range = scorecardRange(period, through);
  const context = await getAssessorScorecardWork(user);
  const ids = context.work.map((work) => work.referral_id);
  const [members, rows, coverage] = await Promise.all([
    sql<ScorecardMember[]>`select principal_id as id, display_name as name, active, roles,
      merged_into_principal_id as "mergedInto" from pipeline.workspace_members`,
    // No answer values, note bodies, email content or recipient addresses leave storage.
    // All-time milestones preserve first-completion attribution when later reconfirmed.
    sql<(Omit<ScorecardEvent, "at"> & { at: Date })[]>`
      select e.audit_event_id::text as id, e.actor_id as "actorId", e.actor_name as "actorName",
        e.action, e.entity_type as "entityType", e.entity_id as "entityId", a.revision_root_id as "rootId", e.changed_fields as fields,
        e.created_at as at, e.metadata->>'delivery_id' as "deliveryId",
        r.referral_id::integer as "referralId", p.display_name as client, r.community
      from pipeline.audit_events e
      left join pipeline.assessments a on e.entity_type = 'assessment' and a.assessment_id = e.entity_id
      left join pipeline.documents d on e.entity_type = 'document' and d.document_id::text = e.entity_id
      left join pipeline.work_items w on e.entity_type = 'work_item' and w.work_item_id::text = e.entity_id
      left join pipeline.admission_decisions decision on e.entity_type = 'admission_decision' and decision.decision_id::text = e.entity_id
      join pipeline.referrals r on r.referral_id = coalesce(
        case when e.entity_type = 'referral' and e.entity_id ~ '^[0-9]{1,15}$' then e.entity_id::bigint end,
        a.referral_id, d.referral_id, w.referral_id, decision.referral_id)
      join pipeline.people p on p.person_id = r.person_id
      where r.referral_id = any(${ids}::bigint[]) and e.created_at <= ${range.through}::timestamptz
        and (e.created_at >= ${range.since}::timestamptz or e.action in ('assessment_started', 'assessment_signed', 'assessment_interview_completed', 'meet_client_summary_sent'))
      order by e.created_at, e.audit_event_id limit 50001
    `,
    sql<{ applied_at: Date }[]>`select applied_at from pipeline.schema_migrations where migration_id = '0049_assessor_usage'`,
  ]);
  if (rows.length > 50000) throw new Error("Scorecard evidence exceeds its reporting limit. Choose a shorter period.");
  const usageSince = coverage[0]?.applied_at.toISOString() ?? null;
  const usage = usageSince ? await sql<{ actorId: string; minute: Date; interactions: string }[]>`
    select principal_id as "actorId", minute, sum(interactions)::text as interactions
    from pipeline.assessor_usage_minutes
    where minute >= ${range.since}::timestamptz and minute <= ${range.through}::timestamptz
    group by principal_id, minute
  ` : [];
  return buildAssessorScorecard({ period, ...range, ...context, usageSince, members,
    events: rows.map((row) => ({ ...row, at: row.at.toISOString() })),
    usage: usage.map((row) => ({ ...row, minute: row.minute.toISOString(), interactions: Number(row.interactions) })),
  });
}
