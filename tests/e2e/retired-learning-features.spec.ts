import { expect, test } from "@playwright/test";
import { activeOperationalAssessor, createOperationalAssessment, createOperationalReferral, startOperationalAssessment } from "./support/operational-api";

test("retired learning routes cannot open or change an existing client", async ({ page }) => {
  const owner = await activeOperationalAssessor(page.request);
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    owner: owner.display_name,
  }, { assigneeId: owner.principal_id });
  const assessment = await startOperationalAssessment(page.request, await createOperationalAssessment(page.request, referral.id));
  const referralPath = `/api/referrals/${referral.id}`;
  const assessmentPath = `/api/assessments/${assessment.assessment_id}`;
  const beforeReferral = (await (await page.request.get(referralPath)).json()).referral;
  const beforeAssessment = (await (await page.request.get(assessmentPath)).json()).assessment;

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Open guided tutorials" })).toHaveCount(0);
  await page.getByRole("button", { name: /Open profile menu for/ }).click();
  await expect(page.getByRole("link", { name: /Learning Center|Academy/ })).toHaveCount(0);
  for (const path of ["/academy", "/tutorials/referral", "/training", "/training/demo", "/training/assessment-preview"]) {
    expect((await page.request.get(path)).status(), path).toBe(404);
  }
  for (const path of ["/api/academy/progress", "/api/training/progress"]) {
    expect((await page.request.get(path)).status(), path).toBe(404);
    expect((await page.request.put(path, { data: { progress: {} } })).status(), path).toBe(404);
  }
  for (const query of ["trainingAssessment=guided", "trainingIntake=1", "demo=1"]) {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&${query}`);
    // A streamed Next shell can be HTTP 200; the editor must never mount.
    await expect(page.getByRole("heading", { name: "That Pipeline page does not exist." })).toBeVisible();
    await expect(page.getByTestId("packet-workspace")).toHaveCount(0);
  }
  expect((await (await page.request.get(referralPath)).json()).referral).toEqual(beforeReferral);
  expect((await (await page.request.get(assessmentPath)).json()).assessment).toEqual(beforeAssessment);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
});

test("client-side history cannot reopen retired tutorial editors", async ({ page }) => {
  for (const query of ["trainingAssessment=guided", "trainingIntake=1", "demo=1"]) {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Pipeline home", exact: true })).toBeVisible();
    await page.evaluate((search) => window.history.pushState(null, "", `/?${search}`), query);
    await expect(page.getByRole("heading", { name: "That Pipeline page does not exist." })).toBeVisible();
    await expect(page.getByTestId("packet-workspace")).toHaveCount(0);
    await page.goBack();
    await expect(page.getByRole("button", { name: "Pipeline home", exact: true })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("heading", { name: "That Pipeline page does not exist." })).toBeVisible();
    await expect(page.getByTestId("packet-workspace")).toHaveCount(0);
  }
});
