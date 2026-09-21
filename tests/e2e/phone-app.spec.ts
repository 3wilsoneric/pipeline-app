import { chromium, webkit, expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral, createOperationalAssessment } from "./support/operational-api";

for (const [name, engine] of [["Chromium", chromium], ["WebKit", webkit]] as const) {
  test(`${name} phone pages, dates, saving and exact-question resume`, async ({ baseURL }, info) => {
    const browser = await engine.launch();
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: `Phone ${randomUUID()}`, owner: "Annette Everhart", tags: [], documentName: "", documentStatus: "Missing" }, { assigneeId: "provisional:allo:annette" });
      await createOperationalAssessment(page.request, referral.id);
      await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=identity`);
      const phone = page.locator("[data-phone-header]");
      const pocket = page.locator("[data-phone-interview]");
      await expect(phone).toBeVisible();
      await expect(pocket).toBeVisible();
      expect((await page.locator(".pipeline-surfaces > div > main").boundingBox())!.x).toBe(0);
      const choose = async (label: string) => {
        await pocket.getByRole("button", { name: "Choose questionnaire section" }).tap();
        const sheet = page.getByRole("dialog", { name: "Questionnaire sections" });
        await sheet.getByRole("searchbox", { name: "Find a question" }).fill(label);
        await sheet.getByRole("button", { name: new RegExp(`^${label}`) }).tap();
      };
      await choose("Assessment date");
      const date = pocket.getByLabel("Assessment date", { exact: true });
      await date.fill("2026-09-19");
      await date.blur();
      const read = async () => (await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments;
      await expect.poll(async () => (await read())[0]?.assessment_date).toBe("2026-09-19");
      await choose("Secondary diagnosis");
      const answer = pocket.getByRole("textbox", { name: "Secondary diagnosis", exact: true });
      await answer.fill("Synthetic phone answer");
      await answer.blur();
      await expect.poll(async () => (await read())[0]?.secondary_diagnoses).toEqual(["Synthetic phone answer"]);
      // Allow the existing debounced encrypted working-set writer to finish.
      await expect.poll(async () => page.evaluate(async () => {
        const databases = await indexedDB.databases();
        return databases.length;
      })).toBeGreaterThan(0);
      await page.waitForTimeout(400);
      await page.reload();
      await expect(answer).toHaveValue("Synthetic phone answer");
      await phone.getByRole("button", { name: /^Open page menu/ }).tap();
      const menu = page.getByRole("dialog", { name: "Pipeline pages" });
      for (const label of ["Open referrals", "Open calendar", "Open client profiles", "Open reports", "Create new referral"]) await expect(menu.getByRole("button", { name: label, exact: true })).toBeVisible();
      await expect.poll(() => menu.getByAltText("Alamo Health Management").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(774);
      await expect(menu.getByRole("button", { name: "Open calendar", exact: true }).getByText("Calendar")).toHaveCSS("font-size", "16px");
      await page.screenshot({ path: info.outputPath(`phone-menu-${name}.png`) });
      await menu.getByRole("button", { name: "Open calendar", exact: true }).tap();
      await expect(page).toHaveURL(/screen=calendar/);
      await page.goBack();
      await expect(answer).toHaveValue("Synthetic phone answer");
      await phone.getByRole("button", { name: /^Notifications/ }).tap();
      const notifications = page.getByRole("dialog", { name: "Notifications", exact: true });
      await expect(notifications).toBeVisible();
      await notifications.getByRole("button", { name: "Close notifications" }).tap();
      await expect(answer).toHaveValue("Synthetic phone answer");
      await page.locator('summary[aria-label="Assessment details"]').tap();
      await page.getByRole("button", { name: "Schedule interview", exact: true }).tap();
      await expect(page.getByRole("dialog", { name: "Schedule interview", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Close schedule", exact: true }).tap();
      await expect(answer).toHaveValue("Synthetic phone answer");
      await pocket.getByRole("button", { name: "Client info" }).tap();
      const reference = page.getByRole("dialog", { name: "Client information", exact: true });
      await reference.getByLabel("Reference information").selectOption("all");
      await expect(reference.getByRole("button", { name: "Review Assessment date", exact: true })).toContainText("2026-09-19");
      await reference.getByRole("button", { name: "Close information panel" }).tap();
      await page.screenshot({ path: info.outputPath(`phone-assessment-${name}.png`) });
      await page.context().setOffline(true);
      await answer.fill("Synthetic offline phone answer");
      await pocket.getByRole("button", { name: "Next", exact: true }).tap();
      await expect(page.locator('[data-guide-target="assessment-save-status"]')).toContainText(/offline|device|queued/i);
      await pocket.getByRole("button", { name: "Previous question", exact: true }).tap();
      await expect(answer).toHaveValue("Synthetic offline phone answer");
      await page.context().setOffline(false);
      await expect.poll(async () => (await read())[0]?.secondary_diagnoses, { timeout: 15_000 }).toEqual(["Synthetic offline phone answer"]);
      const questionBeforeSwipe = await pocket.locator("[data-working-field]").getAttribute("data-working-field");
      // Exercise our gesture handler, not a claim about OS edge gestures.
      await pocket.locator("[data-phone-question-scroll]").evaluate((element) => {
        for (const [type, x] of [["touchstart", 270], ["touchend", 100]] as const) {
          const touch = { clientX: x, clientY: 280, target: element };
          const event = new Event(type, { bubbles: true });
          Object.defineProperties(event, { touches: { value: type === "touchstart" ? [touch] : [] }, changedTouches: { value: [touch] } });
          element.dispatchEvent(event);
        }
      });
      await expect(pocket.locator("[data-working-field]")).not.toHaveAttribute("data-working-field", questionBeforeSwipe!);
      await pocket.getByRole("button", { name: "Previous question", exact: true }).tap();
      await expect(answer).toHaveValue("Synthetic offline phone answer");
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
        const result = await axe.run('[data-phone-interview]', { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
        return result.violations.filter((item) => ["serious", "critical"].includes(item.impact ?? "")).map((item) => ({ id: item.id, nodes: item.nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }));
      });
      expect(violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      const records = await read();
      expect(records).toHaveLength(1);
      expect(records[0].signed_at).toBeNull();
    } finally { await context.close(); await browser.close(); }
  });
}

test("small phone menu stays usable; tablet and desktop retain the sidebar", async ({ page }) => {
  for (const width of [320, 437, 834, 1440]) {
    await page.setViewportSize({ width, height: width < 640 ? 536 : 844 });
    await page.goto("/?screen=calendar");
    if (width < 640) {
      await page.getByRole("button", { name: /^Open page menu/ }).click();
      const menu = page.getByRole("dialog", { name: "Pipeline pages" });
      await expect(menu).toBeInViewport();
      await menu.getByRole("button", { name: /^Open profile menu/ }).click();
      await expect(page.getByRole("dialog", { name: "Profile settings" })).toBeInViewport();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    } else {
      await expect(page.getByRole("complementary", { name: "App navigation" })).toBeVisible();
      await expect(page.locator("[data-phone-header]")).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test("notification errors are explicit and assignment acknowledgment uses the existing endpoint", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = true;
  let acknowledged: string[] = [];
  const eventId = randomUUID();
  await page.route("**/api/operations/home", async (route) => {
    if (fail) return route.fulfill({ status: 503, json: { error: "Synthetic outage" } });
    await route.fulfill({ json: { continuity: {
      new_assignments: acknowledged.includes(eventId) ? [] : [{ event_id: eventId, action: "assigned", actor_name: "Synthetic Supervisor", actor_id: null, created_at: new Date().toISOString(), attention: null,
        workspace: { referral_id: 42, client_name: "Synthetic assignment", community: "Test community", owner_id: null, owner: "Playwright QA", workflow_status: "new", priority: "normal", workspace_status: "active" } }],
      unavailable: false, needs_assignment_tracking_initialization: false,
    } } });
  });
  await page.route("**/api/me/work-continuity", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    acknowledged = route.request().postDataJSON().acknowledgeAssignmentIds ?? [];
    await route.fulfill({ json: { state: { schema: 1, acknowledgedAssignmentIds: acknowledged } } });
  });
  await page.goto("/?screen=calendar");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const notifications = page.getByRole("dialog", { name: "Notifications", exact: true });
  await expect(notifications.getByRole("alert")).toContainText("Could not refresh");
  fail = false;
  await notifications.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(notifications.getByText("Synthetic assignment", { exact: true })).toBeVisible();
  await notifications.getByRole("button", { name: "Mark shown seen", exact: true }).click();
  await expect.poll(() => acknowledged).toEqual([eventId]);
  await expect(notifications.getByText("Synthetic assignment", { exact: true })).toHaveCount(0);
  await notifications.getByRole("button", { name: "Close notifications" }).click();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeFocused();
});
