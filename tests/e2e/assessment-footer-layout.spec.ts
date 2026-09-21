import { expect, test, webkit } from "@playwright/test";
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
    await expect(footer.getByRole("combobox", { name: "Placement recommendation", exact: true })).toBeHidden();
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
    await expect(menu.getByRole("combobox", { name: "Placement recommendation", exact: true })).toHaveCount(0);
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
  });
}

test("recommendation remains available after starting and saves without a final decision", async ({ page }) => {
  const referral = await createOperationalReferral(page.request, "assessmentCoordinator", { name: "Synthetic Recommendation", owner: "", tags: [] });
  const assessment = await createOperationalAssessment(page.request, referral.id);
  await startOperationalAssessment(page.request, assessment);
  await page.goto(`/?view=referrals&screen=packet&referralId=${referral.id}&workspaceStage=assessment`);
  const footer = page.locator('footer[aria-label="Assessment actions"]');
  const details = footer.locator('summary[aria-label="Assessment details"]');
  await details.click();
  const recommendation = footer.getByRole("combobox", { name: "Placement recommendation", exact: true });
  await expect(recommendation).toBeEnabled();
  const route = `**/api/referrals/${referral.id}/recommendation`;
  await page.route(route, (request) => request.fulfill({ status: 503, json: { error: "Synthetic recommendation unavailable" } }));
  await recommendation.selectOption("accept");
  await expect(footer.getByRole("alert")).toContainText("Synthetic recommendation unavailable");
  await page.unroute(route);
  await recommendation.selectOption("needs_more_information");
  await expect(footer.getByRole("status")).toHaveText("Recommendation saved");
  await expect(recommendation).toHaveValue("needs_more_information");
  const workflow = await (await page.request.get(`/api/referrals/${referral.id}/workflow`)).json();
  expect(workflow.recommendation.outcome).toBe("needs_more_information");
  expect(workflow.decision).toBeNull();
  await page.reload();
  await details.click();
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
