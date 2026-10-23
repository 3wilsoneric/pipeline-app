import { calendarToday, normalizeCalendarDate } from "./calendar-date";
import type { Referral } from "./referral-types";

/** Normal reopening follows completed work; explicit chart/assessment links remain available. */
export function handoffWorkspaceView(
  referral: Pick<Referral, "workspaceStatus" | "stage" | "admissionDecision" | "plannedAdmissionDate" | "admissionDate" | "placementCancellation">,
  assessment: { signedAt?: string | null; packetSentAt?: string | null },
): "workflow" | "email" | null {
  if (referral.workspaceStatus === "historical" || referral.stage === "Accepted / Admitted" || referral.placementCancellation || !assessment.signedAt) return null;
  if (referral.admissionDecision?.outcome === "accepted") return "email";
  return "workflow";
}

export function getPlannedAdmissionDate(referral: { plannedAdmissionDate?: string; admissionDate?: string }): string {
  return referral.plannedAdmissionDate ?? referral.admissionDate ?? "";
}

/** A due admit plan is an operational assumption, never an actual/census admission.
 * Only canonical saved ISO dates participate; normalize older free-form dates before extending this rule.
 */
export function assumedAdmissionDate(
  referral: Pick<Referral, "workspaceOrigin" | "workspaceStatus" | "stage" | "admissionDecision" | "plannedAdmissionDate" | "admissionDate" | "actualAdmissionDate" | "placementCancellation">,
  now = new Date(),
): string | null {
  if (referral.workspaceOrigin !== "pipeline" || (referral.workspaceStatus && referral.workspaceStatus !== "active")
    || referral.placementCancellation || referral.actualAdmissionDate || referral.stage === "Accepted / Admitted"
    || referral.admissionDecision?.outcome !== "accepted") return null;
  const recordedPlan = getPlannedAdmissionDate(referral);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recordedPlan)) return null;
  const planned = normalizeCalendarDate(recordedPlan);
  if (!planned) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const day = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return planned <= `${day("year")}-${day("month")}-${day("day")}` ? planned : null;
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
