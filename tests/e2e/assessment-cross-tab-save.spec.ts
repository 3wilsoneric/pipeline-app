import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalAssessment, createOperationalReferral, startOperationalAssessment } from "./support/operational-api";

test("an older assessment save cannot retire a newer failed edit after a tab round-trip", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Example Cross Tab ${randomUUID()}`, owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await startOperationalAssessment(page.request, assessment);
  let releaseFirst = () => {};
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let patches = 0;
  await page.route(`**/api/assessments/${assessment.assessment_id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    patches += 1;
    if (patches === 1) {
      await firstGate;
      return route.continue();
    }
    return route.fulfill({ status: 503, json: { error: "Synthetic newer save failure" } });
  });
  try {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
    const answer = page.locator("#assessment-prior_placements");
    await answer.fill("Synthetic older answer");
    await page.getByRole("button", { name: "Workspace files", exact: true }).click();
    await expect.poll(() => patches).toBe(1);
    await expect(page.getByRole("region", { name: "Files", exact: true })).toBeVisible();
    await expect(page.getByText("Assessment changes not yet saved.")).toBeVisible();
    await expect(page.getByTestId("workspace-save-status")).toHaveCount(0);
    await expect(page.locator("[data-assessment-working-section]")).toBeHidden();
    await expect(page.locator("[data-assessment-working-section]").locator("xpath=ancestor::*[@inert][1]")).toHaveAttribute("inert", "");
    await page.getByRole("button", { name: "Open Assessment", exact: true }).click();
    await expect(answer).toHaveValue("Synthetic older answer");
    await answer.fill("Synthetic newer answer");
    await answer.blur();
    releaseFirst();
    await expect.poll(() => patches).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.prior_placements).toBe("Synthetic older answer");
    await expect(page.getByText("1 change waiting to sync")).toBeVisible();
    await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Decision", exact: true }).click();
    await expect(answer).toBeHidden();
    await expect(page.getByText("1 assessment change waiting to sync.")).toBeVisible();
    await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Assessment", exact: true }).click();
    await expect(answer).toHaveValue("Synthetic newer answer");
    // The encrypted working copy is debounced independently of the server PATCH.
    await page.waitForTimeout(350);
    await page.reload();
    await expect(answer).toHaveValue("Synthetic newer answer");
  } finally {
    releaseFirst();
  }
});

test("two browser tabs retain disjoint answers when their saves arrive out of order", async ({ page, context }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: `Example Two Tabs ${randomUUID()}`, owner: "Annette Everhart",
  }, { assigneeId: "provisional:allo:annette" });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await startOperationalAssessment(page.request, assessment);
  const second = await context.newPage();
  let release!: () => void;
  let entered!: () => void;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { entered = resolve; });
  let firstPatches = 0;
  await page.route(`**/api/assessments/${assessment.assessment_id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    firstPatches += 1;
    if (firstPatches === 1) { entered(); await delayed; }
    return route.continue();
  });
  try {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=diagnosis_clinical`);
    await second.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
    await page.locator("#assessment-current_symptoms").fill("Synthetic first-tab symptoms");
    await page.locator("#assessment-current_symptoms").blur();
    await requested;
    await second.locator("#assessment-prior_placements").fill("Synthetic second-tab history");
    await second.locator("#assessment-prior_placements").blur();
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.prior_placements).toBe("Synthetic second-tab history");
    release();
    await expect.poll(async () => {
      const saved = (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment;
      return [saved.current_symptoms, saved.prior_placements];
    }).toEqual(["Synthetic first-tab symptoms", "Synthetic second-tab history"]);
    await page.reload();
    await second.reload();
    await expect(page.locator("#assessment-current_symptoms")).toHaveValue("Synthetic first-tab symptoms");
    await expect(second.locator("#assessment-prior_placements")).toHaveValue("Synthetic second-tab history");
  } finally {
    release();
    await second.close();
  }
});
