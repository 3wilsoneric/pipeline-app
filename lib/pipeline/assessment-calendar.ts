import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import type {
  PipelineCalendarEvent,
  PipelineUnscheduledAssessment,
} from "@/lib/pipeline/calendar-types";
import type { Referral, ReferralWorkflowStatus } from "@/lib/pipeline/referral-types";
import type { WorkflowContext } from "@/lib/pipeline/workflow-records";
import { getWorkspaceState } from "@/lib/pipeline/workspace-state";

const assessmentPreparationStatuses = new Set([
  "intake_unassigned",
  "intake_documents_needed",
  "profile_incomplete",
  "ready_to_schedule",
]);

export function referralAssignmentCalendarEvent(
  referral: Pick<Referral, "id" | "name" | "community" | "owner" | "ownerId" | "assignedAt" | "assignmentVersion" | "createdAt" | "date" | "workspaceOrigin" | "workspaceStatus" | "deletedAt">,
): PipelineCalendarEvent | null {
  if (
    (referral.workspaceStatus ?? "active") !== "active"
    || referral.deletedAt
    || !referral.assignedAt
    || !referral.ownerId
  ) return null;

  const date = calendarDate(referral.assignedAt);
  const createdDate = calendarDate(referral.createdAt);
  const receivedDate = calendarDate(referral.date);
  if (!date || !createdDate) return null;

  return {
    id: `referral-assigned:${referral.id}:${referral.assignmentVersion ?? 1}`,
    referralId: referral.id,
    clientName: referral.name,
    community: referral.community,
    ownerId: referral.ownerId,
    owner: referral.owner.trim() || "Unassigned",
    date,
    createdDate,
    receivedDate: receivedDate ?? undefined,
    assignedAt: referral.assignedAt,
    kind: "referral_assigned",
    status: "assigned",
    title: "Referral assigned",
    detail: "Assigned referral",
  };
}

export function assessmentCalendarEvent(
  assessment: Pick<PipelineAssessmentRecord, "assessment_id" | "assessor_id" | "assessor" | "status" | "version" | "referral_id" | "scheduled_start_at" | "scheduled_duration_minutes" | "scheduled_method" | "scheduled_location" | "schedule_status">,
  referral: Pick<Referral, "id" | "name" | "community" | "owner" | "ownerId">,
  today = calendarToday(),
): PipelineCalendarEvent | null {
  if (!assessment.scheduled_start_at || !["scheduled", "rescheduled", "completed"].includes(assessment.schedule_status ?? "unscheduled")) return null;
  const date = calendarDate(assessment.scheduled_start_at);
  if (!date) return null;
  const overdue = assessment.status !== "complete" && date < today;
  const title = assessment.status === "complete"
    ? "Assessment completed"
    : assessment.status === "needs_review"
      ? "Assessment ready for review"
      : overdue
        ? "Assessment overdue"
        : "Assessment scheduled";
  return {
    id: `assessment:${assessment.assessment_id}`,
    referralId: referral.id,
    assessmentId: assessment.assessment_id,
    assessmentVersion: assessment.version,
    clientName: referral.name,
    community: referral.community,
    ownerId: referral.ownerId ?? assessment.assessor_id ?? undefined,
    owner: referral.owner?.trim() || assessment.assessor?.trim() || "Unassigned",
    date,
    startsAt: assessment.scheduled_start_at,
    durationMinutes: assessment.scheduled_duration_minutes ?? undefined,
    method: assessment.scheduled_method ?? undefined,
    location: assessment.scheduled_location?.trim() || undefined,
    scheduleStatus: calendarScheduleStatus(assessment.schedule_status),
    kind: "assessment",
    status: overdue ? "overdue" : assessment.status,
    title,
    detail: assessment.status === "complete"
      ? "Completed"
      : assessment.status === "needs_review"
        ? "Review extracted and entered data"
        : overdue
          ? "Open the workspace and update the schedule"
          : "Scheduled assessment",
  };
}

export function assessmentFollowUpEvents(
  referral: Referral,
  today = calendarToday(),
  context: WorkflowContext = {},
): PipelineCalendarEvent[] {
  const state = getWorkspaceState(referral, context);
  const activeRequirementIds = new Set(state.active_requirement_ids);
  return (context.requirements ?? referral.requirements ?? []).flatMap((requirement) => {
    if (!activeRequirementIds.has(requirement.id)) return [];
    if (["received", "reviewed", "waived", "not_applicable"].includes(requirement.status)) return [];
    const date = calendarDate(requirement.dueAt);
    if (!date) return [];
    const overdue = date < today;
    return [{
      id: `follow-up:${requirement.id}`,
      referralId: referral.id,
      clientName: referral.name,
      community: referral.community,
      ownerId: requirement.ownerId,
      owner: requirement.owner?.trim() || referral.owner?.trim() || "Unassigned",
      date,
      kind: "follow_up" as const,
      status: overdue ? "overdue" as const : "due" as const,
      title: requirement.label,
      detail: overdue ? "Assessment follow-up overdue" : "Assessment follow-up due",
    }];
  });
}

export function assessmentPreparationItem(
  referral: Pick<Referral, "id" | "name" | "community" | "owner" | "ownerId" | "date" | "createdAt" | "stage" | "workspaceOrigin" | "workspaceStatus" | "workflowStatus" | "admissionDecision">,
  assessment: Pick<PipelineAssessmentRecord, "assessment_id" | "version" | "schedule_status" | "status" | "created_at"> | null,
): PipelineUnscheduledAssessment | null {
  const hasScheduledAssessment = isScheduledAssessment(assessment);
  const reassessment = isPostOutcomeAssessment(referral, assessment);
  if (
    (referral.workspaceStatus ?? "active") !== "active"
    || hasScheduledAssessment
    || assessment?.status === "complete"
    || (isClosedOutcome(referral) && !reassessment)
  ) return null;
  const workflowStatus = referral.workflowStatus ?? "intake_unassigned";
  if (!reassessment && !assessmentPreparationStatuses.has(workflowStatus)) return null;
  const receivedDate = calendarDate(referral.date) ?? calendarDate(referral.createdAt);
  if (!receivedDate) return null;
  return {
    referralId: referral.id,
    assessmentId: assessment?.assessment_id,
    assessmentVersion: assessment?.version,
    clientName: referral.name,
    community: referral.community,
    ownerId: referral.ownerId,
    owner: referral.owner?.trim() || "Unassigned",
    receivedDate,
    workflowStatus,
    nextAction: reassessment ? "schedule" : preparationNextAction(workflowStatus),
  };
}

function calendarScheduleStatus(status: PipelineAssessmentRecord["schedule_status"]) {
  return status ?? "unscheduled";
}

function isScheduledAssessment(
  assessment: Pick<PipelineAssessmentRecord, "schedule_status"> | null,
) {
  if (!assessment) return false;
  return ["scheduled", "rescheduled"].includes(calendarScheduleStatus(assessment.schedule_status));
}

function isClosedOutcome(referral: Pick<Referral, "stage" | "admissionDecision">) {
  return referral.stage === "Accepted / Admitted"
    || referral.stage === "Declined"
    || Boolean(referral.admissionDecision);
}

function isPostOutcomeAssessment(
  referral: Pick<Referral, "admissionDecision">,
  assessment: Pick<PipelineAssessmentRecord, "created_at"> | null,
) {
  if (!assessment?.created_at || !referral.admissionDecision?.decidedAt) return false;
  const assessmentCreatedAt = Date.parse(assessment.created_at);
  const decisionAt = Date.parse(referral.admissionDecision.decidedAt);
  return Number.isFinite(assessmentCreatedAt)
    && Number.isFinite(decisionAt)
    && assessmentCreatedAt > decisionAt;
}

function preparationNextAction(workflowStatus: ReferralWorkflowStatus): PipelineUnscheduledAssessment["nextAction"] {
  if (workflowStatus === "intake_unassigned") return "assign";
  if (workflowStatus === "ready_to_schedule") return "schedule";
  return "complete_intake";
}

export function consolidateCalendarFollowUps(events: PipelineCalendarEvent[]) {
  const passthrough = events.filter((event) => event.kind !== "follow_up");
  const groups = new Map<string, PipelineCalendarEvent[]>();
  for (const event of events) {
    if (event.kind !== "follow_up") continue;
    const key = [event.referralId, event.date, event.ownerId ?? event.owner].join(":");
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  const consolidated = [...groups.values()].map((items) => {
    const first = items[0];
    const labels = items.map((item) => item.title).sort((left, right) => left.localeCompare(right));
    return {
      ...first,
      id: `follow-ups:${items.map((item) => item.id).sort().join("+")}`,
      followUpCount: items.length,
      followUpLabels: labels,
      title: items.length === 1 ? labels[0] : `${items.length} follow-ups due`,
      detail: labels.join(", "),
      status: items.some((item) => item.status === "overdue") ? "overdue" as const : "due" as const,
    };
  });
  return [...passthrough, ...consolidated];
}

export function calendarDate(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return isValidDateKey(trimmed) ? trimmed : null;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (us) {
    const result = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
    return isValidDateKey(result) ? result : null;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : operationalDateKey(parsed);
}

export function addCalendarDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateKey(date);
}

export function calendarToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function isValidDateKey(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && dateKey(parsed) === value;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function operationalDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
