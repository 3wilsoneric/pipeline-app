import { expect, test, webkit, type Page } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { getReferralBoardState } from "@/lib/pipeline/referral-flow";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { WorkspaceStateProjection } from "@/lib/pipeline/workspace-state";

test("accepted board cards lead to the admission checklist rather than inventing a request", () => {
  const requirement = {
    id: "tb-result",
    type: "tb_test",
    requiredFor: "move_in",
    status: "needed",
    nextStep: "Request a current TB result and verify its date.",
  } as NonNullable<Referral["requirements"]>[number];
  const referral = {
    stage: "Assessment",
    workflowStatus: "approved_for_placement",
    requirements: [requirement],
  } as Referral;
  const state = {
    lifecycle: "active",
    outcome: "accepted",
    assessment: "signed",
    assessment_is_reassessment: false,
  } as WorkspaceStateProjection;

  expect(getReferralBoardState(referral, {}, state)).toMatchObject({
    stage: "decision",
    detail: "Accept",
    next_action: "Complete admission documents",
    location: { view: "files" },
  });
  expect(getReferralBoardState({ ...referral, requirements: [{ ...requirement, status: "received" }] }, {}, state)).toMatchObject({
    detail: "Awaiting admit",
    next_action: "Record admission",
  });
});

test("board folders show document work without an overall completion percentage", async ({ page }, testInfo) => {
  await homeFixture(page);
  await page.goto("/");
  const card = page.locator("[data-board-card]").first();
  await expect(card).toContainText(/Documents needed\s*1/);
  await expect(card).not.toContainText("File progress");
  await expect(card).not.toContainText(/\d+% complete/);
  await card.screenshot({ path: testInfo.outputPath("board-card.png"), animations: "disabled" });
});

async function homeFixture(page: Page, moduleIds = ["current-work", "new-assignments", "upcoming-assessments"], filesPerStage = 0, withFinished = false, longLabels = false, scope?: "mixed" | "team-only") {
  const acknowledgments: unknown[] = [];
  let layout = { schema: 3, module_ids: moduleIds, locked: true };
  const { viewer } = await (await page.request.get("/api/operations/home")).json();
  await page.addInitScript(({ key, layout }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(layout));
  }, { key: `pipeline:home-layout:v1:${encodeURIComponent(viewer.id)}`, layout });
  await page.route("**/api/me/home-layout", async (route) => {
    if (route.request().method() === "PUT") layout = route.request().postDataJSON().layout;
    await route.fulfill({ json: { layout } });
  });
  await page.route("**/api/operations/home", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const item = {
      board: { stage: "received", detail: "Referral received", next_action: "Add referral information", location: { view: "intake" } },
      referral_id: 910501, client_name: "Avery Board", community: "San Pablo", stage: "New",
      workflow_status: "ready_to_schedule", flow_state: "ready_to_schedule", assessment_state: "not_started",
      outcome_state: "pending", assignment_state: "assigned", document_state: "partial", profile_state: "partial",
      assessment_is_reassessment: false, owner: "Example Assessor", priority: "standard", categories: [],
      primary_category: "follow_up", next_action: "Schedule the assessment", blockers: [], missing_data: [],
      urgency: "normal", due_at: null, last_activity_at: "2026-09-20T15:00:00Z", age_hours: 1,
      completion_pct: 40, missing_document_count: 1, location: { view: "intake" },
    };
    payload.unavailable_sections = [];
    const boardItems = filesPerStage ? [
      { name: "Avery", workflow_status: "ready_to_schedule", assessment_state: "not_started" },
      { name: "Jordan", workflow_status: "assessment_in_progress", assessment_state: "in_progress" },
      { name: "Morgan", workflow_status: "decision_pending", assessment_state: "signed" },
    ].flatMap((stage, stageIndex) => Array.from({ length: filesPerStage }, (_, index) => ({
      ...item, referral_id: 920000 + stageIndex * 100 + index,
      client_name: `${stage.name} ${["Rivera", "Brooks", "Chen", "Patel", "Torres", "Bennett", "Parker", "Reed", "Hayes", "Ellis"][index]}`,
      workflow_status: stage.workflow_status, assessment_state: stage.assessment_state,
      board: { stage: ["received", "in_progress", "decision"][stageIndex], detail: ["Referral received", "Assessment underway", "Under review"][stageIndex], next_action: ["Add referral information", "Continue assessment", "Record decision"][stageIndex], location: { view: ["intake", "assessment", "workflow"][stageIndex] } },
    }))) : [item];
    if (longLabels) Object.assign(boardItems[0], {
      client_name: "Alexandria Montgomery-Rivera", owner: "Christopher Montgomery-Williams",
      next_action: "Confirm the current medication list and the assessment location with the referring case manager.",
      board: { ...boardItems[0].board, next_action: "Confirm the current medication list and the assessment location with the referring case manager." },
    });
    payload.workflow = { ...payload.workflow, active_items: boardItems, board_items: boardItems, active_total: boardItems.length };
    if (withFinished) {
      payload.workflow.board_items = [...boardItems,
        { ...item, referral_id: 930001, client_name: "Accepted Client", workflow_status: "approved_for_placement", outcome_state: "accepted", flow_state: "complete_chart", board: { stage: "decision", detail: "Accept", next_action: "Review and sign the assessment", location: { view: "assessment" } } },
        { ...item, referral_id: 930002, client_name: "Denied Client", workflow_status: "declined", outcome_state: "declined", flow_state: "complete", board: { stage: "decision", detail: "Denied", next_action: "Review decision", location: { view: "workflow" } } },
        { ...item, referral_id: 930003, client_name: "Admitted Client", workflow_status: "admitted", outcome_state: "accepted", flow_state: "complete", board: { stage: "decision", detail: "Email not sent", next_action: "Send Meet the Client", location: { view: "email" } } },
        { ...item, referral_id: 930004, client_name: "Awaiting Client", workflow_status: "approved_for_placement", outcome_state: "accepted", flow_state: "complete", board: { stage: "decision", detail: "Awaiting admit", next_action: "Record admission", location: { view: "workflow" } } },
      ];
    }
    payload.workflow.all_board_items = [...payload.workflow.board_items];
    if (scope) {
      for (const [index, workflow_status] of ["ready_to_schedule", "assessment_in_progress", "decision_pending", "admitted"].entries()) {
        payload.workflow.all_board_items.push({ ...item, referral_id: 940000 + index, client_name: `Team ${["Rivera", "Brooks", "Chen", "Patel"][index]}`, workflow_status,
          owner: "Another Assessor", outcome_state: workflow_status === "admitted" ? "accepted" : "pending",
          board: { stage: ["received", "in_progress", "decision", "awaiting_admit"][index], detail: ["Referral received", "Assessment underway", "Under review", "Email not sent"][index], next_action: "Open workspace", location: { view: "workflow" } } });
      }
      if (scope === "team-only") Object.assign(payload.workflow, { active_items: [], board_items: [], active_total: 0 });
    }
    payload.upcoming = [{ id: "synthetic-appointment", referralId: 910502, clientName: "Jordan Appointment", community: "San Pablo", owner: "Example Assessor", date: "2026-09-22", startsAt: "2026-09-22T17:00:00Z", method: "in_person", kind: "assessment", status: "scheduled", title: "Assessment" }];
    payload.continuity = { ...payload.continuity, unavailable: false, needs_assignment_tracking_initialization: false,
      new_assignments: Array.from({ length: 7 }, (_, index) => ({ event_id: `focus-assignment-${index}`, action: "referral_assigned", actor_id: "coordinator", actor_name: "Example Coordinator", created_at: new Date().toISOString(), workspace: { referral_id: 910510 + index, client_name: `New Client ${index + 1}`, community: "San Pablo", owner: "Example Assessor", workflow_status: "intake_in_progress", workspace_status: "active" }, attention: null })),
    };
    await route.fulfill({ response, json: payload });
  });
  await page.route("**/api/me/work-continuity", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const body = route.request().postDataJSON();
    if (body.acknowledgeAssignmentIds) acknowledgments.push(body);
    await route.fulfill({ json: { state: { schema: 1, acknowledgedAssignmentIds: [] } } });
  });
  return acknowledgments;
}

for (const width of [1440, 390]) test(`folder All and Mine switch instantly without changing stages at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await homeFixture(page, undefined, 2, true, false, "mixed");
  await page.goto("/");
  for (const [index, title] of ["Referral received", "In progress", "Decision", "Awaiting admit"].entries()) {
    if (width < 1024) await page.getByRole("combobox", { name: "Referral stage", exact: true }).selectOption(["received", "in_progress", "decision", "awaiting_admit"][index]);
    const opener = page.getByRole("button", { name: `Open ${title.toLowerCase()} folder`, exact: true });
    await opener.click();
    const folder = page.getByRole("dialog", { name: `${title} folder`, exact: true });
    const toggle = folder.getByRole("group", { name: "Folder scope" });
    await expect(toggle.getByRole("button", { name: "Mine", exact: true })).toHaveAttribute("aria-pressed", "true");
    await folder.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => undefined))); });
    const mineCount = await folder.locator("[data-board-card]").count();
    // All data is already present. Even a disconnected browser can switch scopes.
    await page.context().setOffline(true);
    await toggle.getByRole("button", { name: "All", exact: true }).click();
    await expect(folder.locator("[data-board-card]")).toHaveCount(mineCount + 1);
    await expect(folder.getByRole("button", { name: `Open Team ${["Rivera", "Brooks", "Chen", "Patel"][index]}`, exact: true })).toBeVisible();
    await expect(folder.locator("h2")).toContainText(`${mineCount + 1} files`);
    expect(await folder.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const box = await toggle.getByRole("button", { name: "All", exact: true }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    if (index === 0) await page.screenshot({ path: info.outputPath(`folder-scope-${width}.png`), animations: "disabled" });
    await toggle.getByRole("button", { name: "Mine", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(folder.locator("[data-board-card]")).toHaveCount(mineCount);
    await page.context().setOffline(false);
    await page.keyboard.press("Escape");
    await expect(folder).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
});

test("All is reachable when Mine is empty, including admitted referrals awaiting email", async ({ page }) => {
  await homeFixture(page, undefined, 0, false, false, "team-only");
  await page.goto("/");
  for (const title of ["Referral received", "Awaiting admit"]) {
    await page.getByRole("button", { name: `Open ${title.toLowerCase()} folder`, exact: true }).click();
    const folder = page.getByRole("dialog", { name: `${title} folder`, exact: true });
    await expect(folder).toContainText("None assigned to you here.");
    await folder.getByRole("button", { name: "All", exact: true }).click();
    await expect(folder.locator("[data-board-card]").first()).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

for (const width of [1440, 834, 390, 320]) test(`focus deck keeps the foreground legible and backgrounds inert at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const acknowledged = await homeFixture(page);
  await page.goto("/");
  const deck = page.getByTestId("home-focus-deck");
  const tabs = deck.getByRole("tab");
  await expect(tabs).toHaveText(["BoardBoard1", "Upcoming assessmentsUpcoming1", "New assignmentsNew7"]);
  await expect(deck.getByRole("button", { name: /^(Previous|Next) Home panel$/ })).toHaveCount(0);
  await expect(deck.getByRole("tabpanel", { name: "Board", exact: true })).toBeVisible();
  await expect(deck.getByRole("button", { name: "Open Avery Board" })).toBeVisible();
  await expect(deck.locator('[data-position]:not([data-position="front"])[inert][aria-hidden="true"]')).toHaveCount(2);
  await expect(deck.getByRole("region", { name: "Upcoming assessments", exact: true })).toHaveCount(0);
  await deck.screenshot({ path: info.outputPath(`home-board-${width}.png`), animations: "disabled" });
  await tabs.nth(1).click();
  await expect(deck.getByRole("tabpanel", { name: "Upcoming assessments", exact: true })).toBeVisible();
  await expect(deck.getByRole("button", { name: /Jordan Appointment/ })).toBeVisible();
  if (width < 640) {
    const appointment = deck.getByRole("button", { name: /Jordan Appointment/ });
    const name = appointment.locator("strong");
    const action = appointment.getByText("Begin assessment", { exact: true });
    expect((await name.boundingBox())!.width).toBeGreaterThan(200);
    expect((await action.boundingBox())!.y).toBeGreaterThan((await name.boundingBox())!.y + (await name.boundingBox())!.height);
    // The deck scales into place; measure its settled touch target, not an animation frame.
    await expect.poll(async () => (await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await deck.screenshot({ path: info.outputPath(`home-upcoming-${width}.png`), animations: "disabled" });
  await tabs.nth(2).click();
  await expect(deck.getByRole("region", { name: "Since your last visit" })).toBeVisible();
  await deck.getByRole("button", { name: "Show 1 more assignments" }).click();
  await tabs.nth(0).click();
  await tabs.nth(2).click();
  await expect(deck.getByRole("button", { name: /New Client 7/ })).toBeVisible();
  expect(acknowledged).toEqual([]);
  const scrollWidths = await page.locator('[data-guide-target="home-workspace"]').evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(scrollWidths.scroll).toBeLessThanOrEqual(scrollWidths.client);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await deck.screenshot({ path: info.outputPath(`home-assignments-${width}.png`), animations: "disabled" });
  await deck.getByRole("button", { name: /New Client 1/ }).click();
  await expect(page).toHaveURL(/referralId=910510/);
  await expect.poll(() => acknowledged).toEqual([{ acknowledgeAssignmentIds: ["focus-assignment-0"] }]);
});

test("keyboard controls wrap, keep focus, and appointments keep their assessment destination", async ({ page }) => {
  await homeFixture(page);
  await page.goto("/");
  const tabs = page.getByRole("tablist", { name: "Home panels" });
  await tabs.getByRole("tab", { name: "Board", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.getByRole("tab", { name: "New assignments", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Board", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(tabs.getByRole("tab", { name: "New assignments", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Upcoming assessments", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: /Jordan Appointment/ }).click();
  await expect(page).toHaveURL(/referralId=910502/);
  await expect(page).toHaveURL(/workspaceStage=assessment/);
});

for (const { width, count } of [{ width: 1440, count: 5 }, { width: 1440, count: 10 }, { width: 834, count: 10 }, { width: 390, count: 10 }]) {
  test(`straight deck contains ${count} files per stage at ${width}px without clipping or nested scrolling`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await homeFixture(page, undefined, count);
    await page.goto("/");
    const deck = page.getByTestId("home-focus-deck");
    const stage = page.getByTestId("home-focus-stage");
    const board = deck.getByRole("tabpanel", { name: "Board", exact: true });
    const received = board.locator('[data-board-stage="received"]');
    const folders = received.locator("[data-board-card]");
    await expect(folders).toHaveCount(count);
    await expect(board.locator("[data-board-card]")).toHaveCount(count * 3);
    await expect(board).toHaveCSS("position", "relative");
    await expect(board).toHaveCSS("overflow-y", "visible");
    await expect(stage).toHaveCSS("overflow-y", "visible");
    const panels = await deck.locator("[data-position]").evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect();
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return { x: bounds.x + bounds.width / 2, y: bounds.y, width: bounds.width, rotation: matrix.m12, skew: matrix.m21, offset: matrix.m41 };
    }));
    for (const background of panels.slice(1)) {
      expect(background.rotation).toBe(0);
      expect(background.skew).toBe(0);
      expect(background.offset).toBe(0);
      expect(Math.abs(background.x - panels[0].x)).toBeLessThan(1);
      expect(background.y).toBeLessThan(panels[0].y);
      expect(background.width).toBeLessThan(panels[0].width);
    }
    const collapsed = (await received.boundingBox())!.height;
    if (width >= 1024) {
      expect(collapsed).toBeLessThan(350 + count * 110);
      await folders.first().locator("[data-folder-name]").hover();
      await expect(folders.first()).toHaveCSS("margin-bottom", "-130px");
      await expect.poll(async () => (await received.boundingBox())!.height).toBeGreaterThan(collapsed + 70);
      await page.screenshot({ path: info.outputPath(`stack-${count}-${width}.png`), animations: "disabled" });
      await page.getByRole("tab", { name: "Board", exact: true }).hover();
      await folders.first().focus();
      await expect(folders.first()).toHaveCSS("margin-bottom", "-130px");
    }
    for (const key of width >= 1024 ? ["received", "in_progress", "decision"] : ["received"]) {
      const last = board.locator(`[data-board-stage="${key}"] [data-board-card]`).last();
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      const bounds = (await last.boundingBox())!;
      const container = (await board.boundingBox())!;
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(container.y + container.height);
    }
    await page.screenshot({ path: info.outputPath(`stack-end-${count}-${width}.png`), animations: "disabled" });
    expect(Math.abs((await stage.boundingBox())!.height - (await board.boundingBox())!.height)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("tab", { name: "Upcoming assessments", exact: true }).click();
    await expect.poll(async () => (await stage.boundingBox())!.height).toBeLessThan(700);
    await page.getByRole("tab", { name: "Board", exact: true }).click();
    if (width < 1024) {
      await board.getByLabel("Referral stage").selectOption("in_progress");
      const last = board.getByRole("button", { name: "Open Jordan Ellis", exact: true });
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      await page.screenshot({ path: info.outputPath(`stack-bottom-${width}.png`) });
      await last.click();
      await expect(page).toHaveURL(/referralId=920109/);
    } else {
      await expect(folders).toHaveCount(count);
    }
  });
}

test("horizontal gestures turn the deck, vertical and cancelled gestures do not, and reduced motion settles immediately", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await homeFixture(page);
  await page.goto("/");
  const stage = page.getByTestId("home-focus-stage");
  await expect(page.getByRole("tab", { name: "Board", exact: true })).toHaveAttribute("aria-selected", "true");
  const bounds = (await stage.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .75, bounds.y + 12);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .25, bounds.y + 12, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("tab", { name: "Upcoming assessments", exact: true })).toHaveAttribute("aria-selected", "true");
  await stage.dispatchEvent("pointerdown", { pointerId: 3, isPrimary: true, pointerType: "touch", button: 0, clientX: 150, clientY: 200 });
  await stage.dispatchEvent("pointermove", { pointerId: 3, clientX: 160, clientY: 270 });
  await stage.dispatchEvent("pointerup", { pointerId: 3, clientX: 250, clientY: 300 });
  await expect(page.getByRole("tab", { name: "Upcoming assessments", exact: true })).toHaveAttribute("aria-selected", "true");
  await stage.dispatchEvent("pointerdown", { pointerId: 4, isPrimary: true, pointerType: "touch", button: 0, clientX: 150, clientY: 200 });
  await stage.dispatchEvent("pointercancel", { pointerId: 4, clientX: 250, clientY: 200 });
  await expect(page.getByRole("tab", { name: "Upcoming assessments", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("tab", { name: "New assignments", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "New assignments", exact: true })).toHaveCSS("transition-duration", "0s");
});

test("existing Home customization remains intact and never removes the board", async ({ page }) => {
  await homeFixture(page, ["current-work", "upcoming-assessments"]);
  await page.goto("/");
  await expect(page.getByRole("tablist", { name: "Home panels" }).getByRole("tab")).toHaveCount(2);
  await page.goto("/?editHome=1");
  await expect(page.getByTestId("home-focus-deck")).toHaveCount(0);
  await page.getByRole("button", { name: "Remove Upcoming assessments from Home" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Board", exact: true })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Home panels" }).getByRole("tab")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Next Home panel" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("tablist", { name: "Home panels" }).getByRole("tab")).toHaveCount(1);
});

for (const width of [1440, 834, 390, 320]) test(`stage folder expands in place with all ten files at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 950 });
  await homeFixture(page, undefined, 10);
  await page.goto("/");
  const source = page.locator('[data-board-stage="received"]');
  const open = source.getByRole("button", { name: "Open referral received folder", exact: true });
  await expect(open).toBeVisible();
  await expect(open).toContainText("View all");
  const hitArea = (await open.boundingBox())!;
  expect(hitArea.height).toBeGreaterThanOrEqual(72);
  expect(hitArea.width).toBeGreaterThan((await source.boundingBox())!.width * .85);
  if (width === 1440) {
    await page.getByRole("tab", { name: "Board", exact: true }).hover();
    const before = (await source.boundingBox())!;
    await open.hover();
    await expect.poll(async () => (await source.boundingBox())!.width).toBeGreaterThan(before.width);
  }
  const originalUrl = page.url();
  let homeReads = 0;
  page.on("request", request => { if (request.url().endsWith("/api/operations/home")) homeReads++; });
  await open.click({ position: { x: hitArea.width - 12, y: hitArea.height / 2 } });
  const dialog = page.getByRole("dialog", { name: "Referral received folder", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => undefined))); });
  await expect(dialog.getByRole("heading", { name: /^Referral received 10 files$/i })).toBeVisible();
  await expect(dialog.locator("[data-board-card]")).toHaveCount(10);
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  expect(page.url()).toBe(originalUrl);
  expect(homeReads).toBe(0);
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.width).toBeGreaterThan(width * .9);
  expect(bounds.height).toBeGreaterThan(900);
  const cards = dialog.locator("[data-board-card]");
  const positions = await cards.evaluateAll(elements => elements.map(element => {
    const { left, top, bottom } = element.getBoundingClientRect();
    return { left, top, bottom, margin: getComputedStyle(element).marginBottom };
  }));
  for (let index = 0; index < positions.length; index++) {
    expect(positions[index].margin).toBe("0px");
    const above = positions.slice(0, index).filter(card => Math.abs(card.left - positions[index].left) < 1).at(-1);
    if (above) expect(positions[index].top).toBeGreaterThan(above.bottom);
  }
  await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (selector: string, options: object) => Promise<AxeResults> } }).axe;
    return (await axe.run('dialog[open]', { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations;
  });
  expect(violations).toEqual([]);
  await page.screenshot({ path: info.outputPath(`folder-open-${width}.png`), animations: "disabled" });
  await cards.last().scrollIntoViewIfNeeded();
  await expect(cards.last()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(page.getByRole("tab", { name: "Board", exact: true })).toHaveAttribute("aria-selected", "true");
  await open.click();
  await dialog.getByRole("button", { name: "Open Avery Ellis", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/referralId=920009/);
});

test("decision tabs use distinct colors and admitted files await email without a Finished folder", async ({ page }, info) => {
  await homeFixture(page, undefined, 1, true);
  await page.goto("/");
  await expect(page.locator('[data-board-stage="decision"]').getByRole("button", { name: "Open Accepted Client", exact: true })).toBeVisible();
  await expect(page.locator('[data-board-stage="decision"]').getByRole("button", { name: "Open Denied Client", exact: true })).toBeVisible();
  await expect(page.locator('[data-board-stage="decision"]').getByRole("button", { name: "Open Admitted Client", exact: true })).toContainText("Email not sent");
  await expect(page.locator('[data-board-stage="decision"]').getByRole("button", { name: "Open Awaiting Client", exact: true })).toContainText("Awaiting admit");
  await expect(page.locator('[data-board-stage]')).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Open awaiting admit folder", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open finished referrals folder", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Open decision folder", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Decision folder", exact: true });
  await expect(dialog.locator("[data-board-status]")).toHaveText(["Under review", "Accept", "Denied", "Email not sent", "Awaiting admit"]);
  const colors = await dialog.locator("[data-board-status]").evaluateAll(tabs => tabs.map(tab => getComputedStyle(tab).backgroundColor));
  expect(new Set(colors).size).toBe(3);
  await dialog.screenshot({ path: info.outputPath("decision-tabs.png"), animations: "disabled" });
});

test("folder expansion respects reduced motion and empty stages", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await homeFixture(page);
  await page.goto("/");
  const open = page.getByRole("button", { name: "Open decision folder", exact: true });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Decision folder", exact: true });
  await expect(dialog).toContainText("No referrals in this folder.");
  expect(await dialog.evaluate(element => element.getAnimations().length)).toBe(0);
  await dialog.getByRole("button", { name: "Close decision folder", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
});

test("Escape closes only the expanded folder inside the existing board view", async ({ page }) => {
  await homeFixture(page, undefined, 3);
  await page.goto("/");
  await page.getByRole("button", { name: "Open current work", exact: true }).click();
  const board = page.getByRole("dialog", { name: "Current work", exact: true });
  await expect(board).toBeVisible();
  const open = board.getByRole("button", { name: "Open referral received folder", exact: true });
  await open.click();
  const folder = page.getByRole("dialog", { name: "Referral received folder", exact: true });
  await expect(folder).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(folder).toHaveCount(0);
  await expect(board).toBeVisible();
  await expect(open).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(board).toHaveCount(0);
});

test("an expanded stage stays visible when the window becomes narrow", async ({ page }) => {
  await homeFixture(page, undefined, 3);
  await page.goto("/");
  await page.getByRole("button", { name: "Open in progress folder", exact: true }).click();
  const folder = page.getByRole("dialog", { name: "In progress folder", exact: true });
  await expect(folder).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(folder).toBeVisible();
  await expect(folder.getByRole("button", { name: "Open Jordan Chen", exact: true })).toBeVisible();
  await folder.getByRole("button", { name: "Close in progress folder", exact: true }).click();
  await expect(folder).toHaveCount(0);
  await expect(page.getByLabel("Referral stage")).toHaveValue("in_progress");
  await expect(page.getByRole("button", { name: "Open in progress folder", exact: true })).toBeFocused();
});

test("expanded folders retain stage accents and long file labels stay readable", async ({ page }, info) => {
  await homeFixture(page, undefined, 3, true, true);
  await page.goto("/");
  const colors = new Set<string>();
  for (const title of ["Referral received", "In progress", "Decision"]) {
    await page.getByRole("button", { name: `Open ${title.toLowerCase()} folder`, exact: true }).click();
    const folder = page.getByRole("dialog", { name: `${title} folder`, exact: true });
    await expect(folder).toBeVisible();
    await folder.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => undefined))); });
    colors.add(await folder.locator("h2 svg").evaluate(element => getComputedStyle(element).color));
    await page.screenshot({ path: info.outputPath(`stage-${title.toLowerCase().replaceAll(" ", "-")}.png`), animations: "disabled" });
    await folder.getByRole("button", { name: `Close ${title.toLowerCase()} folder`, exact: true }).click();
    await expect(folder).toHaveCount(0);
  }
  expect(colors.size).toBe(3);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByLabel("Referral stage").selectOption("received");
  await page.getByRole("button", { name: "Open referral received folder", exact: true }).click();
  const folder = page.getByRole("dialog", { name: "Referral received folder", exact: true });
  const file = folder.getByRole("button", { name: "Open Alexandria Montgomery-Rivera", exact: true });
  await expect(file).toContainText("Christopher Montgomery-Williams");
  const clipped = await file.evaluate(element => [...element.querySelectorAll("span, strong")].filter(node => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1).map(node => node.textContent));
  expect(clipped).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("long-labels-phone.png"), animations: "disabled" });
  await page.emulateMedia({ forcedColors: "active" });
  await expect(folder.getByRole("button", { name: "Close referral received folder", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("folder-high-contrast.png"), animations: "disabled" });
});

test("iPad folder scrolling does not turn the Home deck", async ({ baseURL }) => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 834, height: 1194 }, hasTouch: true, isMobile: true });
    await homeFixture(page, undefined, 10);
    await page.goto("/");
    const open = page.getByRole("button", { name: "Open referral received folder", exact: true });
    await open.tap();
    const dialog = page.getByRole("dialog", { name: "Referral received folder", exact: true });
    await expect(dialog).toBeVisible();
    const grid = dialog.locator("[data-expanded-folder]");
    await grid.dispatchEvent("pointerdown", { pointerId: 8, isPrimary: true, pointerType: "touch", button: 0, clientX: 200, clientY: 300 });
    await grid.dispatchEvent("pointermove", { pointerId: 8, clientX: 80, clientY: 304 });
    await grid.dispatchEvent("pointerup", { pointerId: 8, clientX: 80, clientY: 304 });
    await dialog.locator("[data-board-card]").last().scrollIntoViewIfNeeded();
    await expect(dialog.locator("[data-board-card]").last()).toBeInViewport();
    await dialog.getByRole("button", { name: "Close referral received folder", exact: true }).tap();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Board", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(open).toBeFocused();
  } finally { await browser.close(); }
});
