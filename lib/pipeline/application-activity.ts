import "server-only";

import { getPipelineSql } from "@/lib/database/pipeline-database";
import { decodeKeysetCursor, encodeKeysetCursor } from "@/lib/pipeline/keyset-cursor";
import { buildReferralActivityChanges } from "@/lib/pipeline/referral-activity-presentation";
import type { ApplicationActivitySnapshot } from "@/lib/pipeline/application-activity-types";

export type ApplicationActivityQuery = { since: string; through: string; actor?: string; cursor?: string };

type ActivityRow = {
  audit_event_id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string;
  changed_fields: string[];
  created_at: string;
  referral_id: string | null;
  display_name: string | null;
  deleted: boolean;
};

// Read only the durable production audit trail. Local-file environments do not
// have a unified trail; callers report that explicitly rather than invent data.
export async function getApplicationActivity(query: ApplicationActivityQuery): Promise<ApplicationActivitySnapshot> {
  const sql = getPipelineSql();
  const cursor = decodeKeysetCursor(query.cursor);
  const [people, rows] = await Promise.all([
    sql<{
      id: string; name: string; email: string | null; last_seen_at: Date | null;
      last_sign_in_at: Date | null; sign_ins: string; recorded_actions: string;
    }[]>`
      with activity as (
        select actor_id, max(actor_name) as actor_name,
          count(*) filter (where action = 'signed_in' and entity_type = 'auth_session') as sign_ins,
          max(created_at) filter (where action = 'signed_in' and entity_type = 'auth_session') as last_sign_in_at,
          count(*) filter (where entity_type <> 'auth_session') as recorded_actions
        from pipeline.audit_events
        where created_at >= ${query.since}::timestamptz and created_at <= ${query.through}::timestamptz
        group by actor_id
      )
      select coalesce(m.principal_id, a.actor_id) as id,
        coalesce(m.display_name, a.actor_name) as name, m.email, m.last_seen_at,
        a.last_sign_in_at, coalesce(a.sign_ins, 0)::text as sign_ins,
        coalesce(a.recorded_actions, 0)::text as recorded_actions
      from pipeline.workspace_members m full outer join activity a on a.actor_id = m.principal_id
      where m.active = true or a.actor_id is not null
      order by m.last_seen_at desc nulls last, name, id
    `,
    sql<ActivityRow[]>`
      with recent as (
        select audit_event_id, actor_id, actor_name, action, entity_type, entity_id, changed_fields, created_at
        from pipeline.audit_events
        where created_at >= ${query.since}::timestamptz and created_at <= ${query.through}::timestamptz
          ${query.actor ? sql`and actor_id = ${query.actor}` : sql``}
          ${cursor ? sql`and (created_at, audit_event_id) < (${cursor.timestamp}::text::timestamptz, ${cursor.key}::uuid)` : sql``}
        order by created_at desc, audit_event_id desc limit 51
      )
      select a.audit_event_id::text, a.actor_id, a.actor_name, a.action, a.entity_type, a.entity_id, a.changed_fields,
        to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
        r.referral_id::text, p.display_name, r.deleted_at is not null as deleted
      from recent a
      left join pipeline.assessments assessment on a.entity_type = 'assessment' and assessment.assessment_id = a.entity_id
      left join pipeline.documents doc on a.entity_type = 'document' and doc.document_id::text = a.entity_id
      left join pipeline.work_items work on a.entity_type = 'work_item' and work.work_item_id::text = a.entity_id
      left join pipeline.admission_decisions decision on a.entity_type = 'admission_decision' and decision.decision_id::text = a.entity_id
      left join pipeline.assessment_reviews review on a.entity_type = 'assessment_review' and review.review_id::text = a.entity_id
      left join pipeline.referrals r on r.referral_id = coalesce(
        case when a.entity_type = 'referral' and a.entity_id ~ '^[0-9]{1,15}$' then a.entity_id::bigint end,
        assessment.referral_id, doc.referral_id, work.referral_id, decision.referral_id, review.referral_id)
      left join pipeline.people p on p.person_id = r.person_id
      order by a.created_at desc, a.audit_event_id desc
    `,
  ]);
  const page = rows.slice(0, 50);
  const last = page.at(-1);
  return {
    since: query.since,
    through: query.through,
    people: people.map((person) => ({ ...person,
      last_seen_at: person.last_seen_at?.toISOString() ?? null,
      last_sign_in_at: person.last_sign_in_at?.toISOString() ?? null,
      sign_ins: Number(person.sign_ins), recorded_actions: Number(person.recorded_actions),
    })),
    events: page.map((row) => ({
      id: row.audit_event_id, actor_id: row.actor_id, actor_name: row.actor_name,
      action: row.action, entity_type: row.entity_type, entity_id: row.entity_id,
      fields: buildReferralActivityChanges(row.changed_fields, null, null).map((field) => field.label),
      created_at: row.created_at,
      workspace: row.referral_id ? { id: Number(row.referral_id), name: row.display_name ?? "Workspace", deleted: row.deleted } : null,
    })),
    next_cursor: rows.length > 50 && last ? encodeKeysetCursor({ timestamp: last.created_at, key: last.audit_event_id }) : null,
  };
}
