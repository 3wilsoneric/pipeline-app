import "server-only";

import { listAssessments } from "@/lib/assessment/assessment-store";
import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import { getPipelineSql } from "@/lib/database/pipeline-database";
import { getReferral, getReferralStoreReadiness } from "@/lib/pipeline/referral-store";
import type { Referral } from "@/lib/pipeline/referral-types";

export type ReferralActivityActor = {
  id: string | null;
  name: string;
};

export type ReferralActivityEvent = {
  event_id: string;
  action: string;
  actor_id: string | null;
  actor_name: string;
  changed_fields: string[];
  from_version: number | null;
  to_version: number | null;
  created_at: string;
};

export type ReferralWorkflowMetadata = {
  owner: ReferralActivityActor | null;
  created_by: ReferralActivityActor | null;
  last_changed_by: ReferralActivityActor | null;
  last_changed_at: string | null;
  contributors: Array<ReferralActivityActor & {
    event_count: number;
    last_activity_at: string;
  }>;
  assessment: {
    status: PipelineAssessmentRecord["status"] | "not_started";
    assessor: ReferralActivityActor | null;
    started_at: string | null;
    completed_at: string | null;
    elapsed_minutes: number | null;
    completed_count: number;
    average_completed_minutes: number | null;
  };
  timing: {
    referral_to_assessment_minutes: number | null;
    assessment_to_decision_minutes: number | null;
    total_minutes: number;
    decision_recorded: boolean;
  };
};

export type ReferralActivitySnapshot = {
  events: ReferralActivityEvent[];
  metadata: ReferralWorkflowMetadata;
};

type ActivityRow = {
  audit_event_id: string;
  action: string;
  actor_id: string | null;
  actor_name: string;
  changed_fields: string[];
  from_version: number | null;
  to_version: number | null;
  created_at: Date | string;
};

export async function listReferralActivity(referralId: number): Promise<ReferralActivityEvent[] | null> {
  const snapshot = await getReferralActivitySnapshot(referralId);
  return snapshot?.events ?? null;
}

export async function getReferralActivitySnapshot(referralId: number): Promise<ReferralActivitySnapshot | null> {
  const referral = await getReferral(referralId);
  if (!referral) return null;
  const assessments = (await listAssessments({ referralId, limit: 100 })).assessments;
  const events = await loadActivityEvents(referral, assessments);
  return {
    events,
    metadata: buildWorkflowMetadata(referral, assessments, events),
  };
}

async function loadActivityEvents(
  referral: Referral,
  assessments: PipelineAssessmentRecord[],
): Promise<ReferralActivityEvent[]> {
  if (getReferralStoreReadiness().mode === "postgres") {
    const sql = getPipelineSql();
    const rows = await sql<ActivityRow[]>`
      select audit_event_id, action, actor_id, actor_name, changed_fields,
             from_version, to_version, created_at
      from pipeline.audit_events
      where (entity_type = 'referral' and entity_id = ${String(referral.id)})
         or (entity_type = 'assessment' and entity_id in (
              select assessment_id from pipeline.assessments where referral_id = ${referral.id}
            ))
         or (entity_type = 'work_item' and entity_id in (
              select work_item_id::text from pipeline.work_items where referral_id = ${referral.id}
            ))
         or (entity_type = 'admission_decision' and entity_id in (
              select decision_id::text from pipeline.admission_decisions where referral_id = ${referral.id}
            ))
      order by created_at desc, audit_event_id desc
      limit 100
    `;
    return rows.map(mapActivityRow);
  }

  const events: ReferralActivityEvent[] = assessments.flatMap((assessment) =>
    assessment.audit_events.map((event) => ({
      event_id: event.event_id,
      action: event.action,
      actor_id: event.actor_id,
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
    actor_id: null,
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
      actor_id: referral.admissionDecision.decidedBy,
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
    actor_id: row.actor_id,
    actor_name: row.actor_name,
    changed_fields: row.changed_fields ?? [],
    from_version: row.from_version === null ? null : Number(row.from_version),
    to_version: row.to_version === null ? null : Number(row.to_version),
    created_at: toIso(row.created_at),
  };
}

function buildWorkflowMetadata(
  referral: Referral,
  assessments: PipelineAssessmentRecord[],
  events: ReferralActivityEvent[],
): ReferralWorkflowMetadata {
  const orderedAssessments = [...assessments].sort((left, right) =>
    right.created_at.localeCompare(left.created_at));
  const latestAssessment = orderedAssessments[0] ?? null;
  const completedDurations = orderedAssessments.flatMap((assessment) => {
    if (!assessment.completed_at) return [];
    const duration = minutesBetween(assessment.created_at, assessment.completed_at);
    return duration === null ? [] : [duration];
  });
  const earliestAssessment = [...assessments].sort((left, right) =>
    left.created_at.localeCompare(right.created_at))[0] ?? null;
  const createdEvent = [...events]
    .reverse()
    .find((event) => event.action === "referral_created");
  const lastEvent = events[0] ?? null;
  const assessmentCompletedAt = latestAssessment?.completed_at ?? referral.assessment?.completedAt ?? null;
  const decisionAt = referral.admissionDecision?.decidedAt ?? null;
  const now = new Date().toISOString();

  return {
    owner: referral.owner && referral.owner.toLowerCase() !== "unassigned"
      ? { id: referral.ownerId ?? null, name: referral.owner }
      : null,
    created_by: createdEvent ? actorFromEvent(createdEvent) : null,
    last_changed_by: lastEvent ? actorFromEvent(lastEvent) : referral.updatedBy
      ? { id: referral.updatedBy.id, name: referral.updatedBy.name }
      : null,
    last_changed_at: lastEvent?.created_at ?? referral.updatedAt ?? referral.createdAt,
    contributors: buildContributors(events),
    assessment: {
      status: latestAssessment?.status ?? (assessmentCompletedAt ? "complete" : "not_started"),
      assessor: latestAssessment
        ? { id: latestAssessment.created_by.id, name: latestAssessment.created_by.name }
        : null,
      started_at: latestAssessment?.created_at ?? referral.assessment?.startedAt ?? null,
      completed_at: assessmentCompletedAt,
      elapsed_minutes: latestAssessment
        ? minutesBetween(latestAssessment.created_at, latestAssessment.completed_at ?? now)
        : referral.assessment?.startedAt
          ? minutesBetween(referral.assessment.startedAt, assessmentCompletedAt ?? now)
          : null,
      completed_count: completedDurations.length,
      average_completed_minutes: completedDurations.length
        ? Math.round(completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length)
        : null,
    },
    timing: {
      referral_to_assessment_minutes: earliestAssessment
        ? minutesBetween(referral.createdAt, earliestAssessment.created_at)
        : null,
      assessment_to_decision_minutes: assessmentCompletedAt && decisionAt
        ? minutesBetween(assessmentCompletedAt, decisionAt)
        : null,
      total_minutes: minutesBetween(referral.createdAt, decisionAt ?? now) ?? 0,
      decision_recorded: Boolean(decisionAt),
    },
  };
}

function buildContributors(events: ReferralActivityEvent[]) {
  const contributors = new Map<string, ReferralWorkflowMetadata["contributors"][number]>();
  for (const event of events) {
    if (!event.actor_name.trim() || event.actor_name === "Pipeline user") continue;
    const key = event.actor_id?.trim() || event.actor_name.trim().toLowerCase();
    const current = contributors.get(key);
    if (current) {
      current.event_count += 1;
      if (event.created_at > current.last_activity_at) current.last_activity_at = event.created_at;
    } else {
      contributors.set(key, {
        id: event.actor_id,
        name: event.actor_name,
        event_count: 1,
        last_activity_at: event.created_at,
      });
    }
  }
  return [...contributors.values()].sort((left, right) =>
    right.last_activity_at.localeCompare(left.last_activity_at));
}

function actorFromEvent(event: ReferralActivityEvent): ReferralActivityActor {
  return { id: event.actor_id, name: event.actor_name };
}

function minutesBetween(from: string, to: string | null) {
  if (!to) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 60_000);
}

function toIso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
