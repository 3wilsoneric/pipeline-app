import { expect, test, type Page } from "@playwright/test";

const defaults = ["current-work", "new-assignments", "upcoming-assessments"];
const completeModuleSet = ["search", "recent-work", ...defaults, "scheduling-queue"];
const serverStateEnabled = process.env.PIPELINE_DESKTOP_E2E === "true";

for (const entry of ["click", "shortcut"]) {
  test(`preserves an active ${entry} search when the Home briefing finishes loading`, async ({ page }) => {
    const response = await page.request.get("/api/operations/home");
    const briefing = await response.json();
    await mockLayout(page, [...defaults, "search"]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/operations/home", async (route) => {
      await gate;
      await route.fulfill({ json: briefing });
    });
    if (entry === "shortcut") {
      await page.goto("/?view=referrals");
      await expect(page.locator("html")).toHaveAttribute("data-pipeline-keyboard-shortcuts-ready", "true");
      await page.keyboard.press("/");
    } else {
      await page.goto("/");
      await page.getByRole("button", { name: "Open search", exact: true }).click();
    }
    const input = page.getByRole("textbox", { name: "Search or ask" });
    await input.fill("Avery");
    const originalInput = await input.elementHandle();
    release();
    await expect(page.getByRole("region", { name: "Current work", exact: true })).toBeVisible();
    await expect(input).toHaveValue("Avery");
    await expect(input).toBeFocused();
    expect(await originalInput!.evaluate((element) => element.isConnected)).toBe(true);
  });
}

async function moduleOrder(page: Page) {
  return page.locator("[data-home-module]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-home-module")));
}

async function mockLayout(page: Page, moduleIds: string[] = defaults) {
  let layout = { schema: 3, module_ids: moduleIds, locked: true };
  const writes: typeof layout[] = [];
  if (!serverStateEnabled) {
    const home = await page.request.get("/api/operations/home");
    expect(home.ok()).toBe(true);
    const { viewer } = await home.json();
    const key = `pipeline:home-layout:v1:${encodeURIComponent(viewer.id)}`;
    await page.exposeFunction("recordHomeLayout", (saved: typeof layout) => writes.push(saved));
    await page.addInitScript(({ key, layout }) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(layout));
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        setItem.call(this, name, value);
        if (this === localStorage && name === key) {
          void (window as typeof window & { recordHomeLayout: (saved: unknown) => Promise<void> }).recordHomeLayout(JSON.parse(value));
        }
      };
    }, { key, layout });
  }
  await page.route("**/api/me/home-layout", async (route) => {
    if (route.request().method() === "PUT") {
      layout = route.request().postDataJSON().layout;
      if (serverStateEnabled) writes.push(layout);
    }
    await route.fulfill({ json: { layout } });
  });
  return writes;
}

test("separates Home modules with light emerald surfaces and responsive spacing", async ({ page }, testInfo) => {
  await mockLayout(page, completeModuleSet);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Current work", exact: true })).toBeVisible();

  const surfaces = page.locator('[data-home-surface="true"]');
  await expect(surfaces).toHaveCount(6);
  const styles = await surfaces.evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderTopColor: style.borderTopColor,
      borderTopWidth: style.borderTopWidth,
    };
  }));
  for (const style of styles) {
    expect(style.backgroundColor).toMatch(/^rgba?\(255, 255, 255/);
    expect(style.borderTopColor).toBe("rgb(220, 231, 226)");
    expect(style.borderTopWidth).toBe("1px");
  }
  await expect(page.locator('[data-guide-target="home-workspace"]')).toHaveCSS("background-color", "rgb(242, 247, 245)");
  await page.screenshot({ path: testInfo.outputPath("home-surfaces-desktop.png"), animations: "disabled", fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("home-surfaces-mobile.png"), animations: "disabled", fullPage: true });
});

test("removes search and recent work, adds a batch once, and keeps canceled selections out of Home", async ({ page }) => {
  const writes = await mockLayout(page, ["search", "recent-work", ...defaults]);
  await page.goto("/?editHome=1");
  await page.getByRole("button", { name: "Remove Search from Home", exact: true }).click();
  await page.getByRole("button", { name: "Remove Recent work from Home", exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  await page.getByRole("button", { name: "Add module", exact: true }).click();
  const library = page.getByRole("dialog", { name: "Home module library" });
  await library.getByRole("checkbox", { name: "Search", exact: true }).check();
  await library.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(writes).toHaveLength(2);
  await page.getByRole("button", { name: "Add module", exact: true }).click();
  await expect(library.getByRole("checkbox", { name: "Search", exact: true })).not.toBeChecked();
  await library.getByRole("checkbox", { name: "Search", exact: true }).check();
  await library.getByRole("checkbox", { name: "Recent work", exact: true }).check();
  await library.getByRole("button", { name: "Add 2 modules", exact: true }).click();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2].module_ids).toEqual(["current-work", "new-assignments", "upcoming-assessments", "search", "recent-work"]);
  await page.reload();
  await expect.poll(() => moduleOrder(page)).toEqual(writes[2].module_ids);
});

test("keeps header search usable without the Home search module", async ({ page }) => {
  await mockLayout(page, ["current-work"]);
  await page.goto("/");
  await expect.poll(() => moduleOrder(page)).toEqual(["current-work"]);
  await expect(page.getByRole("region", { name: "Search Pipeline", exact: true })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-pipeline-keyboard-shortcuts-ready", "true");
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Search Pipeline", exact: true });
  await expect(search).toBeVisible();
  expect((await search.boundingBox())!.width).toBeLessThanOrEqual(760);
  await expect(search.getByRole("textbox", { name: "Search or ask" })).toBeFocused();
  await search.getByRole("textbox", { name: "Search or ask" }).fill("calendar");
  await expect(search).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await expect.poll(() => moduleOrder(page)).toEqual(["current-work"]);
});

for (const width of [390, 1440]) {
  test(`module screenshots enlarge without changing selection at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = await mockLayout(page, ["current-work"]);
    await page.goto("/?editHome=1");
    await page.getByRole("button", { name: "Add module", exact: true }).click();
    const library = page.getByRole("dialog", { name: "Home module library", exact: true });
    await library.getByRole("checkbox", { name: "Search", exact: true }).check();
    for (const button of await library.getByRole("button", { name: /^Preview / }).all()) {
      await button.scrollIntoViewIfNeeded();
      await expect.poll(() => button.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    }
    const previewButton = library.getByRole("button", { name: "Preview Board", exact: true });
    await previewButton.click();
    const preview = page.getByRole("dialog", { name: "Board module preview", exact: true });
    await expect(preview).toBeVisible();
    await expect(preview.getByRole("button", { name: "Close board module preview" })).toBeFocused();
    await expect(preview.getByRole("img")).toBeVisible();
    expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`module-enlarged-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect(library).toBeVisible();
    await expect(previewButton).toBeFocused();
    await expect(library.getByRole("checkbox", { name: "Search", exact: true })).toBeChecked();
    await expect(library.getByRole("checkbox", { name: "Board", exact: true })).toBeDisabled();
    expect(writes).toHaveLength(0);
    await library.evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: testInfo.outputPath(`module-gallery-${width}.png`) });
    await library.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(() => moduleOrder(page)).toEqual(["current-work"]);
    expect(writes).toHaveLength(0);
  });
}

test.describe("module preview assets", () => {
test.use({ deviceScaleFactor: 2, timezoneId: "America/Los_Angeles" });
test("captures real Home module previews with synthetic data", async ({ page, baseURL }, testInfo) => {
  test.skip(process.env.PIPELINE_CAPTURE_HOME_MODULES !== "true", "Opt-in local asset capture, not a live-data screenshot task.");
  expect(["127.0.0.1", "localhost"]).toContain(new URL(baseURL!).hostname);
  await page.setViewportSize({ width: 824, height: 1100 });
  await page.clock.setFixedTime(new Date("2026-09-14T16:00:00.000Z"));
  await mockLayout(page, completeModuleSet);
  await page.route("**/api/operations/home", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const names = ["Taylor Rivera", "Jordan Ellis"];
    payload.scope = "personal";
    payload.unavailable_sections = [];
    payload.current_work = { total: 2, items: names.map((name, index) => ({
      id: `preview-work-${index}`, referral_id: 910101 + index, client_name: name, community: "San Pablo",
      next_action: index ? "Finish the assessment and review your answers" : "Review the referral packet and complete intake",
      urgency: "normal", location: { view: index ? "assessment" : "intake" },
    })) };
    payload.workflow.active_total = 2;
    payload.workflow.flow_counts = { ready_to_schedule: 1, scheduled: 0, assessment: 1, complete_chart: 0 };
    payload.workflow.active_items = names.map((name, index) => ({
      referral_id: 910101 + index, client_name: name, community: "San Pablo", stage: "New",
      workflow_status: index ? "assessment_in_progress" : "ready_to_schedule", flow_state: index ? "assessment" : "ready_to_schedule",
      assessment_state: index ? "in_progress" : "not_started", outcome_state: "pending", assignment_state: "assigned",
      document_state: "partial", profile_state: "partial", assessment_is_reassessment: false, owner: "Example Assessor", priority: "standard",
      categories: [], primary_category: "follow_up", next_action: index ? "Finish the assessment and review your answers" : "Schedule the assessment",
      blockers: [], missing_data: [], urgency: "normal", due_at: null, last_activity_at: "2026-09-14T15:00:00Z",
      age_hours: 1, completion_pct: 40, missing_document_count: 0, location: { view: index ? "assessment" : "intake" },
    }));
    payload.continuity = {
      resume_items: [{ id: "preview-draft", kind: "referral_draft", client_name: "Taylor Rivera", community: "San Pablo", detail: "Intake in progress", updated_at: "2026-09-14T15:40:00Z", referral_id: 910101, location: { view: "intake" }, completed_fields: 8, total_fields: 14 },
        { id: "preview-assessment", kind: "assessment_draft", client_name: "Jordan Ellis", community: "San Pablo", detail: "Assessment in progress", updated_at: "2026-09-14T15:00:00Z", referral_id: 910102, location: { view: "assessment" } }],
      new_assignments: names.map((name, index) => ({ event_id: `preview-assignment-${index}`, action: "assigned", actor_id: "preview-supervisor", actor_name: "Example Supervisor", created_at: "2026-09-14T15:00:00Z", workspace: { referral_id: 910101 + index, client_name: name, community: "San Pablo", owner_id: payload.viewer.id, owner: "Example Assessor", workflow_status: "intake_in_progress", priority: "standard", workspace_status: "active" }, attention: null })),
      assignment_tracking_started_at: "2026-09-14T14:00:00Z", needs_assignment_tracking_initialization: false, unavailable: false,
    };
    payload.upcoming = names.map((name, index) => ({ id: `preview-event-${index}`, referralId: 910101 + index, clientName: name, community: "San Pablo", ownerId: payload.viewer.id, owner: "Example Assessor", date: "2026-09-15", startsAt: index ? "2026-09-15T20:00:00Z" : "2026-09-15T17:00:00Z", durationMinutes: 60, method: index ? "in_person" : "zoom", kind: "assessment", status: "scheduled", title: "Assessment", detail: "Example appointment", scheduleStatus: "scheduled" }));
    payload.unscheduled = names.map((name, index) => ({ referralId: 910101 + index, clientName: name, community: "San Pablo", owner: "Example Assessor", receivedDate: "2026-09-14", workflowStatus: "assessment_in_progress", nextAction: index ? "complete_intake" : "schedule" }));
    payload.unscheduled_total = 2;
    await route.fulfill({ response, json: payload });
  });
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Continue working", exact: true })).toContainText("Taylor Rivera");
  await page.evaluate(() => document.fonts.ready);
  for (const id of completeModuleSet.filter((id) => id !== "search")) {
    if (id === "current-work") await page.setViewportSize({ width: 1440, height: 1100 });
    await page.locator(`[data-home-module="${id}"]`).screenshot({ path: testInfo.outputPath(`${id}.png`), animations: "disabled" });
    if (id === "current-work") await page.setViewportSize({ width: 824, height: 1100 });
  }
  const search = page.locator('[data-home-module="search"]');
  await search.getByRole("button", { name: "Open search", exact: true }).click();
  await expect(search.getByRole("textbox", { name: "Search or ask" })).toBeFocused();
  await search.screenshot({ path: testInfo.outputPath("search.png"), animations: "disabled" });
});
});

for (const width of [390, 834, 1440]) {
  test(`module library fits ${width}px, keeps background controls inert, and restores focus`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await mockLayout(page, ["current-work"]);
    await page.goto("/?editHome=1");
    const add = page.getByRole("button", { name: "Add module", exact: true });
    await add.click();
    const library = page.getByRole("dialog", { name: "Home module library" });
    await expect(library).toBeVisible();
    if (width === 1440) expect((await library.boundingBox())!.width).toBeGreaterThan(1200);
    await expect(library.getByRole("button", { name: "Close home module library" })).toBeFocused();
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: "Search Pipeline", exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(/editHome=1/);
    await page.keyboard.press("Shift+Tab");
    // Native dialogs can move focus to browser chrome, but not the inert page.
    expect(await library.evaluate((dialog) => dialog.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
    await page.keyboard.press("Tab");
    await expect(library.getByRole("button", { name: "Close home module library" })).toBeFocused();
    await library.getByRole("checkbox", { name: "Search", exact: true }).check();
    await library.getByRole("checkbox", { name: "Recent work", exact: true }).check();
    await expect(library.getByRole("button", { name: "Add 2 modules", exact: true })).toBeInViewport();
    expect(await library.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`home-library-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(add).toBeFocused();
    await expect.poll(() => moduleOrder(page)).toEqual(["current-work"]);
  });
}

test("moves Search with the pointer and Recent work with arrow keys", async ({ page }) => {
  await mockLayout(page, ["search", "recent-work", "current-work"]);
  await page.goto("/?editHome=1");
  const handle = page.getByRole("button", { name: "Move Search", exact: true });
  await page.locator('[data-home-module="recent-work"]').scrollIntoViewIfNeeded();
  const start = await handle.boundingBox();
  const target = await page.locator('[data-home-module="recent-work"]').boundingBox();
  expect(start).not.toBeNull();
  expect(target).not.toBeNull();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => moduleOrder(page)).toEqual(["current-work", "recent-work", "search"]);
  await page.getByRole("button", { name: "Move Recent work", exact: true }).press("ArrowDown");
  await expect.poll(() => moduleOrder(page)).toEqual(["current-work", "search", "recent-work"]);
});

test("an empty Home can add modules again or restore defaults", async ({ page }) => {
  await mockLayout(page, []);
  await page.goto("/?editHome=1");
  await page.getByRole("button", { name: "Open module library" }).click();
  const library = page.getByRole("dialog", { name: "Home module library" });
  await library.getByRole("checkbox", { name: "Recent work", exact: true }).check();
  await library.getByRole("button", { name: "Add 1 module", exact: true }).click();
  await expect.poll(() => moduleOrder(page)).toEqual(["current-work", "recent-work"]);
    await expect(page.getByRole("region", { name: "Continue working" })).toBeVisible();
  await page.getByRole("button", { name: "Add module", exact: true }).click();
  await library.getByRole("button", { name: "Restore defaults" }).click();
  await expect.poll(() => moduleOrder(page)).toEqual(["current-work", ...defaults.filter((id) => id !== "current-work")]);
});

test("layout loading cannot overwrite an edit made against an unfinished read", async ({ page }) => {
  test.skip(!serverStateEnabled, "Async server reads are covered by test:e2e:desktop; browser-only layouts load synchronously.");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/me/home-layout", async (route) => {
    await gate;
    await route.fulfill({ json: { layout: { schema: 3, module_ids: ["recent-work"], locked: true } } });
  });
  await page.goto("/?editHome=1");
  await expect(page.getByRole("button", { name: "Add module", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Remove .* from Home$/ })).toHaveCount(0);
  release();
  await expect(page.getByRole("button", { name: "Add module", exact: true })).toBeEnabled();
  await expect.poll(() => moduleOrder(page)).toEqual(["recent-work"]);
});

test("the layout API migrates legacy order, preserves removals, and scopes settings to the signed-in user", async ({ request, baseURL }) => {
  test.skip(!serverStateEnabled, "The user-state API is disabled in mock browser-only mode; test:e2e:desktop enables and verifies it.");
  const origin = new URL(baseURL!).origin;
  const save = (layout: unknown) => request.put("/api/me/home-layout", { headers: { origin }, data: { layout } });
  const legacy = await save({ schema: 1, module_ids: ["scheduling-queue"], locked: true });
  expect(legacy.status()).toBe(200);
  expect((await legacy.json()).layout).toEqual({ schema: 3, module_ids: ["scheduling-queue"], locked: true });
  expect((await (await save({ schema: 2, module_ids: ["search", "recent-work", ...defaults], locked: true })).json()).layout).toEqual({ schema: 3, module_ids: defaults, locked: true });
  expect((await save({ schema: 2, module_ids: ["recent-work"], locked: true })).status()).toBe(200);
  expect((await (await request.get("/api/me/home-layout")).json()).layout.module_ids).toEqual(["recent-work"]);
  expect((await save({ schema: 2, module_ids: ["search", "search"], locked: true })).status()).toBe(400);
  const delegated = await request.post("/api/auth/assessor-session", { headers: { origin }, data: { target_principal_id: "provisional:allo:annette" } });
  expect(delegated.status()).toBe(200);
  expect((await (await request.get("/api/me/home-layout")).json()).layout.module_ids).toEqual(defaults);
  await request.delete("/api/auth/assessor-session", { headers: { origin } });
  expect((await (await request.get("/api/me/home-layout")).json()).layout.module_ids).toEqual(["recent-work"]);
  expect((await save({ schema: 3, module_ids: defaults, locked: true })).status()).toBe(200);
});
