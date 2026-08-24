import type { PipelineAssessmentRecord } from "@/lib/assessment/assessment-records";
import type {
  PipelineCalendarEvent,
  PipelineUnscheduledAssessment,
} from "@/lib/pipeline/calendar-types";
import type { Referral } from "@/lib/pipeline/referral-types";

const closedStages = new Set(["Accepted / Admitted", "Declined"]);
const assessmentPreparationStatuses = new Set([
  "intake_unassigned",
  "intake_documents_needed",
  "profile_incomplete",
  "ready_to_schedule",
]);

export function assessmentCalendarEvent(
  assessment: Pick<PipelineAssessmentRecord, "assessment_id" | "assessor_id" | "assessor" | "status" | "referral_id" | "scheduled_start_at" | "scheduled_duration_minutes" | "scheduled_method" | "scheduled_location" | "schedule_status">,
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
    clientName: referral.name,
    community: referral.community,
    ownerId: referral.ownerId ?? assessment.assessor_id ?? undefined,
    owner: referral.owner?.trim() || assessment.assessor?.trim() || "Unassigned",
    date,
    startsAt: assessment.scheduled_start_at,
    durationMinutes: assessment.scheduled_duration_minutes ?? undefined,
    method: assessment.scheduled_method ?? undefined,
    location: assessment.scheduled_location?.trim() || undefined,
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
  referral: Pick<Referral, "id" | "name" | "community" | "owner" | "ownerId" | "stage" | "requirements">,
  today = calendarToday(),
): PipelineCalendarEvent[] {
  if (closedStages.has(referral.stage)) return [];
  return (referral.requirements ?? []).flatMap((requirement) => {
    if (!["pre_assessment", "admission_decision"].includes(requirement.requiredFor)) return [];
    if (["reviewed", "waived"].includes(requirement.status)) return [];
    const date = calendarDate(requirement.dueAt);
    if (!date) return [];
    const overdue = date < today;
    return [{
      id: `follow-up:${requirement.id}`,
      referralId: referral.id,
      clientName: referral.name,
      community: referral.community,
      ownerId: requirement.ownerId,
      owner: requirement.owner?.trim() || "Unassigned",
      date,
      kind: "follow_up" as const,
      status: overdue ? "overdue" as const : "due" as const,
      title: requirement.label,
      detail: overdue ? "Assessment follow-up overdue" : "Assessment follow-up due",
    }];
  });
}

export function assessmentPreparationItem(
  referral: Pick<Referral, "id" | "name" | "community" | "owner" | "ownerId" | "date" | "createdAt" | "stage" | "workspaceOrigin" | "workflowStatus">,
  hasScheduledAssessment: boolean,
): PipelineUnscheduledAssessment | null {
  if (referral.workspaceOrigin !== "pipeline" || closedStages.has(referral.stage) || hasScheduledAssessment) return null;
  const workflowStatus = referral.workflowStatus ?? "intake_unassigned";
  if (!assessmentPreparationStatuses.has(workflowStatus)) return null;
  const receivedDate = calendarDate(referral.date) ?? calendarDate(referral.createdAt);
  if (!receivedDate) return null;
  return {
    referralId: referral.id,
    clientName: referral.name,
    community: referral.community,
    ownerId: referral.ownerId,
    owner: referral.owner?.trim() || "Unassigned",
    receivedDate,
    workflowStatus,
  };
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
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
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
