import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { calendarToday } from "../../../lib/pipeline/calendar-date";
import { createOperationalReferral, readOperationalReferral, recordOperationalAcceptance } from "../support/operational-api";
import { actorApiContext, actorPage, requireOperationalBaseURL } from "../support/pipeline-actors";

test.describe("admission follow-through", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Uses isolated operational stores.");
  test("accepted referral opens email review without an admit date", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("assessorA", url);
    const { page, context } = await actorPage(browser, "assessorA", url);
    try {
      const created = await createOperationalReferral(api, "assessorA", { name: `Synthetic Preview ${randomUUID()}` });
      const referral = await recordOperationalAcceptance(api, created);
      let sendRequests = 0;
      page.on("request", (request) => {
        if (request.method() === "POST" && /meet-client-email|outlook-draft/.test(request.url())) sendRequests++;
      });
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
      const review = page.getByRole("region", { name: "Admission follow-through" }).getByRole("button", { name: "Review email & packet" });
      await expect(review).toBeEnabled();
      await review.click();
      await expect(page.getByRole("region", { name: "Email and referral packet" })).toBeVisible();
      const summary = await (await api.get(`/api/referrals/${referral.id}/admission-summary`)).json();
      expect(summary.email.blockers.join(" ")).toContain("planned admit date before sending Meet the Client");
      expect(sendRequests).toBe(0);
    } finally { await context.close(); await api.dispose(); }
  });

  test("assessors can finish handoff but cannot confirm admission", async ({ browser, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const assessor = await actorApiContext("assessorA", url);
    const coordinator = await actorApiContext("assessmentCoordinator", url);
    const admin = await actorApiContext("admin", url);
    const { page, context } = await actorPage(browser, "assessorA", url);
    try {
      const created = await createOperationalReferral(assessor, "assessorA", { name: `Synthetic coordinator arrival ${randomUUID()}` });
      const referral = await recordOperationalAcceptance(assessor, created);
      const path = `/api/referrals/${referral.id}`;
      const assessorWorkflow = await (await assessor.get(`${path}/workflow`)).json();
      const coordinatorWorkflow = await (await coordinator.get(`${path}/workflow`)).json();
      const adminWorkflow = await (await admin.get(`${path}/workflow`)).json();
      expect(assessorWorkflow.capabilities.can_confirm_admission).toBe(false);
      expect(coordinatorWorkflow.capabilities.can_confirm_admission).toBe(true);
      expect(adminWorkflow.capabilities.can_confirm_admission).toBe(true);
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
      const admission = page.getByRole("region", { name: "Admission follow-through" });
      await expect(admission.getByRole("button", { name: "Review email & packet" })).toBeEnabled();
      await page.getByRole("button", { name: "Follow-up tools" }).click();
      const updates = page.getByRole("region", { name: "Placement updates" });
      await expect(updates).toContainText("Awaiting arrival confirmation from the daily census or an admissions coordinator");
      await expect(updates.getByRole("button", { name: "Confirm admission" })).toHaveCount(0);

      const transition = await assessor.post(`${path}/transition`, { data: {
        if_match: referral.version, if_match_section: referral.sectionVersions.workflow,
        target_stage: "Accepted / Admitted", actual_admission_date: calendarToday(), client_mutation_id: randomUUID(),
      } });
      expect(transition.status()).toBe(403);
      const genericPatch = await assessor.patch(path, { data: {
        if_match: referral.version, if_match_sections: { workflow: referral.sectionVersions.workflow },
        patch: { stage: "Accepted / Admitted" }, client_mutation_id: randomUUID(),
      } });
      expect(genericPatch.status()).toBe(403);
      const unchanged = await readOperationalReferral(assessor, referral.id);
      expect(unchanged.version).toBe(referral.version);
      expect((unchanged as typeof unchanged & { stage: string }).stage).not.toBe("Accepted / Admitted");
    } finally { await context.close(); await assessor.dispose(); await coordinator.dispose(); await admin.dispose(); }
  });

  for (const width of [1440, 390]) test(`planned dates, confirmation and reopening persist at ${width}`, async ({ browser, baseURL }, info) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("assessmentCoordinator", url);
    const { page, context } = await actorPage(browser, "assessmentCoordinator", url);
    try {
      const created = await createOperationalReferral(api, "assessmentCoordinator", { name: "Synthetic Arrival " + randomUUID().slice(0, 8) });
      let referral = await recordOperationalAcceptance(api, created);
      const original = await readOperationalReferral(api, referral.id);
      const noDate = await api.post(`/api/referrals/${referral.id}/transition`, { data: { if_match: referral.version, if_match_section: referral.sectionVersions.workflow, target_stage: "Accepted / Admitted", client_mutation_id: randomUUID() } });
      expect(noDate.status()).toBe(422);
      const invalid = await api.post(`/api/referrals/${referral.id}/transition`, { data: { if_match: referral.version, if_match_section: referral.sectionVersions.workflow, target_stage: "Accepted / Admitted", actual_admission_date: "2099-01-01", client_mutation_id: randomUUID() } });
      expect(invalid.status()).toBe(422);
      expect((await readOperationalReferral(api, referral.id)).version).toBe(original.version);
      const forged = await api.patch(`/api/referrals/${referral.id}`, { data: { if_match: referral.version, patch: { actualAdmissionDate: calendarToday() }, client_mutation_id: randomUUID() } });
      expect(forged.status()).toBe(400);
      await page.setViewportSize({ width, height: 850 });
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
      const admission = page.getByRole("region", { name: "Admission follow-through" });
      await expect(admission).toBeVisible();
      await expect(page.getByText("This referral is closed as declined.", { exact: true })).toHaveCount(0);
      await admission.getByRole("button", { name: "Review email & packet" }).click();
      await expect(page.getByRole("region", { name: "Email and referral packet" })).toBeVisible();
      const summary = await (await api.get(`/api/referrals/${referral.id}/admission-summary`)).json();
      expect(summary.email.blockers.join(" ")).toContain("planned admit date before sending Meet the Client");
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
      await admission.getByLabel("Planned admission date", { exact: true }).fill("2026-10-12");
      await admission.getByRole("button", { name: "Review email & packet" }).click();
      await expect(page.getByRole("region", { name: "Email and referral packet" })).toBeVisible();
      const planned = (await (await api.get(`/api/referrals/${referral.id}`)).json()).referral as typeof referral & { plannedAdmissionDate: string; admissionDate: string; actualAdmissionDate?: string; stage: string };
      expect(planned.plannedAdmissionDate).toBe("2026-10-12");
      expect(planned.admissionDate).toBe("");
      expect(planned.actualAdmissionDate).toBeUndefined();
      expect(planned.stage).not.toBe("Accepted / Admitted");
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=workflow`);
      await expect(admission.getByLabel("Planned admission date", { exact: true })).toHaveValue("2026-10-12");
      await page.getByRole("button", { name: "Follow-up tools" }).click();
      const updates = page.getByRole("region", { name: "Placement updates" });
      const actualDate = updates.getByLabel("Actual admission date", { exact: true });
      const markAdmitted = updates.getByRole("button", { name: "Confirm admission" });
      await expect(actualDate).toBeVisible();
      await expect(markAdmitted).toBeEnabled();
      expect((await readOperationalReferral(api, referral.id)).version).toBe(planned.version);
      await page.screenshot({ path: info.outputPath(`admission-${width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await markAdmitted.click();
      await expect(updates).toContainText("Enter the client's actual arrival date");
      expect((await readOperationalReferral(api, referral.id)).version).toBe(planned.version);
      await actualDate.fill(calendarToday());
      await markAdmitted.click();
      const confirmationRequest = page.waitForRequest((request) => request.method() === "POST"
        && request.url().endsWith(`/api/referrals/${referral.id}/transition`)
        && request.postDataJSON()?.target_stage === "Accepted / Admitted");
      await page.getByRole("alertdialog").getByRole("button", { name: "Confirm admission", exact: true }).click();
      const confirmation = (await confirmationRequest).postDataJSON() as {
        if_match: number;
        if_match_section: number;
        target_stage: string;
        actual_admission_date: string;
        client_mutation_id: string;
      };
      expect(confirmation).toMatchObject({ if_match: planned.version, target_stage: "Accepted / Admitted", actual_admission_date: calendarToday() });
      await expect(admission).toContainText("Admission confirmed");
      const confirmed = (await (await api.get(`/api/referrals/${referral.id}`)).json()).referral;
      expect(confirmed.actualAdmissionDate).toBe(calendarToday());
      expect(confirmed.plannedAdmissionDate).toBe("2026-10-12");
      expect(confirmed.workflowStatus).toBe("admitted");
      const replay = await api.post(`/api/referrals/${referral.id}/transition`, { data: confirmation });
      expect(replay.status()).toBe(200);
      expect((await replay.json()).referral.version).toBe(confirmed.version);
      const stale = await api.post(`/api/referrals/${referral.id}/transition`, { data: { ...confirmation, target_stage: "Assessment", client_mutation_id: randomUUID() } });
      expect(stale.status()).toBe(409);
      await page.reload();
      await expect(admission).toContainText("Admission confirmed");
      const reopen = await api.post(`/api/referrals/${referral.id}/transition`, { data: { if_match: confirmed.version, if_match_section: confirmed.sectionVersions.workflow, target_stage: "Assessment", client_mutation_id: randomUUID() } });
      expect(reopen.status()).toBe(200);
      referral = (await reopen.json()).referral;
      const edit = await api.patch(`/api/referrals/${referral.id}`, { data: { if_match: referral.version, if_match_sections: { intake: referral.sectionVersions.intake }, patch: { phone: "555-0166" }, client_mutation_id: randomUUID() } });
      expect(edit.status(), await edit.text()).toBe(200);
      const activity = await (await api.get(`/api/referrals/${referral.id}/activity`)).text();
      expect(activity).toContain("actualAdmissionDate");
    } finally { await context.close(); await api.dispose(); }
  });
});
