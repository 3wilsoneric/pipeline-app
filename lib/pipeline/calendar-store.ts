import "server-only";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { listAssessments } from "@/lib/assessment/assessment-store";
import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import {
  assessmentCalendarEvent,
  assessmentPreparationItem,
  assessmentFollowUpEvents,
  calendarToday,
} from "@/lib/pipeline/assessment-calendar";
import type {
  PipelineCalendarEvent,
  PipelineCalendarResponse,
  PipelineUnscheduledAssessment,
} from "@/lib/pipeline/calendar-types";
import { isAssessorUser, scopeReferralListOptions } from "@/lib/pipeline/referral-access";
import { normalizedOwnerAliases } from "@/lib/pipeline/referral-ownership";
import { listReferrals } from "@/lib/pipeline/referral-store";
import type { Referral } from "@/lib/pipeline/referral-types";

type AssessmentCalendarRow = {
  assessment_id: string;
  referral_id: number | string;
  scheduled_start_at: Date | string;
  scheduled_duration_minutes: number | string | null;
  scheduled_method: string | null;
  scheduled_location: string | null;
  schedule_status: "scheduled" | "rescheduled" | "completed";
  assessor_id: string | null;
  assessor_name: string | null;
  status: "draft" | "needs_review" | "complete";
  client_name: string;
  community: string;
  referral_owner_id: string | null;
  referral_owner_name: string | null;
};

type FollowUpCalendarRow = {
  work_item_id: string;
  referral_id: number | string;
  label: string;
  due_date: string;
  owner_id: string | null;
  owner_name: string | null;
  client_name: string;
  community: string;
  stage: Referral["stage"];
};

type UnscheduledCalendarRow = {
  referral_id: number | string;
  client_name: string;
  community: string;
  owner_id: string | null;
  owner_name: string | null;
  received_date: string;
  workflow_status: NonNullable<Referral["workflowStatus"]>;
  total_count: number | string;
};

export async function getAssessmentCalendar(
  user: PipelineUser,
  range: { from: string; to: string },
): Promise<PipelineCalendarResponse> {
  const data = getPipelineDatabaseReadiness().ready
    ? await getPostgresAssessmentCalendar(user, range)
    : await getLocalAssessmentCalendar(user, range);
  return {
    ...range,
    ...data,
    viewer: { id: user.id, name: user.name },
    generated_at: new Date().toISOString(),
  };
}

async function getPostgresAssessmentCalendar(
  user: PipelineUser,
  range: { from: string; to: string },
) {
  const sql = getPipelineSql();
  const restricted = isAssessorUser(user);
  const ownerAliases = normalizedOwnerAliases(user);
  const access = sql`
    (${restricted} = false or r.owner_id = ${user.id}
      or (r.owner_id is null and lower(trim(coalesce(r.owner_name, ''))) = any(${ownerAliases}::text[])))
  `;
  const [assessmentRows, followUpRows, unscheduledRows] = await Promise.all([
    sql<AssessmentCalendarRow[]>`
      select a.assessment_id, a.referral_id, a.scheduled_start_at,
        a.scheduled_duration_minutes, a.scheduled_method, a.scheduled_location,
        a.schedule_status, a.assessor_id, a.assessor_name, a.status, p.display_name as client_name,
        r.community::text as community, r.owner_id as referral_owner_id,
        r.owner_name as referral_owner_name
      from pipeline.assessments a
      join pipeline.referrals r on r.referral_id = a.referral_id
      join pipeline.people p on p.person_id = r.person_id
      where a.scheduled_start_at >= ${range.from}::date
        and a.scheduled_start_at < (${range.to}::date + interval '1 day')
        and a.schedule_status in ('scheduled', 'rescheduled', 'completed')
        and r.deleted_at is null and r.workspace_status = 'active' and ${access}
      order by a.scheduled_start_at, lower(p.display_name), a.assessment_id
    `,
    sql<FollowUpCalendarRow[]>`
      select w.work_item_id, w.referral_id, w.label, w.due_at::date::text as due_date,
        w.owner_id, w.owner_name, p.display_name as client_name,
        r.community::text as community, r.stage
      from pipeline.work_items w
      join pipeline.referrals r on r.referral_id = w.referral_id
      join pipeline.people p on p.person_id = r.person_id
      where w.due_at::date between ${range.from}::date and ${range.to}::date
        and w.gate in ('pre_assessment', 'admission_decision')
        and w.status not in ('reviewed', 'waived')
        and r.closed_at is null and r.deleted_at is null and r.workspace_status = 'active'
        and ${access}
      order by w.due_at, lower(p.display_name), w.work_item_id
    `,
    sql<UnscheduledCalendarRow[]>`
      select r.referral_id, p.display_name as client_name, r.community::text as community,
        r.owner_id, r.owner_name,
        coalesce(r.received_date, r.created_at::date)::text as received_date,
        r.workflow_status,
        count(*) over() as total_count
      from pipeline.referrals r
      join pipeline.people p on p.person_id = r.person_id
      where r.workspace_origin = 'pipeline' and r.workspace_status = 'active'
        and r.closed_at is null and r.deleted_at is null and ${access}
        and r.workflow_status in (
          'intake_unassigned',
          'intake_documents_needed',
          'profile_incomplete',
          'ready_to_schedule'
        )
        and not exists (
          select 1 from pipeline.assessments a
          where a.referral_id = r.referral_id
            and a.schedule_status in ('scheduled', 'rescheduled')
        )
      order by coalesce(r.received_date, r.created_at::date), lower(p.display_name), r.referral_id
      limit 20
    `,
  ]);

  const today = calendarToday();
  const assessmentEvents = assessmentRows.flatMap((row) => {
    const event = assessmentCalendarEvent({
      assessment_id: row.assessment_id,
      scheduled_start_at: toIso(row.scheduled_start_at),
      scheduled_duration_minutes: row.scheduled_duration_minutes === null ? null : Number(row.scheduled_duration_minutes),
      scheduled_method: row.scheduled_method as "in_person" | "phone" | "video" | "record_review" | null,
      scheduled_location: row.scheduled_location,
      schedule_status: row.schedule_status,
      assessor_id: row.assessor_id,
      assessor: row.assessor_name,
      status: row.status,
      referral_id: Number(row.referral_id),
    }, {
      id: Number(row.referral_id),
      name: row.client_name,
      community: row.community as Referral["community"],
      ownerId: row.referral_owner_id ?? undefined,
      owner: row.referral_owner_name ?? "Unassigned",
    }, today);
    return event ? [event] : [];
  });
  const followUpEvents: PipelineCalendarEvent[] = followUpRows.map((row) => ({
    id: `follow-up:${row.work_item_id}`,
    referralId: Number(row.referral_id),
    clientName: row.client_name,
    community: row.community,
    ownerId: row.owner_id ?? undefined,
    owner: row.owner_name?.trim() || "Unassigned",
    date: row.due_date,
    kind: "follow_up",
    status: row.due_date < today ? "overdue" : "due",
    title: row.label,
    detail: row.due_date < today ? "Assessment follow-up overdue" : "Assessment follow-up due",
  }));
  return {
    events: [...assessmentEvents, ...followUpEvents].sort(compareCalendarEvents),
    unscheduled: unscheduledRows.map((row): PipelineUnscheduledAssessment => ({
      referralId: Number(row.referral_id),
      clientName: row.client_name,
      community: row.community,
      ownerId: row.owner_id ?? undefined,
      owner: row.owner_name?.trim() || "Unassigned",
      receivedDate: row.received_date,
      workflowStatus: row.workflow_status,
    })),
    unscheduledTotal: Number(unscheduledRows[0]?.total_count ?? 0),
  };
}

async function getLocalAssessmentCalendar(
  user: PipelineUser,
  range: { from: string; to: string },
) {
  const referrals: Referral[] = [];
  let referralCursor: string | undefined;
  do {
    const page = await listReferrals(scopeReferralListOptions(user, {
      limit: 200,
      cursor: referralCursor,
      workspaceStatus: "active",
      includeTotal: false,
    }));
    referrals.push(...page.referrals);
    referralCursor = page.next_cursor;
  } while (referralCursor);

  const assessments = [];
  let assessmentCursor: string | undefined;
  do {
    const page = await listAssessments({ limit: 200, cursor: assessmentCursor });
    assessments.push(...page.assessments);
    assessmentCursor = page.next_cursor ?? undefined;
  } while (assessmentCursor);

  const referralById = new Map(referrals.map((referral) => [referral.id, referral]));
  const referralIdsWithScheduledAssessments = new Set(
    assessments
      .filter((assessment) => assessment.scheduled_start_at && ["scheduled", "rescheduled"].includes(assessment.schedule_status ?? "unscheduled"))
      .map((assessment) => assessment.referral_id),
  );
  const events = [
    ...assessments.flatMap((assessment) => {
      const referral = referralById.get(assessment.referral_id);
      if (!referral) return [];
      const event = assessmentCalendarEvent(assessment, referral);
      return event && event.date >= range.from && event.date <= range.to ? [event] : [];
    }),
    ...referrals.flatMap((referral) => assessmentFollowUpEvents(referral))
      .filter((event) => event.date >= range.from && event.date <= range.to),
  ].sort(compareCalendarEvents);
  const allUnscheduled = referrals.flatMap((referral) => {
    const item = assessmentPreparationItem(referral, referralIdsWithScheduledAssessments.has(referral.id));
    return item ? [item] : [];
  }).sort((left, right) => left.receivedDate.localeCompare(right.receivedDate) || left.clientName.localeCompare(right.clientName));
  return { events, unscheduled: allUnscheduled.slice(0, 20), unscheduledTotal: allUnscheduled.length };
}

function compareCalendarEvents(left: PipelineCalendarEvent, right: PipelineCalendarEvent) {
  return left.date.localeCompare(right.date)
    || (left.startsAt ?? "").localeCompare(right.startsAt ?? "")
    || left.kind.localeCompare(right.kind)
    || left.clientName.localeCompare(right.clientName)
    || left.id.localeCompare(right.id);
}

function toIso(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
