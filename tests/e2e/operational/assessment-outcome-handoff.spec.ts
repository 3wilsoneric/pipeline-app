import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  completeOperationalAssessment, createOperationalAssessment, createOperationalReferral,
  readOperationalReferral, resolveOperationalDecisionRequirements, scheduleOperationalAssessment,
  signOperationalAssessment, startOperationalAssessment, submitOperationalRecommendation,
} from "../support/operational-api";
import { actorApiContext, actorPage, pipelineActors, requireOperationalBaseURL } from "../support/pipeline-actors";
import { openAdmitDate } from "../support/handoff-review";

test.describe("assessment outcome and admission handoff", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Requires isolated operational stores.");
  test.setTimeout(75_000);

  test("sign, save under review, reopen active work and clarify its recommendation without a review submission", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const assessor = await actorApiContext("assessorA", url);
    const admin = await actorApiContext("admin", url);
    const { page, context } = await actorPage(browser, "assessorA", url);
    try {
      const { referral, assessment } = await completedAssessment(assessor);
      await page.goto(`${workspace(referral.id)}&workspaceStage=assessment&assessmentMode=review`);
      await page.getByRole("button", { name: "Sign & continue to decision", exact: true }).click();
      await page.getByRole("alertdialog", { name: "Sign this assessment?", exact: true }).getByRole("button", { name: "Sign assessment", exact: true }).click();
      await expect(page.getByRole("region", { name: "Admission decision", exact: true })).toBeVisible();
      await expect(page.getByRole("radio", { name: "Accept", exact: true })).not.toBeChecked();
      await expect(page.getByRole("button", { name: "Record decision", exact: true })).toBeDisabled();
      await page.getByRole("radio", { name: "Under review", exact: true }).check();
      await page.getByRole("textbox", { name: "What needs review?", exact: true }).fill("Synthetic follow-up information is needed.");
      await page.getByRole("button", { name: "Save under review", exact: true }).click();
      await page.getByRole("dialog", { name: "Under Review email" }).getByRole("button", { name: "Not now" }).click();
      await expect.poll(async () => (await workflow(admin, referral.id)).recommendation?.outcome).toBe("needs_more_information");
      const submitted = await workflow(admin, referral.id);
      expect(submitted.review).toBeNull();
      expect(submitted.recommendation.outcome).toBe("needs_more_information");
      expect(submitted.decision).toBeNull();
      const personal = await (await assessor.get("/api/operations/home")).json();
      const team = await (await admin.get("/api/operations/home")).json();
      expect(personal.workflow.active_items.map((item: { referral_id: number }) => item.referral_id)).toContain(referral.id);
      expect(team.workflow.active_items.map((item: { referral_id: number }) => item.referral_id)).not.toContain(referral.id);
      // Home is personal even for supervisors; shared access is through the team directory.
      const currentReferral = await readOperationalReferral(admin, referral.id);
      expect(currentReferral.name).toBeTruthy();
      const teamDirectory = await (await admin.get(`/api/referrals/directory?scope=team&q=${encodeURIComponent(currentReferral.name!)}`)).json();
      expect(teamDirectory.referrals.map((item: { id: number }) => item.id)).toContain(referral.id);
      const mine = await (await assessor.get("/api/operations/my-queue")).json();
      expect(mine.items.map((item: { referral_id: number }) => item.referral_id)).toContain(referral.id);
      await page.getByTestId("workspace-folder-header").getByRole("button", { name: "Workspaces", exact: true }).click();
      await expect(page.getByRole("region", { name: "Admission decision", exact: true })).toHaveCount(0);
      await page.goto(`${workspace(referral.id)}&workspaceView=workflow`);
      await expect(page.getByRole("radio", { name: "Under review", exact: true })).toBeChecked();
      await expect(page.getByRole("textbox", { name: "What needs review?", exact: true })).toHaveValue("Synthetic follow-up information is needed.");
      expect((await readOperationalReferral(assessor, referral.id)).id).toBe(referral.id);

      await page.getByRole("textbox", { name: "What needs review?", exact: true }).fill("Clarified the synthetic follow-up information.");
      await page.getByRole("button", { name: "Save under review", exact: true }).click();
      await page.getByRole("dialog", { name: "Under Review email" }).getByRole("button", { name: "Not now" }).click();
      await expect.poll(async () => (await workflow(admin, referral.id)).recommendation?.reasonNote).toBe("Clarified the synthetic follow-up information.");
      expect((await workflow(admin, referral.id)).review).toBeNull();
      const activity = await (await admin.get(`/api/referrals/${referral.id}/activity`)).text();
      expect(activity).toContain("assessment_recommendation_saved");
      expect(activity).not.toMatch(/assessment_review_submitted|meet_client_email_sent/);
      const returned = await (await assessor.get("/api/operations/home")).json();
      expect(returned.workflow.active_items.map((item: { referral_id: number }) => item.referral_id)).toContain(referral.id);
      const original = await (await assessor.get(`/api/assessments/${assessment.assessment_id}`)).json();
      expect(original.assessment.signed_at).toBeTruthy();
    } finally { await context.close(); await assessor.dispose(); await admin.dispose(); }
  });

  for (const outcome of ["accepted", "declined"] as const) {
    test(`supervisor records ${outcome}; completed workspace remains available`, async ({ browser, baseURL }) => {
      const url = requireOperationalBaseURL(baseURL);
      const assessor = await actorApiContext("assessorA", url);
      const admin = await actorApiContext("admin", url);
      const { page, context } = await actorPage(browser, "admin", url);
      try {
        const { referral, assessment } = await completedAssessment(assessor);
        const signed = await signOperationalAssessment(assessor, assessment);
        await submitOperationalRecommendation(assessor, await readOperationalReferral(assessor, referral.id), signed);
        await resolveOperationalDecisionRequirements(admin, referral.id);
        await page.goto(`${workspace(referral.id)}&workspaceView=workflow`);
        await page.getByRole("radio", { name: outcome === "accepted" ? "Accept" : "Deny", exact: true }).check();
        if (outcome === "declined") await page.getByRole("textbox", { name: "Reason (optional)", exact: true }).fill("Synthetic referral needs a different level of care.");
        await page.getByRole("button", { name: "Record decision", exact: true }).click();
        await page.getByRole("alertdialog").getByRole("button", { name: /^Record (acceptance|denial)$/, exact: true }).click();
        await expect.poll(async () => (await workflow(admin, referral.id)).decision?.outcome).toBe(outcome);
        await page.reload();
        await expect(page.getByRole("region", { name: "Admission decision", exact: true }).getByText("Decision recorded", { exact: true })).toBeVisible();
        const reopened = await readOperationalReferral(admin, referral.id);
        const edited = await admin.patch(`/api/referrals/${referral.id}`, { data: {
          if_match: reopened.version, if_match_sections: { intake: reopened.sectionVersions.intake },
          client_mutation_id: randomUUID(), patch: { phone: "555-0188" },
        } });
        expect(edited.status(), await edited.text()).toBe(200);
        expect((await workflow(admin, referral.id)).decision.outcome).toBe(outcome);
        await page.reload();
        if (outcome === "declined") {
          await expect(page.getByRole("button", { name: "Review email & packet", exact: true })).toHaveCount(0);
          return;
        }
        const before = await (await admin.get(`/api/referrals/${referral.id}/admission-summary`)).json();
        expect(before.email.ready).toBe(false);
        expect(before.email.blockers.join(" ")).toContain("planned admit date before sending Meet the Client");
        await page.getByLabel("Planned admission date", { exact: true }).fill("2026-10-12");
        await page.getByRole("button", { name: "Review email & packet", exact: true }).click();
        await expect(page.getByRole("region", { name: "Email and referral packet", exact: true })).toBeVisible();
        const admitDate = await openAdmitDate(page);
        await expect(admitDate.getByLabel("Planned admit date", { exact: true })).toHaveValue("2026-10-12");
        const after = await (await admin.get(`/api/referrals/${referral.id}/admission-summary`)).json();
        expect(after.referral.plannedAdmissionDate).toBe("2026-10-12");
        expect(after.report.meetClient.admissionDate).toBe("2026-10-12");
        expect(after.email.blockers.join(" ")).not.toContain("planned admit date before sending Meet the Client");
        expect(after.referral.stage).not.toBe("Accepted / Admitted");
        await page.goto(`${workspace(referral.id)}&workspaceView=workflow`);
        await expect(page.getByLabel("Planned admission date", { exact: true })).toHaveValue("2026-10-12");
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const unavailableSend = await assessor.post(`/api/referrals/${referral.id}/meet-client-email`, { data: { confirmed: true, if_match: after.referral.version, recipients: ["synthetic@example.invalid"], client_mutation_id: randomUUID() } });
        expect(unavailableSend.status()).toBe(403);
        expect(await unavailableSend.text()).toContain("Not production yet — no email will be sent");
      } finally { await context.close(); await assessor.dispose(); await admin.dispose(); }
    });
  }
});

async function completedAssessment(api: APIRequestContext) {
  await api.get("/api/auth/me");
  const token = Array.from(randomUUID(), (letter) => String.fromCharCode(97 + letter.charCodeAt(0) % 26)).join("");
  const referral = await createOperationalReferral(api, "assessorA", { name: `Outcome ${token}`, phone: "555-0101", email: "outcome@example.invalid" }, { assigneeId: pipelineActors.assessorA.id });
  const draft = await createOperationalAssessment(api, referral.id);
  const scheduled = await scheduleOperationalAssessment(api, draft);
  const started = await startOperationalAssessment(api, scheduled);
  return { referral, assessment: await completeOperationalAssessment(api, started) };
}

async function workflow(api: APIRequestContext, id: number) {
  const response = await api.get(`/api/referrals/${id}/workflow`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

function workspace(id: number) { return `/?view=referrals&screen=packet&referralId=${id}`; }
