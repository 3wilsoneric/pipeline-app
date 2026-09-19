import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral, startOperationalAssessment } from "./support/operational-api";
import { openAssessmentChart } from "./support/assessment-navigation";

for (const width of [1440, 390]) {
  test(`assessment name correction follows the client through the workspace at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
      name: "Synthetic Original", owner: "", tags: [], documentName: "", documentStatus: "Missing",
    });
    const assessment = await createOperationalAssessment(page.request, referral.id);
    await startOperationalAssessment(page.request, assessment);
    const url = `/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`;
    await page.goto(url);
    await page.getByRole("button", { name: "Edit Resident name", exact: true }).click();
    const name = page.locator("#assessment-resident_name");
    await expect(name).toBeVisible();
    await name.fill("Synthetic Corrected");
    await name.blur();
    await expect(page.getByTestId("workspace-identity-title")).toContainText("Synthetic Corrected");
    await openAssessmentChart(page);
    await expect(page.getByRole("article", { name: "Referral chart", exact: true })).toContainText("Synthetic Corrected");
    await expect(page.getByRole("article", { name: "Assessment record", exact: true })).toContainText("Synthetic Corrected");
    await page.reload();
    await expect(page.getByTestId("workspace-identity-title")).toContainText("Synthetic Corrected");
    const saved = await (await page.request.get(`/api/referrals/${referral.id}`)).json();
    expect(saved.referral.name).toBe("Synthetic Corrected");
    const savedAssessment = await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json();
    expect(savedAssessment.assessment.resident_name).toBe("Synthetic Corrected");
    await page.goto("/?view=referrals");
    await expect(page.getByRole("button", { name: "Open Synthetic Corrected referral workspace", exact: true }).first()).toBeVisible();
    await expect(page.getByText("Synthetic Original", { exact: true })).toHaveCount(0);
  });
}
