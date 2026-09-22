import { expect, test, webkit, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createOperationalReferral, startOperationalAssessment } from "./support/operational-api";

async function openInterview(page: Page) {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Mobile", owner: "", tags: [] });
  const response = await page.request.post(`/api/referrals/${referral.id}/assessments`, { data: {
    client_mutation_id: randomUUID(), data: { prior_placements: "Synthetic placement notes for reference.", prior_hospitalizations_count: 0, prior_5150_5250_holds: "Synthetic history." },
  } });
  expect(response.status(), await response.text()).toBe(201);
  const { assessment } = await response.json();
  await startOperationalAssessment(page.request, assessment);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=prior_history`);
  await expect(page.locator('[data-guide-target="packet-workspace"]')).toHaveAttribute("data-performance-ready", "packet");
  await expect(page.getByTestId("packet-workspace")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("region", { name: "Assessment progress", exact: true }).getByRole("button", { name: "Begin assessment", exact: true }).click();
  await page.getByRole("dialog", { name: "Begin assessment", exact: true }).getByRole("button", { name: "Begin assessment", exact: true }).click();
  await expect(page.locator("[data-phone-interview]")).toBeVisible();
  await page.getByRole("button", { name: "Choose questionnaire section", exact: true }).click();
  const sections = page.getByRole("dialog", { name: "Questionnaire sections", exact: true });
  await sections.getByRole("searchbox", { name: "Find a question", exact: true }).fill("Prior AWOL / failed placements");
  await sections.getByRole("button", { name: /^Prior AWOL \/ failed placements/ }).click();
  return { referral, read: async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment };
}

for (const [width, height] of [[320, 650], [390, 844], [437, 536]]) {
  test(`phone prioritizes the question and saves through compact navigation at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    const { read } = await openInterview(page);
    const pocket = page.locator("[data-phone-interview]");
    const view = page.getByRole("combobox", { name: "Workspace view", exact: true });
    await expect(view).toHaveValue("2");
    await expect(page.getByRole("button", { name: "Workspace files", exact: true })).not.toBeVisible();
    expect((await page.getByTestId("workspace-folder-header").boundingBox())!.height).toBeLessThanOrEqual(64);
    expect((await pocket.locator("[data-working-field]").boundingBox())!.y).toBeLessThan(235);
    await expect(pocket.getByRole("button", { name: "Next", exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`mobile-focus-${width}.png`), animations: "disabled" });

    const answer = pocket.getByRole("textbox", { name: "Prior AWOL / failed placements", exact: true });
    await answer.fill("Synthetic interview answer retained through navigation.");
    await pocket.getByRole("button", { name: "Next", exact: true }).click();
    await expect.poll(async () => (await read()).prior_awol_failed_placements).toBe("Synthetic interview answer retained through navigation.");
    await pocket.getByRole("button", { name: "Previous question", exact: true }).click();
    await expect(answer).toHaveValue("Synthetic interview answer retained through navigation.");
    await pocket.getByRole("button", { name: "Client info", exact: true }).click();
    const reference = page.getByRole("dialog", { name: "Client information", exact: true });
    await expect(reference).toContainText("Synthetic placement notes for reference.");
    await reference.getByRole("searchbox", { name: "Find recorded information" }).fill("interview answer");
    await expect(reference.getByRole("button", { name: "Review Prior AWOL / failed placements", exact: true })).toBeVisible();
    await expect(reference.getByRole("button", { name: "Review Prior placements", exact: true })).toHaveCount(0);
    await reference.getByRole("button", { name: "Close information panel", exact: true }).click();
    await expect(pocket.getByRole("button", { name: "Client info", exact: true })).toBeFocused();

    await view.selectOption("files");
    await expect(view).toHaveValue("files");
    await view.selectOption("2");
    await expect(pocket).toBeVisible();
    await pocket.getByRole("button", { name: "Client info", exact: true }).click();
    await reference.getByRole("button", { name: "Review Prior AWOL / failed placements", exact: true }).click();
    await expect(answer).toHaveValue("Synthetic interview answer retained through navigation.");
    await page.getByRole("button", { name: /^Notifications/ }).click();
    await page.getByRole("dialog", { name: "Notifications", exact: true }).getByRole("button", { name: "Close notifications", exact: true }).click();
    await expect(answer).toHaveValue("Synthetic interview answer retained through navigation.");
    await page.getByRole("button", { name: /^Open page menu/ }).click();
    const menu = page.getByRole("dialog", { name: "Pipeline pages", exact: true });
    await expect(menu.getByRole("button", { name: "Open calendar", exact: true })).toBeVisible();
    await menu.getByRole("button", { name: "Close page menu", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await read()).signed_at).toBeNull();
  });
}

test("mobile notification center shows readable assignments and keeps failed acknowledgments", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 650 });
  const eventId = randomUUID();
  let failAcknowledgment = true;
  let seen = false;
  await page.route("**/api/operations/home", (route) => route.fulfill({ json: { continuity: {
    unavailable: false, needs_assignment_tracking_initialization: false,
    new_assignments: seen ? [] : [{ event_id: eventId, action: "assigned", actor_name: "Synthetic Supervisor", created_at: new Date().toISOString(), attention: null,
      workspace: { referral_id: 42, client_name: "Synthetic Alexandra Montgomery", community: "Synthetic community with a longer name", workflow_status: "new", priority: "normal", workspace_status: "active" } }],
  } } }));
  await page.route("**/api/me/work-continuity", (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    if (failAcknowledgment) return route.fulfill({ status: 503, json: { error: "Synthetic acknowledgment failure" } });
    seen = route.request().postDataJSON().acknowledgeAssignmentIds.includes(eventId);
    return route.fulfill({ json: { state: { schema: 1, acknowledgedAssignmentIds: [eventId] } } });
  });
  await page.goto("/?screen=calendar");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const center = page.getByRole("dialog", { name: "Notifications", exact: true });
  await expect(center).toBeInViewport();
  expect((await center.boundingBox())!.height).toBeGreaterThanOrEqual(630);
  const name = center.getByText("Synthetic Alexandra Montgomery", { exact: true });
  await expect(name).toHaveCSS("font-size", "18px");
  await expect(name).toHaveCSS("white-space", "normal");
  await page.screenshot({ path: info.outputPath("mobile-notifications.png") });
  await center.getByRole("button", { name: "Mark shown seen", exact: true }).click();
  await expect(center.getByRole("alert")).toContainText("could not be marked seen");
  await expect(name).toBeVisible();
  failAcknowledgment = false;
  await center.getByRole("button", { name: "Mark shown seen", exact: true }).click();
  await expect(name).toHaveCount(0);
  await center.getByRole("button", { name: "Close notifications", exact: true }).click();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeFocused();
});

test("phone keyboard viewport keeps the question and next control reachable", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openInterview(page);
  const answer = page.getByRole("textbox", { name: "Prior AWOL / failed placements", exact: true });
  await answer.focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: 430 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect(page.locator("[data-mobile-keyboard]")).toHaveAttribute("data-mobile-keyboard", "true");
  await expect(page.locator("[data-phone-header]")).not.toBeVisible();
  const next = (await page.locator("[data-phone-interview]").getByRole("button", { name: "Next", exact: true }).boundingBox())!;
  expect(next.y + next.height).toBeLessThanOrEqual(430);
  expect((await page.locator("[data-phone-question-scroll]").boundingBox())!.height).toBeGreaterThan(100);
  await page.screenshot({ path: info.outputPath("assessment-keyboard-open.png"), animations: "disabled" });
});

test("phone retains offline answers and syncs when reconnected", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { read } = await openInterview(page);
  const pocket = page.locator("[data-phone-interview]");
  const answer = pocket.getByRole("textbox", { name: "Prior AWOL / failed placements", exact: true });
  await page.context().setOffline(true);
  await answer.fill("Synthetic offline mobile answer.");
  await pocket.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator('[data-guide-target="assessment-save-status"]')).toContainText(/offline|device|queued/i);
  await pocket.getByRole("button", { name: "Previous question", exact: true }).click();
  await expect(answer).toHaveValue("Synthetic offline mobile answer.");
  await page.context().setOffline(false);
  await expect.poll(async () => (await read()).prior_awol_failed_placements, { timeout: 15_000 }).toBe("Synthetic offline mobile answer.");
  expect((await read()).signed_at).toBeNull();
});

test("iPhone WebKit supports portrait, landscape and iPad without replacing answers", async ({ baseURL }, info) => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const { read } = await openInterview(page);
    const answer = page.getByRole("textbox", { name: "Prior AWOL / failed placements", exact: true });
    await answer.tap();
    await expect(answer).toBeFocused();
    await answer.fill("Synthetic rotation answer.");
    await answer.blur();
    await expect.poll(async () => (await read()).prior_awol_failed_placements).toBe("Synthetic rotation answer.");
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator("[data-phone-interview]")).toBeVisible();
    await expect(page.getByRole("region", { name: "Assessment progress", exact: true })).not.toBeVisible();
    expect((await page.locator("[data-phone-question-scroll]").boundingBox())!.height).toBeGreaterThanOrEqual(120);
    await page.screenshot({ path: info.outputPath("mobile-landscape.png") });
    await expect(page.locator("[data-phone-interview]").getByRole("button", { name: "Next", exact: true })).toBeInViewport();
    await page.setViewportSize({ width: 834, height: 1194 });
    await expect(page.getByRole("complementary", { name: "Current information", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Workspace view", exact: true })).not.toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("[data-phone-interview]").getByRole("button", { name: "Client info", exact: true }).tap();
    await page.getByRole("dialog", { name: "Client information", exact: true }).getByRole("button", { name: "Review Prior AWOL / failed placements", exact: true }).tap();
    await expect(answer).toHaveValue("Synthetic rotation answer.");
    await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
    const violations = await page.evaluate(async () => {
      const axe = (window as unknown as { axe: typeof import("axe-core") }).axe;
      return (await axe.run('[data-phone-interview], [data-phone-header], [data-testid="workspace-folder-header"]', { runOnly: ["color-contrast", "button-name", "select-name", "aria-valid-attr-value"] })).violations;
    });
    expect(violations).toEqual([]);
  } finally { await browser.close(); }
});

// Batch 4, item 10: the phone keeps its one-question flow and the working
// question through Current info, Files and scheduling.
test("phone keeps the same question and focus through Current info, Files and scheduling", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { referral } = await openInterview(page);
  const pocket = page.locator("[data-phone-interview]");
  const answer = pocket.getByRole("textbox", { name: "Prior AWOL / failed placements", exact: true });
  await answer.fill("Synthetic answer kept through side trips.");
  await answer.blur();
  const position = async () => pocket.getByText(/^Question \d+ of \d+$/).textContent();
  const before = await position();

  // Current info returns focus to its opener and leaves the question in place.
  await pocket.getByRole("button", { name: "Client info", exact: true }).click();
  await page.getByRole("dialog", { name: "Client information", exact: true }).getByRole("button", { name: "Close information panel", exact: true }).click();
  await expect(pocket.getByRole("button", { name: "Client info", exact: true })).toBeFocused();
  expect(await position()).toBe(before);
  await expect(answer).toHaveValue("Synthetic answer kept through side trips.");

  // Files and back keeps the question, and lands on the question heading rather
  // than opening the software keyboard.
  const view = page.getByRole("combobox", { name: "Workspace view", exact: true });
  await view.selectOption("files");
  await expect(pocket).toHaveCount(0);
  await page.getByRole("combobox", { name: "Workspace view", exact: true }).selectOption("2");
  await expect(answer).toHaveValue("Synthetic answer kept through side trips.");
  expect(await position()).toBe(before);
  await expect(page.locator('[data-phone-question-scroll] [tabindex="-1"]')).toBeFocused();
  await expect(page).toHaveURL(/assessmentQuestion=prior_awol_failed_placements/);

  // The input stays visible above the sticky footer.
  const field = (await answer.boundingBox())!;
  const steps = (await pocket.getByRole("navigation", { name: "Question steps", exact: true }).boundingBox())!;
  expect(field.y + field.height).toBeLessThanOrEqual(steps.y + 1);
  await page.screenshot({ path: info.outputPath("phone-question-continuity.png"), animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(referral.id).toBeGreaterThan(0);
});
