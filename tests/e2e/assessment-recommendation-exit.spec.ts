import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral } from "./support/operational-api";

test("a pending or failed working decision keeps its retry available before leaving assessment", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: "Synthetic recommendation exit recovery", owner: "Annette Everhart", tags: [],
  }, { assigneeId: "provisional:allo:annette" });
  await createOperationalAssessment(page.request, referral.id);

  let release!: () => void;
  let requested!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const firstRequest = new Promise<void>((resolve) => { requested = resolve; });
  const mutationIds: string[] = [];
  const outcomes: string[] = [];
  await page.route(`**/api/referrals/${referral.id}/recommendation`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const command = route.request().postDataJSON() as { client_mutation_id: string; outcome: string };
    mutationIds.push(command.client_mutation_id);
    outcomes.push(command.outcome);
    if (mutationIds.length > 1) return route.continue();
    requested();
    await pending;
    return route.fulfill({ status: 503, json: { error: "Synthetic recommendation save unavailable" } });
  });

  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=review`);
  const recommendation = page.getByRole("region", { name: "Placement recommendation", exact: true });
  const stages = page.getByRole("navigation", { name: "Workspace stages", exact: true });
  await expect(recommendation.getByRole("combobox", { name: "Working decision" })).toBeEnabled();
  await recommendation.getByRole("combobox", { name: "Working decision" }).selectOption("accept");
  await firstRequest;

  try {
    await stages.getByRole("button", { name: "Decision", exact: true }).click();
    await expect(stages.getByRole("button", { name: "Assessment", exact: true })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Open calendar", exact: true }).click();
    await expect(page).toHaveURL(/workspaceStage=assessment/);
    await expect(page.getByRole("button", { name: "Back to questions", exact: true })).toBeDisabled();
  } finally { release(); }

  await expect(recommendation.getByRole("alert")).toContainText("Synthetic recommendation save unavailable");
  await expect(recommendation.getByRole("combobox", { name: "Working decision" })).toHaveValue("accept");
  await expect(recommendation.getByRole("button", { name: "Retry working decision", exact: true })).toBeEnabled();
  await stages.getByRole("button", { name: "Decision", exact: true }).click();
  await expect(stages.getByRole("button", { name: "Assessment", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Open calendar", exact: true }).click();
  await expect(page).toHaveURL(/workspaceStage=assessment/);

  await recommendation.getByRole("button", { name: "Retry working decision", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign & continue to decision", exact: true })).toBeEnabled();
  expect(mutationIds).toHaveLength(2);
  expect(mutationIds[1]).toBe(mutationIds[0]);
  expect(outcomes).toEqual(["accept", "accept"]);
  await expect(recommendation.getByRole("combobox", { name: "Working decision" })).toHaveValue("accept");
  const workflow = (await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json());
  expect(workflow.recommendation?.outcome).toBe("accept");
  await stages.getByRole("button", { name: "Decision", exact: true }).click();
  await expect(stages.getByRole("button", { name: "Decision", exact: true })).toHaveAttribute("aria-current", "page");
});

test("a confirmed working decision stays saved when its workflow refresh fails", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: "Synthetic recommendation refresh failure", owner: "Annette Everhart", tags: [],
  }, { assigneeId: "provisional:allo:annette" });
  await createOperationalAssessment(page.request, referral.id);
  let recommendationSaved = false;
  let failedRefreshes = 0;
  await page.route(`**/api/referrals/${referral.id}/recommendation`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const response = await route.fetch();
    recommendationSaved = response.ok();
    return route.fulfill({ response });
  });
  await page.route(`**/api/referrals/${referral.id}/workflow`, (route) => {
    if (!recommendationSaved) return route.continue();
    failedRefreshes += 1;
    return route.fulfill({ status: 503, json: { error: "Synthetic workflow refresh unavailable" } });
  });

  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=review`);
  const recommendation = page.getByRole("region", { name: "Placement recommendation", exact: true });
  await recommendation.getByRole("combobox", { name: "Working decision" }).selectOption("accept");
  await expect.poll(() => failedRefreshes).toBeGreaterThanOrEqual(1);
  expect(recommendationSaved).toBe(true);
  await expect(recommendation.getByRole("combobox", { name: "Working decision" })).toHaveValue("accept");
  await expect(recommendation.getByRole("alert")).toHaveCount(0);
  await expect(recommendation.getByRole("button", { name: "Retry working decision" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign & continue to decision", exact: true })).toBeEnabled();
  const saved = (await (await page.request.get(`/api/referrals/${referral.id}/recommendation`)).json()).recommendation;
  expect(saved.outcome).toBe("accept");
});
