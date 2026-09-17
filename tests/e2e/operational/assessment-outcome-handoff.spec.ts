import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  completeOperationalAssessment, createOperationalAssessment, createOperationalReferral,
  readOperationalReferral, resolveOperationalDecisionRequirements, scheduleOperationalAssessment,
  signOperationalAssessment, startOperationalAssessment, submitOperationalRecommendation,
} from "../support/operational-api";
import { actorApiContext, actorPage, pipelineActors, requireOperationalBaseURL } from "../support/pipeline-actors";

test.describe("assessment outcome and admission handoff", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Requires isolated operational stores.");
  test.setTimeout(75_000);

  test("sign, finish under review, leave active assessor work, reopen and return corrections", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const assessor = await actorApiContext("assessorA", url);
    const admin = await actorApiContext("admin", url);
    const { page, context } = await actorPage(browser, "assessorA", url);
    try {
      const { referral, assessment } = await completedAssessment(assessor);
      await page.goto(`${workspace(referral.id)}&workspaceStage=assessment&assessmentSection=review`);
      await page.getByRole("button", { name: "Full assessment", exact: true }).click();
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Sign assessment", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Assessment outcome", exact: true })).toBeVisible();
      await expect(page.getByRole("radio", { name: "Accept", exact: true })).not.toBeChecked();
      await expect(page.getByRole("button", { name: "Finish assessment", exact: true })).toBeDisabled();
      await page.getByRole("radio", { name: "Under review", exact: true }).check();
      await page.getByRole("textbox", { name: "What needs review?", exact: true }).fill("Synthetic follow-up information is needed.");
      await page.getByRole("button", { name: "Finish assessment", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Assessment finished", exact: true })).toBeVisible();
      const submitted = await workflow(admin, referral.id);
      expect(submitted.review.status).toBe("submitted");
      expect(submitted.recommendation.outcome).toBe("needs_more_information");
      expect(submitted.decision).toBeNull();
      const personal = await (await assessor.get("/api/operations/home")).json();
      const team = await (await admin.get("/api/operations/home")).json();
      expect(personal.workflow.active_items.map((item: { referral_id: number }) => item.referral_id)).not.toContain(referral.id);
      expect(team.workflow.active_items.map((item: { referral_id: number }) => item.referral_id)).toContain(referral.id);
      const mine = await (await assessor.get("/api/operations/my-queue")).json();
      expect(mine.items.map((item: { referral_id: number }) => item.referral_id)).not.toContain(referral.id);
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Current work", exact: true })).toBeVisible();
      await page.goto(`${workspace(referral.id)}&workspaceView=workflow`);
      await expect(page.getByRole("heading", { name: "Assessment finished", exact: true })).toBeVisible();
      expect((await readOperationalReferral(assessor, referral.id)).id).toBe(referral.id);

      const changes = await admin.post(`/api/referrals/${referral.id}/assessment-review`, { data: {
        action: "request_changes", if_match: submitted.referral.version,
        if_match_section: submitted.referral.sectionVersions.decision,
        if_match_review: submitted.review.version, review_id: submitted.review.reviewId,
        client_mutation_id: randomUUID(), reason_note: "Clarify the synthetic follow-up information.",
      } });
      expect(changes.status(), await changes.text()).toBe(200);
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
        await page.getByRole("combobox", { name: "Decision", exact: true }).selectOption(outcome);
        if (outcome === "declined") await page.getByRole("textbox", { name: "Decision rationale", exact: true }).fill("Synthetic referral needs a different level of care.");
        page.once("dialog", (dialog) => dialog.accept());
        await page.getByRole("button", { name: "Record final decision", exact: true }).click();
        await expect.poll(async () => (await workflow(admin, referral.id)).decision?.outcome).toBe(outcome);
        await page.reload();
        await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible();
        const reopened = await readOperationalReferral(admin, referral.id);
        const edited = await admin.patch(`/api/referrals/${referral.id}`, { data: {
          if_match: reopened.version, if_match_sections: { identity: reopened.sectionVersions.identity },
          client_mutation_id: randomUUID(), patch: { phone: "555-0188" },
        } });
        expect(edited.status(), await edited.text()).toBe(200);
        expect((await workflow(admin, referral.id)).decision.outcome).toBe(outcome);
        await page.reload();
        if (outcome === "declined") {
          await expect(page.getByRole("button", { name: "Prepare Meet the Client", exact: true })).toHaveCount(0);
          return;
        }
        const before = await (await admin.get(`/api/referrals/${referral.id}/admission-summary`)).json();
        expect(before.email.ready).toBe(false);
        expect(before.email.blockers.join(" ")).not.toContain("admission date");
        await page.getByLabel("Admission date", { exact: true }).fill("2026-10-12");
        await page.getByRole("button", { name: "Prepare Meet the Client", exact: true }).click();
        await expect(page.getByRole("article", { name: "Meet the Client chart", exact: true })).toContainText("Oct 12, 2026");
        const after = await (await admin.get(`/api/referrals/${referral.id}/admission-summary`)).json();
        expect(after.referral.admissionDate).toBe("2026-10-12");
        expect(after.report.meetClient.admissionDate).toBe("2026-10-12");
        expect(after.email.blockers.join(" ")).not.toContain("Set the admission date");
        expect(after.referral.stage).not.toBe("Accepted / Admitted");
        await page.getByRole("button", { name: "Back to outcome", exact: true }).click();
        await page.reload();
        await expect(page.getByLabel("Admission date", { exact: true })).toHaveValue("2026-10-12");
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const deniedSend = await assessor.post(`/api/referrals/${referral.id}/meet-client-email`, { data: { confirmed: true, if_match: after.referral.version, recipients: ["synthetic@example.invalid"], client_mutation_id: randomUUID() } });
        expect(deniedSend.status()).toBe(403);
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
