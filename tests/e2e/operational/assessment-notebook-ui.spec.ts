import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral } from "../support/operational-api";
import { actorApiContext, actorPage, pipelineActors, requireOperationalBaseURL } from "../support/pipeline-actors";

// Interview notebook in the redesign (docs/design/DECISIONS.md, "Interview notebook"): beside the questions,
// following the topic, saving while typing, as a tab in the interview and a column while preparing.
test("interview notebook follows the topic, saves while typing, and fits beside the questions", async ({ browser, baseURL }) => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true" || process.env.PIPELINE_DESIGN_V2 !== "true", "Run with the operational configuration and PIPELINE_DESIGN_V2=true.");
  test.setTimeout(120_000);
  const url = requireOperationalBaseURL(baseURL);
  const coordinator = await actorApiContext("assessmentCoordinator", url);
  const assessor = await actorApiContext("assessorA", url);
  expect((await assessor.get("/api/members")).status()).toBe(200);
  expect((await coordinator.get("/api/members")).status()).toBe(200);
  const referral = await createOperationalReferral(coordinator, "assessmentCoordinator", {}, { assigneeId: pipelineActors.assessorA.id });
  const assessment = await createOperationalAssessment(assessor, referral.id);
  const { page, context } = await actorPage(browser, "assessorA", url);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=interview`);
  const notebook = page.locator("[data-interview-notebook]");
  await expect(notebook).toBeVisible();
  await expect(notebook).toContainText("All notes saved");
  const first = notebook.locator("[data-notebook-block][data-current] textarea");
  await expect(first).toBeVisible();
  const firstKey = await notebook.locator("[data-notebook-block][data-current]").getAttribute("data-notebook-block");
  await first.click();
  await first.pressSequentially("Client prefers to be called Sam. Lives with sister.", { delay: 5 });
  await expect(first).toBeFocused();
  await expect.poll(async () => ((await (await assessor.get(`/api/assessments/${assessment.assessment_id}/notebook`)).json()).blocks as { block_key: string; body: string }[]).find((block) => block.block_key === firstKey)?.body, { timeout: 8_000 }).toBe("Client prefers to be called Sam. Lives with sister.");
  await expect(notebook).toContainText("All notes saved");

  // Jumping to another topic: the notebook follows.
  const picker = page.getByRole("combobox", { name: "Assessment section" });
  await picker.selectOption("medication");
  await expect(notebook.locator('[data-notebook-block="topic:medication"][data-current] textarea')).toBeVisible();

  // Interview: notes and Current information are tabs beside the questions.
  await page.getByRole("tab", { name: "Current information" }).click();
  await expect(notebook).toBeHidden();
  await page.getByRole("tab", { name: "Interview notes" }).click();
  await expect(notebook).toBeVisible();
  const questions = await page.locator("[data-assessment-question-editor]").first().boundingBox();
  expect(questions!.width).toBeGreaterThan(500);
  // Preparing: the notebook sits to the right and can be hidden and brought back.
  await page.getByRole("button", { name: "All questions", exact: true }).click();
  await expect(page.locator("[data-interview-notebook]")).toBeVisible();
  await page.getByRole("button", { name: "Hide interview notes" }).click();
  await expect(page.locator("[data-interview-notebook]")).toHaveCount(0);
  await page.getByRole("button", { name: "Interview notes" }).click();
  await expect(page.locator("[data-interview-notebook]")).toBeVisible();
  // Saved notes come back after a reload.
  await page.reload();
  await expect(page.locator(`[data-notebook-block="${firstKey}"]`)).toContainText("Client prefers");
  expect(errors).toEqual([]);
  await context.close();
});
