import { expect, test, type Page } from "@playwright/test";
import { clientDirectoryFixture } from "./support/pipeline-clinical-fixtures";
import { createOperationalReferral } from "./support/operational-api";
import { getOperatorGuidedTutorial, operatorGuideTopics } from "../../lib/training/operator-guided-tutorials";
import { createRequire } from "node:module";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/profiles/directory**", (route) => route.fulfill({ json: { ...clientDirectoryFixture, clients: [], total: 0, next_cursor: null } }));
  let revision = 0;
  let progress = { version: 2, curriculumVersion: "2026.09.operator.1", role: "admin", completedActivityIds: [], activeModuleId: "pipeline-purpose", activeActivityId: "learn", evidence: {}, confidence: {}, scenarioResults: {}, tutorialResults: {} };
  await page.route("**/api/training/progress", async (route) => {
    if (route.request().method() === "PUT") { progress = route.request().postDataJSON().progress; revision++; }
    await route.fulfill({ json: { revision, progress, updatedAt: new Date().toISOString(), persistence: "browser" } });
  });
});

async function library(page: Page) {
  await expect(page.locator('[data-pipeline-ready="guided-coach"]')).toBeAttached();
  const more = page.getByRole("button", { name: /^Open page menu/ });
  if (await more.isVisible()) await more.click();
  await page.getByRole("button", { name: "Open guided tutorials" }).click();
  return page.getByRole("dialog", { name: "Tutorials", exact: true });
}

async function startGuide(page: Page, title: string) {
  const panel = page.getByRole("dialog", { name: "Tutorials", exact: true });
  const topic = operatorGuideTopics.find((item) => item.tutorialIds.some((id) => getOperatorGuidedTutorial(id)?.title === title))!;
  if (topic.id !== "create") {
    const toggle = panel.getByRole("button", { name: topic.title, exact: true });
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  }
  await panel.getByRole("button", { name: "Start tutorial: " + title, exact: true }).click();
}

for (const width of [1440, 390]) {
  test("Tutorials has compact, readable topics at " + width, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const panel = await library(page);
    await expect(panel.getByRole("heading", { name: "Tutorials", exact: true })).toBeFocused();
    await expect(panel.locator('button[aria-expanded="false"]')).toHaveCount(4);
    await expect(panel.getByRole("button", { name: "Start tutorial: Create a referral" })).toBeVisible();
    await expect(panel.getByText("Sample referral", { exact: true })).toBeVisible();
    await expect(panel.locator("button:disabled")).toHaveCount(0);
    await expect(panel.getByRole("textbox")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("tutorial-library-" + width + ".png") });
    await panel.getByRole("button", { name: "Schedule & assess", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Start tutorial: Fill out the assessment" })).toBeEnabled();
    await expect(panel.getByRole("button", { name: "Start tutorial: Sign the assessment" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Start tutorial: Practice an assessment" })).toBeVisible();
    await page.screenshot({ path: info.outputPath("tutorial-assessment-menu-" + width + ".png") });
    await page.addScriptTag({ path: createRequire(process.cwd() + "/package.json").resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{ violations: { id: string }[] }> } }).axe;
      return (await axe.run({ include: ['[role="dialog"][aria-label="Tutorials"]'] }, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } })).violations;
    });
    expect(violations).toEqual([]);
    await startGuide(page, "Open the calendar");
    await expect(page).toHaveURL(/screen=calendar/);
    await expect(page.getByTestId("guided-coach-panel").getByRole("heading", { name: "Choose a view" })).toBeVisible();
  });
}

for (const width of [1440, 1024, 390]) {
  test("assessment tutorial targets actual controls at " + width, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && /\/api\/(assessments|referrals|files)(\/|\?|$)/.test(new URL(request.url()).pathname)) writes.push(request.method() + " " + new URL(request.url()).pathname);
    });
    await page.goto("/");
    await library(page);
    await startGuide(page, "Practice an assessment");
    await expect(page).toHaveURL(/trainingAssessment=interview/);
    const draftId = new URL(page.url()).searchParams.get("draftId");
    expect(draftId).toBeTruthy();
    const coach = page.getByTestId("guided-coach-panel");
    const headings = ["A separate practice case", "Jump to a section", "Current information", "Work on remaining fields", "Check saving", "Continue or jump"];
    for (const [index, title] of headings.entries()) {
      await expect(coach.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(coach.getByRole("button", { name: index === headings.length - 1 ? "Finish" : "Continue", exact: true })).toBeVisible();
      await expect(coach.getByText(/not available/)).toHaveCount(0);
      await expect(page.getByTestId("guide-spotlight")).toBeVisible();
      const box = (await coach.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(901);
      const main = (await page.locator("main").first().boundingBox())!;
      if (width >= 1200) expect(main.x + main.width).toBeLessThanOrEqual(box.x + 1);
      else expect(main.y + main.height).toBeLessThanOrEqual(box.y + 1);
      if (index === 2) {
        const outline = (await page.getByTestId("guide-spotlight").boundingBox())!;
        const header = (await page.getByTestId("workspace-folder-header").boundingBox())!;
        const footer = (await page.locator('footer[aria-label="Assessment actions"]').boundingBox())!;
        expect(outline.y).toBeGreaterThanOrEqual(header.y + header.height);
        expect(outline.y + outline.height).toBeLessThanOrEqual(footer.y + 1);
      }
      if (index === 2) await page.screenshot({ path: info.outputPath("assessment-tutorial-" + width + ".png") });
      await coach.getByRole("button", { name: index === headings.length - 1 ? "Finish" : "Continue", exact: true }).click();
    }
    await expect(page.getByRole("dialog", { name: "Tutorials", exact: true })).toBeVisible();
    await expect.poll(async () => page.evaluate(() => JSON.parse(sessionStorage.getItem("pipeline-guided-coach:v5") ?? "{}").completedTutorialIds)).toContain("practice-assessment");
    expect(writes).toEqual([]);
    await startGuide(page, "Practice an assessment");
    await expect.poll(() => new URL(page.url()).searchParams.get("draftId")).not.toBe(draftId);
    await expect(coach.getByRole("heading", { name: "A separate practice case" })).toBeVisible();
  });
}

test("a Home tutorial continues on the referral the user chooses", async ({ page }, info) => {
  const name = "Tutorial Select" + Date.now().toString(36).replace(/[0-9]/g, "x");
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name, owner: "Annette Everhart", tags: [], documentName: "", documentStatus: "Missing" }, { assigneeId: "provisional:allo:annette" });
  const before = await (await page.request.get(`/api/referrals/${referral.id}`)).json();
  const writes: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET" && /\/api\/(assessments|referrals|files)(\/|\?|$)/.test(path)) writes.push(request.method() + " " + path);
  });
  await page.goto("/");
  const panel = await library(page);
  await startGuide(page, "Add or open files");
  await expect(page).toHaveURL(/\?view=referrals$/);
  await expect(panel.getByRole("heading", { name: "Choose a referral" })).toBeVisible();
  await expect(page.getByTestId("guided-coach-panel")).toHaveCount(0);
  await page.locator('[data-guide-target="workspace-search"] input').fill(name);
  await page.screenshot({ path: info.outputPath("tutorial-choose-referral.png") });
  const match = page.locator('[data-guide-target="workspace-results"]:visible');
  await expect(match).toHaveCount(1);
  await match.click();
  const coach = page.getByTestId("guided-coach-panel");
  await expect(coach.getByRole("heading", { name: "Add more documents" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("referralId")).toBe(String(referral.id));
  expect(new URL(page.url()).searchParams.get("workspaceView")).toBe("files");
  // Opening a workspace sends the existing presence lease, not a clinical edit.
  expect(writes.filter((write) => write !== `POST /api/referrals/${referral.id}/presence` && write !== `DELETE /api/referrals/${referral.id}/presence`)).toEqual([]);
  expect(await (await page.request.get(`/api/referrals/${referral.id}`)).json()).toEqual(before);
});

test("choosing a referral can be canceled or replaced with a sample", async ({ page }) => {
  await page.goto("/");
  const panel = await library(page);
  await startGuide(page, "Fill out the assessment");
  await expect(panel.getByRole("heading", { name: "Choose a referral" })).toBeVisible();
  await panel.getByRole("button", { name: "All tutorials", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Choose a referral" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Schedule & assess", exact: true })).toBeVisible();
  await startGuide(page, "Fill out the assessment");
  await panel.getByRole("button", { name: "Use a sample assessment instead" }).click();
  await expect(page).toHaveURL(/trainingAssessment=interview/);
  expect(new URL(page.url()).searchParams.has("referralId")).toBe(false);
  await expect(page.getByTestId("guided-coach-panel").getByRole("heading", { name: "A separate practice case" })).toBeVisible();
});

test("skipping is not completion, and ending leaves normal Home outside practice", async ({ page }) => {
  await page.goto("/");
  const panel = await library(page);
  await startGuide(page, "Practice an assessment");
  const coach = page.getByTestId("guided-coach-panel");
  await expect(coach.getByRole("heading", { name: "A separate practice case" })).toBeVisible();
  for (let index = 0; index < 5; index++) {
    await expect(coach).toContainText("Step " + (index + 1) + " of 6");
    await coach.getByRole("button", { name: "Skip step", exact: true }).click();
  }
  await coach.getByRole("button", { name: "Skip and finish" }).click();
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("pipeline-guided-coach:v5") ?? "{}").completedTutorialIds)).not.toContain("practice-assessment");
  await startGuide(page, "See my referrals");
  await expect(page).toHaveURL(/\/$/);
  await expect(coach.getByRole("heading", { name: "Your work on Home" })).toBeVisible();
});

test("task rail can jump, locate, collapse, and resume without losing the practice case", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await library(page);
  await startGuide(page, "Practice an assessment");
  const coach = page.getByTestId("guided-coach-panel");
  const draft = new URL(page.url()).searchParams.get("draftId");
  await coach.getByRole("button", { name: "Step 1 of 6" }).click();
  await expect(coach.getByRole("list", { name: "Tutorial steps" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("tutorial-steps.png") });
  await coach.getByRole("list").getByRole("button", { name: "4 Work on remaining fields" }).click();
  await expect(coach.getByRole("heading", { name: "Work on remaining fields" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("draftId")).toBe(draft);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("pipeline-guided-coach:v5")!).reviewedStepIds)).toEqual([]);
  await coach.getByRole("button", { name: "Show control" }).click();
  await expect(page.locator('[data-guide-target="assessment-fields"]:visible')).toBeFocused();
  await coach.getByRole("button", { name: "Collapse tutorial", exact: true }).click();
  await expect(coach).toHaveAttribute("data-collapsed", "true");
  await expect(page.getByTestId("guide-spotlight")).toHaveCount(0);
  expect((await coach.boundingBox())!.width).toBe(56);
  await coach.getByRole("button", { name: "Expand tutorial" }).click();
  await expect(coach.getByRole("heading", { name: "Work on remaining fields" })).toBeVisible();
  await coach.getByRole("button", { name: "Pause tutorial" }).click();
  await expect(coach).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-pipeline-ready="guided-coach"]')).toBeAttached();
  await expect(coach).toHaveCount(0);
  await library(page);
  await page.getByRole("button", { name: "Resume Practice an assessment" }).click();
  await expect(coach.getByRole("heading", { name: "Work on remaining fields" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("draftId")).toBe(draft);
});

for (const width of [1440, 390]) {
  test("scheduling stays usable beside the tutorial at " + width, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=schedule");
    await page.getByRole("button", { name: "Close schedule", exact: true }).click();
    await library(page);
    await startGuide(page, "Schedule an assessment");
    const coach = page.getByTestId("guided-coach-panel");
    await expect(coach.getByRole("heading", { name: "Open scheduling" })).toBeVisible();
    await page.locator('[data-guide-target="assessment-schedule-open"]').filter({ hasNot: page.locator("input") }).first().click();
    const schedule = page.getByRole("dialog", { name: "Schedule assessment", exact: true });
    await expect(schedule).toBeVisible();
    await expect(coach.getByRole("heading", { name: "Set the appointment" })).toBeVisible();
    const scheduleBox = (await schedule.boundingBox())!;
    const guideBox = (await coach.boundingBox())!;
    if (width >= 1200) expect(scheduleBox.x + scheduleBox.width).toBeLessThanOrEqual(guideBox.x + 1);
    else expect(scheduleBox.y + scheduleBox.height).toBeLessThanOrEqual(guideBox.y + 1);
    await schedule.getByRole("textbox", { name: "Assessment address" }).fill("Fictional practice location");
    await page.screenshot({ path: info.outputPath("scheduling-guide-" + width + ".png") });
    await coach.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(coach.getByRole("heading", { name: "Choose how to meet" })).toBeVisible();
    await coach.getByRole("button", { name: "Pause tutorial" }).click();
    await expect(coach).toHaveCount(0);
    await expect(schedule).toBeVisible();
    await schedule.getByRole("button", { name: "Close schedule" }).click();
  });
}

for (const width of [1440, 375]) {
  test("practice supports edit and reopen, with an explicit refresh reset at " + width, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 667 });
    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" && /\/api\/(assessments|referrals|files)(\/|\?|$)/.test(new URL(request.url()).pathname)) writes.push(request.url());
    });
    await page.goto("/");
    await library(page);
    await startGuide(page, "Practice an assessment");
    const coach = page.getByTestId("guided-coach-panel");
    await coach.getByRole("button", { name: "Step 1 of 6" }).click();
    await coach.getByRole("list").getByRole("button", { name: "4 Work on remaining fields" }).click();
    const answer = page.locator('[data-working-field="bathing_assistance_details"] textarea');
    await answer.fill("Fictional practice entry for tutorial controls.");
    await coach.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(coach.getByRole("heading", { name: "Check saving" })).toBeVisible();
    await expect(page.getByText("Practice changes saved locally", { exact: true })).toBeVisible();
    await coach.getByRole("button", { name: "Collapse tutorial", exact: true }).click();
    if (width < 1200) expect((await coach.boundingBox())!.height).toBeLessThan(80);
    await page.screenshot({ path: info.outputPath("tutorial-collapsed-" + width + ".png") });
    await coach.getByRole("button", { name: "Pause tutorial" }).click();
    if (width < 640) {
      await page.getByRole("button", { name: "Client info", exact: true }).click();
      await page.getByRole("button", { name: "Review Bathing assistance needed", exact: true }).click();
    } else await page.getByRole("button", { name: "Edit Bathing assistance needed", exact: true }).click();
    await expect(answer).toHaveValue("Fictional practice entry for tutorial controls.");
    await page.reload();
    await expect(answer).toHaveValue("");
    expect(writes).toEqual([]);
  });
}

test("intake practice steps find the actual form without creating a referral", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && /\/api\/referrals$/.test(new URL(request.url()).pathname)) writes.push(request.url()); });
  await page.goto("/");
  await library(page);
  await startGuide(page, "Create a referral");
  await expect(page).toHaveURL(/trainingIntake=1/);
  const coach = page.getByTestId("guided-coach-panel");
  for (const title of ["Add referral documents", "Confirm client details", "Set referral details", "Summary and medications", "Create once, then continue"]) {
    await expect(coach.getByRole("heading", { name: title })).toBeVisible();
    await expect(coach.getByText(/not available/)).toHaveCount(0);
    await coach.getByRole("button", { name: title.startsWith("Create once") ? "Finish" : "Continue", exact: true }).click();
  }
  expect(writes).toEqual([]);
});

test("retired training routes remain disabled", async ({ page }) => {
  await page.goto("/training");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Learning Center", exact: true })).toHaveCount(0);
});

test("Escape closes Tutorials without changing the current page", async ({ page }) => {
  await page.goto("/");
  const panel = await library(page);
  await expect(panel.getByRole("heading", { name: "Tutorials", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open guided tutorials" })).toBeFocused();
  await expect(page).toHaveURL(/\/$/);
});

test("contextual file and history guides keep the existing referral", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Tutorial Fictional Case", owner: "Annette Everhart", tags: [], documentName: "", documentStatus: "Missing" }, { assigneeId: "provisional:allo:annette" });
  await page.goto("/?view=referrals&screen=packet&referralId=" + referral.id + "&workspaceStage=chart");
  await library(page);
  await startGuide(page, "Add or open files");
  const coach = page.getByTestId("guided-coach-panel");
  await expect(coach.getByRole("heading", { name: "Add more documents" })).toBeVisible();
  await expect(coach.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("referralId")).toBe(String(referral.id));
  expect(new URL(page.url()).searchParams.get("workspaceView")).toBe("files");
  await coach.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(coach.getByRole("heading", { name: "Open an existing file", exact: true })).toBeVisible();
  await coach.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(coach.getByRole("heading", { name: "Preview or open the document", exact: true })).toBeVisible();
  await coach.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(coach.getByRole("heading", { name: "Remove only the intended file", exact: true })).toBeVisible();
  await coach.getByRole("button", { name: "Finish", exact: true }).click();
  await startGuide(page, "See what changed");
  await expect(coach.getByRole("heading", { name: "Review Activity" })).toBeVisible();
  await expect(coach.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("referralId")).toBe(String(referral.id));
  expect(new URL(page.url()).searchParams.get("workspaceView")).toBe("activity");
});

test("restricted roles cannot start a reports tutorial through a dispatched event", async ({ page }) => {
  await page.route("**/api/auth/me", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    await route.fulfill({ response, json: { ...payload, user: { ...payload.user, roles: ["reviewer"] } } });
  });
  await page.goto("/");
  const panel = await library(page);
  await expect(panel.locator('button[aria-expanded="false"]')).toHaveCount(3);
  await expect(panel.getByRole("button", { name: "Schedule & assess", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Team & reports", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Start tutorial: View reports" })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("pipeline:guided-coach", { detail: { type: "start", tutorialId: "run-report" } })));
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("guided-coach-panel")).toHaveCount(0);
});

for (const width of [1440, 375]) test("packet tutorial opens the separate preview without sending at " + width, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", {
    name: "Synthetic Tutorial Packet", community: "San Pablo", owner: "", tags: [], documentName: "", documentStatus: "Missing",
  });
  let sends = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/meet-client-email")) sends++; });
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceView=email`);
  await library(page);
  await startGuide(page, "Prepare and send the packet");
  const coach = page.getByTestId("guided-coach-panel");
  for (const title of ["Review the packet", "Check delivery status", "Sending is a separate action"]) {
    await expect(coach.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await coach.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await expect(coach.getByRole("heading", { name: "Open the email preview", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Preview email", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Meet the Client email", exact: true });
  await expect(preview).toBeVisible();
  await expect(coach).toHaveCount(0);
  await preview.getByRole("button", { name: "Close email preview", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Tutorials", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem("pipeline-guided-coach:v5") ?? "{}").completedTutorialIds)).toContain("prepare-packet");
  expect(sends).toBe(0);
});
