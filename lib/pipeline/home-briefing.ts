import "server-only";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { getPipelineSql } from "@/lib/database/pipeline-database";
import { getAssessmentCalendar } from "@/lib/pipeline/calendar-store";
import type {
  HomeBriefingActivityItem,
  HomeBriefingSnapshot,
} from "@/lib/pipeline/home-briefing-types";
import { normalizeClientName } from "@/lib/pipeline/client-identity-presentation.mjs";
import { getMyQueueSnapshot } from "@/lib/pipeline/operations-snapshot";
import { isAssessorUser, scopeReferralListOptions } from "@/lib/pipeline/referral-access";
import { getReferralStoreReadiness, listReferrals } from "@/lib/pipeline/referral-store";
import type { Referral } from "@/lib/pipeline/referral-types";

type ActivityRow = {
  audit_event_id: string;
  action: string;
  actor_name: string;
  created_at: Date | string;
  referral_id: number | string;
  client_name: string;
  community: string;
};

const meaningfulActivityActions = [
  "referral_created",
  "referral_assigned",
  "referral_reassigned",
  "referral_unassigned",
  "referral_stage_changed",
  "manual_intake_authorized",
  "assessment_created",
  "assessment_assigned",
  "assessment_imported",
  "assessment_scheduled",
  "assessment_rescheduled",
  "assessment_cancelled",
  "assessment_no_show",
  "assessment_started",
  "assessment_completed",
  "assessment_reopened",
  "assessment_signed",
  "assessment_addendum_added",
  "assessment_recommendation_submitted",
  "admission_decision_recorded",
  "admission_declined",
  "ehr_handoff_queued",
  "ehr_handoff_retried",
  "ehr_handoff_sent",
  "ehr_handoff_failed",
  "meet_client_summary_sent",
  "meet_client_summary_failed",
] as const;

export async function getHomeBriefing(user: PipelineUser): Promise<HomeBriefingSnapshot> {
  const today = dateKey(new Date());
  const through = addDays(today, 6);
  const [activityResult, calendarResult, queueResult] = await Promise.allSettled([
    listHomeActivity(user),
    getAssessmentCalendar(user, { from: today, to: through }),
    getMyQueueSnapshot({ id: user.id, name: user.name }),
  ]);
  const activity = activityResult.status === "fulfilled" ? activityResult.value : [];
  const calendar = calendarResult.status === "fulfilled"
    ? calendarResult.value
    : { events: [], unscheduled: [], unscheduledTotal: 0 };
  const queue = queueResult.status === "fulfilled"
    ? queueResult.value
    : { total: 0, items: [] };
  const unavailableSections: HomeBriefingSnapshot["unavailable_sections"] = [];
  if (activityResult.status === "rejected") unavailableSections.push("activity");
  if (queueResult.status === "rejected") unavailableSections.push("current_work");
  if (calendarResult.status === "rejected") unavailableSections.push("upcoming");
  const upcoming = calendar.events.slice(0, 8);
  const upcomingAssignmentIds = new Set(
    upcoming
      .filter((event) => event.kind === "referral_assigned")
      .map((event) => event.referralId),
  );
  const unscheduled = calendar.unscheduled.filter((item) => !upcomingAssignmentIds.has(item.referralId));

  return {
    generated_at: new Date().toISOString(),
    scope: isAssessorUser(user) ? "personal" : "team",
    viewer: { id: user.id, name: user.name },
    activity: activity.slice(0, 100),
    activity_truncated: activity.length > 100,
    current_work: {
      total: queue.total,
      items: queue.items.slice(0, 5),
    },
    upcoming,
    unscheduled: unscheduled.slice(0, 5),
    unscheduled_total: calendar.unscheduledTotal,
    unavailable_sections: unavailableSections,
  };
}

async function listHomeActivity(user: PipelineUser) {
  if (getReferralStoreReadiness().mode === "postgres") {
    return listPostgresHomeActivity(user);
  }
  return listLocalHomeActivity(user);
}

async function listPostgresHomeActivity(user: PipelineUser): Promise<HomeBriefingActivityItem[]> {
  const sql = getPipelineSql();
  const personal = isAssessorUser(user);
  const rows = await sql<ActivityRow[]>`
    with linked_events as (
      select
        ae.audit_event_id,
        ae.action,
        ae.actor_id,
        ae.actor_name,
        ae.created_at,
        coalesce(
          case
            when ae.entity_type = 'referral' and ae.entity_id ~ '^[0-9]+$'
              then ae.entity_id::bigint
          end,
          a.referral_id,
          w.referral_id,
          d.referral_id
        ) as referral_id
      from pipeline.audit_events ae
      left join pipeline.assessments a
        on ae.entity_type = 'assessment' and a.assessment_id = ae.entity_id
      left join pipeline.work_items w
        on ae.entity_type = 'work_item' and w.work_item_id::text = ae.entity_id
      left join pipeline.admission_decisions d
        on ae.entity_type = 'admission_decision' and d.decision_id::text = ae.entity_id
      where ae.created_at >= now() - interval '24 hours'
        and ae.action = any(${meaningfulActivityActions as unknown as string[]}::text[])
        and (${personal} = false or ae.actor_id = ${user.id})
    )
    select
      e.audit_event_id::text,
      e.action,
      e.actor_name,
      e.created_at,
      r.referral_id,
      p.display_name as client_name,
      r.community::text
    from linked_events e
    join pipeline.referrals r on r.referral_id = e.referral_id
    join pipeline.people p on p.person_id = r.person_id
    where r.deleted_at is null and r.workspace_status = 'active'
    order by e.created_at desc, e.audit_event_id desc
    limit 101
  `;

  return rows.map((row) => ({
    id: row.audit_event_id,
    referral_id: Number(row.referral_id),
    client_name: normalizeClientName(row.client_name, { community: row.community }) || "Name not recorded",
    community: row.community,
    actor_name: row.actor_name,
    action: row.action,
    label: activityLabel(row.action),
    occurred_at: iso(row.created_at),
  }));
}

async function listLocalHomeActivity(user: PipelineUser): Promise<HomeBriefingActivityItem[]> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1_000;
  const referrals = await loadLocalReferrals(user);
  return referrals.flatMap((referral) => {
    const occurredAt = referral.updatedAt ?? referral.createdAt;
    if (Date.parse(occurredAt) < cutoff) return [];
    if (isAssessorUser(user) && referral.updatedBy?.id !== user.id) return [];
    const action = referral.createdAt === occurredAt ? "referral_created" : "referral_updated";
    return [{
      id: `local:${referral.id}:${occurredAt}`,
      referral_id: referral.id,
      client_name: referral.name,
      community: referral.community,
      actor_name: referral.updatedBy?.name ?? (isAssessorUser(user) ? user.name : "Pipeline team"),
      action,
      label: activityLabel(action),
      occurred_at: occurredAt,
    }];
  }).sort((left, right) => right.occurred_at.localeCompare(left.occurred_at));
}

async function loadLocalReferrals(user: PipelineUser) {
  const referrals: Referral[] = [];
  let cursor: string | undefined;
  do {
    const page = await listReferrals(scopeReferralListOptions(user, {
      workspaceStatus: "active",
      includeTotal: false,
      limit: 200,
      cursor,
    }));
    referrals.push(...page.referrals);
    cursor = page.next_cursor;
  } while (cursor && referrals.length < 5_000);
  return referrals;
}

function activityLabel(action: string) {
  const labels: Record<string, string> = {
    referral_created: "Referral created",
    referral_updated: "Referral updated",
    referral_assigned: "Referral assigned",
    referral_reassigned: "Referral reassigned",
    referral_unassigned: "Referral unassigned",
    referral_stage_changed: "Workflow stage changed",
    manual_intake_authorized: "Manual intake authorized",
    assessment_created: "Assessment opened",
    assessment_assigned: "Assessment assigned",
    assessment_imported: "Assessment imported",
    assessment_scheduled: "Assessment scheduled",
    assessment_rescheduled: "Assessment rescheduled",
    assessment_cancelled: "Assessment cancelled",
    assessment_no_show: "Assessment marked no-show",
    assessment_started: "Assessment started",
    assessment_completed: "Assessment completed",
    assessment_reopened: "Assessment reopened",
    assessment_signed: "Assessment signed",
    assessment_addendum_added: "Assessment addendum added",
    assessment_recommendation_submitted: "Recommendation submitted",
    admission_decision_recorded: "Admission decision recorded",
    admission_declined: "Referral declined",
    ehr_handoff_queued: "EHR handoff queued",
    ehr_handoff_retried: "EHR handoff retried",
    ehr_handoff_sent: "EHR handoff sent",
    ehr_handoff_failed: "EHR handoff failed",
    meet_client_summary_sent: "Meet the Client sent",
    meet_client_summary_failed: "Meet the Client delivery failed",
  };
  return labels[action] ?? "Referral updated";
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function iso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
