import "server-only";

import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { getAssessmentCalendar } from "@/lib/pipeline/calendar-store";
import type { HomeBriefingSnapshot } from "@/lib/pipeline/home-briefing-types";
import type { HomeWorkflowSummary } from "@/lib/pipeline/operations-types";
import { getHomeWorkflowSummary } from "@/lib/pipeline/operations-snapshot";
import { isAssessorUser } from "@/lib/pipeline/referral-access";

export async function getHomeBriefing(user: PipelineUser): Promise<HomeBriefingSnapshot> {
  const today = dateKey(new Date());
  const through = addDays(today, 6);
  const [calendarResult, workflowResult] = await Promise.allSettled([
    getAssessmentCalendar(user, { from: today, to: through }),
    getHomeWorkflowSummary(user),
  ]);
  const calendar = calendarResult.status === "fulfilled"
    ? calendarResult.value
    : { events: [], unscheduled: [], unscheduledTotal: 0 };
  const workflow = workflowResult.status === "fulfilled"
    ? workflowResult.value
    : emptyWorkflowSummary(user);
  const unavailableSections: HomeBriefingSnapshot["unavailable_sections"] = [];
  if (workflowResult.status === "rejected") unavailableSections.push("current_work", "workflow");
  if (calendarResult.status === "rejected") unavailableSections.push("upcoming");
  const upcoming = calendar.events
    .filter((event) => event.kind === "assessment")
    .slice(0, 8);

  return {
    generated_at: new Date().toISOString(),
    scope: isAssessorUser(user) ? "personal" : "team",
    viewer: { id: user.id, name: user.name },
    current_work: {
      total: workflow.current_work.total,
      items: workflow.current_work.items.slice(0, 5),
    },
    workflow,
    upcoming,
    unscheduled: calendar.unscheduled.slice(0, 5),
    unscheduled_total: calendar.unscheduledTotal,
    unavailable_sections: unavailableSections,
  };
}

function emptyWorkflowSummary(user: PipelineUser): HomeWorkflowSummary {
  return {
    generated_at: new Date().toISOString(),
    active_total: 0,
    unassigned_total: 0,
    overall_completion_pct: null,
    ready_to_schedule: { total: 0, items: [] },
    data_completion: { total: 0, items: [] },
    current_work: {
      generated_at: new Date().toISOString(),
      owner: { id: user.id, name: user.name },
      total: 0,
      items: [],
    },
  };
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
