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
import type { Referral, RequirementGate, RequirementStatus } from "@/lib/pipeline/referral-types";
import {
  isRequirementGateActive,
  type WorkspaceOutcomeState,
} from "@/lib/pipeline/workspace-state";

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
  decision_outcome: "accepted" | "declined" | null;
  gate: RequirementGate;
  requirement_status: RequirementStatus;
  assessment_status: "draft" | "needs_review" | "complete" | null;
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
  is_reassessment: boolean;
  total_count: number | string;
};

type AssessmentCalendarOptions = {
  queueLimit?: number;
  queueSearch?: string;
  queueCommunity?: string;
  queueOwner?: string;
  queueMine?: boolean;
  includeAssignments?: boolean;
};

type CalendarAssessorRow = {
  owner_id: string | null;
  owner_name: string | null;
};

export async function getAssessmentCalendar(
  user: PipelineUser,
  range: { from: string; to: string },
  options: AssessmentCalendarOptions = {},
): Promise<PipelineCalendarResponse> {
  const data = getPipelineDatabaseReadiness().ready
    ? await getPostgresAssessmentCalendar(user, range, options)
    : await getLocalAssessmentCalendar(user, range, options);
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
  options: AssessmentCalendarOptions,
) {
  const sql = getPipelineSql();
  const restricted = isAssessorUser(user);
  const ownerAliases = normalizedOwnerAliases(user);
  const queueLimit = Math.min(200, Math.max(1, options.queueLimit ?? 24));
  const queueSearch = options.queueSearch?.trim().toLowerCase() ?? "";
  const queueSearchPattern = `%${queueSearch}%`;
  const queueCommunity = options.queueCommunity?.trim() ?? "";
  const queueOwnerId = options.queueOwner?.startsWith("id:") ? options.queueOwner.slice(3) : "";
  const queueOwnerName = options.queueOwner?.startsWith("name:") ? options.queueOwner.slice(5).trim().toLowerCase() : "";
  const access = sql`
    (${restricted} = false or r.owner_id = ${user.id}
      or (r.owner_id is null and lower(trim(coalesce(r.owner_name, ''))) = any(${ownerAliases}::text[])))
  `;
  const [assignmentRows, assessmentRows, followUpRows, unscheduledRows, assessorRows] = await Promise.all([
    sql<ReferralAssignmentCalendarRow[]>`
      select r.referral_id, p.display_name as client_name, r.community::text as community,
        r.owner_id, r.owner_name, r.assigned_at, r.assignment_version, r.created_at,
        r.received_date::text as received_date
      from pipeline.referrals r
      join pipeline.people p on p.person_id = r.person_id
      where r.workspace_status = 'active'
        and ${options.includeAssignments !== false}
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
        r.community::text as community, r.stage, latest_decision.outcome as decision_outcome, w.gate,
        w.status as requirement_status, latest_assessment.status as assessment_status
      from pipeline.work_items w
      join pipeline.referrals r on r.referral_id = w.referral_id
      join pipeline.people p on p.person_id = r.person_id
      left join lateral (
        select a.status
        from pipeline.assessments a
        where a.referral_id = r.referral_id
        order by a.updated_at desc, a.assessment_id desc
        limit 1
      ) latest_assessment on true
      left join lateral (
        select d.outcome
        from pipeline.admission_decisions d
        where d.referral_id = r.referral_id
        order by d.decided_at desc, d.decision_id desc
        limit 1
      ) latest_decision on true
      where w.due_at::date between ${range.from}::date and ${range.to}::date
        and w.status not in ('received', 'reviewed', 'waived', 'not_applicable')
        and r.deleted_at is null and r.workspace_status = 'active'
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
        (r.closed_at is not null
          and latest_assessment.created_at > coalesce(latest_decision.decided_at, r.closed_at)) as is_reassessment,
        count(*) over() as total_count
      from pipeline.referrals r
      join pipeline.people p on p.person_id = r.person_id
      left join lateral (
        select a.assessment_id, a.version, a.created_at, a.status, a.schedule_status
        from pipeline.assessments a
        where a.referral_id = r.referral_id
        order by a.updated_at desc, a.assessment_id desc
        limit 1
      ) latest_assessment on true
      left join lateral (
        select d.decided_at
        from pipeline.admission_decisions d
        where d.referral_id = r.referral_id
        order by d.decided_at desc, d.decision_id desc
        limit 1
      ) latest_decision on true
      where r.workspace_status = 'active'
        and r.deleted_at is null and ${access}
        and (
          (r.closed_at is null and r.workflow_status = 'ready_to_schedule')
          or (
            r.closed_at is not null
            and latest_assessment.created_at > coalesce(latest_decision.decided_at, r.closed_at)
            and latest_assessment.status <> 'complete'
            and coalesce(latest_assessment.schedule_status, 'unscheduled') not in ('scheduled', 'rescheduled', 'completed')
          )
        )
        and not exists (
          select 1 from pipeline.assessments a
          where a.referral_id = r.referral_id
            and a.schedule_status in ('scheduled', 'rescheduled')
        )
        and (${queueSearch} = '' or lower(p.display_name) like ${queueSearchPattern}
          or lower(r.community::text) like ${queueSearchPattern}
          or lower(coalesce(r.owner_name, '')) like ${queueSearchPattern})
        and (${queueCommunity} = '' or r.community::text = ${queueCommunity})
        and (${queueOwnerId} = '' or r.owner_id = ${queueOwnerId})
        and (${queueOwnerName} = '' or lower(trim(coalesce(r.owner_name, ''))) = ${queueOwnerName})
        and (${options.queueMine === true} = false or r.owner_id = ${user.id}
          or (r.owner_id is null and lower(trim(coalesce(r.owner_name, ''))) = any(${ownerAliases}::text[])))
      order by coalesce(r.received_date, r.created_at::date), lower(p.display_name), r.referral_id
      limit ${queueLimit + 1}
    `,
    sql<CalendarAssessorRow[]>`
      select distinct r.owner_id, r.owner_name
      from pipeline.referrals r
      where r.workspace_status = 'active'
        and r.closed_at is null
        and r.deleted_at is null
        and btrim(coalesce(r.owner_name, '')) <> ''
        and lower(btrim(r.owner_name)) <> 'unassigned'
        and ${access}
      order by r.owner_name, r.owner_id
      limit 100
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
  const followUpEvents = consolidateCalendarFollowUps(followUpRows.flatMap((row): PipelineCalendarEvent[] => {
    const outcome: WorkspaceOutcomeState = row.decision_outcome
      ?? (row.stage === "Accepted / Admitted"
        ? "accepted"
        : row.stage === "Declined"
          ? "declined"
          : "pending");
    if (!isRequirementGateActive(
      { requiredFor: row.gate },
      { assessmentComplete: row.assessment_status === "complete", outcome },
    )) return [];
    return [{
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
    }];
  }));
  const queueRows = unscheduledRows.slice(0, queueLimit);
  return {
    events: [...assignmentEvents, ...assessmentEvents, ...followUpEvents].sort(compareCalendarEvents),
    unscheduled: queueRows.map((row): PipelineUnscheduledAssessment => ({
      referralId: Number(row.referral_id),
      assessmentId: row.assessment_id ?? undefined,
      assessmentVersion: row.assessment_version === null ? undefined : Number(row.assessment_version),
      clientName: calendarClientName(row.client_name, row.community),
      community: row.community,
      ownerId: row.owner_id ?? undefined,
      owner: row.owner_name?.trim() || "Unassigned",
      receivedDate: row.received_date,
      workflowStatus: row.workflow_status,
      nextAction: row.is_reassessment
        ? "schedule"
        : row.workflow_status === "intake_unassigned"
        ? "assign"
        : row.workflow_status === "ready_to_schedule"
          ? "schedule"
          : "complete_intake",
    })),
    unscheduledTotal: Number(unscheduledRows[0]?.total_count ?? 0),
    unscheduledHasMore: unscheduledRows.length > queueLimit,
    assessors: assessorRows.map((row) => ({
      id: row.owner_id ?? undefined,
      name: row.owner_name?.trim() || "Unassigned",
    })),
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
  options: AssessmentCalendarOptions,
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
    ...(options.includeAssignments === false ? [] : referrals.flatMap((referral) => {
      const event = referralAssignmentCalendarEvent(referral);
      return event && event.date >= range.from && event.date <= range.to ? [event] : [];
    })),
    ...assessments.flatMap((assessment) => {
      const referral = referralById.get(assessment.referral_id);
      if (!referral) return [];
      const event = assessmentCalendarEvent(assessment, referral);
      return event && event.date >= range.from && event.date <= range.to ? [event] : [];
    }),
    ...referrals.flatMap((referral) => {
      const assessment = latestAssessmentByReferral.get(referral.id);
      return assessmentFollowUpEvents(referral, calendarToday(), assessment ? {
        assessmentExists: true,
        assessmentCreatedAt: assessment.created_at,
        assessmentComplete: assessment.status === "complete",
        assessmentSigned: Boolean(assessment.signed_at),
        assessmentStarted: Boolean(assessment.started_at),
        assessmentScheduleStatus: assessment.schedule_status,
        assessmentStatus: assessment.status,
      } : {});
    })
      .filter((event) => event.date >= range.from && event.date <= range.to),
  ]).sort(compareCalendarEvents);
  const queueLimit = Math.min(200, Math.max(1, options.queueLimit ?? 24));
  const allUnscheduled = referrals.flatMap((referral) => {
    const item = assessmentPreparationItem(referral, latestAssessmentByReferral.get(referral.id) ?? null);
    return item?.nextAction === "schedule" ? [item] : [];
  })
    .filter((item) => matchesQueueOptions(item, user, options))
    .sort((left, right) => left.receivedDate.localeCompare(right.receivedDate) || left.clientName.localeCompare(right.clientName));
  return {
    events,
    unscheduled: allUnscheduled.slice(0, queueLimit),
    unscheduledTotal: allUnscheduled.length,
    unscheduledHasMore: allUnscheduled.length > queueLimit,
    assessors: uniqueLocalAssessors(referrals),
  };
}

function uniqueLocalAssessors(referrals: Referral[]) {
  const assessors = new Map<string, { id?: string; name: string }>();
  for (const referral of referrals) {
    const name = referral.owner?.trim();
    if (!name || name.toLowerCase() === "unassigned") continue;
    assessors.set(ownerFilterKey(referral.ownerId, name), { id: referral.ownerId, name });
  }
  return [...assessors.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function matchesQueueOptions(item: PipelineUnscheduledAssessment, user: PipelineUser, options: AssessmentCalendarOptions) {
  const search = options.queueSearch?.trim().toLowerCase() ?? "";
  if (search && ![item.clientName, item.community, item.owner].some((value) => value.toLowerCase().includes(search))) return false;
  if (options.queueCommunity && item.community !== options.queueCommunity) return false;
  if (options.queueOwner && ownerFilterKey(item.ownerId, item.owner) !== options.queueOwner) return false;
  if (options.queueMine) {
    const aliases = new Set(normalizedOwnerAliases(user));
    if (item.ownerId !== user.id && !aliases.has(item.owner.trim().toLowerCase())) return false;
  }
  return true;
}

function ownerFilterKey(id: string | undefined, name: string) {
  return id ? `id:${id}` : `name:${name.trim().toLowerCase() || "unassigned"}`;
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
