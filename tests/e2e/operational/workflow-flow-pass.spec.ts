import { expect, test } from "@playwright/test";
import { actorApiContext, actorPage, operationalActorHeaders, requireOperationalBaseURL } from "../support/pipeline-actors";
import { createOperationalAssessment, createOperationalReferral, readOperationalReferral, recordOperationalAcceptance, signOperationalAssessment, submitOperationalRecommendation, transitionOperationalReferral } from "../support/operational-api";

test.describe("uninterrupted workflow", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Isolated stores required.");
  test.setTimeout(60_000);

  test("incomplete work moves in both directions and acceptance permits a later recommendation", async ({ baseURL }) => {
    const api = await actorApiContext("viewer", requireOperationalBaseURL(baseURL));
    try {
      let referral = await createOperationalReferral(api, "viewer", { dob: "", documentName: "", owner: "Unassigned" });
      for (const stage of ["Assessment", "Packet Needed", "Community Review", "New"]) {
        referral = await transitionOperationalReferral(api, referral, stage);
        expect((await (await api.get(`/api/referrals/${referral.id}`)).json()).referral.stage).toBe(stage);
      }
      await recordOperationalAcceptance(api, referral);
      const accepted = (await (await api.get(`/api/referrals/${referral.id}/workflow`)).json()).decision;
      const assessment = await createOperationalAssessment(api, referral.id);
      await submitOperationalRecommendation(api, await readOperationalReferral(api, referral.id), assessment);
      let workflow = await (await api.get(`/api/referrals/${referral.id}/workflow`)).json();
      expect(workflow.decision).toEqual(accepted);
      expect(workflow.referral.workflowStatus).toBe("approved_for_placement");
      expect(workflow.review).toBeNull();
      const signed = await signOperationalAssessment(api, assessment);
      await submitOperationalRecommendation(api, await readOperationalReferral(api, referral.id), signed);
      workflow = await (await api.get(`/api/referrals/${referral.id}/workflow`)).json();
      expect(workflow.decision).toEqual(accepted);
      expect(workflow.referral.workflowStatus).toBe("approved_for_placement");
      expect(workflow.review).toBeNull();
      expect(workflow.work_items.some((item: { status: string }) => item.status === "needed")).toBe(true);
      const queued = await api.post(`/api/referrals/${referral.id}/ehr-handoff`, { data: {
        if_match: workflow.referral.version, if_match_section: workflow.referral.sectionVersions.decision, action: "queue",
      } });
      expect(queued.status(), await queued.text()).toBe(200);
      referral = await transitionOperationalReferral(api, await readOperationalReferral(api, referral.id), "Accepted / Admitted");
      referral = await transitionOperationalReferral(api, referral, "Packet Review");
      expect((await (await api.get(`/api/referrals/${referral.id}`)).json()).referral.stage).toBe("Packet Review");
      expect((await (await api.get(`/api/referrals/${referral.id}/workflow`)).json()).referral.workflowStatus).toBe("approved_for_placement");
      expect((await (await api.get(`/api/referrals/${referral.id}/workflow`)).json()).decision).toEqual(accepted);
    } finally { await api.dispose(); }
  });

  test("queued save acknowledgements preserve immediate newer edits without a false conflict", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("assessorA", url);
    const { page, context } = await actorPage(browser, "assessorA", url);
    let releaseSync = () => {};
    try {
      const referral = await createOperationalReferral(api, "assessorA", { documentName: "" });
      const assessment = await createOperationalAssessment(api, referral.id);
      expect((await api.post(`/api/assessments/${assessment.assessment_id}/start`, { data: { if_match: assessment.version } })).status()).toBe(200);
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
      const editor = page.locator("[data-assessment-view]");
      await expect(editor).toBeVisible();
      await editor.getByRole("combobox", { name: "Assessment section", exact: true }).selectOption("prior_history");
      const answer = editor.getByRole("textbox", { name: /Prior 5150/ });
      let rejectWrites = true;
      let syncCommitted = () => {};
      const committed = new Promise<void>(resolve => { syncCommitted = resolve; });
      const release = new Promise<void>(resolve => { releaseSync = resolve; });
      let delayOnce = true;
      await page.route(`**/api/assessments/${assessment.assessment_id}`, async route => {
        if (route.request().method() !== "PATCH") return route.continue();
        if (rejectWrites) return route.fulfill({ status: 503, json: { error: "Synthetic save outage" } });
        if (delayOnce) {
          delayOnce = false;
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          syncCommitted();
          await release;
          return route.fulfill({ response });
        }
        return route.continue();
      });
      await answer.fill("First queued answer.");
      await answer.blur();
      await expect(editor.getByText("1 change waiting to sync", { exact: true })).toBeVisible();
      rejectWrites = false;
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await committed;
      await answer.fill("Newer answer typed while the earlier save returns.");
      await answer.blur();
      releaseSync();
      await expect.poll(async () => (await (await api.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.prior_5150_5250_holds).toBe("Newer answer typed while the earlier save returns.");
      await expect(editor.getByRole("button", { name: "Keep mine", exact: true })).toHaveCount(0);
      await expect(answer).toHaveValue("Newer answer typed while the earlier save returns.");
      await page.getByTestId("workspace-folder-header").getByRole("button", { name: "Workspaces", exact: true }).click();
      await expect(editor).toHaveCount(0);
    } finally { releaseSync(); await context.close(); await api.dispose(); }
  });

  test("incomplete assessment and scheduling errors keep navigation available without red notices", async ({ page, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("viewer", url);
    await page.setExtraHTTPHeaders(operationalActorHeaders("viewer", url));
    try {
      const referral = await createOperationalReferral(api, "viewer", { documentName: "", dob: "", owner: "Unassigned" });
      await createOperationalAssessment(api, referral.id);
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
      await page.locator('summary[aria-label="Assessment details"]').click();
      await page.getByRole("button", { name: "Schedule assessment", exact: true }).click();
      const schedule = page.getByRole("dialog", { name: "Schedule assessment", exact: true });
      await schedule.getByLabel("Assessment date and time").fill("2027-01-15T10:00");
      await page.route("**/api/assessments/*/schedule", route => route.fulfill({ status: 503, json: { error: "Synthetic schedule outage" } }));
      await schedule.getByRole("button", { name: "Schedule assessment", exact: true }).click();
      const notice = schedule.getByRole("alert");
      await expect(notice).toContainText("Synthetic schedule outage");
      expect(await notice.evaluate(element => getComputedStyle(element).color)).toBe("rgb(89, 100, 94)");
      await schedule.getByRole("button", { name: "Close schedule", exact: true }).click();
      await expect(schedule).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Begin assessment", exact: true })).toHaveCount(0);
      const editor = page.locator("[data-assessment-view]");
      await expect(editor.getByRole("button", { name: "Next section", exact: true })).toBeEnabled();
      await editor.getByRole("button", { name: "Next section", exact: true }).click();
      await expect(editor.getByText("Required", { exact: true })).toHaveCount(0);
      await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Chart", exact: true }).click();
      await expect(page.getByRole("button", { name: "Edit referral details", exact: true })).toBeEnabled();
      await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Decision", exact: true }).click();
      await page.getByText("Admission details", { exact: true }).click();
      const stages = page.getByRole("combobox", { name: "Workflow stage", exact: true });
      await stages.selectOption("Assessment");
      await expect.poll(async () => (await (await api.get(`/api/referrals/${referral.id}`)).json()).referral.stage).toBe("Assessment");
      await stages.selectOption("New");
      await expect.poll(async () => (await (await api.get(`/api/referrals/${referral.id}`)).json()).referral.stage).toBe("New");
    } finally { await api.dispose(); }
  });
});
