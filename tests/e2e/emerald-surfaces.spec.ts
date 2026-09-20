import { expect, test, type Page } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { randomUUID } from "node:crypto";
import { pipelineWorkspaceLocationFromSearchParams } from "../../lib/pipeline/work-continuity";

async function syntheticHome(page: Page, scope: "personal" | "team" = "team") {
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
      blockers: [], missing_data: [], urgency: "normal", due_at: null, last_activity_at: "2026-09-17T15:00:00Z", received_at: "2026-09-17T15:00:00Z",
      age_hours: 1, completion_pct: 40, missing_document_count: index === 0 ? 2 : 0, location: { view: index < 2 ? "intake" : "assessment" },
    }));
    payload.scope = scope;
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
  // The active board excludes the sixth fixture's completed admission.
  await expect(page.locator("[data-board-card]")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Pipeline home", exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const width of [1440, 1024, 437, 390]) {
  test(`emerald Home and assessment stay legible and usable at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: width === 437 ? 536 : width === 390 ? 844 : 1000 });
    await syntheticHome(page);
    await expect(page.locator('[data-guide-target="home-workspace"]')).toHaveCSS("background-color", "rgb(230, 237, 240)");
    await expect(page.locator('[data-home-module="current-work"]')).toHaveCSS("border-top-left-radius", "0px");
    const stageColors = await page.locator('[data-board-stage] > div:first-child').evaluateAll((elements) => elements.map((element) => getComputedStyle(element, "::before").backgroundColor));
    expect(new Set(stageColors).size).toBe(3);
    const dockets = await page.locator('[data-board-stage]').evaluateAll((elements) => elements.map((element) => ({
      paper: getComputedStyle(element).backgroundColor,
      index: getComputedStyle(element.firstElementChild!, "::before").content,
      tabPointerEvents: getComputedStyle(element, "::before").pointerEvents,
      edgePointerEvents: getComputedStyle(element, "::after").pointerEvents,
      backdropFilter: getComputedStyle(element).backdropFilter,
    })));
    expect(new Set(dockets.map((docket) => docket.paper)).size).toBe(3);
    expect(dockets.map((docket) => docket.index)).toEqual(['"01"', '"02"', '"03"']);
    for (const docket of dockets) {
      expect(docket.tabPointerEvents).toBe("none");
      expect(docket.edgePointerEvents).toBe("none");
      expect(docket.backdropFilter).toBe("none");
    }
    const firstCard = page.locator('[data-board-card]').first();
    const folderTab = firstCard.locator('[data-folder-name]');
    const folderBody = firstCard.locator('[data-folder-body]');
    await expect(folderTab).toHaveText("Taylor Rivera");
    await expect(folderTab).toHaveCSS("font-size", "17px");
    await expect(folderTab).toHaveCSS("background-image", /linear-gradient/);
    await expect(folderBody).toHaveCSS("background-image", /linear-gradient/);
    await expect(folderBody.locator(':scope > span')).toHaveCSS("background-color", "rgb(255, 255, 255)");
    const tabBox = (await folderTab.boundingBox())!;
    const bodyBox = (await folderBody.boundingBox())!;
    expect(tabBox.y + tabBox.height - bodyBox.y).toBe(1);
    const statusTab = firstCard.locator('[data-board-status]');
    await expect(statusTab).toHaveText("Referral created");
    await expect(statusTab).toHaveCSS("font-size", "12px");
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
      expect(columns).toBe(width < 1280 ? 2 : 3);
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
    await expect(page.getByRole("button", { name: /^(Collapse|Expand) Board$/ })).toHaveCount(0);
    await expect(page.locator("[data-board-card]")).toHaveCount(5);
    if (width < 1024) {
      for (const stage of ["in_progress", "decision", "received"]) {
        await page.getByRole("combobox", { name: "Referral stage", exact: true }).selectOption(stage);
        await expect(page.locator('[data-board-stage]:visible')).toHaveCount(1);
        await expect(page.locator(`[data-board-stage="${stage}"]`)).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    }

    await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=prepare&assessmentSection=diagnosis_clinical&demo=1");
    const assessment = page.locator('[data-assessment-view="assessment"]');
    await expect(assessment).toBeVisible();
    const presentation = width < 640
      ? { background: "rgb(247, 250, 244)", fontSize: "16px", button: "rgb(8, 119, 90)" }
      : { background: "rgb(255, 255, 255)", fontSize: "17px", button: "rgb(0, 126, 96)" };
    await expect(assessment.locator("main")).toHaveCSS("background-color", presentation.background);
    await expect(assessment).toHaveCSS("backdrop-filter", "none");
    const actions = assessment.locator('footer[aria-label="Assessment actions"]');
    const buttonHeights = await actions.locator("button").evaluateAll((buttons) => buttons.filter((button) => button.getBoundingClientRect().width > 0).map((button) => button.getBoundingClientRect().height));
    expect(buttonHeights.length).toBeGreaterThan(0);
    for (const height of buttonHeights) expect(height).toBeGreaterThanOrEqual(44);
    if (width < 640) {
      await assessment.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
      const sections = page.getByRole("dialog", { name: "Questionnaire sections", exact: true });
      await sections.getByRole("searchbox", { name: "Find a question", exact: true }).fill("Secondary diagnosis");
      await sections.getByRole("button", { name: /^Secondary diagnosis/ }).click();
    }
    const secondary = assessment.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
    await expect(secondary).toHaveCSS("font-size", presentation.fontSize);
    await secondary.fill("Synthetic referral history prepared for the interview.");
    await secondary.press("Tab");
    if (width >= 640) await expect(assessment.getByRole("complementary", { name: "Current information" })).toHaveCSS("background-image", /linear-gradient/);
    await expect(assessment.getByRole("complementary", { name: "Assessment navigation", exact: true })).toHaveCount(0);
    if (width >= 640) await expect(assessment.getByRole("combobox", { name: "Assessment section", exact: true })).toHaveValue("diagnosis_clinical");
    if (width >= 960) {
      const reference = await assessment.getByRole("complementary", { name: "Current information" }).boundingBox();
      const editor = await assessment.locator('[data-assessment-question-editor]').boundingBox();
      expect(reference!.x + reference!.width).toBeLessThan(editor!.x);
      expect(Math.abs(reference!.y - editor!.y)).toBeLessThan(2);
    }
    expect(await assessment.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`assessment-${width}.png`) });
    // Embedded practice is editable without recording a clinical start event.
    await expect(assessment.getByRole("button", { name: "Sign assessment", exact: true })).toHaveCount(0);
    await expect(secondary).toHaveValue("Synthetic referral history prepared for the interview.");
    await assessment.locator("main").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const next = assessment.getByRole("button", { name: "Next section", exact: true });
    await expect(next).toBeInViewport();
    await expect(next).toHaveCSS("background-color", presentation.button);
    await next.click();
    await expect(actions).toBeInViewport();
    expect(errors).toEqual([]);
  });
}

for (const width of [1440, 390]) {
  for (const scope of ["team", "personal"] as const) {
    test(`folder text and chart details remain readable at ${width}px for ${scope} work`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await syntheticHome(page, scope);
      const stack = page.locator('[data-board-stage="received"]');
      const first = stack.locator("[data-board-card]").first();
      const last = stack.locator("[data-board-card]").last();
      await expect(first).toContainText("Referral #910101");
      await expect(first).toContainText("Received Sep 17, 2026");
      await expect(first.locator("[data-folder-details]")).toContainText("Documents needed2");
      await expect(last.locator("[data-folder-name]")).toHaveCSS("font-weight", "700");
      await expect(last.locator("[data-board-status]")).toHaveCSS("font-weight", "700");
      await expect(last.locator("[data-folder-details]")).toContainText("CommunitySan Pablo");
      await expect(last.locator("[data-folder-details]")).toContainText("File progress40% complete");
      await expect(last.locator("[data-folder-details]")).toContainText("Documents needed0");
      await expect(last.getByText("Assessor", { exact: true })).toHaveCount(1);
      await expect(last).toContainText("Example Assessor");
      await last.scrollIntoViewIfNeeded();
      expect(await last.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      const body = last.locator("[data-folder-body]");
      const details = (await last.locator("[data-folder-details]").boundingBox())!;
      const bodyBox = (await body.boundingBox())!;
      expect(details.y + details.height).toBeLessThanOrEqual(bodyBox.y + bodyBox.height - 19);
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
        const result = await axe.run('[data-board-stage="received"]', { runOnly: ["color-contrast", "button-name"] });
        return result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }));
      });
      expect(violations).toEqual([]);
      await stack.screenshot({ path: testInfo.outputPath(`folder-details-${scope}-${width}.png`) });
    });
  }
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
  await page.mouse.move(page.viewportSize()!.width - 1, 1);
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
  await page.mouse.move(page.viewportSize()!.width - 1, 1);
  await expect.poll(gap).toBe(compactGap);
  await expect(action.locator("..")).toHaveCSS("opacity", "0");
  await first.focus();
  await expect(first).toBeFocused();
  await expect(first).toHaveCSS("outline-width", "2px");
  await expect(first).toHaveAccessibleDescription("Referral created Schedule the assessment");
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
  expect(pipelineWorkspaceLocationFromSearchParams(new URL(page.url()).searchParams)).toEqual({ view: "assessment" });
});

test("hovering a lower folder keeps the intended client under the pointer", async ({ page }) => {
  await syntheticHome(page);
  const folder = page.getByRole("button", { name: "Open Christopher Montgomery-Worthington", exact: true });
  const tab = folder.locator('[data-folder-name]');
  await tab.scrollIntoViewIfNeeded();
  const box = (await tab.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(page.viewportSize()!.width - 1, y);
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
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=intake&workspaceField=name`);
    const folder = page.getByTestId("intake-client-folder");
    await expect(folder).toBeVisible();
    await expect(page.getByTestId("workspace-identity-title")).toHaveText(referral.name);
    await expect(folder.locator(":scope > strong")).toHaveCount(0);
    await expect(folder).toHaveCSS("--folder-fill", "#eeeee7");
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
    await page.getByTestId("workspace-identity-title").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`intake-folder-${width}.png`) });
    const questionnaire = width < 640 ? page.getByRole("combobox", { name: "Workspace view", exact: true }) : page.getByRole("button", { name: "Assessment", exact: true });
    await questionnaire.scrollIntoViewIfNeeded();
    await expect(questionnaire).toBeInViewport();
    await folder.locator('[data-workspace-field="dob"] input').fill("1972-05-08");
    await folder.locator('[data-workspace-field="dob"] input').blur();
    if (width < 640) await questionnaire.selectOption({ label: "Assessment" });
    else await questionnaire.click();
    await expect(page.getByTestId("assessment-client-folder")).toBeVisible();
    await expect(page.locator("[data-assessment-view]")).toBeVisible();
    if (width < 640) {
      await page.getByRole("button", { name: "Client info", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Client information" })).toContainText("1972");
    } else await expect(page.getByRole("button", { name: "Edit Date of birth", exact: true })).toContainText("1972");
  });
}
