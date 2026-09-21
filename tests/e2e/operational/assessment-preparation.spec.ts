import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { PipelineAssessmentRecord } from "../../../lib/assessment/assessment-records";
import { actorApiContext, actorPage, pipelineActors, requireOperationalBaseURL, syntheticReferralInput } from "../support/pipeline-actors";

test.describe("assessment preparation", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Requires isolated role-based operational stores.");
  test.setTimeout(60_000);

  for (const actor of ["assessorA", "assessmentCoordinator"] as const) {
    test(`${actor} prepares from intake, resumes and reschedules with the last answer intact`, async ({ browser, baseURL }) => {
      const url = requireOperationalBaseURL(baseURL);
      const api = await actorApiContext(actor, url);
      const { page, context } = await actorPage(browser, actor, url);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        const referral = await createReferral(api);
        await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}`);
        const stages = page.getByRole("navigation", { name: "Workspace stages", exact: true });
        await stages.getByRole("button", { name: "Assessment", exact: true }).click();
        const editor = page.locator("[data-assessment-view]");
        await expect(editor).toBeVisible();
        await expect(stages.getByRole("button", { name: "Assessment", exact: true })).toHaveAttribute("aria-current", "page");
        await expect(page.getByRole("dialog", { name: "Schedule assessment", exact: true })).toHaveCount(0);
        const list = await api.get(`/api/referrals/${referral.id}/assessments`);
        const records = (await list.json()).assessments as PipelineAssessmentRecord[];
        expect(records).toHaveLength(1);
        const id = records[0].assessment_id;
        expect(records[0].resident_name).toBe(referral.name);
        expect(records[0].date_of_birth).toBe(referral.dob);
        expect(records[0].started_at).toBeNull();
        expect(records[0].scheduled_start_at ?? null).toBeNull();

        const findHistory = async () => {
          await editor.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("prior_history");
          const recorded = editor.getByRole("button", { name: "Edit Prior 5150 / 5250 holds", exact: true });
          if (await recorded.isVisible()) await recorded.click();
        };
        await findHistory();
        const field = editor.getByRole("textbox", { name: /Prior 5150/ });
        const answer = "Synthetic discharge summary describes one prior hold, with the date still to confirm.";
        await field.fill(answer);
        await stages.getByRole("button", { name: "Chart", exact: true }).click();
        await expect(stages.getByRole("button", { name: "Chart", exact: true })).toHaveAttribute("aria-current", "page");
        await expect.poll(async () => (await readAssessment(api, id)).prior_5150_5250_holds).toBe(answer);
        expect((await readAssessment(api, id)).started_at).toBeNull();
        await stages.getByRole("button", { name: "Assessment", exact: true }).click();
        await findHistory();
        await expect(field).toHaveValue(answer);

        const scheduledAnswer = `${answer} Prepared before scheduling.`;
        await field.fill(scheduledAnswer);
        await editor.locator('summary[aria-label="Assessment details"]').click();
        await editor.getByRole("button", { name: "Schedule assessment", exact: true }).click();
        const schedule = page.getByRole("dialog", { name: "Schedule assessment", exact: true });
        const future = new Date(Date.now() + (30 + referral.id) * 86_400_000).toISOString().slice(0, 16);
        await schedule.getByLabel("Assessment date and time").fill(future);
        await schedule.getByLabel("Assessment method").selectOption("record_review");
        await schedule.getByRole("button", { name: "Schedule assessment", exact: true }).click();
        await expect(schedule).toHaveCount(0);
        await expect(page.getByRole("dialog", { name: "Begin assessment", exact: true })).toHaveCount(0);
        const scheduled = await readAssessment(api, id);
        expect(scheduled.started_at).toBeNull();
        expect(scheduled.scheduled_start_at).toBeTruthy();
        expect(scheduled.prior_5150_5250_holds).toBe(scheduledAnswer);

        const finalAnswer = `${scheduledAnswer} Last edit immediately before rescheduling.`;
        await field.fill(finalAnswer);
        await field.blur();
        await editor.getByRole("region", { name: "Assessment appointment" }).getByRole("button", { name: "Reschedule assessment", exact: true }).click();
        await schedule.getByLabel("Assessment date and time").fill("2027-10-20T10:00");
        await page.route(`**/api/assessments/${id}/schedule`, (route) => route.fulfill({ status: 503, json: { error: "Synthetic schedule failure. Retry without losing preparation." } }));
        await schedule.getByRole("button", { name: "Save new time", exact: true }).click();
        await expect(schedule.getByRole("alert")).toContainText("Synthetic schedule failure");
        expect((await readAssessment(api, id)).started_at).toBeNull();
        await page.unroute(`**/api/assessments/${id}/schedule`);
        await schedule.getByRole("button", { name: "Save new time", exact: true }).click();
        await expect(schedule).toHaveCount(0);
        await expect(field).toHaveValue(finalAnswer);
        const saved = await readAssessment(api, id);
        expect(saved.started_at).toBeNull();
        expect(saved.prior_5150_5250_holds).toBe(finalAnswer);
        await page.reload();
        await findHistory();
        await expect(field).toHaveValue(finalAnswer);
        expect((await (await api.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments).toHaveLength(1);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
        await api.dispose();
      }
    });
  }

  test("preparation, scheduling and starting retain one record without starting the interview early", async ({ baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("assessorA", url);
    const other = await actorApiContext("outsider", url);
    try {
      const referral = await createReferral(api);
      const created = await api.post(`/api/referrals/${referral.id}/assessments`, { data: {
        client_mutation_id: randomUUID(), data: { prior_5150_5250_holds: "Synthetic record review before the interview." },
      } });
      expect(created.status(), await created.text()).toBe(201);
      const draft = (await created.json()).assessment as PipelineAssessmentRecord;
      expect(draft.started_at).toBeNull();
      expect(draft.scheduled_start_at ?? null).toBeNull();
      const denied = await other.patch(`/api/assessments/${draft.assessment_id}`, { data: {
        if_match: draft.version, patch: { data: { prior_5150_5250_holds: "Must not replace the assigned assessor's answer." } },
      } });
      expect(denied.status()).toBe(403);
      const schedule = await api.post(`/api/assessments/${draft.assessment_id}/schedule`, { data: {
        if_match: draft.version, client_mutation_id: randomUUID(),
        schedule: { status: "scheduled", start_at: new Date(Date.now() + (30 + referral.id) * 86_400_000).toISOString(), duration_minutes: 60, method: "record_review" },
      } });
      expect(schedule.status(), await schedule.text()).toBe(200);
      const scheduled = (await schedule.json()).assessment as PipelineAssessmentRecord;
      expect(scheduled.started_at).toBeNull();
      expect(scheduled.prior_5150_5250_holds).toBe(draft.prior_5150_5250_holds);
      const begin = await api.post(`/api/assessments/${draft.assessment_id}/start`, { data: { if_match: scheduled.version, client_mutation_id: randomUUID() } });
      expect(begin.status(), await begin.text()).toBe(200);
      const started = (await begin.json()).assessment as PipelineAssessmentRecord;
      expect(started.assessment_id).toBe(draft.assessment_id);
      expect(started.started_at).toBeTruthy();
      expect(started.prior_5150_5250_holds).toBe(draft.prior_5150_5250_holds);
      expect((await (await api.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments).toHaveLength(1);
    } finally {
      await api.dispose();
      await other.dispose();
    }
  });
});

async function createReferral(api: APIRequestContext) {
  await api.get("/api/auth/me");
  const response = await api.post("/api/referrals", { data: {
    client_mutation_id: randomUUID(), assignee_id: pipelineActors.assessorA.id,
    referral: syntheticReferralInput("assessorA", { name: `Preparation ${randomUUID().replace(/\d/g, "x")}`, phone: "555-0101" }),
  } });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).referral as { id: number; name: string; dob: string };
}

async function readAssessment(api: APIRequestContext, id: string): Promise<PipelineAssessmentRecord> {
  const response = await api.get(`/api/assessments/${id}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()).assessment;
}
