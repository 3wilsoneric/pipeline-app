import { expect, test } from "@playwright/test";
import { createOperationalAssessment, createOperationalReferral } from "../support/operational-api";
import { actorApiContext, actorPage, pipelineActors, requireOperationalBaseURL } from "../support/pipeline-actors";

// Client notes in the redesign (docs/design/DECISIONS.md, "Notes"): beside the questions, following the
// topic, saving while typing, docked under the chart text in the interview and a column while preparing.
test("client notes follow the topic, saves while typing, and fits beside the questions", async ({ browser, baseURL }) => {
  test.skip(process.env.PIPELINE_OPERATIONAL_E2E !== "true" || process.env.PIPELINE_DESIGN_V2 !== "true", "Run with the operational configuration and PIPELINE_DESIGN_V2=true.");
  test.setTimeout(120_000);
  const url = requireOperationalBaseURL(baseURL);
  const coordinator = await actorApiContext("assessmentCoordinator", url);
  const assessor = await actorApiContext("assessorA", url);
  expect((await assessor.get("/api/members")).status()).toBe(200);
  expect((await coordinator.get("/api/members")).status()).toBe(200);
  const referral = await createOperationalReferral(coordinator, "assessmentCoordinator", {}, { assigneeId: pipelineActors.assessorA.id });
  await createOperationalAssessment(assessor, referral.id);
  const { page, context } = await actorPage(browser, "assessorA", url);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=interview`);
  const notebook = page.locator("[data-client-notes]");
  await expect(notebook).toBeVisible();
  await expect(notebook).toContainText("All notes saved");
  await expect(notebook.locator("[data-note-heading][data-current] textarea")).toBeVisible();
  const firstKey = await notebook.locator("[data-note-heading][data-current]").getAttribute("data-note-heading");
  // By its heading: once typing starts the note stays put even if the questions scroll to another topic.
  const first = notebook.locator(`[data-note-heading="${firstKey}"] textarea`);
  await first.click();
  await first.pressSequentially("Client prefers to be called Sam. Lives with sister.", { delay: 5 });
  await expect(first).toBeFocused();
  await expect.poll(async () => ((await (await assessor.get(`/api/referrals/${referral.id}/notes`)).json()).blocks as { block_key: string; body: string }[]).find((block) => block.block_key === firstKey)?.body, { timeout: 8_000 }).toBe("Client prefers to be called Sam. Lives with sister.");
  await expect(notebook).toContainText("All notes saved");

  // Jumping to another topic: the notebook follows once the person leaves the note (a note being typed in stays put).
  await first.blur();
  const picker = page.getByRole("combobox", { name: "Assessment section" });
  await picker.selectOption("medication");
  await expect(notebook.locator('[data-note-heading="topic:medication"][data-current] textarea')).toBeVisible();

  // Interview (docs/design/DECISIONS.md, "Split interview"): the information and notes on the left, one line, the
  // questions on the right; the line resizes with the keyboard and resets.
  const split = page.locator("[data-interview-split]");
  await expect(split).toBeVisible();
  await expect(split.locator("[data-client-notes]")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Assessment sections" }).getByRole("button", { name: "Chart", exact: true })).toHaveCount(0);
  const line = split.getByRole("separator", { name: "Current information" });
  await expect(line).toHaveAttribute("aria-valuenow", "45");
  await line.focus();
  await page.keyboard.press("ArrowRight");
  await expect(line).toHaveAttribute("aria-valuenow", "47");
  await page.keyboard.press("Enter");
  await expect(line).toHaveAttribute("aria-valuenow", "45");
  const questions = await page.locator("[data-assessment-question-editor]").first().boundingBox();
  expect(questions!.width).toBeGreaterThan(420);
  // Beside the questions: only the information already filled in for the topic being asked, updated as it is
  // recorded (docs/design/DECISIONS.md, "Split interview").
  await picker.selectOption("identity");
  await expect(split.locator("[data-split-topic]")).toHaveCount(1);
  await expect(split.locator('[data-split-topic="identity"]')).toBeVisible();
  await page.getByRole("textbox", { name: "Current location" }).fill("Board and care in Turlock");
  await page.keyboard.press("Tab");
  await expect(split.locator('[data-split-topic="identity"]')).toContainText("Board and care in Turlock");
  // Interview layout (docs/design/DECISIONS.md, "Interview layout"): the record rail is tucked away; the arrow
  // brings it back and hides it again. Scheduling stays in All questions.
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-interview-focus", "true");
  const railChart = page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Chart", exact: true });
  await expect(railChart).toBeHidden();
  await page.getByRole("button", { name: "Expand navigation" }).last().click();
  await expect(railChart).toBeVisible();
  await page.getByRole("button", { name: "Collapse navigation" }).last().click();
  await expect(railChart).toBeHidden();
  const headerRow = page.getByRole("navigation", { name: "Assessment sections" });
  await expect(headerRow.getByRole("button", { name: "Schedule interview" })).toHaveCount(0);
  // All questions shows the rail again; the Assessment step reopens there after a reload.
  await page.getByRole("button", { name: "All questions", exact: true }).click();
  await expect(root).not.toHaveAttribute("data-interview-focus", "true");
  await expect(railChart).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Prepare assessment", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Preparing: the notebook sits to the right and can be hidden and brought back.
  await expect(page.locator("[data-client-notes]")).toBeVisible();
  await page.getByRole("button", { name: "Hide notes" }).click();
  await expect(page.locator("[data-client-notes]")).toHaveCount(0);
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.locator("[data-client-notes]")).toBeVisible();
  // On other steps the same notes open from the floating button.
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Chart", exact: true }).click();
  await page.locator('button[aria-label="Notes"][aria-expanded]').click();
  await expect(page.getByRole("dialog", { name: "Notes" }).locator(`[data-note-heading="${firstKey}"]`)).toContainText("Client prefers");
  await page.keyboard.press("Escape");
  await page.getByRole("navigation", { name: "Workspace stages" }).getByRole("button", { name: "Assessment", exact: true }).click();
  // Saved notes come back after a reload.
  await page.reload();
  // Beside the questions only the topic in view shows; View all lists every heading wherever the page reopened.
  const reopened = page.locator("[data-client-notes]").first();
  await reopened.getByRole("button", { name: "View all", exact: true }).click();
  await expect(reopened.locator(`[data-note-heading="${firstKey}"]`)).toContainText("Client prefers");
  expect(errors).toEqual([]);
  await context.close();
});
