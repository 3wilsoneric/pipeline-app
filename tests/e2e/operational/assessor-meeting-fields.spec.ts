import { expect, test } from "@playwright/test";
import { actorApiContext, operationalActorHeaders, requireOperationalBaseURL } from "../support/pipeline-actors";
import { createOperationalAssessment, createOperationalReferral, signOperationalAssessment } from "../support/operational-api";

test.describe("assessor meeting fields", () => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true", "Isolated stores required.");
  test.setTimeout(60_000);

  test("injection timing and acknowledgement persist through the working assessment", async ({ page, baseURL }) => {
    const url = requireOperationalBaseURL(baseURL);
    const api = await actorApiContext("assessorA", url);
    await page.setExtraHTTPHeaders(operationalActorHeaders("assessorA", url));
    try {
      const referral = await createOperationalReferral(api, "assessorA", { documentName: "" });
      const assessment = await createOperationalAssessment(api, referral.id);
      const started = await api.post(`/api/assessments/${assessment.assessment_id}/start`, { data: { if_match: assessment.version } });
      expect(started.status()).toBe(200);
      const assessmentUrl = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`;
      await page.goto(assessmentUrl);
      const editor = page.locator('[data-assessment-view="chart"]');
      const search = editor.getByRole("searchbox", { name: "Find assessment question" });
      const find = async (name: string) => {
        await editor.locator('summary[aria-label="Find assessment question"]').click();
        await search.fill(name);
        await editor.locator('[aria-label="Matching assessment questions"]').getByRole("button", { name: new RegExp(`^${name}`) }).click();
      };
      const read = async () => (await (await api.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
      await find("IM injections");
      await editor.getByRole("group", { name: "IM injections", exact: true }).getByRole("button", { name: "Yes", exact: true }).click();
      const entries = [
        ["Injection frequency", "injection_frequency", "Medication A — every 4 weeks\nMedication B — frequency unknown"],
        ["Last injection", "last_injection", "Medication A — September 3, 2026\nMedication B — approximately early September"],
        ["Next injection due", "next_injection_due", "Medication A — October 1, 2026\nMedication B — unknown"],
      ];
      for (const [label, key, answer] of entries) {
        const field = editor.getByRole("textbox", { name: label, exact: true });
        await field.fill(answer);
        await field.blur();
        await expect.poll(async () => (await read())[key]).toBe(answer);
      }
      await find("History of substance abuse");
      await editor.getByRole("group", { name: "History of substance abuse", exact: true }).getByRole("button", { name: "Yes", exact: true }).click();
      await find("Acknowledgment of substance-use impact");
      const insight = editor.getByRole("combobox", { name: "Acknowledgment of substance-use impact", exact: true });
      for (const value of ["partially", "not_discussed", "yes", "no"]) {
        await insight.focus();
        await insight.selectOption(value);
        await insight.blur();
        await expect.poll(async () => (await read()).substance_use_insight).toBe(value);
      }
      await find("Physical altercations");
      await editor.getByRole("group", { name: "Physical altercations", exact: true }).getByRole("button", { name: "Yes", exact: true }).click();
      const details = editor.getByRole("textbox", { name: "Physical altercation details", exact: true });
      await expect(details).toHaveAttribute("placeholder", "What happened, when, the context, and the outcome");
      await expect(details).not.toHaveAttribute("required");
      await editor.locator('summary[aria-label="Find assessment question"]').click();
      for (const retired of ["Aggression risk", "Triggers"]) {
        await search.fill(retired);
        await expect(editor.locator('[aria-label="Matching assessment questions"]').getByRole("button")).toHaveCount(0);
      }
      await editor.getByRole("button", { name: "Back to referral", exact: true }).click();
      await page.goto(assessmentUrl);
      await expect(editor).toBeVisible();
      await find("Injection frequency");
      await expect(editor.getByRole("textbox", { name: "Injection frequency", exact: true })).toHaveValue(entries[0][2]);
      const saved = await read();
      expect(saved.im_injections_details).toBeNull();
      expect(saved.physical_altercation_details).toBeNull();
      expect(saved.substance_use_insight_details).toBeNull();
    } finally { await api.dispose(); }
  });

  test("blank follow-ups allow signing and retired data survives without appearing in the report", async ({ baseURL }) => {
    const api = await actorApiContext("assessorA", requireOperationalBaseURL(baseURL));
    try {
      const referral = await createOperationalReferral(api, "assessorA", { documentName: "" });
      const assessment = await createOperationalAssessment(api, referral.id);
      const response = await api.patch(`/api/assessments/${assessment.assessment_id}`, { data: {
        if_match: assessment.version,
        patch: { data: { im_injections: "yes", physical_altercations: "yes", substance_abuse_history: "yes", substance_use_insight: "partially", aggression_risk: "Synthetic preserved historical answer", triggers: "Synthetic preserved trigger history" } },
      } });
      expect(response.status(), await response.text()).toBe(200);
      const saved = (await response.json()).assessment;
      await signOperationalAssessment(api, saved);
      const read = (await (await api.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
      expect(read.aggression_risk).toBe("Synthetic preserved historical answer");
      expect(read.triggers).toBe("Synthetic preserved trigger history");
      for (const key of ["injection_frequency", "last_injection", "next_injection_due", "im_injections_details", "physical_altercation_details", "substance_use_insight_details"]) expect(read[key]).toBeNull();
      const summary = await api.get(`/api/referrals/${referral.id}/admission-summary`);
      expect(summary.status()).toBe(200);
      const report = (await summary.json()).report;
      expect(report.signed).toBe(true);
      expect(JSON.stringify(report)).not.toContain("Aggression risk");
      expect(JSON.stringify(report)).not.toContain("Synthetic preserved historical answer");
      expect(JSON.stringify(report)).not.toContain("Synthetic preserved trigger history");
      expect(JSON.stringify(report)).toContain("Partially acknowledges impact");
    } finally { await api.dispose(); }
  });
});
