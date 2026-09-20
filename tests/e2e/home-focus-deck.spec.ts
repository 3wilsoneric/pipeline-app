import { expect, test, type Page } from "@playwright/test";

async function homeFixture(page: Page, moduleIds = ["current-work", "new-assignments", "upcoming-assessments"]) {
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
      referral_id: 910501, client_name: "Avery Board", community: "San Pablo", stage: "New",
      workflow_status: "ready_to_schedule", flow_state: "ready_to_schedule", assessment_state: "not_started",
      outcome_state: "pending", assignment_state: "assigned", document_state: "partial", profile_state: "partial",
      assessment_is_reassessment: false, owner: "Example Assessor", priority: "standard", categories: [],
      primary_category: "follow_up", next_action: "Schedule the assessment", blockers: [], missing_data: [],
      urgency: "normal", due_at: null, last_activity_at: "2026-09-20T15:00:00Z", age_hours: 1,
      completion_pct: 40, missing_document_count: 1, location: { view: "intake" },
    };
    payload.unavailable_sections = [];
    payload.workflow = { ...payload.workflow, active_items: [item], board_items: [item], active_total: 1 };
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

for (const width of [1440, 834, 390, 320]) test(`focus deck keeps the foreground legible and backgrounds inert at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const acknowledged = await homeFixture(page);
  await page.goto("/");
  const deck = page.getByTestId("home-focus-deck");
  const tabs = deck.getByRole("tab");
  await expect(tabs).toHaveText(["BoardBoard1", "Upcoming assessmentsUpcoming1", "New assignmentsAssignments7"]);
  await expect(deck.getByRole("tabpanel", { name: "Board", exact: true })).toBeVisible();
  await expect(deck.getByRole("button", { name: "Open Avery Board" })).toBeVisible();
  await expect(deck.locator('[data-position]:not([data-position="front"])[inert][aria-hidden="true"]')).toHaveCount(2);
  await expect(deck.getByRole("region", { name: "Upcoming assessments", exact: true })).toHaveCount(0);
  await deck.screenshot({ path: info.outputPath(`home-board-${width}.png`), animations: "disabled" });
  await tabs.nth(1).click();
  await expect(deck.getByRole("tabpanel", { name: "Upcoming assessments", exact: true })).toBeVisible();
  await expect(deck.getByRole("button", { name: /Jordan Appointment/ })).toBeVisible();
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
  await page.getByRole("button", { name: "Next Home panel" }).click();
  await expect(tabs.getByRole("tab", { name: "Upcoming assessments", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: /Jordan Appointment/ }).click();
  await expect(page).toHaveURL(/referralId=910502/);
  await expect(page).toHaveURL(/workspaceStage=assessment/);
});

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
