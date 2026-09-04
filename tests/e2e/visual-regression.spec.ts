import { expect, test, type Page } from "@playwright/test";

test.describe("Stable visual surfaces", () => {
  test.skip(process.env.PIPELINE_VISUAL_REGRESSION !== "true", "Visual baselines run in the isolated visual gate.");

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  });

  test("desktop home matches its baseline", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStable(page, "/");
    await expect(page).toHaveScreenshot("desktop-home.png", screenshotOptions());
  });

  test("desktop referrals match their baseline", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStable(page, "/");
    await page.getByRole("button", { name: "Open referrals" }).click();
    await expect(page.getByRole("main", { name: "Referral workspaces" })).toBeVisible();
    await settleStable(page);
    await expect(page).toHaveScreenshot("desktop-referrals.png", screenshotOptions());
  });

  test("desktop profiles match their baseline", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStable(page, "/");
    await page.getByRole("button", { name: "Open client profiles" }).click();
    await expect(page.getByRole("main", { name: "Client profiles" })).toBeVisible();
    await expect(page.getByTestId("profiles-workspace").getByRole("status")).toContainText(
      "Live census information is temporarily unavailable. Referral records remain available.",
    );
    await settleStable(page);
    await expect(page).toHaveScreenshot("desktop-profiles.png", screenshotOptions());
  });

  test("desktop new referral intake matches its baseline", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openStable(page, "/");
    await page.getByRole("button", { name: "Create new referral" }).click();
    await expect(page.getByRole("region", { name: "Intake", exact: true })).toBeVisible();
    await settleStable(page);
    await expect(page).toHaveScreenshot("desktop-new-packet.png", screenshotOptions());
  });

  test("mobile referrals match their baseline", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStable(page, "/?view=referrals");
    await expect(page.getByRole("main", { name: "Referral workspaces" })).toBeVisible();
    await expect(page).toHaveScreenshot("mobile-referrals.png", screenshotOptions());
  });

  test("mobile new referral intake matches its baseline", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStable(page, "/?view=referrals");
    await page.getByRole("button", { name: "Create new referral" }).click();
    await expect(page.getByRole("region", { name: "Intake", exact: true })).toBeVisible();
    await settleStable(page);
    await expect(page).toHaveScreenshot("mobile-new-packet.png", screenshotOptions());
  });
});

async function openStable(page: Page, url: string) {
  await page.goto(url);
  await settleStable(page);
}

async function settleStable(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}

function screenshotOptions() {
  return {
    animations: "disabled" as const,
    caret: "hide" as const,
    fullPage: false,
    maxDiffPixelRatio: 0.002,
    scale: "css" as const,
  };
}
