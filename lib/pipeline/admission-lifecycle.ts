import { calendarToday, normalizeCalendarDate } from "./calendar-date";
import type { Referral } from "./referral-types";

/** Normal reopening follows completed work; explicit chart/assessment links remain available. */
export function handoffWorkspaceView(
  referral: Pick<Referral, "workspaceStatus" | "stage" | "admissionDecision" | "plannedAdmissionDate" | "admissionDate">,
  assessment: { signedAt?: string | null; packetSentAt?: string | null },
): "workflow" | "email" | null {
  if (referral.workspaceStatus === "historical" || referral.stage === "Accepted / Admitted" || !assessment.signedAt) return null;
  if (referral.admissionDecision?.outcome === "accepted" && getPlannedAdmissionDate(referral) && !assessment.packetSentAt) return "email";
  return "workflow";
}

export function getPlannedAdmissionDate(referral: { plannedAdmissionDate?: string; admissionDate?: string }): string {
  return referral.plannedAdmissionDate ?? referral.admissionDate ?? "";
}

export function plannedAdmissionDateError(value: unknown): string | null {
  return typeof value === "string" && normalizeCalendarDate(value)
    ? null : "Add a planned admit date before sending Meet the Client. It will populate the email automatically.";
}

export function actualAdmissionDateError(value: unknown): string | null {
  const date = typeof value === "string" ? normalizeCalendarDate(value) : null;
  if (!date) return "Record the actual admission date to confirm the client arrived.";
  if (date > calendarToday()) return "The actual admission date cannot be in the future. Keep future arrivals as planned admissions.";
  return null;
}

export function isAwaitingAdmission(stage: string, outcome: string, packetSentAt?: string | null) {
  return outcome === "accepted" && Boolean(packetSentAt) && stage !== "Accepted / Admitted";
}
