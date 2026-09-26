import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

import { isUpcomingAssessmentAppointment } from "../../lib/pipeline/assessment-calendar";
import type { PipelineCalendarResponse } from "../../lib/pipeline/calendar-types";
import type { HomeBriefingSnapshot } from "../../lib/pipeline/home-briefing-types";
import { createOperationalAssessment, createOperationalReferral, scheduleOperationalAssessment } from "./support/operational-api";

test("Home only lists appointments within their scheduled window", () => {
  const now = new Date("2026-09-24T19:00:00.000Z");
  const event = {
    kind: "assessment" as const,
    status: "draft" as const,
    scheduleStatus: "scheduled" as const,
    startsAt: "2026-09-24T18:30:00.000Z",
    durationMinutes: 60,
  };
  expect(isUpcomingAssessmentAppointment(event, now)).toBe(true);
  expect(isUpcomingAssessmentAppointment({ ...event, startsAt: "2026-09-24T17:30:00.000Z" }, now)).toBe(false);
  expect(isUpcomingAssessmentAppointment({ ...event, status: "complete" }, now)).toBe(false);
  expect(isUpcomingAssessmentAppointment({ ...event, scheduleStatus: "completed" }, now)).toBe(false);
  expect(isUpcomingAssessmentAppointment({ ...event, scheduleStatus: "cancelled" }, now)).toBe(false);
});

test("intake edits and appointment changes agree across Home, Board, and Calendar", async ({ page }) => {
  const token = randomUUID().slice(0, 8).replace(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)));
  const suffix = `${token[0].toUpperCase()}${token.slice(1)}`;
  const originalName = `Initial ${suffix}`;
  const updatedName = `Updated ${suffix}`;
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: originalName,
    owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const created = await createOperationalAssessment(page.request, referral.id);
  const scheduled = await scheduleOperationalAssessment(page.request, created);
  const home = async () => {
    const response = await page.request.get("/api/operations/home");
    expect(response.ok()).toBe(true);
    return response.json() as Promise<HomeBriefingSnapshot>;
  };
  const findUpcoming = (snapshot: HomeBriefingSnapshot) => snapshot.upcoming.filter((event) => event.referralId === referral.id);
  const findBoard = (snapshot: HomeBriefingSnapshot) => snapshot.workflow.all_board_items?.filter((item) => item.referral_id === referral.id) ?? [];

  const before = await home();
  expect(findUpcoming(before)).toHaveLength(1);
  expect(findUpcoming(before)[0].clientName).toBe(originalName);
  expect(findBoard(before)).toHaveLength(1);
  const appointmentDate = findUpcoming(before)[0].date;
  const calendar = async (date = appointmentDate) => {
    const response = await page.request.get(`/api/calendar/events?from=${date}&to=${date}`);
    expect(response.ok()).toBe(true);
    return response.json() as Promise<PipelineCalendarResponse>;
  };

  const renamedResponse = await page.request.patch(`/api/referrals/${referral.id}`, {
    data: {
      if_match: referral.version,
      if_match_sections: referral.sectionVersions,
      patch: { name: updatedName },
    },
  });
  expect(renamedResponse.ok()).toBe(true);
  const renamed = (await renamedResponse.json()).referral as typeof referral;
  expect(renamed.name).toBe(updatedName);
  const afterRename = await home();
  expect(findUpcoming(afterRename).map((event) => event.clientName)).toEqual([updatedName]);
  expect(findBoard(afterRename).map((item) => item.client_name)).toEqual([updatedName]);
  expect((await calendar()).events.filter((event) => event.referralId === referral.id).map((event) => event.clientName)).toContain(updatedName);

  const currentAssessment = await (await page.request.get(`/api/assessments/${scheduled.assessment_id}`)).json();
  const originalAppointment = currentAssessment.assessment;
  const movedStart = new Date(Date.parse(originalAppointment.scheduled_start_at) + 24 * 60 * 60_000).toISOString();
  const movedResponse = await page.request.post(`/api/assessments/${scheduled.assessment_id}/schedule`, {
    data: {
      if_match: originalAppointment.version,
      client_mutation_id: randomUUID(),
      schedule: {
        status: "rescheduled",
        start_at: movedStart,
        duration_minutes: originalAppointment.scheduled_duration_minutes,
        method: originalAppointment.scheduled_method,
        location: originalAppointment.scheduled_location,
      },
    },
  });
  const movedBody = await movedResponse.text();
  expect(movedResponse.ok(), movedBody).toBe(true);
  const movedAppointment = JSON.parse(movedBody).assessment;
  const afterMove = await home();
  expect(findUpcoming(afterMove)).toHaveLength(1);
  expect(findUpcoming(afterMove)[0].startsAt).toBe(movedStart);
  const movedDate = findUpcoming(afterMove)[0].date;
  expect((await calendar()).events.filter((event) => event.referralId === referral.id)).toHaveLength(0);
  expect((await calendar(movedDate)).events.filter((event) => event.referralId === referral.id)).toHaveLength(1);

  const completedResponse = await page.request.post(`/api/assessments/${scheduled.assessment_id}/schedule`, {
    data: {
      if_match: movedAppointment.version,
      client_mutation_id: randomUUID(),
      schedule: {
        status: "completed",
        start_at: movedAppointment.scheduled_start_at,
        duration_minutes: movedAppointment.scheduled_duration_minutes,
        method: movedAppointment.scheduled_method,
        location: movedAppointment.scheduled_location,
      },
    },
  });
  expect(completedResponse.ok()).toBe(true);
  const afterCompletion = await home();
  expect(findUpcoming(afterCompletion)).toHaveLength(0);
  expect(findBoard(afterCompletion)).toHaveLength(1);
  expect((await calendar(movedDate)).events.filter((event) => event.referralId === referral.id)).toHaveLength(1);

  const currentReferral = (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral as typeof referral;
  const trashedResponse = await page.request.delete(`/api/referrals/${referral.id}`, {
    data: { if_match: currentReferral.version, client_mutation_id: randomUUID() },
  });
  expect(trashedResponse.ok(), await trashedResponse.text()).toBe(true);
  expect(findUpcoming(await home())).toHaveLength(0);
  expect(findBoard(await home())).toHaveLength(0);
  expect((await calendar(movedDate)).events.filter((event) => event.referralId === referral.id)).toHaveLength(0);
});
