import { expect, test } from "@playwright/test";
import { createOperationalReferral } from "./support/operational-api";

test("assessor-list failure does not report an unsaved workspace and can be retried", async ({ page }) => {
  let failMembers = true;
  await page.route("**/api/members?scope=assessors", (route) => failMembers
    ? route.fulfill({ status: 503, json: { error: "Synthetic assessor list outage" } })
    : route.continue());

  await page.goto("/");
  await page.getByRole("button", { name: "Create new referral", exact: true }).click();
  const listError = page.getByRole("alert").filter({ hasText: "The assessor list could not be loaded." });
  await expect(listError).toBeVisible();
  await expect(page.getByTestId("workspace-save-status")).not.toContainText("Not saved to Pipeline");

  failMembers = false;
  await listError.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(listError).toHaveCount(0);
  await expect.poll(() => page.getByRole("combobox", { name: "Assessor", exact: true }).locator("option").count()).toBeGreaterThan(1);
});

test("a failed access probe stays read-only and offers a retry from the workspace", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { owner: "Annette Everhart" }, { assigneeId: "provisional:allo:annette" });
  let failAccess = true;
  await page.route("**/api/auth/me", (route) => failAccess
    ? route.fulfill({ status: 503, json: { error: "Synthetic account lookup outage" } })
    : route.continue());

  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=chart`);
  const accessError = page.getByRole("alert").filter({ hasText: "Pipeline could not verify your access." });
  await expect(accessError).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit referral details", exact: true })).toHaveCount(0);

  failAccess = false;
  await accessError.getByRole("button", { name: "Retry access check", exact: true }).click();
  await expect(accessError).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit referral details", exact: true })).toBeVisible();
});
