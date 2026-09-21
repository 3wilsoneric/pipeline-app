import { calendarToday, normalizeCalendarDate } from "./calendar-date";

export function getPlannedAdmissionDate(referral: { plannedAdmissionDate?: string; admissionDate?: string }): string {
  return referral.plannedAdmissionDate ?? referral.admissionDate ?? "";
}

export function plannedAdmissionDateError(value: unknown): string | null {
  return typeof value === "string" && normalizeCalendarDate(value)
    ? null : "Set a planned admission date in Decision before sending Meet the Client. You can still preview the packet.";
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
