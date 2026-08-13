import "server-only";

import { listAssessments } from "@/lib/assessment/assessment-store";
import { getPipelineSql } from "@/lib/database/pipeline-database";
import { getReferral, getReferralStoreReadiness } from "@/lib/pipeline/referral-store";

export type ReferralActivityEvent = {
  event_id: string;
  action: string;
  actor_name: string;
  changed_fields: string[];
  from_version: number | null;
  to_version: number | null;
  created_at: string;
};

type ActivityRow = {
  audit_event_id: string;
  action: string;
  actor_name: string;
  changed_fields: string[];
  from_version: number | null;
  to_version: number | null;
  created_at: Date | string;
};

export async function listReferralActivity(referralId: number): Promise<ReferralActivityEvent[] | null> {
  const referral = await getReferral(referralId);
  if (!referral) return null;

  if (getReferralStoreReadiness().mode === "postgres") {
    const sql = getPipelineSql();
    const rows = await sql<ActivityRow[]>`
      select audit_event_id, action, actor_name, changed_fields,
             from_version, to_version, created_at
      from pipeline.audit_events
      where (entity_type = 'referral' and entity_id = ${String(referralId)})
         or (entity_type = 'assessment' and entity_id in (
              select assessment_id from pipeline.assessments where referral_id = ${referralId}
            ))
         or (entity_type = 'work_item' and entity_id in (
              select work_item_id::text from pipeline.work_items where referral_id = ${referralId}
            ))
         or (entity_type = 'admission_decision' and entity_id in (
              select decision_id::text from pipeline.admission_decisions where referral_id = ${referralId}
            ))
      order by created_at desc, audit_event_id desc
      limit 100
    `;
    return rows.map(mapActivityRow);
  }

  const assessments = await listAssessments({ referralId, limit: 100 });
  const events: ReferralActivityEvent[] = assessments.assessments.flatMap((assessment) =>
    assessment.audit_events.map((event) => ({
      event_id: event.event_id,
      action: event.action,
      actor_name: event.actor_name,
      changed_fields: event.changed_fields,
      from_version: null,
      to_version: null,
      created_at: event.created_at,
    })),
  );
  events.push({
    event_id: `referral-${referral.id}-created`,
    action: "referral_created",
    actor_name: "Pipeline user",
    changed_fields: [],
    from_version: null,
    to_version: 1,
    created_at: referral.createdAt,
  });
  if (referral.admissionDecision) {
    events.push({
      event_id: `decision-${referral.admissionDecision.decisionId}-${referral.admissionDecision.version}`,
      action: "admission_decision_recorded",
      actor_name: referral.admissionDecision.decidedByName,
      changed_fields: ["outcome", "reasonNote"],
      from_version: referral.admissionDecision.version > 1 ? referral.admissionDecision.version - 1 : null,
      to_version: referral.admissionDecision.version,
      created_at: referral.admissionDecision.decidedAt,
    });
  }
  return events.sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, 100);
}

function mapActivityRow(row: ActivityRow): ReferralActivityEvent {
  return {
    event_id: row.audit_event_id,
    action: row.action,
    actor_name: row.actor_name,
    changed_fields: row.changed_fields ?? [],
    from_version: row.from_version === null ? null : Number(row.from_version),
    to_version: row.to_version === null ? null : Number(row.to_version),
    created_at: toIso(row.created_at),
  };
}

function toIso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
