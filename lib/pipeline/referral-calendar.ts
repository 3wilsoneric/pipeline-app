import type { PipelineCalendarEvent } from "@/lib/pipeline/calendar-types";
import type { Referral } from "@/lib/pipeline/referral-types";

export function referralCalendarEvents(referral: Referral): PipelineCalendarEvent[] {
  const base = {
    referralId: referral.id,
    clientName: referral.name,
    community: referral.community,
    owner: referral.owner || "Unassigned",
  };
  const events: PipelineCalendarEvent[] = [];
  const receivedDate = calendarDate(referral.date) ?? calendarDate(referral.createdAt);
  if (receivedDate) {
    events.push({
      ...base,
      id: `referral:${referral.id}:received`,
      date: receivedDate,
      kind: "referral",
      title: "Referral received",
      detail: referral.source || referral.stage,
    });
  }
  const assessmentDate = calendarDate(referral.assessment?.scheduledDate);
  if (assessmentDate) {
    events.push({
      ...base,
      id: `referral:${referral.id}:assessment`,
      date: assessmentDate,
      kind: "assessment",
      title: "Assessment",
      detail: referral.assessment?.completedAt ? "Completed" : "Scheduled",
    });
  }
  const admissionDate = calendarDate(referral.admissionDate);
  if (admissionDate) {
    events.push({
      ...base,
      id: `referral:${referral.id}:admission`,
      date: admissionDate,
      kind: "admission",
      title: "Admission",
      detail: referral.community,
    });
  }
  for (const requirement of referral.requirements ?? []) {
    const dueDate = calendarDate(requirement.dueAt);
    if (!dueDate || ["reviewed", "waived"].includes(requirement.status)) continue;
    events.push({
      ...base,
      id: `requirement:${requirement.id}:due`,
      date: dueDate,
      kind: "requirement",
      title: requirement.label,
      detail: requirement.owner || "Unassigned",
    });
  }
  return events;
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

function isValidDateKey(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
