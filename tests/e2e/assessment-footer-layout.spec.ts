import { closeTestBrowser } from "./support/browser-lifecycle";
import { expect, test, webkit } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { createOperationalAssessment, createOperationalReferral, startOperationalAssessment } from "./support/operational-api";

// Chunk fault injection must reach the network instead of the offline cache.
test.use({ serviceWorkers: "block" });

for (const width of [1440, 1024, 834, 640, 390, 320]) {
  test(`assessment actions and working decision remain reachable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Footer", owner: "", tags: [] });
    const assessment = await createOperationalAssessment(page.request, referral.id);
    await startOperationalAssessment(page.request, assessment);
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=interview&assessmentSection=identity`);
    const footer = page.locator('footer[aria-label="Assessment actions"]');
    const bookmark = footer.getByRole("combobox", { name: "Working decision", exact: true });
    await expect(bookmark).toBeEnabled();
    await expect(footer.getByRole("button", { name: /Excel|backup|recovery/i })).toHaveCount(0);
    // The bookmark is now deliberately available before review; it must not displace the actual question controls.
    const actions = width < 640 ? page.getByRole("navigation", { name: "Question steps", exact: true }) : page.getByRole("navigation", { name: "Assessment section steps", exact: true });
    await expect(actions).toBeInViewport();
    expect((await actions.boundingBox())!.height).toBeLessThanOrEqual(width >= 640 ? 80 : 64);
    for (const control of [bookmark, ...await actions.getByRole("button").all()]) {
      if (!await control.isVisible()) continue;
      const bounds = (await control.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      await expect(control).toBeInViewport();
    }
    if (width === 1440 || width === 390) {
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (selector: object, options: object) => Promise<AxeResults> } }).axe;
        return (await axe.run({ include: ['[data-testid="workspace-folder-header"]', 'footer[aria-label="Assessment actions"]'] }, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations;
      });
      expect(violations).toEqual([]);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`assessment-footer-${width}.png`), animations: "disabled" });
    const date = page.getByRole("button", { name: /^Interview date/ });
    await date.click();
    const dialog = page.getByRole("dialog", { name: "Interview date", exact: true });
    await expect(dialog.locator("#assessment-assessment_date")).toBeVisible();
    for (const button of await dialog.getByRole("button").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(date).toBeFocused();
  });
}

test("loading the decision cannot move assessment navigation during a press", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic stable header", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await startOperationalAssessment(page.request, assessment);
  let release = () => {};
  let decisionChunkPending = false;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  // Hold the decision's data boundary, not a string inside a generated bundle:
  // bundlers may combine the decision and assessment renderers in one chunk.
  await page.route(`**/api/referrals/${referral.id}/workflow`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    decisionChunkPending = true;
    await pending;
    await route.fulfill({ response });
  });
  try {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=interview&assessmentSection=diagnosis_clinical`);
    await page.locator("#assessment-current_symptoms").fill("Synthetic stable navigation observation");
    // The early bookmark loads with the interview; its reserved space keeps review navigation stable.
    await expect.poll(() => decisionChunkPending).toBe(true);
    // Persist the answer before reopening the saved review destination.
    await page.locator("#assessment-current_symptoms").blur();
    await expect.poll(async () => (await (await page.request.get(`/api/assessments/${assessment.assessment_id}`)).json()).assessment.current_symptoms).toBe("Synthetic stable navigation observation");
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=review`);
    await expect.poll(() => decisionChunkPending).toBe(true);
    const backToQuestions = page.getByRole("button", { name: "Back to questions", exact: true });
    await backToQuestions.click({ trial: true });
    const before = (await backToQuestions.boundingBox())!;
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    release();
    await expect(page.getByRole("combobox", { name: "Working decision", exact: true })).toBeVisible();
    const after = (await backToQuestions.boundingBox())!;
    expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(1);
    // Releasing the held press performs the click. A second click would target
    // a review control that has already unmounted after successful navigation.
    await page.mouse.up();
    await expect(page.locator("#assessment-current_symptoms")).toHaveValue("Synthetic stable navigation observation");
  } finally { release(); if (!page.isClosed()) await page.mouse.up(); }
});

test("recommendation remains available in review after starting and saves without a final decision", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Recommendation", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await startOperationalAssessment(page.request, assessment);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=review`);
  const review = page.getByRole("region", { name: "Placement recommendation", exact: true });
  const recommendation = review.getByRole("combobox", { name: "Working decision", exact: true });
  await expect(recommendation).toBeEnabled();
  const route = `**/api/referrals/${referral.id}/recommendation`;
  await page.route(route, (request) => request.fulfill({ status: 503, json: { error: "Synthetic recommendation unavailable" } }));
  await recommendation.selectOption("accept");
  await expect(review.getByRole("alert")).toContainText("Not saved. Synthetic recommendation unavailable");
  await page.unroute(route);
  await recommendation.selectOption("needs_more_information");
  await expect(review.locator("[data-quick-recommendation]").getByRole("status")).toHaveText("Working decision saved");
  await expect(recommendation).toHaveValue("needs_more_information");
  const workflow = await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json();
  expect(workflow.recommendation.outcome).toBe("needs_more_information");
  expect(workflow.decision).toBeNull();
  await page.reload();
  await expect(recommendation).toHaveValue("needs_more_information");
});

test("iPad WebKit keeps date and interview controls reachable", async ({ baseURL }) => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 834, height: 1194 }, hasTouch: true, isMobile: true });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Tablet Footer", owner: "", tags: [] });
    await createOperationalAssessment(page.request, referral.id);
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
    const footer = page.locator('footer[aria-label="Assessment actions"]');
    const read = async () => (await (await page.request.get(`/api/referrals/${referral.id}/assessments`)).json()).assessments[0];
    const entry = page.getByRole("region", { name: "Interview", exact: true });
    await entry.getByRole("button", { name: "Schedule interview", exact: true }).tap();
    const appointment = page.getByRole("dialog", { name: "Schedule interview", exact: true });
    await expect(appointment).toBeInViewport();
    await appointment.getByRole("button", { name: "Close schedule", exact: true }).tap();
    await expect(entry.getByRole("button", { name: "Schedule interview", exact: true })).toBeFocused();
    expect((await read()).started_at).toBeNull();
    await entry.getByRole("button", { name: "Start now", exact: true }).tap();
    await expect(footer.getByRole("button", { name: "Continue to decision", exact: true })).toBeVisible();
    expect((await read()).started_at).toBeTruthy();
    const date = page.getByRole("button", { name: /^Interview date/ });
    await date.tap();
    const dialog = page.getByRole("dialog", { name: "Interview date", exact: true });
    await expect(dialog).toBeInViewport();
    const bounds = (await dialog.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(834);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(1194);
    await page.keyboard.press("Escape");
    await expect(date).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await closeTestBrowser(browser); }
});
