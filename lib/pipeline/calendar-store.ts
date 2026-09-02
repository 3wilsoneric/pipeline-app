import "server-only";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { listAssessments } from "@/lib/assessment/assessment-store";
import { getPipelineDatabaseReadiness, getPipelineSql } from "@/lib/database/pipeline-database";
import {
  assessmentCalendarEvent,
  assessmentPreparationItem,
  assessmentFollowUpEvents,
  calendarToday,
  consolidateCalendarFollowUps,
  referralAssignmentCalendarEvent,
} from "@/lib/pipeline/assessment-calendar";
import type {
  PipelineCalendarEvent,
  PipelineCalendarResponse,
  PipelineUnscheduledAssessment,
} from "@/lib/pipeline/calendar-types";
import { normalizeClientName } from "@/lib/pipeline/client-identity-presentation.mjs";
import { isAssessorUser, scopeReferralListOptions } from "@/lib/pipeline/referral-access";
import { normalizedOwnerAliases } from "@/lib/pipeline/referral-ownership";
import { listReferrals } from "@/lib/pipeline/referral-store";
import type { Referral } from "@/lib/pipeline/referral-types";

type AssessmentCalendarRow = {
  assessment_id: string;
  version: number | string;
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

type ReferralAssignmentCalendarRow = {
  referral_id: number | string;
  client_name: string;
  community: string;
  owner_id: string;
  owner_name: string | null;
  assigned_at: Date | string;
  assignment_version: number | string;
  created_at: Date | string;
  received_date: string | null;
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
  assessment_id: string | null;
  assessment_version: number | string | null;
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
    scope: isAssessorUser(user) ? "personal" : "team",
    timezone: "America/Los_Angeles",
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
  const [assignmentRows, assessmentRows, followUpRows, unscheduledRows] = await Promise.all([
    sql<ReferralAssignmentCalendarRow[]>`
      select r.referral_id, p.display_name as client_name, r.community::text as community,
        r.owner_id, r.owner_name, r.assigned_at, r.assignment_version, r.created_at,
        r.received_date::text as received_date
      from pipeline.referrals r
      join pipeline.people p on p.person_id = r.person_id
      where r.workspace_origin = 'pipeline' and r.workspace_status = 'active'
        and r.deleted_at is null and r.owner_id is not null and r.assigned_at is not null
        and r.assigned_at >= (${range.from}::date - interval '1 day')
        and r.assigned_at < (${range.to}::date + interval '2 days')
        and ${access}
      order by r.assigned_at, lower(p.display_name), r.referral_id
    `,
    sql<AssessmentCalendarRow[]>`
      select a.assessment_id, a.version, a.referral_id, a.scheduled_start_at,
        a.scheduled_duration_minutes, a.scheduled_method, a.scheduled_location,
        a.schedule_status, a.assessor_id, a.assessor_name, a.status, p.display_name as client_name,
        r.community::text as community, r.owner_id as referral_owner_id,
        r.owner_name as referral_owner_name
      from pipeline.assessments a
      join pipeline.referrals r on r.referral_id = a.referral_id
      join pipeline.people p on p.person_id = r.person_id
      where a.scheduled_start_at >= (${range.from}::date - interval '1 day')
        and a.scheduled_start_at < (${range.to}::date + interval '2 days')
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
      select r.referral_id, latest_assessment.assessment_id,
        latest_assessment.version as assessment_version,
        p.display_name as client_name, r.community::text as community,
        r.owner_id, r.owner_name,
        coalesce(r.received_date, r.created_at::date)::text as received_date,
        r.workflow_status,
        count(*) over() as total_count
      from pipeline.referrals r
      join pipeline.people p on p.person_id = r.person_id
      left join lateral (
        select a.assessment_id, a.version
        from pipeline.assessments a
        where a.referral_id = r.referral_id
        order by a.updated_at desc, a.assessment_id desc
        limit 1
      ) latest_assessment on true
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
  const assignmentEvents = assignmentRows.flatMap((row) => {
    const event = referralAssignmentCalendarEvent({
      id: Number(row.referral_id),
      name: calendarClientName(row.client_name, row.community),
      community: row.community as Referral["community"],
      ownerId: row.owner_id,
      owner: row.owner_name?.trim() || "Assigned assessor",
      assignedAt: toIso(row.assigned_at),
      assignmentVersion: Number(row.assignment_version),
      createdAt: toIso(row.created_at),
      date: row.received_date ?? "",
      workspaceOrigin: "pipeline",
      workspaceStatus: "active",
    });
    return event && event.date >= range.from && event.date <= range.to ? [event] : [];
  });
  const assessmentEvents = assessmentRows.flatMap((row) => {
    const clientName = calendarClientName(row.client_name, row.community);
    const event = assessmentCalendarEvent({
      assessment_id: row.assessment_id,
      version: Number(row.version),
      scheduled_start_at: toIso(row.scheduled_start_at),
      scheduled_duration_minutes: row.scheduled_duration_minutes === null ? null : Number(row.scheduled_duration_minutes),
      scheduled_method: normalizeScheduleMethod(row.scheduled_method),
      scheduled_location: row.scheduled_location,
      schedule_status: row.schedule_status,
      assessor_id: row.assessor_id,
      assessor: row.assessor_name,
      status: row.status,
      referral_id: Number(row.referral_id),
    }, {
      id: Number(row.referral_id),
      name: clientName,
      community: row.community as Referral["community"],
      ownerId: row.referral_owner_id ?? undefined,
      owner: row.referral_owner_name ?? "Unassigned",
    }, today);
    return event && event.date >= range.from && event.date <= range.to ? [event] : [];
  });
  const followUpEvents = consolidateCalendarFollowUps(followUpRows.map((row): PipelineCalendarEvent => ({
    id: `follow-up:${row.work_item_id}`,
    referralId: Number(row.referral_id),
    clientName: calendarClientName(row.client_name, row.community),
    community: row.community,
    ownerId: row.owner_id ?? undefined,
    owner: row.owner_name?.trim() || "Unassigned",
    date: row.due_date,
    kind: "follow_up",
    status: row.due_date < today ? "overdue" : "due",
    title: row.label,
    detail: row.due_date < today ? "Assessment follow-up overdue" : "Assessment follow-up due",
  })));
  return {
    events: [...assignmentEvents, ...assessmentEvents, ...followUpEvents].sort(compareCalendarEvents),
    unscheduled: unscheduledRows.map((row): PipelineUnscheduledAssessment => ({
      referralId: Number(row.referral_id),
      assessmentId: row.assessment_id ?? undefined,
      assessmentVersion: row.assessment_version === null ? undefined : Number(row.assessment_version),
      clientName: calendarClientName(row.client_name, row.community),
      community: row.community,
      ownerId: row.owner_id ?? undefined,
      owner: row.owner_name?.trim() || "Unassigned",
      receivedDate: row.received_date,
      workflowStatus: row.workflow_status,
      nextAction: row.workflow_status === "intake_unassigned"
        ? "assign"
        : row.workflow_status === "ready_to_schedule"
          ? "schedule"
          : "complete_intake",
    })),
    unscheduledTotal: Number(unscheduledRows[0]?.total_count ?? 0),
  };
}

function calendarClientName(name: string, community: string) {
  return normalizeClientName(name, { community }) || "Name not recorded";
}

function normalizeScheduleMethod(method: string | null) {
  if (method === "video") return "zoom";
  if (method === "in_person" || method === "phone" || method === "zoom" || method === "record_review") return method;
  return null;
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
  const latestAssessmentByReferral = new Map<number, typeof assessments[number]>();
  for (const assessment of assessments) {
    if (!latestAssessmentByReferral.has(assessment.referral_id)) {
      latestAssessmentByReferral.set(assessment.referral_id, assessment);
    }
  }
  const events = consolidateCalendarFollowUps([
    ...referrals.flatMap((referral) => {
      const event = referralAssignmentCalendarEvent(referral);
      return event && event.date >= range.from && event.date <= range.to ? [event] : [];
    }),
    ...assessments.flatMap((assessment) => {
      const referral = referralById.get(assessment.referral_id);
      if (!referral) return [];
      const event = assessmentCalendarEvent(assessment, referral);
      return event && event.date >= range.from && event.date <= range.to ? [event] : [];
    }),
    ...referrals.flatMap((referral) => assessmentFollowUpEvents(referral))
      .filter((event) => event.date >= range.from && event.date <= range.to),
  ]).sort(compareCalendarEvents);
  const allUnscheduled = referrals.flatMap((referral) => {
    const item = assessmentPreparationItem(referral, latestAssessmentByReferral.get(referral.id) ?? null);
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
