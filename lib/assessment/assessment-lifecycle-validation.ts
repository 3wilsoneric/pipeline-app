import type { AssessmentScheduleUpdate } from "./assessment-records";

type Failure = { ok: false; message: string; status?: number };
type Success<T> = { ok: true; value: T };
type Result<T> = Failure | Success<T>;

export type AssessmentLifecycleCommand = {
  if_match: number;
  client_mutation_id?: string;
};

export type AssessmentScheduleCommand = AssessmentLifecycleCommand & {
  schedule: AssessmentScheduleUpdate;
};

export type AssessmentAddendumCommand = AssessmentLifecycleCommand & {
  note: string;
  reason_code: string;
};

const scheduleStatuses = ["unscheduled", "scheduled", "rescheduled", "cancelled", "no_show"] as const;
const scheduleMethods = ["in_person", "phone", "video", "record_review"] as const;

export function validateAssessmentLifecycleCommand(value: unknown): Result<AssessmentLifecycleCommand> {
  if (!isRecord(value)) return failure("The request body must be an object.");
  const common = validateCommon(value);
  if (!common.ok) return common;
  return { ok: true, value: common.value };
}

export function validateAssessmentScheduleCommand(value: unknown): Result<AssessmentScheduleCommand> {
  if (!isRecord(value) || !isRecord(value.schedule)) return failure("schedule must be an object.");
  const common = validateCommon(value);
  if (!common.ok) return common;
  const schedule = value.schedule;
  if (!scheduleStatuses.includes(schedule.status as typeof scheduleStatuses[number])) {
    return failure("schedule.status is invalid.");
  }
  const status = schedule.status as AssessmentScheduleUpdate["status"];
  const startAt = nullableString(schedule.start_at, 64);
  if (!startAt.ok) return failure("schedule.start_at is invalid.");
  if (startAt.value && !isTimestampWithTimezone(startAt.value)) {
    return failure("schedule.start_at must be an ISO timestamp with a timezone.");
  }
  const duration = schedule.duration_minutes;
  if (duration !== null && (!Number.isInteger(duration) || Number(duration) < 15 || Number(duration) > 480)) {
    return failure("schedule.duration_minutes must be between 15 and 480.");
  }
  const method = schedule.method;
  if (method !== null && !scheduleMethods.includes(method as typeof scheduleMethods[number])) {
    return failure("schedule.method is invalid.");
  }
  const location = nullableString(schedule.location, 500);
  if (!location.ok) return failure("schedule.location is invalid.");
  if (["scheduled", "rescheduled"].includes(status) && (!startAt.value || duration === null || method === null)) {
    return failure("Scheduled assessments require a start time, duration, and method.");
  }
  return {
    ok: true,
    value: {
      ...common.value,
      schedule: {
        status,
        start_at: startAt.value,
        duration_minutes: duration === null ? null : Number(duration),
        method: method as AssessmentScheduleUpdate["method"],
        location: location.value,
      },
    },
  };
}

export function validateAssessmentAddendumCommand(value: unknown): Result<AssessmentAddendumCommand> {
  if (!isRecord(value)) return failure("The request body must be an object.");
  const common = validateCommon(value);
  if (!common.ok) return common;
  const note = typeof value.note === "string" ? value.note.trim() : "";
  const reasonCode = typeof value.reason_code === "string" ? value.reason_code.trim() : "";
  if (!note || note.length > 20_000) return failure("note must contain 1 to 20,000 characters.");
  if (!reasonCode || reasonCode.length > 128) return failure("reason_code must contain 1 to 128 characters.");
  return { ok: true, value: { ...common.value, note, reason_code: reasonCode } };
}

function validateCommon(value: Record<string, unknown>): Result<AssessmentLifecycleCommand> {
  if (!Number.isInteger(value.if_match) || Number(value.if_match) < 1) {
    return failure("if_match must be a positive version number.");
  }
  const mutationId = value.client_mutation_id;
  if (mutationId !== undefined && (
    typeof mutationId !== "string"
    || mutationId.length < 1
    || mutationId.length > 128
    || !/^[a-zA-Z0-9_.:-]+$/.test(mutationId)
  )) return failure("client_mutation_id is invalid.");
  return {
    ok: true,
    value: {
      if_match: Number(value.if_match),
      ...(typeof mutationId === "string" ? { client_mutation_id: mutationId } : {}),
    },
  };
}

function nullableString(value: unknown, maximum: number): Result<string | null> {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || value.length > maximum) return failure("Invalid text value.");
  return { ok: true, value: value.trim() || null };
}

function isTimestampWithTimezone(value: string) {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function failure(message: string, status = 400): Failure {
  return { ok: false, message, status };
}
