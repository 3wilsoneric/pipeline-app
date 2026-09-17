import { expect, test, type Page } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { randomUUID } from "node:crypto";
import { pipelineWorkspaceLocationFromSearchParams } from "../../lib/pipeline/work-continuity";

async function syntheticHome(page: Page) {
  await page.route("**/api/operations/home", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const names = ["Taylor Rivera", "Christopher Montgomery-Worthington", "Morgan Chen", "Casey Brooks", "Alex Reed", "Riley Hart"];
    const statuses = ["ready_to_schedule", "profile_incomplete", "assessment_scheduled", "assessment_in_progress", "decision_pending", "admitted"];
    const actions = ["Schedule the assessment", "Complete the referral details", "Assessment on Thursday at 10:00 AM", "Continue Clinical", "Review the recommendation", "Admission recorded"];
    const items = names.map((name, index) => ({
      referral_id: 910101 + index, client_name: name, community: "San Pablo", stage: "New",
      workflow_status: statuses[index], flow_state: index < 2 ? "ready_to_schedule" : index < 4 ? "assessment" : "complete_chart",
      assessment_state: index === 2 ? "scheduled" : "in_progress", outcome_state: index === 5 ? "accepted" : "pending",
      assignment_state: "assigned", document_state: "partial", profile_state: "partial", assessment_is_reassessment: false,
      owner: "Example Assessor", priority: "standard", categories: [], primary_category: "follow_up", next_action: actions[index],
      blockers: [], missing_data: [], urgency: "normal", due_at: null, last_activity_at: "2026-09-17T15:00:00Z",
      age_hours: 1, completion_pct: 40, missing_document_count: 0, location: { view: index < 2 ? "intake" : "assessment" },
    }));
    payload.scope = "team";
    payload.unavailable_sections = [];
    payload.continuity.unavailable = false;
    payload.continuity.resume_items = [];
    payload.workflow.active_total = 5;
    payload.workflow.active_items = items.slice(0, 5);
    payload.workflow.board_items = items;
    payload.upcoming = [{ id: "preview-event", referralId: 910103, clientName: "Morgan Chen", community: "San Pablo",
      ownerId: payload.viewer.id, owner: "Example Assessor", date: "2026-09-17", startsAt: "2026-09-17T17:00:00Z",
      durationMinutes: 60, method: "in_person", kind: "assessment", status: "scheduled", title: "Assessment", scheduleStatus: "scheduled" }];
    payload.continuity.new_assignments = [{ event_id: "preview-assignment", action: "assigned", actor_id: "preview-supervisor",
      actor_name: "Example Supervisor", created_at: "2026-09-17T15:00:00Z", workspace: { referral_id: 910101,
        client_name: "Taylor Rivera", community: "San Pablo", owner_id: payload.viewer.id, owner: "Example Assessor",
        workflow_status: "intake_in_progress", priority: "standard", workspace_status: "active" }, attention: null }];
    await route.fulfill({ response, json: payload });
  });
  await page.goto("/");
  await expect(page.locator("[data-board-card]")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Pipeline home", exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const width of [1440, 1024, 437, 390]) {
  test(`emerald Home and assessment stay legible and usable at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: width === 437 ? 536 : width === 390 ? 844 : 1000 });
    await syntheticHome(page);
    await expect(page.locator('[data-guide-target="home-workspace"]')).toHaveCSS("background-color", "rgb(245, 246, 248)");
    await expect(page.locator('[data-home-module="current-work"]')).toHaveCSS("border-top-left-radius", "0px");
    const stageColors = await page.locator('[data-board-stage] > div:first-child').evaluateAll((elements) => elements.map((element) => getComputedStyle(element, "::before").backgroundColor));
    expect(new Set(stageColors).size).toBe(4);
    const firstCard = page.locator('[data-board-card]').first();
    const folderTab = firstCard.locator('[data-folder-name]');
    const folderBody = firstCard.locator('[data-folder-body]');
    await expect(folderTab).toHaveText("Taylor Rivera");
    await expect(folderTab).toHaveCSS("font-size", "14px");
    await expect(folderTab).toHaveCSS("background-image", /linear-gradient/);
    await expect(folderBody).toHaveCSS("background-image", /linear-gradient/);
    await expect(folderBody.locator(':scope > span')).toHaveCSS("background-color", "rgb(255, 255, 255)");
    const tabBox = (await folderTab.boundingBox())!;
    const bodyBox = (await folderBody.boundingBox())!;
    expect(tabBox.y + tabBox.height - bodyBox.y).toBe(1);
    const statusTab = firstCard.locator('[data-board-status]');
    await expect(statusTab).toHaveText("Ready to schedule");
    await expect(statusTab).toHaveCSS("font-size", "10px");
    const statusBox = (await statusTab.boundingBox())!;
    expect(statusBox.x).toBeGreaterThan(tabBox.x + tabBox.width);
    expect(statusBox.height).toBeLessThan(tabBox.height);
    await expect(firstCard.locator('button, a, input, select')).toHaveCount(0);
    const longName = page.getByRole('button', { name: 'Open Christopher Montgomery-Worthington', exact: true }).locator('[data-folder-name]');
    expect(await longName.evaluate((element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
    expect(await longName.locator(":scope > span").evaluate((element) => {
      const style = getComputedStyle(element);
      return (element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)) / parseFloat(style.lineHeight);
    })).toBeLessThanOrEqual(3);
    if (width >= 1024) {
      const columns = await page.locator('[data-current-work-board]').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
      expect(columns).toBe(width < 1280 ? 2 : 4);
    }
    const stageHeader = page.locator('[data-board-stage="received"] > div:first-child');
    await expect(stageHeader).toHaveCSS("background-image", "none");
    expect((await stageHeader.boundingBox())!.height).toBeLessThanOrEqual(48);
    await expect(page.locator("[data-home-surface]").first()).toHaveCSS("backdrop-filter", "none");
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const contrast = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
      const result = await axe.run('[aria-label="Current work board"]', { runOnly: ["color-contrast"] });
      return result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }));
    });
    expect(contrast).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`) });
    await page.getByRole("button", { name: "Collapse Board", exact: true }).click();
    await expect(page.locator("[data-current-work-board]")).toHaveCount(0);
    await page.getByRole("button", { name: "Expand Board", exact: true }).click();
    await expect(page.locator("[data-board-card]")).toHaveCount(6);

    await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=prepare&assessmentSection=diagnosis_clinical&demo=1");
    const assessment = page.locator('[data-assessment-view="chart"]');
    await expect(assessment).toBeVisible();
    await expect(assessment.locator("main")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(assessment).toHaveCSS("backdrop-filter", "none");
    const actions = assessment.locator('footer[aria-label="Assessment actions"]');
    const buttonStyles = await actions.locator("button").evaluateAll((buttons) => buttons.filter((button) => button.getBoundingClientRect().width > 0).map((button) => {
      const style = getComputedStyle(button);
      return [style.height, style.borderRadius, style.fontSize, style.fontWeight, style.borderTopWidth].join("/");
    }));
    expect(new Set(buttonStyles).size).toBe(1);
    const secondary = assessment.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
    await expect(secondary).toHaveCSS("font-size", "16px");
    await secondary.fill("Synthetic referral history prepared for the interview.");
    await secondary.press("Tab");
    await expect(assessment.getByRole("complementary", { name: "Captured assessment answers" })).toHaveCSS("background-image", /linear-gradient/);
    await expect(assessment.getByRole("complementary", { name: "Assessment navigation", exact: true })).toHaveCount(0);
    await expect(assessment.getByRole("combobox", { name: "Assessment section", exact: true })).toHaveValue("diagnosis_clinical");
    if (width >= 960) {
      const reference = await assessment.getByRole("complementary", { name: "Captured assessment answers" }).boundingBox();
      const editor = await assessment.locator('[data-assessment-question-editor]').boundingBox();
      expect(reference!.x + reference!.width).toBeLessThan(editor!.x);
      expect(Math.abs(reference!.y - editor!.y)).toBeLessThan(2);
    }
    expect(await assessment.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`assessment-${width}.png`) });
    await assessment.getByRole("button", { name: "Begin assessment", exact: true }).click();
    const begin = page.getByRole("dialog", { name: "Begin assessment", exact: true });
    await expect(begin).toBeVisible();
    await begin.getByRole("button", { name: "Begin assessment", exact: true }).click();
    await expect(begin).toHaveCount(0);
    await expect(assessment.getByRole("button", { name: "Sign assessment", exact: true })).toHaveCSS("background-color", "rgb(0, 126, 96)");
    await expect(secondary).toHaveValue("Synthetic referral history prepared for the interview.");
    await assessment.locator("main").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(assessment.getByRole("button", { name: "Next section", exact: true })).toBeInViewport();
    await expect(assessment.getByRole("button", { name: "Next section", exact: true })).toHaveCSS("background-color", "rgb(0, 126, 96)");
    await expect(assessment.getByRole("button", { name: "Sign assessment", exact: true })).toBeInViewport();
    expect(errors).toEqual([]);
  });
}

test("board folders fan halfway on hover and keyboard focus without fetching or changing the click path", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Home already prefetches one upcoming workspace independently of the board.
  const warmup = page.waitForResponse("**/api/referrals/910103/canvas");
  await syntheticHome(page);
  await warmup;
  const stack = page.locator('[data-board-stage="received"] [data-folder-stack]');
  const cards = stack.locator('[data-board-card]');
  const first = cards.first();
  const second = cards.nth(1);
  await stack.scrollIntoViewIfNeeded();
  await page.mouse.move(1, 1);
  const gap = async () => (await second.boundingBox())!.y - (await first.boundingBox())!.y;
  const height = (await first.boundingBox())!.height;
  await expect.poll(gap).toBeLessThan(height * 0.35);
  const compactGap = await gap();
  const requests: string[] = [];
  page.on("request", (request) => { if (["fetch", "xhr"].includes(request.resourceType())) requests.push(request.url()); });
  await first.locator('[data-folder-name]').hover();
  await expect.poll(gap).toBeGreaterThan(height * 0.5);
  expect(await gap()).toBeLessThan(height * 0.65);
  const action = first.getByText("Schedule the assessment", { exact: true });
  await expect(action.locator("..")).toHaveCSS("opacity", "1");
  const actionBox = (await action.boundingBox())!;
  expect(actionBox.y + actionBox.height).toBeLessThan((await second.boundingBox())!.y);
  await page.screenshot({ path: testInfo.outputPath("folder-stack-expanded.png") });
  await page.mouse.move(1, 1);
  await expect.poll(gap).toBe(compactGap);
  await expect(action.locator("..")).toHaveCSS("opacity", "0");
  await first.focus();
  await expect(first).toBeFocused();
  await expect(first).toHaveCSS("outline-width", "2px");
  await expect(first).toHaveAccessibleDescription("Ready to schedule Schedule the assessment");
  await expect.poll(gap).toBeGreaterThan(height * 0.5);
  await page.keyboard.press("Tab");
  await expect(second).toBeFocused();
  expect(requests).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/referralId=910102/);
  expect(pipelineWorkspaceLocationFromSearchParams(new URL(page.url()).searchParams)).toEqual({ view: "intake" });
  await page.goto("/");
  const scheduled = page.getByRole("button", { name: "Open Morgan Chen", exact: true });
  await scheduled.locator('[data-folder-name]').click();
  await expect(page).toHaveURL(/referralId=910103/);
  expect(pipelineWorkspaceLocationFromSearchParams(new URL(page.url()).searchParams)).toEqual({ view: "assessment", assessmentSection: "identity" });
});

test("hovering a lower folder keeps the intended client under the pointer", async ({ page }) => {
  await syntheticHome(page);
  const folder = page.getByRole("button", { name: "Open Christopher Montgomery-Worthington", exact: true });
  const tab = folder.locator('[data-folder-name]');
  await tab.scrollIntoViewIfNeeded();
  const box = (await tab.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(1, y);
  await page.mouse.move(x, y);
  await page.locator('[data-board-stage="received"]').evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  await expect.poll(async () => (await tab.boundingBox())!.y).toBe(box.y);
  await expect(folder.getByText("Complete the referral details", { exact: true }).locator("..")).toHaveCSS("opacity", "1");
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"), { x, y })).toBe("Open Christopher Montgomery-Worthington");
  await page.mouse.click(x, y);
  await expect(page).toHaveURL(/referralId=910102/);
});

test("touch users see open folder previews and open a referral with one tap", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 1024, height: 900 } });
  const page = await context.newPage();
  try {
    await syntheticHome(page);
    const cards = page.locator('[data-board-stage="received"] [data-board-card]');
    const first = cards.first();
    const second = cards.nth(1);
    expect(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches)).toBe(false);
    const firstBox = (await first.boundingBox())!;
    expect((await second.boundingBox())!.y).toBeGreaterThan(firstBox.y + firstBox.height);
    await expect(first.getByText("Schedule the assessment", { exact: true }).locator("..")).toHaveCSS("opacity", "1");
    await first.locator('[data-folder-name]').tap();
    await expect(page).toHaveURL(/referralId=910101/);
    expect(pipelineWorkspaceLocationFromSearchParams(new URL(page.url()).searchParams)).toEqual({ view: "intake" });
  } finally {
    await context.close();
  }
});

test("reduced motion removes card movement and the standalone lab stays unthemed", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await syntheticHome(page);
  const card = page.locator("[data-board-card]").first();
  await card.locator('[data-folder-name]').hover();
  await expect(card).toHaveCSS("transform", "none");
  await expect(card).toHaveCSS("transition-duration", "0s");
  await card.focus();
  await expect(card).toHaveCSS("outline-width", "2px");
  await page.goto("/note-lab/practice");
  await expect(page.getByTestId("standalone-review-shell")).toBeVisible();
  await expect(page.locator(".pipeline-surfaces")).toHaveCount(0);
});

for (const width of [1440, 390]) {
  test(`Intake uses the client folder and keeps editing and questionnaire access at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const created = await page.request.post("/api/referrals", { data: {
      client_mutation_id: randomUUID(),
      assignee_id: "provisional:allo:annette",
      referral: {
        name: `Chart File ${randomUUID().slice(0, 8)}`, date: "2026-09-17", stage: "New",
        community: "San Pablo", county: "Contra Costa County", source: "Synthetic visual test",
        priority: "standard", tags: [], documentName: "", documentStatus: "Missing",
        owner: "Annette Everhart", note: "", createdAt: new Date().toISOString(),
        dob: "", phone: "", email: "", payer: "", requirements: [],
      },
    } });
    expect(created.status()).toBe(201);
    const { referral } = await created.json() as { referral: { id: number; name: string } };
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake`);
    const folder = page.getByTestId("intake-client-folder");
    await expect(folder).toBeVisible();
    await expect(folder.locator(":scope > strong")).toHaveText(referral.name);
    await expect(folder.locator(":scope > strong")).toHaveCSS("background-color", "rgb(237, 228, 208)");
    await expect(folder.locator(":scope > div")).toHaveCSS("background-color", "rgb(237, 228, 208)");
    await expect(folder.getByRole("article", { name: "Referral intake chart", exact: true })).toBeVisible();
    await expect(page.getByTestId("document-checklist-panel")).not.toHaveAttribute("open");
    await page.getByTestId("document-checklist-toggle").click();
    await expect(page.getByTestId("document-checklist-panel")).toHaveAttribute("open", "");
    await page.getByTestId("document-checklist-toggle").click();
    const email = folder.getByRole("textbox", { name: "Client email:", exact: true });
    await email.fill("chart-file@example.invalid");
    await email.press("Tab");
    await expect.poll(async () => (await (await page.request.get(`/api/referrals/${referral.id}`)).json()).referral.email).toBe("chart-file@example.invalid");
    await page.reload();
    await expect(email).toHaveValue("chart-file@example.invalid");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await folder.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await folder.locator(":scope > strong").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`intake-folder-${width}.png`) });
    const questionnaire = page.getByRole("button", { name: "Open questionnaire", exact: true });
    await questionnaire.scrollIntoViewIfNeeded();
    await expect(questionnaire).toBeInViewport();
    await folder.locator('[data-workspace-field="dob"] input').fill("1972-05-08");
    await questionnaire.click();
    await expect(page.getByTestId("preparation-client-folder")).toBeVisible();
    await expect(page.getByRole("region", { name: "Referral preparation", exact: true })).toBeVisible();
    await expect(page.locator("#assessment-date_of_birth")).toHaveValue("1972-05-08");
  });
}
