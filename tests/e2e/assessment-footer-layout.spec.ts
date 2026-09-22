import { expect, test, webkit } from "@playwright/test";
import type { AxeResults } from "axe-core";
import { createOperationalAssessment, createOperationalReferral, startOperationalAssessment } from "./support/operational-api";

for (const width of [1440, 1024, 834, 640, 390, 320]) {
  test(`assessment footer keeps navigation separate from details at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Footer", owner: "", tags: [] });
    await createOperationalAssessment(page.request, referral.id);
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentSection=identity`);
    const footer = page.locator('footer[aria-label="Assessment actions"]');
    const details = footer.locator('summary[aria-label="Assessment details"]');
    await expect(footer).toBeVisible();
    await expect(footer.locator('[data-guide-target="assessment-save-status"]')).toContainText("All changes saved");
    await expect(footer.getByRole("combobox", { name: "Working decision", exact: true })).toHaveCount(0);
    const header = page.getByTestId("workspace-folder-header");
    await expect(header.getByRole("combobox", { name: "Working decision", exact: true })).toBeVisible();
    await expect(header.getByRole("button", { name: /Excel|recovery|Workspaces|Move workspace to trash/ })).toHaveCount(0);
    const recovery = footer.getByRole("button", { name: /Open Excel and recovery/ });
    await expect(recovery).toBeVisible();
    const identity = header.getByTestId("workspace-identity-title");
    await expect(identity.locator("+ nav")).toHaveAttribute("aria-label", "Workspace stages");
    if (width === 1440) {
      const identityBounds = (await identity.boundingBox())!;
      const stagesBounds = (await identity.locator("+ nav").boundingBox())!;
      const decisionBounds = (await header.getByRole("combobox", { name: "Working decision" }).boundingBox())!;
      expect(stagesBounds.x).toBeLessThanOrEqual(identityBounds.x + identityBounds.width + 1);
      expect(stagesBounds.x + stagesBounds.width).toBeLessThan(decisionBounds.x);
      expect(Math.abs(identityBounds.y + identityBounds.height - stagesBounds.y - stagesBounds.height)).toBeLessThan(10);
    }
    for (const control of [header.getByRole("combobox", { name: "Working decision" }), recovery]) {
      const controlBounds = (await control.boundingBox())!;
      expect(controlBounds.height).toBeGreaterThanOrEqual(44);
      expect(controlBounds.x).toBeGreaterThanOrEqual(0);
      expect(controlBounds.x + controlBounds.width).toBeLessThanOrEqual(width);
      await control.click({ trial: true });
    }
    for (const button of await header.getByRole("button").all()) {
      if (!await button.isVisible()) continue;
      const buttonBounds = (await button.boundingBox())!;
      expect(buttonBounds.x + buttonBounds.width).toBeLessThanOrEqual(width);
    }
    if (width === 1440 || width === 390) {
      await page.addScriptTag({ path: require.resolve("axe-core/axe.min.js") });
      const violations = await page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (selector: object, options: object) => Promise<AxeResults> } }).axe;
        return (await axe.run({ include: ['[data-testid="workspace-folder-header"]', 'footer[aria-label="Assessment actions"]'] }, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations;
      });
      expect(violations).toEqual([]);
    }
    await footer.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await footer.boundingBox();
    expect(bounds!.height).toBeLessThanOrEqual(width >= 640 ? 80 : 64);

    const steps = page.getByRole("navigation", { name: "Assessment section steps" });
      await expect(steps.getByRole("button", { name: "Previous section", exact: true })).toBeDisabled();
      await expect(steps.locator('[aria-label="Section 1 of 5"]')).toHaveText("1 of 5");
      await steps.getByRole("button", { name: "Next section", exact: true }).click();
      await expect(steps.locator('[aria-label="Section 2 of 5"]')).toHaveText("2 of 5");
      await expect(page.getByRole("combobox", { name: "Assessment section", exact: true })).toBeFocused();
      await steps.getByRole("button", { name: "Previous section", exact: true }).click();
      await expect(steps.locator('[aria-label="Section 1 of 5"]')).toBeVisible();
    if (width >= 640) {
      const navBounds = await steps.boundingBox();
      const detailsBounds = await details.boundingBox();
      expect(detailsBounds!.x + detailsBounds!.width).toBeLessThanOrEqual(navBounds!.x);
    } else {
      await expect(steps).toBeInViewport();
      await expect(page.getByRole("navigation", { name: "Question steps" })).toHaveCount(0);
    }
    await footer.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`assessment-footer-${width}.png`), animations: "disabled" });
    await details.click();
    const menu = footer.getByRole("group", { name: "Assessment details", exact: true });
    await expect(menu.getByRole("combobox", { name: "Working decision", exact: true })).toHaveCount(0);
    await expect(menu.getByRole("button", { name: /^Interview date/ })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Schedule interview", exact: true })).toHaveCount(0);
    for (const button of await menu.getByRole("button").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const menuBounds = await menu.boundingBox();
    expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(width);
    expect(menuBounds!.y).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: info.outputPath(`assessment-details-${width}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(details).toBeFocused();
    await recovery.click();
    const backup = page.getByRole("dialog", { name: "Backup & recovery", exact: true });
    await expect(backup).toBeVisible();
    await expect(backup.getByRole("button", { name: "Download current assessment", exact: true })).toBeVisible();
    await backup.getByRole("button", { name: "Return to assessment", exact: true }).click();
    await expect(backup).toHaveCount(0);
    await expect(recovery).toBeFocused();
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
  await page.route("**/_next/static/chunks/*.js", async (route) => {
    const response = await route.fetch();
    if ((await response.text()).includes("Retry decision")) {
      decisionChunkPending = true;
      await pending;
    }
    await route.fulfill({ response });
  });
  try {
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment&assessmentMode=interview&assessmentSection=diagnosis_clinical`);
    await page.locator("#assessment-current_symptoms").fill("Synthetic stable navigation observation");
    await expect.poll(() => decisionChunkPending).toBe(true);
    const allQuestions = page.getByRole("button", { name: "All questions", exact: true });
    await allQuestions.click({ trial: true });
    const before = (await allQuestions.boundingBox())!;
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    release();
    await expect(page.getByRole("combobox", { name: "Working decision", exact: true })).toBeVisible();
    const after = (await allQuestions.boundingBox())!;
    expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(1);
    await page.mouse.up();
    await expect(page.getByRole("button", { name: "Prepare assessment", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#assessment-current_symptoms")).toHaveValue("Synthetic stable navigation observation");
  } finally { release(); await page.mouse.up(); }
});

test("recommendation remains available after starting and saves without a final decision", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Recommendation", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await startOperationalAssessment(page.request, assessment);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
  const header = page.getByTestId("workspace-folder-header");
  const recommendation = header.getByRole("combobox", { name: "Working decision", exact: true });
  await expect(recommendation).toBeEnabled();
  const route = `**/api/referrals/${referral.id}/recommendation`;
  await page.route(route, (request) => request.fulfill({ status: 503, json: { error: "Synthetic recommendation unavailable" } }));
  await recommendation.selectOption("accept");
  await expect(header.getByRole("alert")).toContainText("Not saved. Synthetic recommendation unavailable");
  await page.unroute(route);
  await recommendation.selectOption("needs_more_information");
  await expect(header.locator("[data-quick-recommendation]").getByRole("status")).toHaveText("Working decision saved");
  await expect(recommendation).toHaveValue("needs_more_information");
  const workflow = await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json();
  expect(workflow.recommendation.outcome).toBe("needs_more_information");
  expect(workflow.decision).toBeNull();
  await page.reload();
  await expect(recommendation).toHaveValue("needs_more_information");
});

test("iPad WebKit keeps the details menu reachable without covering navigation", async ({ baseURL }) => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ baseURL, viewport: { width: 834, height: 1194 }, hasTouch: true, isMobile: true });
    const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Tablet Footer", owner: "", tags: [] });
    await createOperationalAssessment(page.request, referral.id);
    await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
    const footer = page.locator('footer[aria-label="Assessment actions"]');
    const details = footer.locator('summary[aria-label="Assessment details"]');
    await details.tap();
    const menu = footer.getByRole("group", { name: "Assessment details", exact: true });
    await expect(menu).toBeVisible();
    const bounds = (await menu.boundingBox())!;
    expect(bounds.y + bounds.height).toBeLessThanOrEqual((await footer.boundingBox())!.y + 1);
    await page.keyboard.press("Escape");
    const beginButton = page.getByRole("region", { name: "Assessment progress", exact: true }).getByRole("button", { name: "Begin interview", exact: true });
    await beginButton.tap();
    const begin = page.getByRole("dialog", { name: "Begin interview", exact: true });
    await expect(begin).toBeVisible();
    await begin.getByRole("button", { name: "Keep preparing", exact: true }).tap();
    await expect(begin).toBeHidden();
    await expect(beginButton).toBeFocused();
    await footer.getByRole("button", { name: "Next section", exact: true }).tap();
    await expect(footer.locator('[aria-label="Section 2 of 5"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await browser.close(); }
});
