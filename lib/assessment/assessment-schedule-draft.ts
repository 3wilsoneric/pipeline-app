import type { PipelineAssessmentRecord, AssessmentScheduleMethod } from "./assessment-records";
import { isoToOperationalInput } from "@/components/pipeline/pipeline-calendar-model";

export type AssessmentScheduleDraft = {
  start: string;
  duration: string;
  method: AssessmentScheduleMethod;
  location: string;
  base: string;
};

// Compare appointment fields, not the assessment version: answering a question
// must not invalidate an unfinished appointment, but another booking must.
export function assessmentScheduleDraft(assessment: PipelineAssessmentRecord): AssessmentScheduleDraft {
  const method = String(assessment.scheduled_method) === "video" ? "zoom" : assessment.scheduled_method ?? "in_person";
  return {
    start: isoToOperationalInput(assessment.scheduled_start_at),
    duration: String(assessment.scheduled_duration_minutes ?? 60),
    method,
    location: assessment.scheduled_location ?? "",
    base: JSON.stringify([assessment.scheduled_start_at, assessment.scheduled_duration_minutes, assessment.scheduled_method, assessment.scheduled_location, assessment.schedule_status]),
  };
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum;
}

export function parseAssessmentScheduleDraft(value: unknown): AssessmentScheduleDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as AssessmentScheduleDraft;
  if (!boundedText(item.start, 32) || typeof item.duration !== "string" || !["30", "45", "60", "90", "120"].includes(item.duration)) return null;
  if (!["in_person", "phone", "zoom", "record_review"].includes(item.method)) return null;
  if (!boundedText(item.location, 500) || !boundedText(item.base, 1000)) return null;
  return { start: item.start, duration: item.duration, method: item.method, location: item.location, base: item.base };
}
