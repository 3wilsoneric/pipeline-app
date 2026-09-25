import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { isoToOperationalInput } from "../../../components/pipeline/pipeline-calendar-model";
import type { PipelineAssessmentRecord } from "../../../lib/assessment/assessment-records";
import type { Referral } from "../../../lib/pipeline/referral-types";
import { completeOperationalAssessment, signOperationalAssessment, startOperationalAssessment } from "../support/operational-api";
import {
  actorApiContext,
  actorPage,
  pipelineActors,
  requireOperationalBaseURL,
  syntheticReferralInput,
} from "../support/pipeline-actors";

test.describe("assessment editing entry and return paths", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Requires isolated role-based operational stores.");
  test.setTimeout(60_000);

  for (const actor of ["assessorA", "assessmentCoordinator"] as const) {
    test(`${actor} edits before a future appointment, records its start and resumes the same answers`, async ({ browser, baseURL }) => {
      const url = requireOperationalBaseURL(baseURL);
      const api = await actorApiContext(actor, url);
      const { page, context } = await actorPage(browser, actor, url);
      try {
        const { referral, assessment } = await scheduledAssessment(api, pipelineActors[actor].id);
        await page.goto(`${workspacePath(referral.id)}&workspaceStage=assessment&assessmentSection=prior_history`);
        const full = page.locator("[data-assessment-view]");
        await expect(full.getByRole("combobox", { name: "Assessment section", exact: true })).toHaveValue("prior_history");
        await expect(page.getByRole("dialog", { name: "Begin assessment", exact: true })).toHaveCount(0);
        await expect(full.getByRole("textbox", { name: /Prior 5150/ })).toBeEditable();
        expect((await readAssessment(api, assessment.assessment_id)).started_at).toBeFalsy();
        await expect(page.getByRole("button", { name: "Begin assessment", exact: true })).toHaveCount(0);
        expect((await readAssessment(api, assessment.assessment_id)).started_at).toBeNull();

        const answer = "Synthetic history entered immediately before closing the assessment.";
        await full.getByRole("textbox", { name: /Prior 5150/ }).fill(answer);
        const stages = page.getByRole("navigation", { name: "Workspace stages" });
        await stages.getByRole("button", { name: "Chart", exact: true }).click();
        await expect(stages.getByRole("button", { name: "Chart", exact: true })).toHaveAttribute("aria-current", "page");
        expect((await readAssessment(api, assessment.assessment_id)).prior_5150_5250_holds).toBe(answer);
        // Reopen without leaving the workspace, not just via a saved Home link.
        await stages.getByRole("button", { name: "Assessment", exact: true }).click();
        await expect(full.getByRole("combobox", { name: "Assessment section", exact: true })).toHaveValue("prior_history");
        await expect(full.getByRole("textbox", { name: /Prior 5150/ })).toHaveValue(answer);
        await page.getByRole("button", { name: "Pipeline home", exact: true }).click();
        await expect(page.getByTestId("packet-workspace")).toHaveCount(0);
        await page.locator('[data-home-module="current-work"]').getByRole("button", { name: "Open current work", exact: true }).click();
        const board = page.getByRole("dialog", { name: "Current work", exact: true });
        await board.getByRole("button", { name: `Open ${referral.name}`, exact: true }).click();
        await expect(full).toBeVisible();
        await expect(full.getByRole("combobox", { name: "Assessment section", exact: true })).toHaveValue("prior_history");
        await expect(full.getByRole("textbox", { name: /Prior 5150/ })).toHaveValue(answer);
        const records = (await (await api.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments;
        expect(records).toHaveLength(1);
        expect(records[0].assessment_id).toBe(assessment.assessment_id);
        expect(records[0].prior_5150_5250_holds).toBe(answer);
      } finally {
        await context.close();
        await api.dispose();
      }
    });
  }

  for (const status of ["cancelled", "no_show"] as const) {
    test(`${status} remains editable and rescheduling preserves the same assessment`, async ({ browser, baseURL }) => {
      const url = requireOperationalBaseURL(baseURL);
      const api = await actorApiContext("assessorA", url);
      const { page, context } = await actorPage(browser, "assessorA", url);
      try {
        const { referral, assessment } = await scheduledAssessment(api);
        const cancelled = await api.post(`/api/assessments/${assessment.assessment_id}/schedule`, { data: {
          if_match: assessment.version, client_mutation_id: randomUUID(),
          schedule: { status, start_at: assessment.scheduled_start_at, duration_minutes: 60, method: "record_review" },
        } });
        expect(cancelled.status(), await cancelled.text()).toBe(200);
        await page.goto(`${workspacePath(referral.id)}&workspaceStage=assessment&assessmentSection=prior_history`);
        const full = page.locator("[data-assessment-view]");
        await expect(full.getByRole("textbox", { name: /Prior 5150/ })).toBeEditable();
        await page.getByRole("region", { name: "Assessment progress", exact: true })
          .getByRole("button", { name: "Schedule interview", exact: true }).click();
        const schedule = page.getByRole("dialog", { name: "Schedule interview", exact: true });
        await expect(schedule).toBeVisible();
        await expect(page.getByRole("dialog", { name: "Begin assessment", exact: true })).toHaveCount(0);
        const newStart = new Date(Date.parse(assessment.scheduled_start_at!) + 86_400_000);
        newStart.setUTCHours(20, 0, 0, 0);
        await schedule.getByLabel("Assessment date and time").fill(isoToOperationalInput(newStart.toISOString()));
        await schedule.getByRole("button", { name: "Save new time", exact: true }).click();
        await expect(schedule).not.toBeVisible();
        await expect(page.getByRole("button", { name: "Begin assessment", exact: true })).toHaveCount(0);
        await expect(full).toBeVisible();
        const saved = await readAssessment(api, assessment.assessment_id);
        expect(saved.assessment_id).toBe(assessment.assessment_id);
        expect(saved.schedule_status).toBe("scheduled");
        expect(saved.scheduled_start_at).toBe(newStart.toISOString());
        expect(saved.current_location).toBe("Synthetic placement");
        expect(saved.started_at).toBeNull();
        const records = (await (await api.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments;
        expect(records).toHaveLength(1);
        expect(records[0].assessment_id).toBe(assessment.assessment_id);
      } finally {
        await context.close();
        await api.dispose();
      }
    });
  }

  test("Calendar opens the scheduled referral and another authorized assessor can start it", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("assessorA", url);
    const other = await actorApiContext("assessorB", url);
    const { page, context } = await actorPage(browser, "assessorA", url);
    try {
      const { referral, assessment } = await scheduledAssessment(api);
      const started = await other.post(`/api/assessments/${assessment.assessment_id}/start`, { data: {
        if_match: assessment.version, client_mutation_id: randomUUID(),
      } });
      expect(started.status()).toBe(200);
      expect((await readAssessment(api, assessment.assessment_id)).started_at).toBeTruthy();
      await page.goto("/?screen=calendar");
      await expect(page.locator('main[data-performance-ready="calendar"]')).toBeVisible();
      // Move the client calendar after hydration so its Pacific date matches the appointment.
      await page.clock.setFixedTime(new Date(assessment.scheduled_start_at!));
      await page.getByRole("button", { name: "Today", exact: true }).click();
      const timedAppointment = page.getByRole("region", { name: "Timed assessment week", exact: true })
        .getByRole("button", { name: new RegExp(referral.name!) });
      const otherAppointment = page.getByRole("region", { name: "Other appointment times", exact: true })
        .getByRole("button", { name: referral.name!, exact: true });
      const appointment = timedAppointment.or(otherAppointment);
      await expect(appointment).toHaveCount(1);
      await appointment.click();
      await page.getByRole("dialog", { name: "Calendar item", exact: true }).getByRole("button", { name: "Continue assessment", exact: true }).click();
      await expect(page.locator("[data-assessment-view]")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`referralId=${referral.id}(?:&|$)`));
      await page.reload();
      await expect(page.locator("[data-assessment-view]")).toBeVisible();
    } finally {
      await context.close();
      await api.dispose();
      await other.dispose();
    }
  });

  test("signed but unsent assessments stay editable and a new assessment does not overwrite the signed record", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("assessorA", url);
    const { page, context } = await actorPage(browser, "assessorA", url);
    try {
      const { referral, assessment } = await scheduledAssessment(api);
      const started = await startOperationalAssessment(api, assessment);
      const complete = await completeOperationalAssessment(api, started);
      const signed = await signOperationalAssessment(api, complete);
      const signedRecord = await readAssessment(api, signed.assessment_id);
      expect(signedRecord.signed_at).toBeTruthy();
      await page.goto(`${workspacePath(referral.id)}&workspaceStage=assessment&assessmentSection=prior_history`);
      const full = page.locator("[data-assessment-view]");
      await expect(full).toBeVisible();
      const placements = full.getByRole("textbox", { name: "Prior placements", exact: true });
      await expect(placements).toBeEditable();
      await expect(full.getByRole("button", { name: "Add note", exact: true })).toHaveCount(0);
      const signedAnswer = "Synthetic placement correction after signing, before sending.";
      await placements.fill(signedAnswer);
      await placements.blur();
      await expect.poll(async () => (await readAssessment(api, signed.assessment_id)).prior_placements).toBe(signedAnswer);
      const editedSigned = await readAssessment(api, signed.assessment_id);
      expect(editedSigned.signed_at).toBe(signedRecord.signed_at);
      const next = await api.post(`/api/referrals/${referral.id}/assessments`, { data: {
        client_mutation_id: randomUUID(), data: { current_location: "Synthetic reassessment placement" },
      } });
      expect(next.status(), await next.text()).toBe(201);
      const nextDraft = (await next.json()).assessment as PipelineAssessmentRecord;
      const scheduled = await api.post(`/api/assessments/${nextDraft.assessment_id}/schedule`, { data: {
        if_match: nextDraft.version, client_mutation_id: randomUUID(),
        schedule: { status: "scheduled", start_at: new Date(Date.parse(assessment.scheduled_start_at!) + 86_400_000).toISOString(), duration_minutes: 60, method: "record_review" },
      } });
      expect(scheduled.status(), await scheduled.text()).toBe(200);
      await page.reload();
      await expect(placements).toBeEditable();
      await expect(placements).toHaveValue("");
      const nextAnswer = "Synthetic placement in the new interview.";
      await placements.fill(nextAnswer);
      await placements.blur();
      await expect.poll(async () => (await readAssessment(api, nextDraft.assessment_id)).prior_placements).toBe(nextAnswer);
      const retainedSigned = await readAssessment(api, signed.assessment_id);
      expect(retainedSigned.prior_placements).toBe(signedAnswer);
      expect(retainedSigned.version).toBe(editedSigned.version);
      expect(retainedSigned.signed_at).toBe(signedRecord.signed_at);
      expect(nextDraft.assessment_id).not.toBe(signed.assessment_id);
      const records = (await (await api.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments;
      expect(records).toHaveLength(2);
    } finally {
      await context.close();
      await api.dispose();
    }
  });

  test("legacy process-tester links retain their section across desktop and phone assessment layouts", async ({ browser, baseURL }) => {
    const { page, context } = await actorPage(browser, "admin", requireOperationalBaseURL(baseURL));
    try {
      await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=interview&assessmentSection=prior_history");
      const full = page.locator("[data-assessment-view]");
      await expect(full).toBeVisible();
      await expect(full.getByRole("combobox", { name: "Assessment section", exact: true })).toHaveValue("prior_history");
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(full.getByRole("button", { name: "Choose questionnaire section", exact: true })).toContainText("Recent care and history");
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(full.getByRole("combobox", { name: "Assessment section", exact: true })).toHaveValue("prior_history");
    } finally {
      await context.close();
    }
  });
});

async function scheduledAssessment(api: APIRequestContext, assigneeId = pipelineActors.assessorA.id) {
  await api.get("/api/auth/me");
  const token = Array.from(randomUUID(), (letter) => String.fromCharCode(97 + letter.charCodeAt(0) % 26)).join("");
  const created = await api.post("/api/referrals", { data: {
    client_mutation_id: randomUUID(), assignee_id: assigneeId,
    referral: syntheticReferralInput("assessorA", {
      name: `Entry ${token}`, phone: "555-0101", email: "entry@example.invalid",
    }),
  } });
  expect(created.status(), await created.text()).toBe(201);
  const referral = (await created.json()).referral as Referral;
  const draft = await api.post(`/api/referrals/${referral.id}/assessments`, { data: {
    client_mutation_id: randomUUID(), data: { current_location: "Synthetic placement" },
  } });
  expect(draft.status(), await draft.text()).toBe(201);
  const assessment = (await draft.json()).assessment as PipelineAssessmentRecord;
  const schedule = await api.post(`/api/assessments/${assessment.assessment_id}/schedule`, { data: {
    if_match: assessment.version, client_mutation_id: randomUUID(),
    schedule: { status: "scheduled", start_at: new Date(Date.now() + (30 + referral.id) * 86_400_000).toISOString(), duration_minutes: 60, method: "record_review" },
  } });
  expect(schedule.status(), await schedule.text()).toBe(200);
  return { referral, assessment: (await schedule.json()).assessment as PipelineAssessmentRecord };
}

async function readAssessment(api: APIRequestContext, id: string): Promise<PipelineAssessmentRecord> {
  const response = await api.get(`/api/assessments/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).assessment;
}

function workspacePath(id: number) { return `/?view=referrals&screen=packet&referralId=${id}`; }
