import { editPreparedAnswer } from "./support/assessment-navigation";
import { expect, test, type Page } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { randomUUID } from "node:crypto";
import { pipelineWorkspaceLocationFromSearchParams } from "../../lib/pipeline/work-continuity";

async function syntheticHome(page: Page, scope: "personal" | "team" = "team") {
  await page.route("**/api/operations/home", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const names = ["Taylor Rivera", "Christopher Montgomery-Worthington", "Morgan Chen", "Casey Brooks", "Alex Reed", "Riley Hart"];
    const statuses = ["ready_to_schedule", "profile_incomplete", "assessment_scheduled", "assessment_in_progress", "approved_for_placement", "admitted"];
    const actions = ["Schedule the assessment", "Complete the referral details", "Assessment on Thursday at 10:00 AM", "Continue Clinical", "Review the recommendation", "Admission recorded"];
    const items = names.map((name, index) => ({
      referral_id: 910101 + index, client_name: name, community: "San Pablo", stage: "New",
      workflow_status: statuses[index], flow_state: index < 2 ? "ready_to_schedule" : index < 4 ? "assessment" : "complete_chart",
      assessment_state: index === 2 ? "scheduled" : "in_progress", outcome_state: index >= 4 ? "accepted" : "pending",
      assignment_state: "assigned", document_state: "partial", profile_state: "partial", assessment_is_reassessment: false,
      owner: "Example Assessor", priority: "standard", categories: [], primary_category: "follow_up", next_action: actions[index],
      board: { stage: index === 5 ? null : index < 2 ? "received" : index < 4 ? "in_progress" : "decision",
        detail: index < 2 ? "Referral created" : index < 4 ? "Assessment underway" : "Accepted",
        next_action: actions[index], location: { view: index < 2 ? "intake" : "assessment" } },
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
    payload.workflow.all_board_items = items;
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
  await expect(page.getByRole("button", { name: "Open in progress folder", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open clients in handoff folder", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pipeline home", exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const width of [1440, 1024, 437, 390]) {
  test(`emerald Home and assessment stay legible and usable at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: width === 437 ? 536 : width === 390 ? 844 : 1000 });
    await syntheticHome(page);
    const seen: string[] = [];
    for (const [title, count] of [["In progress", 4], ["Clients in handoff", 1]] as const) {
      const open = page.getByRole("button", { name: `Open ${title.toLowerCase()} folder`, exact: true });
      await expect.poll(async () => (await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await open.click();
      const dialog = page.getByRole("dialog", { name: `${title} folder`, exact: true });
      const cards = dialog.locator("[data-board-card]");
      await expect(cards).toHaveCount(count);
      await expect(dialog.getByRole("button", { name: "Open Riley Hart", exact: true })).toHaveCount(0);
      seen.push(...await cards.locator("[data-folder-name]").allTextContents());
      for (const card of await cards.all()) {
        await expect(card.locator("button, a, input, select")).toHaveCount(0);
        await expect.poll(async () => (await card.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        const clipped = await card.evaluate(element => [...element.querySelectorAll("[data-folder-name], [data-board-status], [data-folder-details]")].filter(node => node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight).map(node => node.textContent));
        expect(clipped).toEqual([]);
      }
      await dialog.evaluate(async (element) => {
        await document.fonts.ready;
        await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
      });
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
        return (await axe.run('dialog[open]', { runOnly: ["color-contrast", "button-name"] })).violations;
      });
      expect(violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`home-${title}-${width}.png`) });
      await page.keyboard.press("Escape");
      await expect(open).toBeFocused();
    }
    expect(seen.sort()).toEqual(["Taylor Rivera", "Christopher Montgomery-Worthington", "Morgan Chen", "Casey Brooks", "Alex Reed"].sort());

    await page.goto("/?view=referrals&screen=packet&workspaceStage=assessment&trainingAssessment=interview&assessmentSection=diagnosis_clinical&demo=1");
    const assessment = page.locator('[data-assessment-view="assessment"]');
    await expect(assessment).toBeVisible();
    const presentation = width < 640
      ? { background: "rgb(255, 255, 255)", fontSize: "16px", button: "rgb(244, 162, 97)" }
      : { background: "rgb(255, 255, 255)", fontSize: "16px", button: "rgb(244, 162, 97)" };
    await expect(assessment.locator(width < 640 ? "[data-phone-interview]" : "main")).toHaveCSS("background-color", presentation.background);
    await expect(assessment).toHaveCSS("backdrop-filter", "none");
    const actions = assessment.locator('footer[aria-label="Assessment actions"]');
    const buttonHeights = await actions.locator("button").evaluateAll((buttons) => buttons.filter((button) => button.getBoundingClientRect().width > 0).map((button) => button.getBoundingClientRect().height));
    expect(buttonHeights.length).toBeGreaterThan(0);
    for (const height of buttonHeights) expect(height).toBeGreaterThanOrEqual(44);
    if (width < 640) {
      await assessment.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
      const sections = page.getByRole("dialog", { name: "Questionnaire sections", exact: true });
      await sections.getByRole("searchbox", { name: "Find a question", exact: true }).fill("Current symptoms");
      await sections.getByRole("button", { name: /^Current symptoms/ }).click();
    }
    await editPreparedAnswer(page, "Current symptoms");
    const secondary = assessment.getByRole("textbox", { name: "Current symptoms", exact: true });
    await expect(secondary).toHaveCSS("font-size", presentation.fontSize);
    await secondary.fill("Synthetic referral history prepared for the interview.");
    await secondary.press("Tab");
    if (width >= 640) await expect(assessment.getByRole("complementary", { name: "Current information" })).toHaveCSS("background-image", "none");
    await expect(assessment.getByRole("complementary", { name: "Assessment navigation", exact: true })).toHaveCount(0);
    if (width >= 640) await expect(assessment.getByRole("combobox", { name: "Assessment section", exact: true })).toHaveValue("diagnosis_clinical");
    if (width >= 960) {
      const reference = await assessment.getByRole("complementary", { name: "Current information" }).boundingBox();
      const editor = await assessment.locator('[data-assessment-question-editor]').boundingBox();
      expect(reference!.x + reference!.width).toBeLessThan(editor!.x);
      const referenceHeader = await assessment.getByRole("complementary", { name: "Current information" }).locator("header").boundingBox();
      expect(Math.abs(referenceHeader!.y - editor!.y)).toBeLessThan(2);
    }
    expect(await assessment.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`assessment-${width}.png`) });
    // Embedded practice is editable without recording a clinical start event.
    await expect(assessment.getByRole("button", { name: "Confirm chart", exact: true })).toHaveCount(0);
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
      await page.getByRole("button", { name: "Open in progress folder", exact: true }).click();
      const stack = page.getByRole("dialog", { name: "In progress folder", exact: true });
      const first = stack.getByRole("button", { name: "Open Taylor Rivera", exact: true });
      const last = stack.getByRole("button", { name: "Open Christopher Montgomery-Worthington", exact: true });
      await expect(first).toContainText("Referral created");
      await expect(first).not.toContainText("#910101");
      await expect(first.locator("[data-folder-details]")).toContainText("2 documents needed");
      await expect(last.locator("[data-folder-details]")).toContainText("San Pablo");
      await expect(last.locator("[data-folder-details]")).not.toContainText("File progress");
      await expect(last.locator("[data-folder-details]")).not.toContainText("documents needed");
      if (width < 640) {
        await expect(last).not.toContainText("Example Assessor");
        await expect(stack.getByRole("button", { name: "All", exact: true })).toHaveCount(0);
        await expect(stack.getByRole("button", { name: "Mine", exact: true })).toHaveCount(0);
      } else {
        await expect(last).toContainText("Example Assessor");
      }
      await last.scrollIntoViewIfNeeded();
      expect(await last.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await stack.evaluate(async (element) => {
        await document.fonts.ready;
        await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
      });
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
        const result = await axe.run('dialog[open]', { runOnly: ["color-contrast", "button-name"] });
        return result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) }));
      });
      expect(violations).toEqual([]);
      await stack.screenshot({ path: testInfo.outputPath(`folder-details-${scope}-${width}.png`) });
    });
  }
}

test("folder cards remain stable on hover and keyboard focus without fetching or changing the click path", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await syntheticHome(page);
  await page.getByRole("button", { name: "Open in progress folder", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "In progress folder", exact: true });
  const first = dialog.getByRole("button", { name: "Open Taylor Rivera", exact: true });
  const second = dialog.getByRole("button", { name: "Open Christopher Montgomery-Worthington", exact: true });
  await page.waitForLoadState("networkidle");
  const requests: string[] = [];
  page.on("request", request => { if (["fetch", "xhr"].includes(request.resourceType())) requests.push(request.url()); });
  const secondBefore = await second.boundingBox();
  await first.hover();
  await expect(first.getByText("Schedule the assessment", { exact: true })).toBeVisible();
  expect(await second.boundingBox()).toEqual(secondBefore);
  await first.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(first).toBeFocused();
  await expect(first).toHaveCSS("outline-width", "2px");
  await expect(first).toHaveAccessibleDescription("Referral created Schedule the assessment");
  await page.screenshot({ path: testInfo.outputPath("folder-keyboard-focus.png") });
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: /^Pin / })).toHaveCount(0);
  await expect(second).toBeFocused();
  expect(requests).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/referralId=910102/);
  expect(pipelineWorkspaceLocationFromSearchParams(new URL(page.url()).searchParams)).toEqual({ view: "intake" });
  await page.goto("/");
  await page.getByRole("button", { name: "Open in progress folder", exact: true }).click();
  await page.getByRole("button", { name: "Open Morgan Chen", exact: true }).click();
  await expect(page).toHaveURL(/referralId=910103/);
  expect(pipelineWorkspaceLocationFromSearchParams(new URL(page.url()).searchParams)).toEqual({ view: "assessment" });
});

test("hovering a lower folder keeps the intended client under the pointer", async ({ page }) => {
  await syntheticHome(page);
  await page.getByRole("button", { name: "Open in progress folder", exact: true }).click();
  const folder = page.getByRole("button", { name: "Open Christopher Montgomery-Worthington", exact: true });
  const tab = folder.locator('[data-folder-name]');
  await tab.scrollIntoViewIfNeeded();
  const box = (await tab.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(page.viewportSize()!.width - 1, y);
  await page.mouse.move(x, y);
  await page.getByRole("dialog", { name: "In progress folder", exact: true }).evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
  });
  // The whole docket lifts slightly on hover; the same client must stay under
  // the pointer (asserted below), not remain at an obsolete exact pixel.
  await expect(tab).toBeInViewport();
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
    await page.getByRole("button", { name: "Open in progress folder", exact: true }).tap();
    const cards = page.getByRole("dialog", { name: "In progress folder", exact: true }).locator("[data-board-card]");
    const first = cards.first();
    const second = cards.nth(1);
    expect(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches)).toBe(false);
    // Measure after the folder opening animation reaches its final position.
    await page.getByRole("dialog", { name: "In progress folder", exact: true }).evaluate(async (element) => {
      await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
    });
    const firstBox = (await first.boundingBox())!;
    const secondBox = (await second.boundingBox())!;
    expect(secondBox.y >= firstBox.y + firstBox.height || secondBox.x >= firstBox.x + firstBox.width).toBe(true);
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
  await page.getByRole("button", { name: "Open in progress folder", exact: true }).click();
  const card = page.locator("[data-board-card]").first();
  await card.locator('[data-folder-name]').hover();
  await expect(card).toHaveCSS("transform", "none");
  await expect(card).toHaveCSS("transition-duration", "0s");
  await card.focus();
  await expect(card).toHaveCSS("outline-width", "3px");
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
    await expect(folder).toHaveCSS("--folder-fill", "#f5f7f5");
    await expect(folder.getByRole("article", { name: "Referral intake chart", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Drop files or choose files/ })).toBeVisible();
    const email = folder.getByRole("textbox", { name: "Referrer email:", exact: true });
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
    // Preparation opens all questions, so the copied date is directly editable
    // rather than hidden behind the interview reference panel.
    await expect(page.getByLabel("Date of birth", { exact: true })).toHaveValue("1972-05-08");
  });
}
